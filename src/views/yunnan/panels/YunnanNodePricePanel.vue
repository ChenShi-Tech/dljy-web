<script setup lang="ts">
// 云南节点电价分析面板（xhjy/yunnan/node-price）：消费 agent-backend /api/v1/spot/* 权威端点。
// 三块展示：原生 15m/1h 价格曲线（da/rt 可叠加）、价格热力图、当日节点日聚合明细。
// 数据固定来自中广核云南厂侧私有 PG；token 公司和 yunnan 地区由服务端核验，查询主体服务端固定，
// 不标「模拟数据」，也不允许在页内切到其他地区/集团链路。
import { computed, onMounted, ref } from 'vue'
import { MapPin, Activity, Grid3x3, TableProperties } from 'lucide-vue-next'
import ChartCard from '../../../components/common/ChartCard.vue'
import DynamicTable from '../../../components/common/DynamicTable.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { onRegionChange } from '../../../composables/useRegionReload'
import { chartChrome } from '../../../composables/useTheme'
import { axisTooltip, chartToolbox, fmtNum, insideZoom, emptyOverlay } from '@/services/chart/chartOptions'
import {
  searchSpotNodes,
  fetchNodePriceSeries,
  fetchDailySummary,
  fetchHeatmap,
  type SpotMarket,
  type NodePricePoint,
  type DailySummaryItem,
  type HeatmapData
} from '@/services/market/spotClient'
import { hasCgnYunnanPriceEntitlement } from '@/services/market/cgnYunnanLivePrice'

// 控件状态
// 来源标注必须与实际取数路径同源：spotClient 只在「云南 + 账号属中广核云南」时走厂侧
// 专属端点，其余账号静默落到公共节点价端点。标注写死会让非中广核账号读着公共数据、
// 页面却宣称是中广核厂侧私有数据，来源错标（#1791）。复用 spotClient 同一个谓词。
const usesCgnPrivatePrice = computed(() => hasCgnYunnanPriceEntitlement())

const region = ref('云南')
const date = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
const market = ref<SpotMarket>('da')
const marketOptions = [
  { value: 'da' as SpotMarket, label: '日前' },
  { value: 'rt' as SpotMarket, label: '实时' }
]
const compareMarket = ref(false)

// 节点检索（remote）
const nodeOptions = ref<string[]>([])
const nodeLoading = ref(false)
const selectedNode = ref('')

// 数据
const series = ref<NodePricePoint[]>([])
const compareSeries = ref<NodePricePoint[]>([])
const heatmap = ref<HeatmapData | null>(null)
const dailyItems = ref<DailySummaryItem[]>([])

// 加载/错误态
const seriesLoading = ref(false)
const heatmapLoading = ref(false)
const dailyLoading = ref(false)
let reloadAllReqId = 0
let seriesReqId = 0
let heatmapReqId = 0
let dailyReqId = 0
const errorMsg = ref('')
const ingestHint = ref(false)

const compareLabel = computed(() => (market.value === 'da' ? '实时' : '日前'))
const otherMarket = computed<SpotMarket>(() => (market.value === 'da' ? 'rt' : 'da'))

function isEmptyResultError(message: string): boolean {
  // 私有 PG 当日尚无事实时切到摄取提示；鉴权/PG 故障仍作为硬错误展示。
  return /未摄取|parquet|no data|暂无数据|not found|空/i.test(message)
}

async function remoteSearchNodes(query: string) {
  nodeLoading.value = true
  try {
    const data = await searchSpotNodes(query, region.value, 50)
    nodeOptions.value = data.nodes ?? []
  } catch {
    nodeOptions.value = []
  } finally {
    nodeLoading.value = false
  }
}

async function loadSeries(reqId = ++seriesReqId) {
  const node = selectedNode.value
  const currentDate = date.value
  const currentMarket = market.value
  const currentRegion = region.value
  const shouldCompare = compareMarket.value
  const compareWith = otherMarket.value
  if (!node) {
    if (reqId !== seriesReqId) return
    series.value = []
    compareSeries.value = []
    seriesLoading.value = false
    return
  }
  seriesLoading.value = true
  try {
    const main = await fetchNodePriceSeries(currentDate, node, currentMarket, currentRegion)
    if (reqId !== seriesReqId) return
    let nextCompareSeries: NodePricePoint[] = []
    if (shouldCompare) {
      const other = await fetchNodePriceSeries(currentDate, node, compareWith, currentRegion)
      if (reqId !== seriesReqId) return
      nextCompareSeries = other.series ?? []
    }
    series.value = main.series ?? []
    compareSeries.value = nextCompareSeries
    refreshIngestHint()
  } catch (e) {
    if (reqId !== seriesReqId) return
    series.value = []
    compareSeries.value = []
    handleError(e)
  } finally {
    if (reqId === seriesReqId) seriesLoading.value = false
  }
}

