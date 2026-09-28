<script setup lang="ts">
// 中长期与现货套保工作台（openspec build-midlong-spot-hedging 任务 8.1—8.5、8.7，HW-01..10）。
//
// 只开放云南（D15/HW-07）：其他地区隐藏入口、直接访问统一显示「该地区未开放」且不发任何请求。
// 默认展示今天+明天逐时段敞口（含机制/仅中长期两条，未知断开不连线），页头列出各数据腿
// 新鲜度，标准指标卡展示两个套保率与生效方案判级；服务端需关注清单与数据缺口单独成区。
// 认知时点回看（HW-05）：横幅；切换公司/地区/时点丢弃迟到响应（HW-06，查询代次）。
// 维护入口（HW-10）：区间方案切换、月度发电基准录入；无写权限只读并注明所需权限
// （写权限由后端把关：首个 403 即转只读态并说明所需角色）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import {
  HedgeApiError, activateBand, fetchBandActivation, fetchBandPresets, fetchCaps, fetchBaselines,
  fetchMechanismParams, fetchMonths, fetchOverview, fetchSettlement, postMechanismVersion, postSimulate,
  putBaselines, putCaps, requestBandSchemeCreate,
} from '@/services/hedge/hedgeApi'
import type { HedgeOverview } from '@/services/hedge/hedgeApi'
import { createQuerySession, scopeKeyOf } from '@/services/hedge/hedgeSession'

const REGION_OPEN = 'yunnan'
const regionOpen = computed(() => currentRegion.value.id === REGION_OPEN)

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
const canWrite = ref(true)
const tab = ref<'today2' | 'month' | 'settlement' | 'simulate'>('today2')
const monthData = ref<Record<string, unknown> | null>(null)
const monthLoading = ref(false)
const settlementData = ref<Record<string, unknown> | null>(null)
const settlementLoading = ref(false)
const simulateResult = ref<Record<string, unknown> | null>(null)
const simulateQuantity = ref('')
const simulateStatus = ref<string | null>(null)

async function loadMonth() {
  monthLoading.value = true
  try {
    const range = today2Range()
    monthData.value = await fetchMonths({ fromMonth: range.fromDate.slice(0, 7), toMonth: range.fromDate.slice(0, 7) })
  } catch { monthData.value = null }
  monthLoading.value = false
}

async function loadSettlement() {
  settlementLoading.value = true
  try {
    const range = today2Range()
    settlementData.value = await fetchSettlement({
      fromDate: `${range.fromDate.slice(0, 7)}-01`, toDate: range.toDate, granularity: 'DAY', view: 'FORMAL',
    })
  } catch { settlementData.value = null }
  settlementLoading.value = false
}

async function runSimulate() {
  simulateStatus.value = null
  try {
    const range = today2Range()
    const result = await postSimulate({
      window: { fromDate: range.fromDate, toDate: range.toDate },
      adjustments: [{ quantityMwh: simulateQuantity.value, shape: { kind: 'FLAT' } }],
    })
    simulateResult.value = result
    simulateStatus.value = '试算完成（不落库，刷新即消失）'
  } catch (err) {
    simulateStatus.value = err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : '试算失败'
  }
}

