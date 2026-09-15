<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { routeLocationKey } from 'vue-router'
import { Activity, ArrowUpRight, BarChart3, CircleAlert, Gauge, RefreshCw, WalletCards, Zap } from 'lucide-vue-next'
import { selectedCompanyId } from '@/services/company/companyContext'
import { resolveCaptureOwner } from 'shared/schema/entities/capture-families.mjs'
import { fetchNodePriceSeries, type NodePricePoint } from '@/services/market/spotClient'
import {
  buildPlantOutputSeries,
  detectPlantOutputAnomalies,
  loadPlantOutputSourcePayload,
  summarizePlantOutput,
  type CapturedEnvelopeMeta,
  type PlantOutputSummary,
} from '@/services/market/plantOutputClient'
import { loadSettlementPrices, type SettlementPricePoint } from '@/services/market/settlementClient'
import { fetchGridGeoPlantIntegrations } from './client'
import { mappingMatchesScope, resolveGridSpatialPriceRegion, resolveScopedOutputSources } from './marketSpatialScope'
import type { GridGeoPlant, GridGeoPlantIntegrations } from './types'
import { buildGridObjectLocation, validObjectDate } from './objectNavigation'
import { todayBeijing } from '@/utils/beijingDate'

const props = defineProps<{ plant: GridGeoPlant; date?: string }>()
const route = inject(routeLocationKey, null)

type PriceSummary = { average: number | null; minimum: number | null; maximum: number | null; spread: number | null; negativeShare: number | null; points: number }
type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

const tradeDate = ref(props.date ?? todayBeijing())
const mapping = ref<GridGeoPlantIntegrations | null>(null)
const loading = ref(false)
const mappingError = ref('')
const nodeState = ref<LoadState>('idle')
const outputState = ref<LoadState>('idle')
const settlementState = ref<LoadState>('idle')
const nodeError = ref('')
const outputError = ref('')
const settlementError = ref('')
const daSummary = ref<PriceSummary | null>(null)
const rtSummary = ref<PriceSummary | null>(null)
const priceSeries = ref<NodePricePoint[]>([])
const outputSummary = ref<PlantOutputSummary | null>(null)
const outputMeta = ref<CapturedEnvelopeMeta | null>(null)
const settlementPoint = ref<SettlementPricePoint | null>(null)
const settlementMeta = ref<{ sourceType: string; mock: boolean; updatedAt: string | null } | null>(null)
const matchedOutputName = ref('')
const matchedSettlementName = ref('')
const targetKind = ref<'plan' | 'forecast'>('forecast')
let loadRequestId = 0

function requestCurrent(requestId: number, config?: GridGeoPlantIntegrations) {
  return requestId === loadRequestId
    && (!config || (
      config.asset.plantId === props.plant.plantId
      && mappingMatchesScope(config, selectedCompanyId.value, props.plant.regionId)
    ))
}

function number(value: number | null | undefined, digits = 1) {
  return Number.isFinite(value) ? Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'
}

function summarizePrice(points: NodePricePoint[]): PriceSummary {
  const values = points.map((item) => item.price).filter((value): value is number => Number.isFinite(value))
  if (!values.length) return { average: null, minimum: null, maximum: null, spread: null, negativeShare: null, points: 0 }
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return {
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    minimum,
    maximum,
    spread: maximum - minimum,
    negativeShare: values.filter((value) => value < 0).length / values.length * 100,
    points: values.length,
  }
}

const sparklinePoints = computed(() => {
  const values = priceSeries.value.map((point) => point.price).filter((value): value is number => Number.isFinite(value))
  if (values.length < 2) return ''
  const low = Math.min(...values)
  const high = Math.max(...values)
  const range = Math.max(high - low, 1)
  return values.map((value, index) => `${(index / (values.length - 1) * 100).toFixed(2)},${(34 - (value - low) / range * 28).toFixed(2)}`).join(' ')
})

const deviationTone = computed(() => {
  const completion = outputSummary.value?.completionAvg
  if (!Number.isFinite(completion)) return 'neutral'
  const gap = Math.abs(Number(completion) - 100)
  return gap >= 20 ? 'danger' : gap >= 10 ? 'warning' : 'good'
})

