<script setup lang="ts">
// 推理模型管理页（/system/models，dljy#2465 · Epic dljy#2455 4.3.11）——南洋推理服务的唯一管理面。
// 只读 + 启用/禁用/切版本（用户拍板）；写操作经 agent-backend 代理并由服务端按平台 RBAC 校验 ADMIN/BOSS。
// 顶部健康条三态（unreachable / unauthorized / ok）——目录接口把异常吞成空数组是刻意的诚实缺席，
// 但管理页必须分清「南洋没连上」和「南洋上没有模型」。
// 表格的「协变量供给」列 = 模型声明 × 平台协变量注册表（契约 io.covariates[].platformStatus）：
// 直接标出「目录可用但平台供不全」的模型（rt-dynamic-tmoe-covariates 就是这种）。
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ForecastModel } from '@/services/forecast/modelContract'
import {
  activateRemoteVersion, bareModelId, fetchRemoteHealth, fetchRemoteModels, fetchRemoteVersions,
  reloadRemoteModel, rescanRemote, setRemoteModelEnabled, unloadRemoteModel,
  type RemoteHealth, type RemoteModelVersion,
} from '@/services/forecast/remoteModelAdmin'

const health = ref<RemoteHealth | null>(null)
const models = ref<ForecastModel[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref<Record<string, boolean>>({})
const versionDialog = ref<{ open: boolean; modelId: string; name: string; rows: RemoteModelVersion[]; loading: boolean }>({
  open: false, modelId: '', name: '', rows: [], loading: false,
})

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [h, ms] = await Promise.all([fetchRemoteHealth(), fetchRemoteModels().catch((e: unknown) => { error.value = errText(e); return [] as ForecastModel[] })])
    health.value = h
    models.value = ms
  } catch (e) {
    health.value = { state: 'unreachable', reason: errText(e) }
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const healthLabel = computed(() => {
  const h = health.value
  if (!h) return { type: 'info', text: '未探测' }
  if (h.state === 'ok') return { type: 'success', text: `在线 · ${h.modelCount ?? '?'} 个模型 · ${h.contractVersion ?? ''} · ${h.version ?? ''} · ${h.device ?? ''}` }
  if (h.state === 'unauthorized') return { type: 'warning', text: `连上了但平台凭据在南洋无效：${h.reason ?? ''}` }
  return { type: 'danger', text: `连不上推理服务：${h.reason ?? ''}` }
})

// 来源标签（契约 source：local / remote:native / remote:bundle / remote:nf / remote:zeroshot）
const sourceLabel = (s?: string) => ({ 'remote:native': '南洋原生', 'remote:bundle': '外部交付', 'remote:nf': 'NeuralForecast', 'remote:zeroshot': '零样本' } as Record<string, string>)[s ?? ''] ?? (s ?? '—')
const versionOf = (m: ForecastModel) => m.lineage?.activeVersion ?? m.lineage?.version ?? '—'
const isDisabledByAdmin = (m: ForecastModel) => !m.available && /管理页禁用|已禁用/.test(m.unavailableReason ?? '')
/** 协变量供给交叉：全部可供 / 缺 N 个（红） / 单变量 */
function supplySummary(m: ForecastModel): { text: string; blocked: number; total: number } {
  const covs = m.io?.covariates ?? []
  const blocked = covs.filter((c) => c.platformStatus === 'blocked').length
  if (!covs.length) return { text: '单变量', blocked: 0, total: 0 }
  return { text: blocked ? `缺 ${blocked}/${covs.length}` : `${covs.length} 项齐全`, blocked, total: covs.length }
}

async function withBusy(id: string, fn: () => Promise<void>) {
  busy.value = { ...busy.value, [id]: true }
  try { await fn() } catch (e) { ElMessage.error(errText(e)) } finally {
    busy.value = { ...busy.value, [id]: false }
  }
}

async function toggleEnabled(m: ForecastModel) {
  const enable = !m.available
  if (!enable) {
    try {
      await ElMessageBox.confirm(`停用「${m.name ?? m.modelId}」后平台目录立即不可选，正在进行的预测不受影响。`, '停用模型', { type: 'warning' })
    } catch { return }
  }
  await withBusy(m.modelId, async () => {
    await setRemoteModelEnabled(m.modelId, enable)
    ElMessage.success(`${m.name ?? m.modelId} 已${enable ? '启用' : '停用'}`)
    await load()
  })
}

async function openVersions(m: ForecastModel) {
  versionDialog.value = { open: true, modelId: m.modelId, name: m.name ?? m.modelId, rows: [], loading: true }
  try {
    versionDialog.value.rows = await fetchRemoteVersions(m.modelId)
  } catch (e) {
    ElMessage.error(errText(e))
  } finally {
    versionDialog.value.loading = false
  }
}

async function activate(v: RemoteModelVersion) {
  const id = versionDialog.value.modelId
  await withBusy(id, async () => {
    await activateRemoteVersion(id, v.version)
    ElMessage.success(`已切到版本 ${v.version}`)
    versionDialog.value.open = false
    await load()
  })
}

async function memory(m: ForecastModel, action: 'reload' | 'unload') {
  if (action === 'unload') {
    try { await ElMessageBox.confirm(`卸载「${m.name ?? m.modelId}」的权重会释放显存，目录仍列出但标不可用；装回需重新加载。`, '卸载显存', { type: 'warning' }) } catch { return }
  }
  await withBusy(m.modelId, async () => {
    await (action === 'reload' ? reloadRemoteModel(m.modelId) : unloadRemoteModel(m.modelId))
    ElMessage.success(action === 'reload' ? '已重新装载' : '已卸载')
    await load()
  })
}

async function rescan() {
  await withBusy('__rescan', async () => {
    const r = await rescanRemote()
    ElMessage.success(`重扫完成：${r.modelCount} 个模型 / ${r.availableCount} 可用（metadata 与字段字典是进程内缓存，改了须重启）`)
    await load()
  })
}
</script>

<template>
  <div class="system-models">
    <el-card>
      <template #header>
        <div class="head">
          <span class="title">推理模型管理</span>
          <el-tag class="health" :type="healthLabel.type" size="small" data-test="health">{{ healthLabel.text }}</el-tag>
          <span class="spacer" />
          <el-button size="small" :loading="loading" @click="load">刷新</el-button>
          <el-button size="small" type="primary" :loading="busy.__rescan" :disabled="health?.state !== 'ok'" @click="rescan">重扫目录</el-button>
        </div>
      </template>

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="err" />
      <el-alert v-else-if="health?.state === 'unauthorized'" type="warning" :closable="false" show-icon
        title="平台能连到推理服务，但平台凭据在南洋没有权限——检查南洋侧平台用户角色或令牌配置；本页只读、写操作会被拒。" />

      <table class="models-table" data-test="models">
        <thead>
          <tr>
            <th>模型</th><th>标的</th><th>粒度</th><th>架构</th><th>来源</th><th>版本</th><th>状态</th><th>协变量供给</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in models" :key="m.modelId" :data-model="m.modelId">
            <td>
              <div class="name">{{ m.name ?? m.modelId }}</div>
              <div class="mono">{{ bareModelId(m.modelId) }}</div>
            </td>
            <td>{{ m.target }}<span v-if="m.unit" class="dim"> · {{ m.unit }}</span></td>
            <td>{{ m.io ? `${m.io.intervalMinutes} 分钟 · 回看 ${m.io.seqLen ?? '?'} · 出 ${m.io.predLen ?? '?'}` : '—' }}</td>
            <td class="mono">{{ m.framework ?? '—' }}</td>
            <td>{{ sourceLabel(m.source) }}<span v-if="m.lineage?.bundleId" class="dim"> · {{ m.lineage.bundleId }}</span></td>
            <td class="mono">{{ versionOf(m) }}<span v-if="m.lineage?.versionCount" class="dim"> /{{ m.lineage.versionCount }}</span></td>
            <td>
              <el-tag :type="m.available ? 'success' : 'danger'" size="small" :title="m.unavailableReason ?? ''" data-test="avail">
                {{ m.available ? '可用' : (isDisabledByAdmin(m) ? '已停用' : '不可用') }}
              </el-tag>
              <div v-if="m.unavailableReason" class="reason">{{ m.unavailableReason }}</div>
            </td>
            <td>
              <el-tag :type="supplySummary(m).blocked ? 'danger' : (supplySummary(m).total ? 'success' : 'info')" size="small" data-test="supply">
                {{ supplySummary(m).text }}
              </el-tag>
              <div class="covs">
                <span v-for="c in (m.io?.covariates ?? [])" :key="c.field" class="cov" :class="c.platformStatus"
                  :title="c.platformStatus === 'available' ? c.field : `${c.field}：${c.blockedReason || '平台供不上'}`">
                  {{ c.labelZh || c.field }}
                </span>
              </div>
            </td>
            <td class="ops">
              <el-button size="small" :type="m.available ? 'warning' : 'success'" :loading="busy[m.modelId]"
                :disabled="health?.state !== 'ok'" data-test="toggle" @click="toggleEnabled(m)">
                {{ m.available ? '停用' : '启用' }}
              </el-button>
              <el-button size="small" :disabled="health?.state !== 'ok'" data-test="versions" @click="openVersions(m)">版本</el-button>
              <el-button v-if="m.lineage?.loaded === false" size="small" :disabled="health?.state !== 'ok'" @click="memory(m, 'reload')">装载</el-button>
              <el-button v-else-if="m.lineage?.loaded === true" size="small" :disabled="health?.state !== 'ok'" @click="memory(m, 'unload')">卸载</el-button>
            </td>
          </tr>
          <tr v-if="!loading && !models.length">
            <td colspan="9" class="empty">{{ health?.state === 'ok' ? '南洋目录为空' : '未取到模型清单（见上方健康状态）' }}</td>
          </tr>
        </tbody>
      </table>
    </el-card>

    <el-dialog v-model="versionDialog.open" :title="`版本槽位 · ${versionDialog.name}`" width="720px">
      <table class="models-table" data-test="versions-table">
        <thead><tr><th>版本</th><th>训练时间</th><th>训练窗口</th><th>校验和</th><th>状态</th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in versionDialog.rows" :key="v.version">
            <td class="mono">{{ v.version }}</td>
            <td>{{ v.trainedAt ?? '—' }}</td>
            <td>{{ v.trainWindow ? v.trainWindow.join(' ~ ') : '—' }}</td>
            <td class="mono">{{ (v.checksum ?? '').slice(0, 19) }}</td>
            <td>
              <el-tag v-if="v.active" type="success" size="small">当前</el-tag>
              <el-tag v-else-if="v.hasCheckpoint === false" type="danger" size="small">缺权重</el-tag>
              <el-tag v-if="v.bundleManaged" type="info" size="small">外部交付</el-tag>
            </td>
            <td>
              <el-button v-if="!v.active && !v.bundleManaged" size="small" type="primary"
                :loading="busy[versionDialog.modelId]" data-test="activate" @click="activate(v)">切到此版本</el-button>
            </td>
          </tr>
          <tr v-if="!versionDialog.loading && !versionDialog.rows.length"><td colspan="6" class="empty">无版本槽位信息</td></tr>
        </tbody>
      </table>
    </el-dialog>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 10px; }
.title { font-weight: 600; }
.spacer { flex: 1; }
.err { margin-bottom: 8px; }
.models-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 12px); }
.models-table th, .models-table td { border-bottom: 1px solid var(--el-border-color-lighter); padding: 6px 8px; text-align: left; vertical-align: top; }
.models-table th { color: var(--el-text-color-secondary); font-weight: 500; }
.name { font-weight: 500; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dim, .reason { color: var(--el-text-color-secondary); }
.reason { max-width: 260px; }
.covs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.cov { padding: 0 6px; border-radius: 3px; background: var(--el-color-success-light-9); color: var(--el-color-success); }
.cov.blocked { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.ops { white-space: nowrap; }
.empty { text-align: center; color: var(--el-text-color-secondary); padding: 18px 0; }
</style>
