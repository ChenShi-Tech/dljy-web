<script setup lang="ts">
// 四川披露采集服务运维面板（Issue #1621 / Epic #1618；#1896 从独立页抽为本面板）。
//
// 让 Java 采集服务（127.0.0.1:8090）的状态「可见可控」——不看日志也能判断采集是否正常。
// 数据全部来自真实服务（经 Node 转发层 /api/v1/sichuan-ingest），无 Mock 兜底：
// - 服务不可达（502）→ 显式红色「服务不可达」态
// - 库不可达（503）→ 红色「服务在运行但数据库不可达」
// - 手动触发 → Java 侧 per-menuCode 内存锁（skipped 软拒绝）满足幂等
// - 无数据 → 诚实空态
//
// #1896 起本面板是「数据源接入 → 电网官方平台」tab 里四川接入点的一部分（凭据录入在其上方的
// SichuanCredentialCard）。故本面板只管「服务运维」：存活/数据集/运行/触发；**不再重复展示凭据掩码**
// （凭据的录入、生效集、掩码归 SichuanCredentialCard，#1925 起还含按账号隔离语义）——
// 这里只保留 overview 里一个「凭据是否齐全」的布尔标签，作为「采集能否跑起来」的快判。
//
// 当前是四川专用（直连 /api/v1/sichuan-ingest）；#1895 采集服务省份化后按接入点泛化。
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CheckCircle2, Clock, Database, RefreshCw, ServerCog, XCircle } from 'lucide-vue-next'
import { ApiError } from '@/services/api'
import {
  ALERT_LEVEL_LABEL,
  ALERT_LEVEL_TYPE,
  DATASET_KEY_TO_MENU_CODE,
  FAILURE_KIND_LABEL,
  FAILURE_KIND_TAG_TYPE,
  RUN_STATUS_TAG_TYPE,
  TRIGGER_SOURCE_LABEL,
  fetchSichuanIngestHealth,
  fetchSichuanIngestStatus,
  triggerSichuanIngest,
  type SichuanIngestHealth,
  type SichuanIngestStatus,
  type SichuanTriggerItem,
  type SichuanTriggerSource,
} from '@/services/sichuanAccess'

const status = ref<SichuanIngestStatus | null>(null)
const health = ref<SichuanIngestHealth | null>(null)
const loading = ref(false)
const triggering = ref(false)
const lastUpdatedAt = ref<string | null>(null)

// 三类错误态（互斥）：forbidden=非管理员；unreachable=Java 服务不可达(502)；dbDown=库不可达(503)
const forbidden = ref(false)
const unreachable = ref(false)
const dbDownError = ref<string>('')

// 数据集 key → 中文标签映射（从 status.menus 派生，menus 缺失时用 code 兜底）。
const menuLabelByCode = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const m of status.value?.menus ?? []) {
    map[m.code] = m.label
  }
  return map
})

const datasets = computed(() => {
  const ds = status.value?.datasets
  if (!ds) return []
  type DatasetKey = 'loadForecast' | 'reservoirPlan'
  return (Object.keys(DATASET_KEY_TO_MENU_CODE) as DatasetKey[]).map((key) => {
    const code = DATASET_KEY_TO_MENU_CODE[key]
    const summary = ds[key]
    return {
      key,
      code,
      label: menuLabelByCode.value[code] ?? code,
      records: summary?.records ?? null,
      latestMonth: summary?.latest_month ?? null,
      lastCaptured: summary?.last_captured ?? null,
    }
  })
})

const recentRuns = computed(() => status.value?.recentRuns ?? [])

// 连续失败告警（Issue #1622）。
const alerts = computed(() => status.value?.alerts ?? [])

// 服务端没给 alerts 键 = 采集服务还是引入告警之前的版本。
// **不能当成「没有告警」渲染**——那会把「不知道有没有断」显示成「一切正常」，
// 正是这个面板最该避免的假绿。
const alertsUnsupported = computed(() => !!status.value && status.value.alerts === undefined)

function triggerSourceLabel(source: string): string {
  return TRIGGER_SOURCE_LABEL[source as SichuanTriggerSource] ?? source
}

// 是否有正在进行的采集（用于轮询启停）。
const hasRunning = computed(() => recentRuns.value.some((r) => r.status === 'running'))