async function loadNodePrice(config: GridGeoPlantIntegrations, requestId: number) {
  nodeState.value = 'loading'
  nodeError.value = ''
  daSummary.value = null
  rtSummary.value = null
  priceSeries.value = []
  const nodeName = config.identity.nodeName
  const priceRegion = resolveGridSpatialPriceRegion(config.asset.regionId)
  if (!nodeName || !priceRegion) {
    nodeState.value = 'empty'
    if (!priceRegion) nodeError.value = '当前地区未登记节点电价取数口径'
    return
  }
  try {
    const [da, rt] = await Promise.all([
      fetchNodePriceSeries(tradeDate.value, nodeName, 'da', priceRegion),
      fetchNodePriceSeries(tradeDate.value, nodeName, 'rt', priceRegion),
    ])
    if (!requestCurrent(requestId, config)) return
    daSummary.value = summarizePrice(da.series ?? [])
    rtSummary.value = summarizePrice(rt.series ?? [])
    priceSeries.value = rt.series?.length ? rt.series : da.series ?? []
    nodeState.value = daSummary.value.points || rtSummary.value.points ? 'ready' : 'empty'
  } catch (cause) {
    if (!requestCurrent(requestId, config)) return
    nodeState.value = 'error'
    nodeError.value = cause instanceof Error ? cause.message : '节点电价服务暂不可用'
  }
}

async function loadOutput(config: GridGeoPlantIntegrations, requestId: number) {
  outputState.value = 'loading'
  outputError.value = ''
  outputSummary.value = null
  outputMeta.value = null
  matchedOutputName.value = ''
  try {
    const source = resolveScopedOutputSources([config], selectedCompanyId.value, props.plant.regionId)[0]
    if (!source) {
      outputMeta.value = { hasRealData: false, mock: false, sourceType: 'NOT_CONFIGURED', updatedAt: null }
      outputState.value = 'empty'
      outputError.value = '所选公司没有通过 owner registry 核验的出力数据族'
      return
    }
    const payload = await loadPlantOutputSourcePayload(source, { date: tradeDate.value })
    if (!requestCurrent(requestId, config)) return
    outputMeta.value = payload.meta
    const names = new Set(config.identity.plantNames)
    const rows = payload.rows.filter((row) => names.has(row.standardPlant ?? '') || names.has(row.plant))
    matchedOutputName.value = rows.find((row) => names.has(row.standardPlant ?? ''))?.standardPlant
      ?? rows.find((row) => names.has(row.plant))?.plant
      ?? ''
    if (!rows.length) {
      outputState.value = payload.meta.error ? 'error' : 'empty'
      outputError.value = payload.meta.error ?? ''
      return
    }
    const series = buildPlantOutputSeries(rows)
    const anomalies = detectPlantOutputAnomalies(series, { deviationPct: 10, deviationMw: 5 }, props.plant.standardName)
    outputSummary.value = summarizePlantOutput(series, anomalies)
    targetKind.value = series.targetKind
    outputState.value = outputSummary.value.pointCount ? 'ready' : 'empty'
  } catch (cause) {
    if (!requestCurrent(requestId, config)) return
    outputState.value = 'error'
    outputError.value = cause instanceof Error ? cause.message : '出力数据暂不可用'
  }
}

async function loadSettlement(config: GridGeoPlantIntegrations, requestId: number) {
  settlementState.value = 'loading'
  settlementError.value = ''
  settlementPoint.value = null
  settlementMeta.value = null
  matchedSettlementName.value = ''
  try {
    const settlement = config.domains.settlement
    if (
      !mappingMatchesScope(config, selectedCompanyId.value, props.plant.regionId)
      || settlement.status !== 'configured'
      || !settlement.family
      || !settlement.dataset
      || resolveCaptureOwner(settlement.family, config.asset.regionId, settlement.dataset) !== selectedCompanyId.value
    ) {
      settlementState.value = 'empty'
      settlementError.value = '所选公司没有通过 owner registry 核验的结算数据族'
      return
    }
    const exact = await loadSettlementPrices({
      dateRange: [tradeDate.value, tradeDate.value],
      plantCandidates: config.identity.plantNames,
      source: { family: settlement.family, dataset: settlement.dataset, region: config.asset.regionId },
    })
    if (!requestCurrent(requestId, config)) return
    settlementMeta.value = { sourceType: exact.sourceType, mock: exact.mock, updatedAt: exact.updatedAt }
    if (!exact.matchedPlant) {
      settlementState.value = 'empty'
      return
    }
    matchedSettlementName.value = exact.matchedPlant
    settlementPoint.value = exact.points[0] ?? null
    settlementState.value = settlementPoint.value ? 'ready' : 'empty'
  } catch (cause) {
    if (!requestCurrent(requestId, config)) return
    settlementState.value = 'error'
    settlementError.value = cause instanceof Error ? cause.message : '结算数据暂不可用'
  }
}

