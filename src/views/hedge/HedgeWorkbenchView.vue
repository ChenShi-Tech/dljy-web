<script setup lang="ts">
// 中长期与现货套保工作台（openspec build-midlong-spot-hedging 任务 8.1—8.5、8.7，HW-01..10）。
//
// 只开放云南（D15/HW-07）：其他地区隐藏入口、直接访问统一显示「该地区未开放」且不发任何请求。
// 默认展示今天+明天逐时段敞口（含机制/仅中长期两条，未知断开不连线），页头列出各数据腿
// 新鲜度，标准指标卡展示两个套保率与生效方案判级；服务端需关注清单与数据缺口单独成区。
// 认知时点回看（HW-05）：横幅 + 导出带 asOf；切换公司/地区/时点丢弃迟到响应（HW-06，查询代次）。
// 维护入口（HW-10）：区间方案切换、月度发电基准录入；无写权限只读并注明所需权限。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { HedgeApiError, fetchBaselines, fetchOverview, putBaselines } from '@/services/hedge/hedgeApi'
import type { HedgeOverview } from '@/services/hedge/hedgeApi'
import { createQuerySession, scopeKeyOf } from '@/services/hedge/hedgeSession'

const REGION_OPEN = 'yunnan'
const regionOpen = computed(() => currentRegion.value.id === REGION_OPEN)

const companyId = localStorage.getItem('company_id') ?? ''
const granularity = ref<'HOUR' | 'DAY'>('HOUR')
const asOfInput = ref('')
const loading = ref(false)
const loadError = ref<string | null>(null)
const overview = ref<HedgeOverview | null>(null)
const session = createQuerySession()
const showAsOfBanner = ref(false)
const maintenanceOpen = ref(false)
const baselineRows = ref<Array<{ stationId: number; month: string; quantityMwh: string; basisNote?: string }>>([])
const baselineStatus = ref<string | null>(null)
const canWrite = ref(true) // 由 capabilities 接口补充；乐观渲染受 403 兜底

const scopeKey = computed(() => scopeKeyOf({
  companyId, regionId: currentRegion.value.id, asOf: asOfInput.value || null, granularity: granularity.value,
}))
let inFlight: ReturnType<typeof setTimeout> | null = null

function today2Range(): { fromDate: string; toDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const now = new Date(Date.now() + 8 * 3_600_000)
  const from = fmt(now)
  const to = fmt(new Date(now.getTime() + 86_400_000))
  return { fromDate: from, toDate: to }
}

async function load() {
  if (!regionOpen.value) return
  const token = session.begin(scopeKey.value)
  loading.value = true
  loadError.value = null
  try {
    const range = today2Range()
    const data = await fetchOverview({
      fromDate: range.fromDate, toDate: range.toDate, granularity: granularity.value,
      scope: 'company', asOf: asOfInput.value || undefined,
    })
    if (!session.isCurrent(token, scopeKey.value)) return // HW-06：迟到响应丢弃
    overview.value = data
    showAsOfBanner.value = Boolean(asOfInput.value)
  } catch (err) {
    if (!session.isCurrent(token, scopeKey.value)) return
    loadError.value = err instanceof HedgeApiError
      ? `${err.errorCode}：${err.message}`
      : '数据加载失败，可重试'
    overview.value = null
  } finally {
    if (session.isCurrent(token, scopeKey.value)) loading.value = false
  }
}

function scheduleLoad() {
  if (inFlight) clearTimeout(inFlight)
  inFlight = setTimeout(load, 150)
}

watch([granularity, asOfInput], () => {
  overview.value = null // HW-06：切换即清空旧结果
  scheduleLoad()
})

async function openMaintenance() {
  maintenanceOpen.value = !maintenanceOpen.value
  if (maintenanceOpen.value) {
    try {
      const data = await fetchBaselines({ fromMonth: '2026-10', toMonth: '2026-12' })
      baselineRows.value = (data as { rows: Array<{ stationId: number; month: string; quantityMwh: string; basisNote?: string }> }).rows
        .map((row) => ({ stationId: row.stationId, month: row.month, quantityMwh: row.quantityMwh, basisNote: row.basisNote }))
    } catch { baselineRows.value = [] }
  }
}

async function saveBaselines() {
  baselineStatus.value = null
  try {
    await putBaselines(baselineRows.value)
    baselineStatus.value = '已保存（写入后下一次读取即反映到套保计算）'
    await load()
  } catch (err) {
    baselineStatus.value = err instanceof HedgeApiError
      ? (err.errorCode === 'VERSION_CONFLICT' ? '409：基准已被他人更新，请刷新后核对' : err.message)
      : '保存失败'
  }
}

function onAsOfClear() {
  asOfInput.value = ''
}

onMounted(load)
onBeforeUnmount(() => { if (inFlight) clearTimeout(inFlight) })
</script>