async function reload() {
  loading.value = true
  // 重置瞬时错误态（forbidden 保留，因 403 不会因重试改变）。
  unreachable.value = false
  dbDownError.value = ''
  try {
    const [st, hd] = await Promise.all([
      fetchSichuanIngestStatus(),
      fetchSichuanIngestHealth().catch(() => null),
    ])
    status.value = st
    health.value = hd
    forbidden.value = false
    lastUpdatedAt.value = new Date().toLocaleString()
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      forbidden.value = true
    } else if (e instanceof ApiError && e.status === 502) {
      unreachable.value = true
      status.value = null
      health.value = null
    } else if (e instanceof ApiError && e.status === 503) {
      // 库不可达：转发层透传部分响应（credential 等已在 payload.data）。
      const partial = e.payload?.data as SichuanIngestStatus | undefined
      dbDownError.value = partial?.databaseError || e.message || '数据库不可达'
      status.value = partial ?? null
      health.value = null
    } else {
      unreachable.value = true
      status.value = null
      health.value = null
    }
  } finally {
    loading.value = false
  }
}

// 触发采集：menuCode 缺省触发全部。展示 success/skipped/failed 三态提示。
async function doTrigger(menuCode?: string) {
  if (triggering.value) return
  triggering.value = true
  const label = menuCode ? (menuLabelByCode.value[menuCode] ?? menuCode) : '全部数据集'
  try {
    const result = await triggerSichuanIngest(menuCode)
    for (const item of result.results) {
      reportTriggerItem(item, label)
    }
    // 触发后刷新状态（采集可能仍在 running，轮询会接力）。
    await reload()
  } catch (e) {
    const msg = e instanceof Error ? e.message : '触发失败'
    ElMessage.error(`触发「${label}」失败：${msg}`)
  } finally {
    triggering.value = false
  }
}

function reportTriggerItem(item: SichuanTriggerItem, scopeLabel: string) {
  const itemLabel = menuLabelByCode.value[item.menuCode] ?? item.menuCode
  if (item.status === 'success') {
    ElMessage.success(`「${itemLabel}」采集成功：新增 ${item.inserted ?? 0} 条（共拉取 ${item.fetched ?? 0} 条）`)
    return
  }
  if (item.status === 'skipped') {
    // 软拒绝：同数据集正在采集中（Java per-menuCode 锁）。不计失败率，用 warning 非 error。
    ElMessage.warning(`「${itemLabel}」已跳过：${item.message ?? '该数据集正在采集中'}`)
    return
  }
  // failed：带失败类别与详情，便于排查。
  const kindText = item.failureKind ? `［${FAILURE_KIND_LABEL[item.failureKind]}］` : ''
  ElMessage.error(`「${itemLabel}」采集失败${kindText}：${item.message ?? item.failureKind ?? '未知原因'}`)
}

// —— KeepAlive 安全轮询（守 #1736：onActivated/onDeactivated 对称启停）——
// 本面板经 tab KeepAlive 缓存：切到别的 tab 触发 onDeactivated（停轮询），切回触发 onActivated（恢复）。
let pollTimer: number | undefined
function startPoll() {
  stopPoll()
  pollTimer = window.setInterval(() => {
    if (hasRunning.value && !loading.value) reload()
  }, 5000)
}
function stopPoll() {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}

onMounted(() => {
  reload()
  startPoll()
})
onActivated(startPoll)
onDeactivated(stopPoll)
onBeforeUnmount(stopPoll)

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}
</script>