async function loadAll() {
  const requestId = ++loadRequestId
  loading.value = true
  mappingError.value = ''
  mapping.value = null
  nodeState.value = outputState.value = settlementState.value = 'idle'
  daSummary.value = null
  rtSummary.value = null
  priceSeries.value = []
  outputSummary.value = null
  outputMeta.value = null
  settlementPoint.value = null
  settlementMeta.value = null
  if (!validObjectDate(tradeDate.value)) { mappingError.value = '请选择有效的交易日期'; loading.value = false; return }
  try {
    const config = await fetchGridGeoPlantIntegrations(props.plant.plantId)
    if (!requestCurrent(requestId)) return
    if (!mappingMatchesScope(config, selectedCompanyId.value, props.plant.regionId)) {
      throw new Error('业务映射与当前公司或地区不一致，已拒绝跨域取数')
    }
    mapping.value = config
    await Promise.all([loadNodePrice(config, requestId), loadOutput(config, requestId), loadSettlement(config, requestId)])
  } catch (cause) {
    if (!requestCurrent(requestId)) return
    mapping.value = null
    mappingError.value = cause instanceof Error ? cause.message : '业务映射暂不可用'
    nodeState.value = outputState.value = settlementState.value = 'error'
  } finally {
    if (requestCurrent(requestId)) loading.value = false
  }
}

function businessLocation(path: string) {
  return buildGridObjectLocation(path, { kind: 'plant', id: props.plant.plantId, regionId: props.plant.regionId, gridOperator: props.plant.gridOperator }, { companyId: selectedCompanyId.value ?? '', date: tradeDate.value, returnTo: route?.fullPath })
}
watch(() => props.date, (value) => { if (value !== undefined) tradeDate.value = value })
watch(() => [props.plant.plantId, props.plant.regionId, selectedCompanyId.value, tradeDate.value], loadAll, { immediate: true })
onBeforeUnmount(() => { loadRequestId += 1 })
</script>