async function loadHeatmap(reqId = ++heatmapReqId) {
  const currentDate = date.value
  const currentMarket = market.value
  const currentRegion = region.value
  heatmapLoading.value = true
  try {
    const data = await fetchHeatmap(currentDate, currentMarket, 40, currentRegion)
    if (reqId !== heatmapReqId) return
    heatmap.value = data
  } catch (e) {
    if (reqId !== heatmapReqId) return
    heatmap.value = null
    handleError(e)
  } finally {
    if (reqId === heatmapReqId) heatmapLoading.value = false
  }
}

async function loadDaily(reqId = ++dailyReqId) {
  const currentDate = date.value
  const currentMarket = market.value
  const currentRegion = region.value
  dailyLoading.value = true
  try {
    const data = await fetchDailySummary(currentDate, currentMarket, 200, currentRegion)
    if (reqId !== dailyReqId) return
    dailyItems.value = data.items ?? []
  } catch (e) {
    if (reqId !== dailyReqId) return
    dailyItems.value = []
    handleError(e)
  } finally {
    if (reqId === dailyReqId) dailyLoading.value = false
  }
}

function handleError(e: unknown) {
  const message = e instanceof Error ? e.message : '加载失败'
  if (isEmptyResultError(message)) {
    ingestHint.value = true
    errorMsg.value = ''
  } else {
    errorMsg.value = message
  }
}

// 三块都空且无硬错误 → 判定私有 PG 尚无该日节点电价。
// 抽出共用：reloadAll 与 loadSeries（onCompareChange/onNodeChange 仅刷曲线的路径）都调，
// 否则只刷曲线时 reloadAll 的 reqId 守卫 early return 会跳过空态判断（#463）。
function refreshIngestHint() {
  // 双向同步：三块都空且无 errorMsg → true，否则 false。
  // 避免 loadSeries 先于 heatmap/daily 回填时误置 true 后不清（#463 #3522402165）。
  ingestHint.value = !errorMsg.value && !heatmap.value?.nodes?.length && !dailyItems.value.length && !series.value.length
}

async function reloadAll() {
  const reqId = ++reloadAllReqId
  const heatmapId = ++heatmapReqId
  const dailyId = ++dailyReqId
  const seriesId = ++seriesReqId
  errorMsg.value = ''
  ingestHint.value = false
  await Promise.all([loadHeatmap(heatmapId), loadDaily(dailyId), loadSeries(seriesId)])
  if (reqId !== reloadAllReqId) return
  refreshIngestHint()
}

// 控件变化后重拉（节点检索后选中也触发曲线）。
function resetAndReload() {
  selectedNode.value = ''
  nodeOptions.value = []
  void reloadAll()
}
function onDateChange() {
  void reloadAll()
}
function onMarketChange() {
  void reloadAll()
}
function onCompareChange() {
  reloadAllReqId += 1
  void loadSeries()
}
function onNodeChange() {
  reloadAllReqId += 1
  void loadSeries()
}

// 图表 option（buildOption 函数式，ChartCard 自动追踪响应式重绘）
function buildSeriesOption() {
  const cc = chartChrome()
  const x = series.value.map((p) => p.time_point)
  const empty = !series.value.length
  const list: Record<string, unknown>[] = [
    {
      name: market.value === 'da' ? '日前' : '实时',
      type: 'line',
      smooth: false,
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.8, color: '#0f766e' },
      itemStyle: { color: '#0f766e' },
      data: series.value.map((p) => p.price)
    }
  ]
  if (compareMarket.value && compareSeries.value.length) {
    list.push({
      name: compareLabel.value,
      type: 'line',
      smooth: false,
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.6, color: '#ED7D31', type: 'dashed' },
      itemStyle: { color: '#ED7D31' },
      data: compareSeries.value.map((p) => p.price)
    })
  }
  return {
    tooltip: { ...axisTooltip({ unit: '元/MWh', digits: 2 }), confine: true },
    toolbox: chartToolbox('节点电价曲线'),
    legend: { top: 4, right: 80, itemWidth: 16, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 24, top: 40, bottom: 36, containLabel: false },
    dataZoom: insideZoom(),
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 10,
        // 15m 与 1h 都只标整点；不把 1h 源升采样成 96 点。
        formatter: (v: string) => (String(v).endsWith(':00') || /:00$/.test(String(v)) ? String(v) : '')
      },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '元/MWh',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: list,
    ...emptyOverlay(empty, selectedNode.value ? '该节点当日暂无序列' : '请先检索并选择节点')
  }
}