<template>
  <section class="ops-panel">
    <div class="ops-head">
      <div class="ops-title"><ServerCog :size="18" aria-hidden="true" /><span>采集服务运维</span></div>
      <div class="ops-actions">
        <span v-if="lastUpdatedAt" class="updated-at">最近更新：{{ lastUpdatedAt }}</span>
        <el-button :icon="RefreshCw" :loading="loading" size="small" type="primary" @click="reload">刷新</el-button>
      </div>
    </div>

    <!-- 互斥错误态 -->
    <el-alert
      v-if="forbidden"
      type="warning"
      :closable="false"
      show-icon
      title="仅系统管理员(ADMIN/BOSS)可查看采集服务状态"
      description="本面板为运维管理面。请联系管理员配置，或切换管理员账号。"
    />
    <el-alert
      v-else-if="unreachable"
      type="error"
      :closable="false"
      show-icon
      title="四川采集服务不可达（127.0.0.1:8090 未响应）"
    >
      <div>采集可能已中断。请检查：</div>
      <ol class="troubleshoot">
        <li>Java 服务进程是否在运行（integrations/sichuan-ingest）</li>
        <li>端口 8090 是否监听（默认只绑 127.0.0.1）</li>
        <li><code>SICHUAN_INGEST_URL</code> 环境变量是否指向正确地址</li>
      </ol>
    </el-alert>
    <el-alert
      v-else-if="dbDownError"
      type="error"
      :closable="false"
      show-icon
      :title="`服务在运行，但数据库不可达：${dbDownError}`"
      description="Java 服务进程存活，但无法连接 PostgreSQL。请检查 dljy-postgres 容器与 DLJY_PG_URL 配置。"
    />

    <template v-else>
      <!-- 连续失败告警（Issue #1622）：放在最上方，且不可关闭——
           它回答的是「这个数据集现在是不是断了」，比任何统计都该先被看到。 -->
      <el-alert
        v-for="alert in alerts"
        :key="alert.menuCode"
        :type="ALERT_LEVEL_TYPE[alert.level]"
        :closable="false"
        show-icon
        :title="`［${ALERT_LEVEL_LABEL[alert.level]}］「${alert.menuLabel}」自 ${formatTime(alert.since)} 起连续失败 ${alert.consecutiveFailures} 次`"
      >
        <div class="alert-hint">处置：{{ alert.hint }}</div>
        <div v-if="alert.lastFailureKind" class="alert-meta">
          最近一次失败：{{ formatTime(alert.lastFailedAt) }}（{{ FAILURE_KIND_LABEL[alert.lastFailureKind] }}）
        </div>
      </el-alert>
      <el-alert
        v-if="alertsUnsupported"
        type="info"
        :closable="false"
        show-icon
        title="当前采集服务未提供连续失败告警"
        description="服务版本早于 Issue #1622，无法判断数据集是否已连续多次采集失败。重新构建并重启 integrations/sichuan-ingest 后可见。"
      />

      <!-- 服务概览 -->
      <el-descriptions v-if="status" :column="3" border size="small" class="overview">
        <el-descriptions-item label="服务标识">{{ status.service }}</el-descriptions-item>
        <el-descriptions-item label="上游平台">{{ status.baseAddress }}</el-descriptions-item>
        <el-descriptions-item label="调度 CRON">{{ status.scheduleCron }}</el-descriptions-item>
        <el-descriptions-item label="进程探活">
          <el-tag v-if="health?.status === 'up'" type="success" size="small">
            <CheckCircle2 :size="14" style="vertical-align: middle" /> 在线
          </el-tag>
          <el-tag v-else type="info" size="small">
            <XCircle :size="14" style="vertical-align: middle" /> 未探活
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="数据库">
          <el-tag :type="status.databaseAvailable ? 'success' : 'danger'" size="small">
            {{ status.databaseAvailable ? '可用' : '不可用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="凭据状态">
          <el-tag :type="status.credential.configured ? 'success' : 'danger'" size="small">
            {{ status.credential.configured ? '已配置齐全' : '未配置齐全' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
      <p v-if="status && !status.credential.configured" class="hint">
        凭据未配置齐全，采集会以「凭据不完整」失败。录入与连通测试见上方「四川开放平台凭据」卡片。
      </p>

      <!-- 数据集统计 -->
      <el-card v-if="status" shadow="never" class="section">
        <template #header>
          <div class="card-header"><Database :size="16" /><span>数据集统计</span></div>
        </template>
        <el-table :data="datasets" size="small">
          <el-table-column label="数据集" min-width="220">
            <template #default="{ row }">
              <div class="ds-code">{{ row.code }}</div>
              <div class="ds-label">{{ row.label }}</div>
            </template>
          </el-table-column>
          <el-table-column label="记录数" width="100">
            <template #default="{ row }">{{ row.records ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="最新数据月份" width="140">
            <template #default="{ row }">{{ row.latestMonth ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="最近落库时间" min-width="180">
            <template #default="{ row }">{{ formatTime(row.lastCaptured) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!datasets.length" description="暂无数据集统计（服务尚未返回数据集信息）" :image-size="60" />
      </el-card>

      <!-- 手动触发 -->
      <el-card v-if="status" shadow="never" class="section">
        <template #header>
          <div class="card-header"><ServerCog :size="16" /><span>手动触发采集</span></div>
        </template>
        <div class="trigger-row">
          <el-button :loading="triggering" type="primary" @click="doTrigger()">触发全部数据集</el-button>
          <el-button
            v-for="m in (status.menus ?? [])"
            :key="m.code"
            :loading="triggering"
            @click="doTrigger(m.code)"
          >
            触发「{{ m.label }}」
          </el-button>
        </div>
        <div class="hint">同一数据集并发触发会被服务端跳过（返回 skipped），不会重复采集。重复拉取同月份内容时新增数为 0（按内容哈希去重）。</div>
      </el-card>

      <!-- 最近采集运行 -->
      <el-card v-if="status" shadow="never" class="section">
        <template #header>
          <div class="card-header">
            <Clock :size="16" /><span>最近采集运行</span>
            <span class="header-count">（最近 20 次）</span>
          </div>
        </template>
        <el-table :data="recentRuns" size="small">
          <el-table-column prop="menu_code" label="数据集" width="120">
            <template #default="{ row }">{{ menuLabelByCode[row.menu_code] ?? row.menu_code }}</template>
          </el-table-column>
          <el-table-column label="触发来源" width="100">
            <template #default="{ row }">{{ triggerSourceLabel(row.trigger_source) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="RUN_STATUS_TAG_TYPE[row.status as keyof typeof RUN_STATUS_TAG_TYPE]" size="small">
                {{ row.status === 'running' ? '进行中' : row.status === 'success' ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="开始时间" min-width="160">
            <template #default="{ row }">{{ formatTime(row.started_at) }}</template>
          </el-table-column>
          <el-table-column label="结束时间" min-width="160">
            <template #default="{ row }">{{ formatTime(row.finished_at) }}</template>
          </el-table-column>
          <el-table-column label="页/拉取/新增" width="120">
            <template #default="{ row }">{{ row.pages_fetched }} / {{ row.records_fetched }} / {{ row.records_new }}</template>
          </el-table-column>
          <el-table-column label="失败原因" min-width="200">
            <template #default="{ row }">
              <template v-if="row.failure_kind">
                <el-tag :type="FAILURE_KIND_TAG_TYPE[row.failure_kind as keyof typeof FAILURE_KIND_TAG_TYPE]" size="small">
                  {{ FAILURE_KIND_LABEL[row.failure_kind as keyof typeof FAILURE_KIND_LABEL] }}
                </el-tag>
                <span class="failure-detail">{{ row.failure_detail || '—' }}</span>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!recentRuns.length" description="暂无运行记录（服务尚未执行过采集）" :image-size="60" />
      </el-card>
    </template>
  </section>
</template>

<style scoped>
.ops-panel { display: flex; flex-direction: column; gap: 14px; }
.ops-head { display: flex; justify-content: space-between; align-items: center; }
.ops-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); }
.ops-actions { display: flex; align-items: center; gap: 10px; }
.updated-at { color: var(--el-text-color-secondary); font-size: 12px; }
.troubleshoot { margin: 6px 0 0; padding-left: 18px; }
.troubleshoot code { background: var(--el-fill-color-light); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.overview { margin-top: 2px; }
.section :deep(.el-card__header) { padding: 10px 14px; }
.card-header { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.header-count { color: var(--el-text-color-secondary); font-weight: normal; font-size: 12px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; margin: 6px 0 0; }
.alert-hint { font-size: 13px; }
.alert-meta { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.trigger-row { display: flex; flex-wrap: wrap; gap: 8px; }
.ds-code { font-family: var(--el-font-family-mono, monospace); font-size: 12px; color: var(--el-text-color-secondary); }
.ds-label { font-size: 13px; }
.failure-detail { margin-left: 6px; font-size: 12px; color: var(--el-text-color-regular); }
.muted { color: var(--el-text-color-placeholder); }
</style>
