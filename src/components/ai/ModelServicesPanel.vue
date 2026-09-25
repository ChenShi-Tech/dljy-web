<script setup lang="ts">
// 模型服务「选服务」面（主仓 Epic #2661 · #2668 · #2701）。
//
// 前端不持有供应商 / 型号，也不落密钥明文：档位清单来自服务端 GET /llm/services（网关模式下由
// dljy-llm-gateway 的 /v1/models 换算而来，只剩中文标签与能力位），用户只做三件事——
// 在「接入凭据」处粘贴供应方下发的密钥（明文只随 PUT 直传服务端，页面只回显尾号）、
// 勾选启用哪些档位、把角色路由到已启用档位。密钥也可由我方在安装时预置（source==='env'）。
//
// 网关不可达 / 未配网关 → 服务端诚实返回 available:false + reason，这里原样显示
// （未配置时引导用户去填凭据）并禁用编辑，不伪造清单、不静默降级。
//
// 本组件同时服务两个档：内部档嵌在「AI 模型设置」页的「模型接入」分段里；交付档作为
// AI 工作室的「模型服务」tab 单独出现——它不含任何品牌信息，所以能进交付产物
// （产物由 verify:customer-edition-build 扫，源码由 edition.brand-keywords.spec 扫）。
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CheckCircle2, RefreshCw } from 'lucide-vue-next'
import {
  deleteCredential,
  getServices,
  getServicesUsage,
  putCredential,
  putServices,
  testSearchService,
  testService,
  type LlmServices,
  type LlmServicesUsage,
  type LlmServiceRole,
  type LlmServiceTier
} from '@/services/llm'
import { ROLE_LABELS } from '@/services/agent/agentConfig'
import { canWriteSharedResources } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'

const emit = defineEmits<{ loaded: [services: LlmServices] }>()

const services = ref<LlmServices | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const testing = ref<string>('')
const testResult = ref<Record<string, { ok: boolean; msg: string }>>({})

// 共享资源写权限（dljy#3226 · 规格 AA-06.2）：内部版仅平台超管可写，BOSS 等角色只读。
// 只控写控件——档位清单、额度展示与连通探测保持可用；后端是唯一裁决。
const canWrite = computed(() => canWriteSharedResources(getCurrentUser()?.roleCode))
const WRITE_LOCKED_TITLE = '仅平台超管可操作'

// ---- 接入凭据（#2701）----
const credentialUrl = ref('')
const credentialKey = ref('')
const credentialSaving = ref(false)
const credentialError = ref('')

const credential = computed(() => services.value?.credential ?? null)
const credentialConfigured = computed(() => credential.value?.configured === true)
const credentialSourceLabel = computed(() => {
  const s = credential.value?.source
  if (s === 'ui') return '界面填写'
  if (s === 'env') return '安装预置'
  return ''
})
// 状态行：已配置 · 来源：界面填写 / 安装预置 · 尾号 ****abcd · 更新于 …
const credentialStatusLine = computed(() => {
  if (!credentialConfigured.value) return '未配置'
  const parts = [`已配置 · 来源：${credentialSourceLabel.value}`]
  if (credential.value?.key_hint) parts.push(`尾号 ${credential.value.key_hint}`)  // 服务端已按「****+末4位」给出，这里不再叠加星号
  if (credential.value?.updated_at) parts.push(`更新于 ${formatLocalTime(credential.value.updated_at)}`)
  return parts.join(' · ')
})
// 服务端说不可用时：已配置 → 原告警；未配置 → 先引导去填凭据（description 仍显示服务端原因）
const unavailableTitle = computed(() => {
  if (services.value && !credentialConfigured.value) return '请填写供应方提供的模型服务地址与密钥'
  return '模型服务暂不可用'
})

// ---- 用量与额度（#2701）----
const usage = ref<{ loading: boolean; data: LlmServicesUsage | null; hint: string }>({
  loading: false,
  data: null,
  hint: ''
})

