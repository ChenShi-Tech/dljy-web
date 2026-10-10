<script setup lang="ts">
// B2 风控阈值统一面板（/xhjy/risk-center）：聚合敞口/申报偏差/价差异动/告警越限四类，
// 用统一 riskThresholds 判红黄绿。数据来自既有 quantClient（exposure/review/monitor，
// 经 /agent-api 调权威后端）+ alertClient（盯盘告警）。复用 AlertCenter 的告警轮询基建。
// 严格地区：随 currentRegion 切换重算。kind=mixed（量化端点，预测/合成序列数值仅供参考）。
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, ShieldCheck, Activity, Gauge } from 'lucide-vue-next'
import {
  classifyReviewError,
  fetchReview,
  fetchMonitor,
  type ReviewFailure,
  type ReviewResult,
  type MonitorResult,
} from '@/services/quant/quantClient'
import { fetchSummary } from '@/services/hedge/hedgeApi'
import { listAlerts, type Alert } from '@/services/alertClient'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '@/composables/useRegionReload'
import {
  getRiskThresholds,
  deviationPenaltyLevel,
  spreadAlertLevel,
  RISK_LEVEL_LABEL,
  type RiskLevel,
} from '@/data/riskThresholds'
import DataState from '@/components/common/DataState.vue'

const regionId = computed(() => currentRegion.value.id)
const thresholds = computed(() => getRiskThresholds(regionId.value))

const loading = ref(false)
const error = ref('')
const review = ref<ReviewResult | null>(null)
const reviewFailure = ref<ReviewFailure | null>(null)
const monitor = ref<MonitorResult | null>(null)
const monitorFailure = ref<string | null>(null)
const alerts = ref<Alert[]>([])
const alertsFailure = ref<string | null>(null)