const scopeKey = computed(() => scopeKeyOf({
  companyId: selectedCompanyId.value, regionId: currentRegion.value.id, asOf: asOfInput.value || null, granularity: granularity.value,
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

watch(tab, (t) => {
  if (t === 'month') loadMonth()
  if (t === 'settlement') loadSettlement()
})
watch([granularity, asOfInput], () => {
  overview.value = null // HW-06：切换即清空旧结果
  scheduleLoad()
})
// HW-06：切换公司或地区时清空全部旧结果、作废在途请求并按新范围重取（#3401：原先读不存在的
// localStorage.company_id，切公司后仍显示上一家公司的数据）。
watch([selectedCompanyId, () => currentRegion.value.id], () => {
  session.renew()
  overview.value = null
  monthData.value = null
  settlementData.value = null
  simulateResult.value = null
  scheduleLoad()
  if (tab.value === 'month') loadMonth()
  if (tab.value === 'settlement') loadSettlement()
})

async function openMaintenance() {
  maintenanceOpen.value = !maintenanceOpen.value
  if (maintenanceOpen.value) {
    try {
      const data = await fetchBaselines({ fromMonth: '2026-10', toMonth: '2026-12' })
      baselineRows.value = (data as { rows: Array<{ stationId: number; month: string; quantityMwh: string; basisNote?: string }> }).rows
        .map((row) => ({ stationId: row.stationId, month: row.month, quantityMwh: row.quantityMwh, basisNote: row.basisNote }))
    } catch { baselineRows.value = [] }
    fetchBandPresets().then((data) => {
      schemePresets.value = ((data as { rows: Array<Record<string, unknown>> }).rows) ?? []
      return fetchBandActivation({}).then((act) => { schemeActivation.value = (act as { active?: Record<string, unknown> }).active ?? null })
    }).catch(() => { schemeActivation.value = null })
    loadMechanismParams()
    loadCaps()
  }
}

// ── 其余三个维护入口：区间方案 / 机制参数 / 核定上限（HW-10）──────────────────
const schemePresets = ref<Array<Record<string, unknown>>>([])
const schemeActivation = ref<Record<string, unknown> | null>(null)
const schemeStatus = ref<string | null>(null)
const mechanismRows = ref<Array<Record<string, unknown>>>([])
const mechanismStatus = ref<string | null>(null)
const capsRows = ref<Array<{ subjectId: number; month: string; capMwh: string; sourceNote?: string; rowVersion?: number }>>([])
const capsStatus = ref<string | null>(null)

/** 维护写口错误统一映射（HW-10）：403 转只读态并说明所需权限；422 定位字段（details.field）；409 提示刷新。 */
function hedgeMaintenanceMessage(err: unknown): string {
  if (!(err instanceof HedgeApiError)) return '操作失败'
  if (err.status === 403) {
    canWrite.value = false
    return '403：当前角色无公司写权限，已转只读（维护需要 ADMIN / 本公司 BOSS）'
  }
  if (err.status === 422) {
    const field = typeof err.details?.field === 'string' ? String(err.details.field) : null
    return field ? `422：字段 ${field} —— ${err.message}` : `422：${err.message}`
  }
  if (err.status === 409) return '409：已被他人更新，请刷新后核对'
  return `${err.errorCode}：${err.message}`
}

async function activateScheme(presetKey: string, label: string) {
  schemeStatus.value = null
  try {
    const created = await requestBandSchemeCreate({ name: `采用-${label}`, presetKey, origin: 'PRESET' })
    await activateBand({ schemeId: (created as { schemeId: number }).schemeId, versionNo: 1, reason: `采用预置${label}` })
    schemeStatus.value = `已切换到「${label}」（唯一生效，历史保留）`
    await load()
  } catch (err) {
    schemeStatus.value = hedgeMaintenanceMessage(err)
  }
}

async function loadMechanismParams() {
  try {
    const data = await fetchMechanismParams({})
    mechanismRows.value = (data as { rows: Array<Record<string, unknown>> }).rows
    mechanismStatus.value = mechanismRows.value.length ? null : '暂无机制参数登记（导入后待业务确认）'
  } catch (err) {
    mechanismStatus.value = err instanceof HedgeApiError ? err.message : '加载失败'
  }
}

async function loadCaps() {
  try {
    const data = await fetchCaps({ fromMonth: '2026-10', toMonth: '2026-12' })
    capsRows.value = (data as { rows: typeof capsRows.value }).rows
    capsStatus.value = capsRows.value.length ? null : '核定上限未登记（向交易机构索取核定文件后录入）'
  } catch (err) {
    capsStatus.value = err instanceof HedgeApiError ? err.message : '加载失败'
  }
}

async function saveCap(row: { subjectId: number; month: string; capMwh: string; sourceNote?: string; rowVersion?: number }) {
  capsStatus.value = null
  try {
    await putCaps([row])
    capsStatus.value = '核定上限已保存'
    await loadCaps()
  } catch (err) {
    capsStatus.value = hedgeMaintenanceMessage(err)
  }
}

async function saveBaselines() {
  baselineStatus.value = null
  try {
    await putBaselines(baselineRows.value)
    baselineStatus.value = '已保存（写入后下一次读取即反映到套保计算）'
    await load()
  } catch (err) {
    baselineStatus.value = hedgeMaintenanceMessage(err)
  }
}

async function confirmMechanism(row: Record<string, unknown>) {
  mechanismStatus.value = null
  try {
    await postMechanismVersion(String(row.periodKey), { action: 'CONFIRM', baseVersionNo: Number(row.versionNo), effectiveFrom: '2025-06-01' })
    mechanismStatus.value = '机制参数已确认生效'
    await load()
  } catch (err) {
    mechanismStatus.value = err instanceof HedgeApiError ? hedgeMaintenanceMessage(err) : '确认失败'
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
        <h2>中长期与现货套保</h2>
        <nav class="tabs" data-test="tabs">
          <button :class="{ active: tab === 'today2' }" @click="tab = 'today2'">今明两日</button>
          <button :class="{ active: tab === 'month' }" @click="tab = 'month'; loadMonth()">当月/后续</button>
          <button :class="{ active: tab === 'settlement' }" @click="tab = 'settlement'; loadSettlement()">结算复核</button>
          <button :class="{ active: tab === 'simulate' }" @click="tab = 'simulate'">补仓试算</button>
        </nav>
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

      <section v-if="overview && tab === 'today2'" class="body">
        <div class="metrics" data-test="metrics">
          <div class="metric-card" data-test="metric-today2">
            <h3>今明两日逐时段套保率</h3>
            <p>含机制：<b>{{ overview.ratio.withMechanism.value ?? '不可计算' }}</b>（{{ overview.ratio.withMechanism.status }}）</p>
            <p>仅中长期：<b>{{ overview.ratio.midlongOnly.value ?? '不可计算' }}</b>（{{ overview.ratio.midlongOnly.status }}）</p>
            <p data-test="assessment">
              判级：{{ overview.standardMetrics?.TODAY2_INTERVAL?.level ?? '未评估' }}
              <span v-if="overview.standardMetrics?.TODAY2_INTERVAL?.reason">
                （未评估：{{ overview.standardMetrics?.TODAY2_INTERVAL.reason }}）</span>
            </p>
            <p v-if="overview.scheme" class="scheme">生效方案：{{ overview.scheme.name }} v{{ overview.scheme.versionNo }}（{{ overview.scheme.basis === 'WITH_MECHANISM' ? '含机制' : '仅中长期' }} 判级）</p>
            <p v-else class="scheme">未评估：套保区间未配置</p>
          </div>
          <div class="metric-card" data-test="sensitivity">
            <h3>价格敏感度</h3>
            <p>{{ overview.sensitivity?.value ?? '不完整' }}<span v-if="overview.sensitivity?.note">（{{ overview.sensitivity?.note }}）</span></p>
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

      <section v-if="tab === 'month' && monthData" data-test="month-view" class="body">
        <h3>当月/后续月份（月度视图）</h3>
        <pre>{{ JSON.stringify(monthData.months ?? monthData, null, 2).slice(0, 2000) }}</pre>
      </section>

      <section v-if="tab === 'settlement'" data-test="settlement-view" class="body">
        <h3>结算复核（已实现指标，不判级）</h3>
        <p v-if="settlementLoading">加载中…</p>
        <p v-else-if="!settlementData">暂无已入库结算数据（新月份入库后自动出现）</p>
        <pre v-else>{{ JSON.stringify(settlementData, null, 2).slice(0, 2000) }}</pre>
      </section>

      <section v-if="tab === 'simulate'" data-test="simulate-view" class="body">
        <h3>补仓试算（不落库；刷新即消失）</h3>
        <input v-model="simulateQuantity" data-test="simulate-qty" placeholder="试算电量 MWh" />
        <button data-test="simulate-run" @click="runSimulate">试算</button>
        <p data-test="simulate-status">{{ simulateStatus }}</p>
        <pre v-if="simulateResult">{{ JSON.stringify(simulateResult, null, 2).slice(0, 2000) }}</pre>
      </section>

      <section v-if="maintenanceOpen" class="maintenance" data-test="maintenance">
        <h3>区间方案（预置带出处，采用即快照；未配置时全站「未评估」）</h3>
        <p data-test="scheme-status">{{ schemeStatus ?? (schemeActivation ? `当前生效：v${(schemeActivation as { versionNo?: number }).versionNo ?? '—'}` : '未配置') }}</p>
        <div class="baseline-row">
          <button v-for="p in schemePresets" :key="String(p.key)" data-test="scheme-activate" :disabled="!canWrite" @click="activateScheme(String(p.key), String(p.label))">
            采用{{ p.label }}
          </button>
        </div>

        <h3>场站机制参数（比例制，待确认不参与计算）</h3>
        <p data-test="mechanism-status">{{ mechanismStatus ?? `${mechanismRows.length} 个生效期已登记` }}</p>
        <ul>
          <li v-for="(row, i) in mechanismRows" :key="i">
            场站 {{ row.stationId }}：比例 {{ row.ratio }}（{{ row.status }}<span v-if="row.endReason">/{{ row.endReason }}</span>）
            <button v-if="row.status === 'PENDING'" :disabled="!canWrite" @click="confirmMechanism(row)">确认生效</button>
          </li>
        </ul>

        <h3>核定上限（交易单元 × 月；未登记显示「核定上限未登记」）</h3>
        <p data-test="caps-status">{{ capsStatus ?? `${capsRows.length} 行已登记` }}</p>
        <div v-for="(row, i) in capsRows" :key="i" class="baseline-row">
          <input v-model="row.subjectId" placeholder="交易单元" />
          <input v-model="row.month" placeholder="2026-11" />
          <input v-model="row.capMwh" placeholder="MWh" />
          <button :disabled="!canWrite" @click="saveCap(row)">保存</button>
        </div>

        <h3>月度发电基准（经营计划口径，禁止用售电目标顶替）</h3>
        <p v-if="!canWrite" class="readonly-note">只读：维护需要公司写权限（ADMIN / 本公司 BOSS）</p>
        <div v-for="(row, i) in baselineRows" :key="i" class="baseline-row">
          <input v-model="row.stationId" placeholder="stationId" />
          <input v-model="row.month" placeholder="2026-11" />
          <input v-model="row.quantityMwh" placeholder="MWh" />
          <input v-model="row.basisNote" placeholder="依据说明" />
        </div>
        <button data-test="baseline-save" :disabled="!canWrite" @click="saveBaselines">保存基准</button>
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