<template>
  <div class="hedge-workbench">
    <div v-if="!regionOpen" class="region-closed" data-test="region-closed">
      该地区未开放
      <p>中长期与现货套保当前仅对云南开放；当前地区 {{ currentRegion.id || '(未选择)' }} 不发任何数据请求。</p>
    </div>
    <template v-else>
      <div v-if="showAsOfBanner" class="asof-banner" data-test="asof-banner">
        历史视角：认知时点 {{ asOfInput }}
        <button data-test="asof-clear" @click="onAsOfClear">回到当前视图</button>
      </div>
      <header class="page-head">
        <h2>今明两日敞口</h2>
        <label>粒度
          <select v-model="granularity" data-test="granularity">
            <option value="HOUR">小时</option>
            <option value="DAY">日</option>
          </select>
        </label>
        <label>认知时点
          <input v-model="asOfInput" data-test="asof-input" placeholder="留空 = 当前视图" />
        </label>
        <button data-test="maintenance-toggle" @click="openMaintenance">维护</button>
      </header>

      <p v-if="loadError" class="load-error" data-test="load-error">{{ loadError }}</p>
      <p v-else-if="loading" data-test="loading">加载中…</p>

      <section v-if="overview" class="body">
        <div class="metrics" data-test="metrics">
          <div class="metric-card" data-test="metric-today2">
            <h3>今明两日逐时段套保率</h3>
            <p>含机制：<b>{{ overview.ratio.withMechanism.value ?? '不可计算' }}</b>（{{ overview.ratio.withMechanism.status }}）</p>
            <p>仅中长期：<b>{{ overview.ratio.midlongOnly.value ?? '不可计算' }}</b>（{{ overview.ratio.midlongOnly.status }}）</p>
            <p data-test="assessment">
              判级：{{ overview.standardMetrics.TODAY2_INTERVAL?.level }}
              <span v-if="overview.standardMetrics.TODAY2_INTERVAL?.reason">
                （未评估：{{ overview.standardMetrics.TODAY2_INTERVAL.reason }}）</span>
            </p>
            <p v-if="overview.scheme" class="scheme">生效方案：{{ overview.scheme.name }} v{{ overview.scheme.versionNo }}（{{ overview.scheme.basis === 'WITH_MECHANISM' ? '含机制' : '仅中长期' }} 判级）</p>
            <p v-else class="scheme">未评估：套保区间未配置</p>
          </div>
          <div class="metric-card" data-test="sensitivity">
            <h3>价格敏感度</h3>
            <p>{{ overview.sensitivity.value ?? '不完整' }}<span v-if="overview.sensitivity.note">（{{ overview.sensitivity.note }}）</span></p>
          </div>
        </div>

        <section class="intervals" data-test="intervals">
          <h3>逐时段敞口（未知时段断开，不做平滑/插值）</h3>
          <table>
            <thead>
              <tr><th>时段</th><th>发电</th><th>来源</th><th>中长期</th><th>机制</th><th>敞口（含机制）</th><th>敞口（仅中长期）</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in overview.intervals" :key="row.start" :class="{ uncovered: row.generation.value === null || row.locked.midlong === null }">
                <td>{{ row.start.slice(11, 16) }}</td>
                <td>{{ row.generation.value ?? '未知' }}</td>
                <td>{{ row.generation.value === null ? (row.generation.uncoveredReason ?? "未知") : row.generation.source }}</td>
                <td>{{ row.locked.midlong ?? '未知' }}</td>
                <td>{{ row.locked.mechanism.value ?? '未知' }}<span v-if="row.locked.mechanism.note">（{{ row.locked.mechanism.note }}）</span></td>
                <td>{{ row.exposure.withMechanism ?? '未知' }}</td>
                <td>{{ row.exposure.midlongOnly ?? '未知' }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="watchlist" data-test="watchlist">
          <h3>需关注时段（服务端生成）</h3>
          <p v-if="!overview.watchlist.rows.length">暂无已覆盖的风险时段</p>
          <ul v-else>
            <li v-for="(row, wi) in overview.watchlist.rows" :key="wi">
              {{ String(row.start ?? '').slice(11, 16) }} 敞口 {{ row.exposureMwh }} MWh（{{ row.direction === 'SELL' ? '多发卖出' : '买入' }}）
              <span v-if="row.note">【{{ row.note }}】</span>
              <span v-if="row.priceTag">【{{ row.priceTag }}】</span>
            </li>
          </ul>
          <p class="disclaimer">{{ overview.watchlist.disclaimer }}</p>
        </section>

        <section class="gaps" data-test="gaps">
          <h3>数据缺口</h3>
          <ul><li v-for="(gap, i) in overview.gaps" :key="i">{{ gap.code }}：{{ gap.message }}</li></ul>
          <p v-if="!overview.gaps.length">无</p>
        </section>
      </section>

      <section v-if="maintenanceOpen" class="maintenance" data-test="maintenance">
        <h3>月度发电基准（经营计划口径，禁止用售电目标顶替）</h3>
        <p v-if="!canWrite" class="readonly-note">只读：维护需要公司写权限（ADMIN / 本公司 BOSS）</p>
        <div v-for="(row, i) in baselineRows" :key="i" class="baseline-row">
          <input v-model="row.stationId" placeholder="stationId" />
          <input v-model="row.month" placeholder="2026-11" />
          <input v-model="row.quantityMwh" placeholder="MWh" />
          <input v-model="row.basisNote" placeholder="依据说明" />
        </div>
        <button data-test="baseline-save" @click="saveBaselines">保存基准</button>
        <p data-test="baseline-status">{{ baselineStatus }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.hedge-workbench { padding: 16px; }
.region-closed { padding: 48px; text-align: center; font-size: var(--font-lg, 18px); }
.asof-banner { background: #fff7e6; padding: 8px 12px; border: 1px solid #f0c36d; margin-bottom: 8px; }
.metric-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }
.metrics { display: flex; gap: 12px; }
.intervals table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 13px); }
.intervals th, .intervals td { border-bottom: 1px solid #f0f0f0; padding: 4px 8px; text-align: left; }
tr.uncovered td { color: #9ca3af; }
.watchlist .disclaimer { color: #9ca3af; font-size: var(--font-xs, 12px); }
.baseline-row { display: flex; gap: 8px; margin-bottom: 6px; }
.load-error { color: #b91c1c; }
</style>