const now = new Date()
const yesterday = new Date(now.getTime() - 86400000)
const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`

function failureText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '网络错误（智能体后端未运行？）'
}

async function load() {
  loading.value = true
  error.value = ''
  reviewFailure.value = null
  monitorFailure.value = null
  alertsFailure.value = null
  // 各端点用 allSettled 隔离：单点失败不阻断整页，但不再用 catch 把原因折成 null。
  const tasks = await Promise.allSettled([
    fetchReview({ date: dateStr }),
    fetchMonitor(dateStr, thresholds.value.spreadThresholdYuan),
    fetchSummary({ window: 'today2' }),
    listAlerts(),
  ])
  review.value = tasks[0].status === 'fulfilled' ? tasks[0].value : null
  monitor.value = tasks[1].status === 'fulfilled' ? tasks[1].value : null
  hedgeSummary.value = tasks[2].status === 'fulfilled' ? tasks[2].value : null
  if (tasks[0].status === 'rejected') reviewFailure.value = classifyReviewError(tasks[0].reason)
  if (tasks[1].status === 'rejected') monitorFailure.value = failureText(tasks[1].reason)
  alerts.value = tasks[3].status === 'fulfilled' ? tasks[3].value.alerts : []
  if (tasks[3].status === 'rejected') alertsFailure.value = failureText(tasks[3].reason)
  const otherFailures = [tasks[1], tasks[2], tasks[3]].filter((task) => task.status === 'rejected')
  if (otherFailures.length) error.value = `其他 ${otherFailures.length} 项风控数据加载失败，已保留可用结果。`
  loading.value = false
}

onMounted(load)
onRegionChange(load)

// HA-01/HA-04：套保卡片读 /api/v1/hedge/summary 统一结果；失败/未配置/不可计算/不完整/地区未开放
// 一律灰色「未评估」并写明原因，MUST NOT 默认安全，也不进面板整体红黄绿计算。
const hedgeSummary = ref<Record<string, unknown> | null>(null)
const hedgeNotAssessed = computed<string | null>(() => {
  const s = hedgeSummary.value as { regionSupported?: boolean; scheme?: unknown; status?: string; reason?: string } | null
  if (s === null) return '数据加载失败'
  if (s.regionSupported === false) return '该地区未开放'
  if (!s.scheme) return '套保区间未配置'
  if (s.status && s.status !== 'OK') return s.reason ?? String(s.status)
  return null
})
const hedgeRatioValue = computed<string | null>(() => {
  if (hedgeNotAssessed.value) return null
  const s = hedgeSummary.value as { metrics?: Record<string, { value?: string | null }> } | null
  return s?.metrics?.TODAY2_INTERVAL?.value ?? null
})
const devLevel = computed<RiskLevel>(() =>
  review.value ? deviationPenaltyLevel(review.value.deviation.estimated_penalty_yuan, thresholds.value) : 'green'
)
const spreadLevel = computed<RiskLevel>(() =>
  monitor.value ? spreadAlertLevel(monitor.value.alerts.length, thresholds.value) : 'green'
)
const alertLevel = computed<RiskLevel>(() => spreadAlertLevel(alerts.value.length, thresholds.value))

function levelClass(l: RiskLevel) {
  return `lv-${l}`
}
</script>

<template>
  <div class="risk-center">
    <header class="rc-head">
      <h2><ShieldCheck :size="18" /> 风控阈值统一面板</h2>
      <p class="rc-sub">
        聚合敞口 / 申报偏差 / 价差异动 / 告警越限，统一阈值判红黄绿。地区：{{ currentRegion.shortName || regionId }}
        · 数据经量化权威端点（/agent-api/agent/quant/*），预测/合成序列数值仅供参考（mixed）。
      </p>
    </header>

    <section class="rc-thr">
      <span>当前阈值：</span>
      <span>偏差考核费 ≥ {{ thresholds.deviationPenaltyRedYuan }} 元 红</span>
      <span>价差阈值 {{ thresholds.spreadThresholdYuan }} 元/MWh，告警 ≥ {{ thresholds.spreadAlertRedCount }} 条 红</span>
    </section>

    <div v-loading="loading" class="rc-cards">
      <div class="rc-card hedge-card" data-test="hedge-card" :class="hedgeNotAssessed ? 'rc-unevaluated' : ''">
        <div class="rc-card-head"><Gauge :size="15" /> 中长期与现货套保</div>
        <template v-if="hedgeNotAssessed">
          <div class="rc-val rc-grey" data-test="hedge-unevaluated">未评估</div>
          <div class="rc-hint" data-test="hedge-unevaluated-reason">{{ hedgeNotAssessed }}</div>
        </template>
        <template v-else>
          <div class="rc-val" data-test="hedge-ratio">{{ hedgeRatioValue ? Number(hedgeRatioValue).toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 1 }) : '不可计算' }}</div>
          <div class="rc-hint">今明两日逐时段套保率；生效方案 {{ (hedgeSummary as any)?.scheme?.name ?? '—' }}</div>
        </template>
      </div>
      <div class="rc-card" :class="review ? levelClass(devLevel) : 'state-empty'">
        <div class="rc-card-head"><Activity :size="15" /> 申报偏差考核（{{ review?.deviation?.tolerance_pct ?? '—' }}% 免考核带）</div>
        <template v-if="review">
          <div class="rc-val">{{ review.deviation.estimated_penalty_yuan.toFixed(0) }} 元</div>
          <div class="rc-tag">{{ RISK_LEVEL_LABEL[devLevel] }}</div>
          <div class="rc-hint">绝对偏差 {{ review.deviation.total_abs_deviation_mwh.toFixed(1) }} MWh</div>
        </template>
        <div v-else-if="reviewFailure" class="rc-card-empty">
          <strong>{{ reviewFailure.title }}</strong>
          <span>{{ reviewFailure.description }}</span>
          <small v-if="reviewFailure.detail">后端返回：{{ reviewFailure.detail }}</small>
        </div>
      </div>
      <div class="rc-card" :class="monitor ? levelClass(spreadLevel) : 'state-empty'">
        <div class="rc-card-head"><AlertTriangle :size="15" /> 实时-日前价差异动</div>
        <template v-if="monitor">
          <div class="rc-val">{{ monitor.alerts.length }} 条</div>
          <div class="rc-tag">{{ RISK_LEVEL_LABEL[spreadLevel] }}</div>
          <div class="rc-hint">阈值 {{ monitor.spread_threshold ?? thresholds.spreadThresholdYuan }} 元/MWh</div>
        </template>
        <div v-else-if="monitorFailure" class="rc-card-empty">
          <strong>价差数据加载失败</strong>
          <span>无法判定当前价差异动级别，失败不代表安全。</span>
          <small>后端返回：{{ monitorFailure }}</small>
        </div>
      </div>
      <div class="rc-card" :class="alertsFailure ? 'state-empty' : levelClass(alertLevel)">
        <div class="rc-card-head"><AlertTriangle :size="15" /> 盯盘告警（未消除）</div>
        <template v-if="!alertsFailure">
          <div class="rc-val">{{ alerts.length }} 条</div>
          <div class="rc-tag">{{ RISK_LEVEL_LABEL[alertLevel] }}</div>
          <div class="rc-hint">复用 /api/agent/alerts 轮询（AlertCenter 同源）</div>
        </template>
        <div v-else class="rc-card-empty">
          <strong>告警读取失败</strong>
          <span>告警链路不可用，无法确认是否存在未消除告警。</span>
          <small>后端返回：{{ alertsFailure }}</small>
        </div>
      </div>
    </div>

    <section class="rc-alerts">
      <div class="rc-block-title"><AlertTriangle :size="14" /> 活跃告警</div>
      <DataState v-if="alertsFailure" :error="`告警读取失败：${alertsFailure}`" />
      <DataState v-else-if="!alerts.length" :empty="true" empty-text="暂无活跃告警" />
      <ul v-else class="rc-alert-list">
        <li v-for="a in alerts.slice(0, 12)" :key="a.id" :class="a.severity">
          <span class="rc-alert-sev">{{ a.severity }}</span>
          <span class="rc-alert-title">{{ a.title }}</span>
          <span class="rc-alert-region">{{ a.region_name || a.region_id || '全局' }}</span>
        </li>
      </ul>
    </section>

    <p v-if="error" class="rc-err">{{ error }}</p>
  </div>
</template>

<style scoped>
.risk-center { padding: 16px 20px; }
.rc-head h2 { margin: 0 0 4px; display: flex; align-items: center; gap: 6px; }
.rc-sub { margin: 0 0 12px; color: var(--el-text-color-secondary); font-size: var(--font-md); }
.rc-thr {
  display: flex; flex-wrap: wrap; gap: 14px;
  font-size: var(--font-sm); color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 6px; margin-bottom: 14px;
}
.rc-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.rc-unevaluated { filter: grayscale(1); opacity: 0.75; }
.rc-grey { color: #9ca3af; }
.rc-card {
  border: 1px solid var(--el-border-color); border-radius: 8px; padding: 12px;
  background: var(--el-bg-color); border-left-width: 4px;
}
.rc-card.lv-green { border-left-color: #67c23a; }
.rc-card.lv-yellow { border-left-color: #e6a23c; }
.rc-card.lv-red { border-left-color: #f56c6c; }
.rc-card.state-empty { border-left-color: var(--el-border-color); background: var(--el-fill-color-extra-light); }
.rc-card-head { display: flex; align-items: center; gap: 5px; font-size: var(--font-md); color: var(--el-text-color-regular); margin-bottom: 8px; }
.rc-val { font-size: var(--font-22); font-weight: 600; }
.rc-tag { display: inline-block; font-size: var(--font-sm); padding: 1px 8px; border-radius: 10px; margin-top: 6px; }
.lv-green .rc-tag { background: #f0f9eb; color: #67c23a; }
.lv-yellow .rc-tag { background: #fdf6ec; color: #e6a23c; }
.lv-red .rc-tag { background: #fef0f0; color: #f56c6c; }
.rc-hint { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-top: 6px; }
.rc-card-empty { display: flex; flex-direction: column; gap: 5px; font-size: var(--font-sm); color: var(--el-text-color-regular); }
.rc-card-empty small { color: var(--el-text-color-secondary); line-height: 1.5; }
.rc-block-title { display: flex; align-items: center; gap: 5px; font-size: var(--font-lg); font-weight: 600; margin-bottom: 8px; }
.rc-alert-list { list-style: none; margin: 0; padding: 0; }
.rc-alert-list li { display: flex; gap: 10px; align-items: center; padding: 7px 8px; border-bottom: 1px solid var(--el-border-color-lighter); font-size: var(--font-md); }
.rc-alert-sev { font-size: var(--font-xs); padding: 1px 6px; border-radius: 8px; background: var(--el-fill-color); }
.rc-alert-list li.high .rc-alert-sev { background: #fef0f0; color: #f56c6c; }
.rc-alert-title { flex: 1; }
.rc-alert-region { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.rc-err { color: #f56c6c; font-size: var(--font-md); }
@media (max-width: 1140px) { .rc-cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .rc-cards { grid-template-columns: 1fr; } }
</style>