<template>
  <section class="business-panel">
    <div class="business-head">
      <div>
        <small>SPATIAL × MARKET</small>
        <h4>业务时序属性</h4>
        <p>按电厂与定价节点精确映射，空间主数据不承载时序值。</p>
      </div>
      <div class="date-actions">
        <input v-model="tradeDate" type="date" min="2025-01-01" max="2030-12-31" aria-label="交易日期" />
        <button :disabled="loading" title="重新加载" @click="loadAll"><RefreshCw :size="14" :class="{ spin: loading }" /></button>
      </div>
    </div>

    <div v-if="mappingError" class="domain-empty error"><CircleAlert :size="16" /> {{ mappingError }}</div>
    <template v-else>
      <article class="domain-card price-card">
        <header><span><Zap :size="15" /> 定价节点电价</span><small>{{ mapping?.identity.nodeName || '节点未绑定' }}</small></header>
        <div v-if="nodeState === 'ready'" class="price-body">
          <div class="price-primary">
            <span><small>日前均价</small><strong>{{ number(daSummary?.average) }}</strong><em>元/MWh</em></span>
            <span><small>实时均价</small><strong>{{ number(rtSummary?.average) }}</strong><em>元/MWh</em></span>
          </div>
          <svg v-if="sparklinePoints" viewBox="0 0 100 38" preserveAspectRatio="none" aria-label="实时电价日内走势">
            <defs><linearGradient id="grid-price-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#56ddff" stop-opacity=".35"/><stop offset="1" stop-color="#56ddff" stop-opacity="0"/></linearGradient></defs>
            <polyline :points="`0,38 ${sparklinePoints} 100,38`" fill="url(#grid-price-fill)" stroke="none" />
            <polyline :points="sparklinePoints" fill="none" stroke="#62e2ff" stroke-width="1.4" vector-effect="non-scaling-stroke" />
          </svg>
          <div class="mini-grid">
            <span>实时峰谷差<b>{{ number(rtSummary?.spread) }}</b></span>
            <span>实时最低<b>{{ number(rtSummary?.minimum) }}</b></span>
            <span>负价占比<b>{{ number(rtSummary?.negativeShare) }}%</b></span>
            <span>有效点数<b>{{ rtSummary?.points ?? 0 }}/96</b></span>
          </div>
        </div>
        <div v-else-if="nodeState === 'loading'" class="domain-empty">正在读取节点日前/实时价格…</div>
        <div v-else class="domain-empty" :class="{ error: nodeState === 'error' }">{{ nodeError || '该日期没有此节点的精确价格序列，不展示全省均价替代。' }}</div>
      </article>

      <article class="domain-card output-card">
        <header><span><Activity :size="15" /> 出力与预测偏差</span><small>{{ matchedOutputName || '等待精确匹配' }}</small></header>
        <div v-if="outputState === 'ready' && outputSummary" class="output-body">
          <div class="metric-quads">
            <span><small>实际均值</small><strong>{{ number(outputSummary.actualAvg) }}</strong><em>MW</em></span>
            <span><small>{{ targetKind === 'plan' ? '计划均值' : '预测均值' }}</small><strong>{{ number(outputSummary.targetAvg) }}</strong><em>MW</em></span>
            <span><small>完成率</small><strong>{{ number(outputSummary.completionAvg) }}%</strong></span>
            <span><small>最大偏差</small><strong>{{ number(outputSummary.maxAbsDeviation) }}</strong><em>MW</em></span>
          </div>
          <div class="risk-band" :class="deviationTone"><Gauge :size="15" /><span><b>{{ outputSummary.anomalyCount }}</b> 个偏差关注时段</span><small>阈值：10% 或 5 MW</small></div>
        </div>
        <div v-else-if="outputState === 'loading'" class="domain-empty">正在读取电厂实际、计划与预测序列…</div>
        <div v-else class="domain-empty" :class="{ error: outputState === 'error' }">{{ outputError || '没有命中该电厂稳定名称的数据，不回退到全场站组合。' }}</div>
        <footer v-if="outputMeta"><span>{{ outputMeta.sourceType || 'UNKNOWN' }} · real={{ outputMeta.hasRealData }} · mock={{ outputMeta.mock }}</span><span>{{ outputMeta.updatedAt || '更新时间缺失' }}</span></footer>
      </article>

      <article class="domain-card settlement-card">
        <header><span><WalletCards :size="15" /> 结算价格</span><small>{{ matchedSettlementName || '等待精确匹配' }}</small></header>
        <div v-if="settlementState === 'ready' && settlementPoint" class="settlement-body">
          <span><small>日前结算</small><strong>{{ number(settlementPoint.daPrice) }}</strong></span>
          <span><small>实时结算</small><strong>{{ number(settlementPoint.rtPrice) }}</strong></span>
          <span><small>综合结算</small><strong>{{ number(settlementPoint.avgPrice) }}</strong></span>
          <span><small>中长期参照</small><strong>{{ number(settlementPoint.ltmPrice) }}</strong></span>
        </div>
        <div v-else-if="settlementState === 'loading'" class="domain-empty">正在读取正式结算回放…</div>
        <div v-else class="domain-empty" :class="{ error: settlementState === 'error' }">{{ settlementError || '该日期没有精确匹配的正式结算记录。' }}</div>
        <footer v-if="settlementMeta"><span>{{ settlementMeta.sourceType || 'UNKNOWN' }} · mock={{ settlementMeta.mock }}</span><span>{{ settlementMeta.updatedAt || '更新时间缺失' }}</span></footer>
      </article>

      <div class="risk-disclaimer"><CircleAlert :size="15" /><span>偏差仅是运行关注信号，不是结算结果或金额预测；本模块不执行潮流、拓扑或电价求解。</span></div>
      <nav v-if="mapping" class="business-links" aria-label="业务详情入口">
        <RouterLink :to="businessLocation(mapping.navigation.nodePrice)"><Zap :size="13" /> 节点电价 <ArrowUpRight :size="12" /></RouterLink>
        <RouterLink :to="businessLocation('/grid-assets/market')"><BarChart3 :size="13" /> 出力分析 <ArrowUpRight :size="12" /></RouterLink>
        <RouterLink :to="businessLocation('/grid-assets/weather-impact')"><Activity :size="13" /> 气象与预测 <ArrowUpRight :size="12" /></RouterLink>
        <RouterLink :to="businessLocation(mapping.navigation.settlement)"><WalletCards :size="13" /> 结算分析 <ArrowUpRight :size="12" /></RouterLink>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.business-panel { margin-top: 18px; padding: 16px; border: 1px solid rgba(64, 188, 225, .22); border-radius: 15px; color: #dff7ff; background: radial-gradient(circle at 90% 0, rgba(55, 205, 244, .1), transparent 32%), linear-gradient(145deg, #071b2c, #05111e); }
.business-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.business-head small { color: #5bcce9; font-size: var(--font-8); letter-spacing: .16em; }
.business-head h4 { margin: 4px 0 2px; font-size: var(--font-lg); }
.business-head p { margin: 0; color: #7298a8; font-size: var(--font-9); }
.date-actions { display: flex; flex: 0 0 auto; gap: 5px; }
.date-actions input, .date-actions button { height: 31px; color: #a8d0dc; border: 1px solid rgba(85, 185, 216, .2); border-radius: 8px; background: rgba(4, 20, 34, .8); font-size: var(--font-9); }
.date-actions input { width: 116px; padding: 0 7px; color-scheme: dark; }
.date-actions button { display: grid; width: 31px; place-items: center; cursor: pointer; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.domain-card { overflow: hidden; margin-top: 11px; border: 1px solid rgba(88, 178, 210, .14); border-radius: 11px; background: rgba(3, 16, 28, .68); }
.domain-card header { display: flex; min-height: 34px; padding: 0 11px; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid rgba(89, 181, 212, .1); }
.domain-card header span { display: inline-flex; align-items: center; gap: 6px; color: #aeeafa; font-size: var(--font-10); font-weight: 650; }
.domain-card header small { overflow: hidden; max-width: 58%; color: #63899a; font-size: var(--font-8); text-overflow: ellipsis; white-space: nowrap; }
.price-body, .output-body { padding: 11px; }
.price-primary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.price-primary span, .metric-quads span, .settlement-body span { display: flex; padding: 8px; flex-wrap: wrap; align-items: baseline; gap: 3px; border-radius: 8px; background: rgba(26, 79, 99, .16); }
.price-primary small, .metric-quads small, .settlement-body small { width: 100%; color: #668f9f; font-size: var(--font-8); }
.price-primary strong { color: #67e2ff; font-size: var(--font-19); font-variant-numeric: tabular-nums; }
.price-primary em, .metric-quads em { color: #608694; font-size: var(--font-7); font-style: normal; }
.price-body svg { width: 100%; height: 46px; margin-top: 8px; }
.mini-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.mini-grid span { display: flex; padding: 6px; flex-direction: column; gap: 2px; border-radius: 6px; color: #618697; background: rgba(16, 48, 64, .24); font-size: var(--font-7); }
.mini-grid b { color: #badce6; font-size: var(--font-9); font-weight: 550; }
.metric-quads, .settlement-body { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.metric-quads strong, .settlement-body strong { color: #dff8ff; font-size: var(--font-md); font-variant-numeric: tabular-nums; }
.risk-band { display: flex; margin-top: 8px; padding: 8px; align-items: center; gap: 6px; border-radius: 7px; color: #76dfbd; background: rgba(51, 170, 132, .1); font-size: var(--font-9); }
.risk-band.warning { color: #f2c56d; background: rgba(180, 131, 36, .12); }
.risk-band.danger { color: #ff9c91; background: rgba(209, 73, 65, .13); }
.risk-band small { margin-left: auto; color: inherit; opacity: .72; font-size: var(--font-7); }
.settlement-body { padding: 11px; }
.settlement-body span { background: rgba(94, 70, 146, .13); }
.settlement-body strong { color: #c7b6ff; }
.domain-empty { display: flex; min-height: 56px; padding: 12px; align-items: center; justify-content: center; gap: 6px; color: #728f9b; font-size: var(--font-9); text-align: center; }
.domain-empty.error { color: #eaa086; }
.domain-card footer { display: flex; padding: 6px 11px; justify-content: space-between; gap: 8px; color: #527482; border-top: 1px solid rgba(89, 181, 212, .08); font-size: var(--font-7); }
.risk-disclaimer { display: flex; margin-top: 10px; padding: 9px; align-items: flex-start; gap: 7px; border-radius: 8px; color: #c7aa67; background: rgba(208, 153, 46, .09); font-size: var(--font-8); line-height: 1.45; }
.business-links { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 9px; }
.business-links a { display: inline-flex; padding: 8px 5px; align-items: center; justify-content: center; gap: 4px; color: #8ddbee; border: 1px solid rgba(85, 185, 216, .15); border-radius: 7px; background: rgba(15, 59, 77, .18); font-size: var(--font-8); text-decoration: none; }
@media (max-width: 560px) {
  .business-head { flex-direction: column; }
  .metric-quads, .settlement-body, .business-links { grid-template-columns: 1fr 1fr; }
  .mini-grid { grid-template-columns: 1fr 1fr; }
}
</style>