function buildHeatmapOption() {
  const cc = chartChrome()
  const hm = heatmap.value
  const nodes = hm?.nodes ?? []
  const times = hm?.time_points ?? []
  const matrix = hm?.matrix ?? []
  // 矩阵展平为 [timeIdx, nodeIdx, value]；null 跳过。
  const points: Array<[number, number, number]> = []
  let vmin = Infinity
  let vmax = -Infinity
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (v === null || v === undefined || !Number.isFinite(Number(v))) continue
      const num = Number(v)
      points.push([c, r, num])
      if (num < vmin) vmin = num
      if (num > vmax) vmax = num
    }
  }
  const empty = !points.length
  if (!Number.isFinite(vmin)) vmin = 0
  if (!Number.isFinite(vmax)) vmax = 1
  return {
    tooltip: {
      position: 'top',
      confine: true,
      formatter: (p: { value?: [number, number, number] }) => {
        const val = p.value
        if (!val) return ''
        const [c, r, v] = val
        return `${nodes[r] ?? ''}<br/>${times[c] ?? ''}<br/><b>${fmtNum(v, 2)} 元/MWh</b>`
      }
    },
    grid: { left: 120, right: 24, top: 16, bottom: 56, containLabel: false },
    xAxis: {
      type: 'category',
      data: times,
      splitArea: { show: false },
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 9,
        interval: times.length > 48 ? 7 : 1,
        formatter: (v: string) => String(v)
      },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'category',
      data: nodes,
      splitArea: { show: true },
      axisLabel: { color: cc.axisLabel, fontSize: 10, width: 110, overflow: 'truncate' },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    visualMap: {
      min: vmin,
      max: vmax,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 6,
      itemWidth: 14,
      itemHeight: 90,
      textStyle: { color: cc.axisLabel, fontSize: 10 },
      inRange: { color: ['#1e3a8a', '#2563eb', '#22c55e', '#facc15', '#f97316', '#dc2626'] }
    },
    series: [
      {
        name: '节点电价',
        type: 'heatmap',
        data: points,
        emphasis: { itemStyle: { borderColor: '#111', borderWidth: 1 } },
        progressive: 2000
      }
    ],
    ...emptyOverlay(empty, '当日暂无节点电价热力数据')
  }
}

// 日聚合明细表（DynamicTable 列标签 + 行映射）
const dailyLabels: Record<string, string> = {
  node_name: '节点',
  avg: '均价(元/MWh)',
  max: '最高(元/MWh)',
  min: '最低(元/MWh)',
  neg_share_pct: '负价占比(%)',
  points: '点数'
}
const dailyRows = computed(() =>
  dailyItems.value.map((it) => ({
    node_name: it.node_name,
    avg: fmtNum(it.avg, 2),
    max: fmtNum(it.max, 2),
    min: fmtNum(it.min, 2),
    neg_share_pct: fmtNum(it.neg_share_pct, 1),
    points: it.points
  }))
)

onMounted(reloadAll)

// 全局地区变化时由父视图卸载/重挂；仍触发一次请求代际切换，防旧响应回写。
onRegionChange(() => {
  resetAndReload()
})
</script>