// ---- 联网搜索（#2701，网关统一提供）----
const searchGranted = computed(() => services.value?.search?.granted === true)
const searchAvailable = computed(() => services.value?.search?.available === true)
const searchTesting = ref(false)
const searchResult = ref<{ ok: boolean; msg: string } | null>(null)

/** 能力位 → 中文（未知能力位原样显示，不吞） */
const CAP_LABELS: Record<string, string> = {
  tool_call: '工具调用',
  vision: '图像理解',
  json_mode: '结构化输出',
  reasoning: '深度推理',
  long_context: '长上下文'
}
const capLabel = (cap: string) => CAP_LABELS[cap] ?? cap
const roleLabel = (role: string) => ROLE_LABELS[role] ?? role

const available = computed(() => services.value?.available === true)
const unavailableReason = computed(() => {
  const s = services.value
  if (!s) return loadError.value || '正在连接服务端…'
  return s.reason || (s.gateway ? '网关未返回任何档位' : '未配置模型服务网关')
})
const enabledTiers = computed(() => (services.value?.tiers ?? []).filter((t) => t.enabled && t.available))

/** 该角色可选的档位：已启用 + 具备所需能力（与服务端 PUT 的校验同口径，避免选了再被拒） */
function tiersForRole(role: LlmServiceRole): LlmServiceTier[] {
  return enabledTiers.value.filter((t) => role.requires.every((cap) => t.capabilities.includes(cap)))
}

type RoleOption = { id: string; label: string; selectable: boolean }
/**
 * 下拉选项 = 可选档位；若角色当前生效的档位不在可选集里（默认档位未启用 / 未开通），仍把它列进去
 * 但标「未启用」且不可选——否则 el-select 只能显示原始 id（实测 `dljy-standard` 直接上屏）。
 */
function optionsForRole(role: LlmServiceRole): RoleOption[] {
  const out: RoleOption[] = tiersForRole(role).map((t) => ({
    id: t.id,
    label: t.label + (t.id === role.default_tier ? '（默认）' : ''),
    selectable: true
  }))
  if (role.tier && !out.some((o) => o.id === role.tier)) {
    const t = services.value?.tiers.find((x) => x.id === role.tier)
    out.unshift({ id: role.tier, label: `${t?.label ?? role.tier}（${t?.available ? '未启用' : '未开通'}）`, selectable: false })
  }
  return out
}

function formatContext(n: number | null): string {
  if (!n) return ''
  return n >= 1000 ? `${Math.round(n / 1000)}k 上下文` : `${n} 上下文`
}

/** ISO 时间 → 本地时间展示；无效值原样返回（服务端脏数据不致显示 Invalid Date） */
function formatLocalTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