<template>
  <div class="node-price-panel">
    <RegionDataBanner />

    <section class="np-hero">
      <div class="np-hero-main">
        <div class="np-kicker"><MapPin :size="16" /><span>云南 · 现货节点电价分析</span></div>
        <p v-if="usesCgnPrivatePrice">选择日期与市场后，查看原生 15m/1h 节点曲线、全网节点热力图与日聚合明细。来源为中广核云南厂侧私有 PostgreSQL，非电网官方接口。</p>
        <p v-else>选择日期与市场后，查看原生 15m/1h 节点曲线、全网节点热力图与日聚合明细。来源为平台已入库的公共节点电价行情，非中广核厂侧私有数据。</p>
      </div>
    </section>

    <section class="np-controls">
      <label class="np-field">
        <span>地区</span>
        <el-select v-model="region" disabled>
          <el-option label="云南（中广核专属）" value="云南" />
        </el-select>
      </label>
      <label class="np-field">
        <span>日期</span>
        <el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          placeholder="选择日期"
          @change="onDateChange"
        />
      </label>
      <label class="np-field">
        <span>市场</span>
        <el-radio-group v-model="market" @change="onMarketChange">
          <el-radio-button v-for="m in marketOptions" :key="m.value" :value="m.value">{{ m.label }}</el-radio-button>
        </el-radio-group>
      </label>
      <label class="np-field np-field--node">
        <span>节点检索</span>
        <el-select
          v-model="selectedNode"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="remoteSearchNodes"
          :loading="nodeLoading"
          placeholder="输入节点名检索"
          @change="onNodeChange"
        >
          <el-option v-for="n in nodeOptions" :key="n" :label="n" :value="n" />
        </el-select>
      </label>
      <label class="np-field np-field--compare">
        <span>叠加对比</span>
        <el-switch v-model="compareMarket" :active-text="`叠加${compareLabel}`" inline-prompt @change="onCompareChange" />
      </label>
    </section>

    <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="np-alert" show-icon />
    <el-alert
      v-else-if="ingestHint"
      type="warning"
      :closable="false"
      class="np-alert"
      show-icon
      title="后端暂无该日节点电价数据"
      description="请检查中广核云南 prices/all 常驻轮询及该日期/市场的私有 PostgreSQL 数据；不会回落公共节点价。"
    />

    <section class="np-charts">
      <ChartCard
        :title="`节点价格曲线 · ${series.length || '—'} 点`"
        :height="340"
        :loading="seriesLoading"
        :build-option="buildSeriesOption"
        fullscreen
      >
        <template #actions>
          <span class="np-chart-sub"><Activity :size="13" /> {{ selectedNode || '未选节点' }} · {{ market === 'da' ? '日前' : '实时' }}</span>
        </template>
      </ChartCard>

      <ChartCard
        title="节点价格热力图（Top 40 节点 × 96 时段）"
        :height="440"
        :loading="heatmapLoading"
        :build-option="buildHeatmapOption"
        fullscreen
      >
        <template #actions>
          <span class="np-chart-sub"><Grid3x3 :size="13" /> {{ market === 'da' ? '日前' : '实时' }} · {{ region }}</span>
        </template>
      </ChartCard>
    </section>

    <section class="np-table-card">
      <div class="np-table-head">
        <h3><TableProperties :size="16" /> 当日节点日聚合明细</h3>
        <span class="np-table-sub">{{ date }} · {{ market === 'da' ? '日前' : '实时' }} · {{ region }}</span>
      </div>
      <div v-loading="dailyLoading">
        <DynamicTable
          :rows="dailyRows"
          :labels="dailyLabels"
          :page-size="20"
          export-name="yn-node-price-daily"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.node-price-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.np-hero {
  padding: 16px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffffff 0%, #eef7f3 55%, #f7fbff 100%);
}

.np-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #0f766e;
  font-size: 13px;
  font-weight: 650;
}

.np-hero p {
  margin: 8px 0 0;
  color: #5c6b76;
  line-height: 1.7;
}

.np-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.np-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.np-field > span {
  color: #50616e;
  font-size: 12px;
  font-weight: 650;
}

.np-field :deep(.el-select),
.np-field :deep(.el-date-editor) {
  width: 180px;
}

.np-field--node :deep(.el-select) {
  width: 260px;
}

.np-field--compare {
  justify-content: flex-end;
}

.np-alert {
  margin: 0;
}

.np-charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.np-chart-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted, #909399);
}

.np-table-card {
  padding: 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.np-table-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.np-table-head h3 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: #172b3a;
  font-size: 15px;
}

.np-table-sub {
  color: #687987;
  font-size: 12px;
}

@media (max-width: 768px) {
  .np-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .np-field :deep(.el-select),
  .np-field :deep(.el-date-editor),
  .np-field--node :deep(.el-select) {
    width: 100%;
  }
}
</style>