async function refreshUsage() {
  usage.value = { ...usage.value, loading: true, hint: '' }
  try {
    const r = await getServicesUsage()
    if (r.available && r.usage) {
      usage.value = { loading: false, data: r.usage, hint: '' }
    } else {
      // 服务端暂时给不出额度（如凭据未配置）：灰字说明，不弹错误
      usage.value = { loading: false, data: null, hint: r.reason || '额度信息暂不可用' }
    }
  } catch (e) {
    usage.value = { loading: false, data: null, hint: e instanceof Error ? `无法获取用量：${e.message}` : '无法获取用量' }
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    services.value = await getServices()
    // 地址输入框回服务端真实值（刷新即回真相，与档位开关失败回读同一纪律）
    credentialUrl.value = services.value?.credential?.url ?? ''
    emit('loaded', services.value)
    if (services.value?.available) void refreshUsage()
  } catch (e) {
    services.value = null
    loadError.value = e instanceof Error ? `无法连接智能体后端：${e.message}` : '无法连接智能体后端'
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function onSaveCredential() {
  if (credentialSaving.value) return
  if (!credentialKey.value) {
    credentialError.value = '请粘贴供应方提供的密钥'
    return
  }
  credentialSaving.value = true
  credentialError.value = ''
  try {
    const url = credentialUrl.value.trim()
    const r = await putCredential({ ...(url ? { url } : {}), key: credentialKey.value })
    if (r.ok && r.services) {
      // 成功用服务端回传的 services 刷新整页：档位卡随之出现，凭据状态行换回回显形态
      services.value = r.services
      credentialUrl.value = r.services.credential?.url ?? ''
      credentialKey.value = ''
      emit('loaded', r.services)
      ElMessage.success('凭据已保存，模型服务已连接')
      void refreshUsage()
    } else {
      // 服务端拒绝（密钥错 / 校验失败）：红字显示在表单下方，不清空已输入的地址
      credentialError.value = r.msg || '保存失败'
    }
  } finally {
    credentialSaving.value = false
  }
}

async function onClearCredential() {
  if (credentialSaving.value) return
  try {
    await ElMessageBox.confirm('清除后模型服务将回到未配置状态，需要重新填写密钥才能使用。', '清除接入凭据', {
      type: 'warning',
      confirmButtonText: '清除',
      cancelButtonText: '取消'
    })
  } catch {
    return // 用户取消
  }
  credentialSaving.value = true
  credentialError.value = ''
  try {
    const r = await deleteCredential()
    if (r.ok && r.services) {
      services.value = r.services
      credentialUrl.value = r.services.credential?.url ?? ''
      emit('loaded', r.services)
      ElMessage.success('已清除界面填写的凭据')
    } else {
      ElMessage.error(`清除失败：${r.msg ?? '未知错误'}`)
    }
  } finally {
    credentialSaving.value = false
  }
}

async function doSearchTest() {
  if (searchTesting.value) return
  searchTesting.value = true
  try {
    searchResult.value = await testSearchService()
  } finally {
    searchTesting.value = false
  }
}

async function apply(body: { enabled?: string[]; roles?: Record<string, string> }, okMsg: string) {
  if (saving.value) return
  saving.value = true
  try {
    const r = await putServices(body)
    if (r.ok && r.services) {
      services.value = r.services
      emit('loaded', r.services)
      ElMessage.success(okMsg)
    } else {
      ElMessage.error(`保存失败：${r.msg ?? '未知错误'}`)
      // 服务端拒绝时回读一次，把界面拉回服务端真实状态（开关不能停在「看似已改」的位置）
      await load()
    }
  } finally {
    saving.value = false
  }
}

function onToggleTier(tier: LlmServiceTier, on: boolean) {
  const current = new Set(enabledTiers.value.map((t) => t.id))
  if (on) current.add(tier.id)
  else current.delete(tier.id)
  if (current.size === 0) {
    // 服务端把空集合当作「清空选择 → 可用即启用」，关掉最后一个档位会变成全部启用（实机踩过）。
    // 这里直接拦下，并回读让开关弹回真实状态。
    ElMessage.warning('至少保留一个已启用的档位')
    void load()
    return
  }
  void apply({ enabled: [...current] }, on ? `已启用「${tier.label}」` : `已停用「${tier.label}」`)
}

function onRoleChange(role: LlmServiceRole, tier: string) {
  // 选回默认即清除覆盖（空串 = 恢复默认路由）
  const target = tier === role.default_tier ? '' : tier
  void apply({ roles: { [role.role]: target } }, `${roleLabel(role.role)} 已路由到「${tierLabel(tier)}」`)
}

function tierLabel(id: string): string {
  return services.value?.tiers.find((t) => t.id === id)?.label ?? id
}

async function doTest(tier: LlmServiceTier) {
  testing.value = tier.id
  try {
    testResult.value = { ...testResult.value, [tier.id]: await testService(tier.id) }
  } finally {
    testing.value = ''
  }
}
</script>

<template>
  <section class="card services-card">
    <div class="card-head">
      <h2>模型服务</h2>
      <span v-if="available" class="badge-ok"><CheckCircle2 :size="14" /> 服务可用</span>
      <el-button text size="small" class="reload-btn" :loading="loading" @click="load">
        <RefreshCw :size="13" /> 刷新
      </el-button>
    </div>
    <p class="sub">
      智能体使用的大模型由<strong>模型服务</strong>统一提供，按能力分为若干<strong>档位</strong>。
      这里只需勾选启用哪些档位、并为各智能体角色指定档位；密钥由供应方提供，在下方「接入凭据」处填写一次即可；页面不显示密钥明文。
    </p>

    <!-- 共享资源写权限（dljy#3226）：非平台超管只读视角，写控件整体禁用，读与探测不受影响 -->
    <el-alert
      v-if="!canWrite"
      type="info"
      :closable="false"
      show-icon
      class="readonly"
      data-test="write-locked"
      title="仅平台超管可操作"
      description="当前账号为只读视角：修改接入凭据、启用档位或调整角色路由需平台超管；额度与连通探测不受影响。"
    />

    <!-- 接入凭据（始终显示）：明文只随 PUT 直传服务端，这里只有地址输入与尾号回显 -->
    <section class="credential-card">
      <div class="cred-head">
        <span class="cred-title">接入凭据</span>
        <span class="cred-status" :class="{ ok: credentialConfigured }">{{ credentialStatusLine }}</span>
      </div>
      <p class="cred-sub">由供应方统一提供网关地址与密钥；填一次即可，更换时在此粘贴新密钥。</p>
      <div class="cred-form">
        <div class="cred-field">
          <label>模型服务地址</label>
          <el-input v-model="credentialUrl" placeholder="供应方提供的模型服务地址" :disabled="credentialSaving || !canWrite" />
        </div>
        <div class="cred-field">
          <label>模型服务密钥</label>
          <el-input
            v-model="credentialKey"
            type="password"
            show-password
            placeholder="粘贴供应方提供的密钥"
            :disabled="credentialSaving || !canWrite"
            @keyup.enter="onSaveCredential"
          />
        </div>
        <div class="cred-actions">
          <el-button type="primary" :loading="credentialSaving" :disabled="!canWrite" :title="canWrite ? undefined : WRITE_LOCKED_TITLE" @click="onSaveCredential">验证并保存</el-button>
          <el-button v-if="credential?.source === 'ui'" :disabled="credentialSaving || !canWrite" :title="canWrite ? undefined : WRITE_LOCKED_TITLE" @click="onClearCredential">清除</el-button>
          <span v-if="credentialError" class="cred-error">{{ credentialError }}</span>
        </div>
      </div>
    </section>

    <el-alert
      v-if="!available"
      type="warning"
      :closable="false"
      show-icon
      class="unavailable"
      :title="unavailableTitle"
      :description="unavailableReason"
    />

    <template v-else-if="services">
      <div class="tier-grid">
        <div
          v-for="t in services.tiers"
          :key="t.id"
          class="tier-card"
          :class="{ off: !t.enabled || !t.available, unavailable: !t.available }"
        >
          <div class="tier-head">
            <span class="tier-label">{{ t.label }}</span>
            <el-switch
              :model-value="t.enabled && t.available"
              :disabled="!t.available || saving || !canWrite"
              :title="canWrite ? undefined : WRITE_LOCKED_TITLE"
              size="small"
              @change="(v: string | number | boolean) => onToggleTier(t, v === true)"
            />
          </div>
          <p class="tier-desc">{{ t.description || '—' }}</p>
          <div class="tier-caps">
            <span v-for="cap in t.capabilities" :key="cap" class="cap-tag">{{ capLabel(cap) }}</span>
            <span v-if="t.context_window" class="cap-tag ctx">{{ formatContext(t.context_window) }}</span>
          </div>
          <div class="tier-foot">
            <span v-if="!t.available" class="tier-note bad">未开通——请联系供应方</span>
            <template v-else>
              <el-button text size="small" :loading="testing === t.id" @click="doTest(t)">测试连接</el-button>
              <span
                v-if="testResult[t.id]"
                class="test-msg"
                :class="{ ok: testResult[t.id].ok, bad: !testResult[t.id].ok }"
              >{{ testResult[t.id].msg }}</span>
            </template>
          </div>
        </div>
      </div>

      <div class="roles-block">
        <div class="roles-title">角色 → 档位</div>
        <p class="sub2">每个智能体角色只能路由到<strong>已启用且具备所需能力</strong>的档位；选回默认档位即恢复默认路由。</p>
        <div class="route-table">
          <div v-for="role in services.roles" :key="role.role" class="route-row">
            <span class="route-name">
              {{ roleLabel(role.role) }}
              <span v-for="cap in role.requires" :key="cap" class="cap-tag">{{ capLabel(cap) }}</span>
            </span>
            <el-select
              :model-value="role.tier ?? ''"
              class="route-select"
              :disabled="saving || !canWrite"
              :title="canWrite ? undefined : WRITE_LOCKED_TITLE"
              :placeholder="role.tier ? '' : '默认档位未开通'"
              @change="(v: string) => onRoleChange(role, v)"
            >
              <el-option
                v-for="o in optionsForRole(role)"
                :key="o.id"
                :label="o.label"
                :value="o.id"
                :disabled="!o.selectable"
              />
            </el-select>
            <span v-if="role.override" class="muted-tag">已覆盖</span>
          </div>
        </div>
      </div>

      <!-- 用量与额度（available 时显示；服务端给不出时灰字说明、不弹错误） -->
      <section class="sub-card usage-card">
        <div class="sub-card-title">用量与额度</div>
        <template v-if="usage.data">
          <div class="usage-grid">
            <div class="usage-item">
              <span class="usage-label">今日请求</span>
              <span class="usage-val">已用 {{ usage.data.today.requests }} / 上限 {{ usage.data.quota.requests_per_day ?? '不限' }}</span>
              <span class="usage-remain">剩余 {{ usage.data.remaining.requests ?? '不限' }}</span>
            </div>
            <div class="usage-item">
              <span class="usage-label">今日 Token</span>
              <span class="usage-val">已用 {{ usage.data.today.total_tokens }} / 上限 {{ usage.data.quota.tokens_per_day ?? '不限' }}</span>
              <span class="usage-remain">剩余 {{ usage.data.remaining.tokens ?? '不限' }}</span>
            </div>
          </div>
          <p class="usage-reset">额度于 {{ formatLocalTime(usage.data.resets_at) }} 重置</p>
          <p v-if="usage.data.today.usage_unknown > 0" class="usage-hint">
            另有 {{ usage.data.today.usage_unknown }} 次调用未计入用量。
          </p>
          <table v-if="usage.data.rows.length" class="usage-table">
            <thead>
              <tr><th>日期</th><th>档位</th><th>请求数</th><th>失败</th><th>Token</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in usage.data.rows" :key="`${row.day}-${row.tier}-${i}`">
                <td>{{ row.day }}</td>
                <td>{{ tierLabel(row.tier) }}</td>
                <td>{{ row.requests }}</td>
                <td>{{ row.failed }}</td>
                <td>{{ row.total_tokens }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-else class="usage-hint">{{ usage.loading ? '正在获取用量…' : usage.hint }}</p>
      </section>

      <!-- 联网搜索（available 时显示；开通状态由模型服务统一给出） -->
      <section class="sub-card search-card">
        <div class="sub-card-title">联网搜索</div>
        <template v-if="searchGranted && searchAvailable">
          <div class="search-row">
            <span class="badge-ok"><CheckCircle2 :size="14" /> 已开通 · 由模型服务统一提供</span>
            <el-button text size="small" :loading="searchTesting" @click="doSearchTest">测试</el-button>
            <span v-if="searchResult" class="test-msg" :class="{ ok: searchResult.ok, bad: !searchResult.ok }">{{ searchResult.msg }}</span>
          </div>
        </template>
        <template v-else-if="searchGranted">
          <p class="search-note">暂时不可用</p>
          <p class="usage-hint">{{ services.search?.reason || '稍后再试' }}</p>
        </template>
        <p v-else class="search-note bad">未开通——请联系供应方</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.services-card { display: flex; flex-direction: column; }
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: 0 12px 30px -22px rgba(16, 60, 60, 0.35);
}
.card-head { display: flex; align-items: center; gap: 12px; }
.card-head h2 { margin: 0; font-size: var(--font-20); color: var(--text); }
.reload-btn { margin-left: auto; }
.badge-ok {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px; font-size: var(--font-sm);
  color: var(--primary); background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.sub { margin: 10px 0 18px; font-size: var(--font-md); line-height: 1.7; color: var(--muted); }
.sub strong { color: var(--primary); }
.sub2 { margin: 0 0 14px; font-size: var(--font-12-5); line-height: 1.6; color: var(--muted); }
.unavailable { margin-top: 4px; }
.readonly { margin-bottom: 14px; }

.tier-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.tier-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px 16px; border: 1px solid var(--line-soft); border-radius: 12px;
  background: var(--panel);
}
.tier-card.off { opacity: 0.72; }
.tier-card.unavailable { border-style: dashed; }
.tier-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tier-label { font-size: var(--font-15); font-weight: 600; color: var(--text); }
.tier-desc { margin: 0; font-size: var(--font-sm); line-height: 1.6; color: var(--el-text-color-secondary); min-height: 2.6em; }
.tier-caps { display: flex; flex-wrap: wrap; gap: 6px; }
.cap-tag { font-size: var(--font-10-5); font-weight: 500; color: var(--primary); background: var(--primary-tint); padding: 0 6px; border-radius: 999px; }
.cap-tag.ctx { color: var(--el-text-color-secondary); background: var(--line-faint); }
.tier-foot { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.tier-note { font-size: var(--font-sm); }
.test-msg { font-size: var(--font-sm); }
.test-msg.ok, .tier-note.ok { color: var(--primary); }
.test-msg.bad, .tier-note.bad { color: var(--danger); }

.roles-block { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line-faint); }
.roles-title { font-size: var(--font-md); font-weight: 600; color: var(--text-body); margin-bottom: 6px; }
.route-table { display: flex; flex-direction: column; gap: 4px; }
.route-row { display: flex; align-items: center; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--line-faint); }
.route-name { min-width: 180px; font-size: var(--font-md); font-weight: 600; color: var(--text-body); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.route-select { flex: 1; max-width: 320px; }
.muted-tag { font-weight: 400; font-size: var(--font-sm); color: var(--el-text-color-secondary); }

/* 接入凭据（#2701）：服务状态 + 地址/密钥表单；样式对齐 tier-card 的子卡观感 */
.credential-card {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--panel);
}
.cred-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.cred-title { font-size: var(--font-15); font-weight: 600; color: var(--text); }
.cred-status { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.cred-status.ok { color: var(--primary); }
.cred-sub { margin: 4px 0 12px; font-size: var(--font-12-5); line-height: 1.6; color: var(--muted); }
.cred-form { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
.cred-field { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 220px; }
.cred-field label { font-size: var(--font-12-5); font-weight: 600; color: var(--text-body); }
.cred-actions { display: flex; align-items: center; gap: 10px; }
.cred-error { font-size: var(--font-sm); color: var(--danger); }

/* 用量与额度 / 联网搜索（#2701）：与 roles-block 同级的收尾子卡 */
.sub-card { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line-faint); }
.sub-card-title { font-size: var(--font-md); font-weight: 600; color: var(--text-body); margin-bottom: 10px; }
.usage-grid { display: flex; gap: 32px; flex-wrap: wrap; }
.usage-item { display: flex; flex-direction: column; gap: 4px; }
.usage-label { font-size: var(--font-12-5); font-weight: 600; color: var(--text-body); }
.usage-val { font-size: var(--font-15); color: var(--text); }
.usage-remain { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.usage-reset { margin: 10px 0 0; font-size: var(--font-sm); color: var(--muted); }
.usage-hint { margin: 6px 0 0; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.usage-table { margin-top: 12px; border-collapse: collapse; font-size: var(--font-sm); }
.usage-table th, .usage-table td { padding: 5px 14px 5px 0; text-align: left; color: var(--text-body); border-bottom: 1px solid var(--line-faint); }
.usage-table th { font-weight: 600; color: var(--el-text-color-secondary); }

.search-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.search-note { margin: 0; font-size: var(--font-md); color: var(--text-body); }
.search-note.bad { color: var(--el-text-color-secondary); }

@media (max-width: 1180px) {
  .route-name { min-width: 120px; }
}
</style>
