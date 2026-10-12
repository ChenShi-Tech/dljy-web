<script setup lang="ts">
// 云南价格弹性分析面板（xhjy/yunnan/elasticity）：消费 agent-backend /api/v1/spot/elasticity。
// 竞价空间 = 统调负荷 + 外送电量 − 新能源出力（外送=官方 D-1 断面预测，缺披露时 0 并标注）；出清价=节点电价系统均价。
// 三块展示：① 分段弹性曲线（竞价空间→出清价散点 + 拟合分段折线，陡/平着色）；
//          ② 目标日预测 vs 实际价格 96 点曲线（弹性调整持续性）；
//          ③ 竞价空间 96 点曲线 + 陡段时段标注。
// 数据真实（经权威后端，非 /api/real Mock）；输出 kind=分析参考·非结算依据；
// 严格地区 yunnan「真实或空」：available=False → 空态提示，不臆造曲线。
import { computed, onMounted, ref } from 'vue'
import { TrendingUp, Activity, Gauge, AlertTriangle } from 'lucide-vue-next'
import ChartCard from '@/components/common/ChartCard.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { onRegionChange } from '@/composables/useRegionReload'
import { chartChrome } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, fmtNum, insideZoom, emptyOverlay } from '@/services/chart/chartOptions'
import { fetchSpotRegions, type SpotMarket } from '@/services/market/spotClient'
import { fetchElasticity, type ElasticityResult } from '@/services/market/elasticityClient'
import InfoHint from '@/components/common/InfoHint.vue'
import DataStatusLine from '@/components/trading/stages/DataStatusLine.vue'

// hero 口径全文：主定义句已升格进标题行，公式段与 MAE 口径收 ⓘ（spot-page-hint-density：hero 一行化）。
const HERO_INFO = [
  '竞价空间 = 统调负荷 + 外送电量 − 新能源出力（外送取南网官方 D-1 断面预测；外送数据当期缺披露时按 0 计）。',
  '拟合「竞价空间→出清价」分段弹性曲线，预判目标日价格水平 + 价格弹性（陡段=供需紧张、价格对负荷敏感；平段=宽松），对照朴素基线（昨日同时段）。',
  'MAE 口径（非 MAPE）。'
].join('\n')
const EMPTY_INFO =
  '价格弹性引擎仅云南有真实系统供需与节点电价；严格地区「真实或空」，缺真实数据走空态（不臆造曲线）。请更换为数据覆盖范围内（2026-05）的云南日期重试。'

// 控件状态
const regions = ref<string[]>([])
const region = ref('云南')
// 默认取数据范围内一天（节点电价/系统供需 Parquet 当前覆盖 2026-05），避免首屏空。
const date = ref('2026-05-20')
const market = ref<SpotMarket>('da')
const marketOptions = [
  { value: 'da' as SpotMarket, label: '日前' },
  { value: 'rt' as SpotMarket, label: '实时' }
]
const segments = ref(4)
const segmentOptions = [3, 4, 5, 6]
const windowDays = ref(21)

// 数据
const result = ref<ElasticityResult | null>(null)
const loading = ref(false)
const errorMsg = ref('')
// reload 版本守卫：快速切日期/市场/分段/窗口时旧响应丢弃，防覆盖新（与 PlantOutputPanel 同族同模式）
const reloadSeq = ref(0)

const available = computed(() => result.value?.available === true)
const noteItems = computed(() => (result.value?.notes ?? []).map((n) => ({ tone: 'info' as const, text: n })))
const steepColor = '#dc2626'
const flatColor = '#2563eb'

async function loadRegions() {
  try {
    const data = await fetchSpotRegions()
    regions.value = data.regions ?? []
    if (regions.value.length && !regions.value.includes(region.value)) {
      region.value = regions.value.includes('云南') ? '云南' : regions.value[0]
    }
  } catch {
    regions.value = []
  }
}

async function reload() {
  const seq = ++reloadSeq.value
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await fetchElasticity(date.value, market.value, region.value, segments.value, windowDays.value)
    if (seq !== reloadSeq.value) return // 新轮已发起，丢弃旧响应
    result.value = data
  } catch (e) {
    if (seq !== reloadSeq.value) return // 旧轮的错误不覆盖新轮
    result.value = null
    errorMsg.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (seq === reloadSeq.value) loading.value = false // 只有最新轮才关 loading
  }
}

function onRegionSelect() {
  void reload()
}

// KPI 派生
const kpis = computed(() => {
  const r = result.value
  if (!r || !r.available) return null
  return {
    maeModel: r.mae_model,
    maeNaive: r.mae_naive,
    improvement: r.mae_improvement_pct,
    steepShare: r.steep_share_pct,
    trainDays: r.train_days,
    trainPoints: r.train_points,
    prevDay: r.naive_prev_day,
    method: r.prediction_method
  }
})

const improvementPositive = computed(() => (kpis.value?.improvement ?? 0) > 0)

// 图① 分段弹性曲线（竞价空间→出清价）
function buildCurveOption() {
  const cc = chartChrome()
  const r = result.value
  const empty = !r || !r.available || !r.bid_space.length
  // 散点：目标日 (竞价空间, 实际价格)
  const scatter: Array<[number, number]> = []
  if (r) {
    const priceByTime = new Map(r.actual_price.map((p) => [p.time_point, p.price]))
    for (const bs of r.bid_space) {
      const pr = priceByTime.get(bs.time_point)
      if (bs.value != null && pr != null) scatter.push([bs.value, pr])
    }
  }
  // 分段折线：每段 (x_lo,y_lo)→(x_hi,y_hi)，按陡/平着色
  const segSeries = (r?.segments ?? []).map((s) => ({
    name: s.label === 'steep' ? '陡段' : '平段',
    type: 'line',
    data: [
      [s.x_lo, s.y_lo],
      [s.x_hi, s.y_hi]
    ],
    showSymbol: false,
    lineStyle: { width: 3, color: s.label === 'steep' ? steepColor : flatColor },
    itemStyle: { color: s.label === 'steep' ? steepColor : flatColor },
    z: 3,
    tooltip: { show: false }
  }))
  return {
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { seriesType?: string; value?: [number, number] }) => {
        if (p.seriesType === 'scatter' && p.value) {
          return `竞价空间 ${fmtNum(p.value[0], 0)}（原始值）<br/>出清价 <b>${fmtNum(p.value[1], 2)}</b> 元/MWh`
        }
        return ''
      }
    },
    toolbox: chartToolbox('价格弹性曲线'),
    legend: { top: 4, right: 12, data: ['日内出清点', '陡段', '平段'], itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 60, right: 24, top: 40, bottom: 48, containLabel: false },
    xAxis: {
      type: 'value',
      name: '竞价空间 (原始值)',
      scale: true,
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10, formatter: (v: number) => fmtNum(v, 0) },
      axisLine: { lineStyle: { color: cc.splitLine } },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '出清价 元/MWh',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        name: '日内出清点',
        type: 'scatter',
        data: scatter,
        symbolSize: 7,
        itemStyle: { color: 'rgba(15,118,110,0.55)' },
        z: 2
      },
      ...segSeries
    ],
    ...emptyOverlay(empty, '该日无足够真实数据拟合弹性曲线')
  }
}

// 图② 预测 vs 实际价格（96 点）
function buildPredictOption() {
  const cc = chartChrome()
  const r = result.value
  const empty = !r || !r.available || !r.predicted_price.length
  const times = r?.predicted_price.map((p) => p.time_point) ?? []
  return {
    tooltip: { ...axisTooltip({ unit: '元/MWh', digits: 2 }), confine: true },
    toolbox: chartToolbox('预测vs实际价格'),
    legend: { top: 4, right: 80, itemWidth: 16, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 24, top: 40, bottom: 36, containLabel: false },
    dataZoom: insideZoom(),
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 10,
        formatter: (v: string) => (/:00$/.test(String(v)) ? String(v) : '')
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
    series: [
      {
        name: '实际',
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.8, color: '#0f766e' },
        itemStyle: { color: '#0f766e' },
        data: r?.actual_price.map((p) => p.price) ?? []
      },
      {
        name: '弹性预测',
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.6, color: '#ED7D31', type: 'dashed' },
        itemStyle: { color: '#ED7D31' },
        data: r?.predicted_price.map((p) => p.price) ?? []
      }
    ],
    ...emptyOverlay(empty, '该日无预测序列')
  }
}

// 图③ 竞价空间 96 点 + 陡段标注
function buildBidSpaceOption() {
  const cc = chartChrome()
  const r = result.value
  const empty = !r || !r.available || !r.bid_space.length
  const times = r?.bid_space.map((p) => p.time_point) ?? []
  const labelByTime = new Map((r?.classification ?? []).map((c) => [c.time_point, c.label]))
  const bsData = r?.bid_space.map((p) => p.value) ?? []
  // 陡段点单独散点标注
  const steepPoints: Array<[number, number]> = []
  ;(r?.bid_space ?? []).forEach((p, idx) => {
    if (labelByTime.get(p.time_point) === 'steep' && p.value != null) steepPoints.push([idx, p.value])
  })
  return {
    tooltip: { ...axisTooltip({ unit: 'MW', digits: 0 }), confine: true },
    toolbox: chartToolbox('竞价空间96点'),
    legend: { top: 4, right: 80, data: ['竞价空间', '陡段时段'], itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 64, right: 24, top: 40, bottom: 36, containLabel: false },
    dataZoom: insideZoom(),
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 10,
        formatter: (v: string) => (/:00$/.test(String(v)) ? String(v) : '')
      },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '竞价空间 原始值',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10, formatter: (v: number) => fmtNum(v, 0) },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        name: '竞价空间',
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.8, color: '#7c3aed' },
        itemStyle: { color: '#7c3aed' },
        data: bsData
      },
      {
        name: '陡段时段',
        type: 'scatter',
        data: steepPoints,
        symbolSize: 8,
        itemStyle: { color: steepColor },
        z: 4
      }
    ],
    ...emptyOverlay(empty, '该日无竞价空间序列')
  }
}

onMounted(async () => {
  await loadRegions()
  await reload()
})

onRegionChange(() => {
  void onRegionSelect()
})
</script>

<template>
  <div class="elasticity-panel">
    <RegionDataBanner />

    <section class="el-hero">
      <div class="el-hero-main">
        <div class="el-kicker"><TrendingUp :size="16" /><span>云南 · 竞价空间 → 价格弹性预判</span></div>
        <InfoHint class="el-hero-info" :text="HERO_INFO" label="口径" />
        <el-tag size="small" type="warning">分析参考 · 非结算依据</el-tag>
        <el-tag size="small" type="success">真实数据：系统供需 + 节点电价</el-tag>
      </div>
    </section>

    <section class="el-controls">
      <label class="el-field">
        <span>地区</span>
        <el-select v-model="region" :disabled="!regions.length" filterable @change="onRegionSelect">
          <el-option v-for="r in regions.length ? regions : [region]" :key="r" :label="r" :value="r" />
        </el-select>
      </label>
      <label class="el-field">
        <span>目标日</span>
        <el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          placeholder="选择日期"
          @change="reload"
        />
      </label>
      <label class="el-field">
        <span>市场</span>
        <el-radio-group v-model="market" @change="reload">
          <el-radio-button v-for="m in marketOptions" :key="m.value" :value="m.value">{{ m.label }}</el-radio-button>
        </el-radio-group>
      </label>
      <label class="el-field">
        <span>分段数</span>
        <el-select v-model="segments" @change="reload">
          <el-option v-for="n in segmentOptions" :key="n" :label="`${n} 段`" :value="n" />
        </el-select>
      </label>
      <label class="el-field">
        <span>训练窗口</span>
        <el-select v-model="windowDays" @change="reload">
          <el-option :label="'近 14 天'" :value="14" />
          <el-option :label="'近 21 天'" :value="21" />
          <el-option :label="'近 31 天'" :value="31" />
        </el-select>
      </label>
    </section>

    <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="el-alert" show-icon />
    <DataStatusLine
      v-else-if="!loading && !available"
      label="数据状态"
      summary="该日/地区暂无足够真实数据拟合弹性曲线"
      :items="[{ tone: 'caveat', text: EMPTY_INFO }]"
    />

    <section v-if="available && kpis" class="el-kpis">
      <div class="kpi" :class="{ good: improvementPositive, bad: !improvementPositive }">
        <span class="kpi-label"><Gauge :size="13" /> 预测优于朴素基线</span>
        <span class="kpi-value">{{ kpis.improvement != null ? `${kpis.improvement > 0 ? '+' : ''}${fmtNum(kpis.improvement, 1)}%` : '—' }}</span>
        <span class="kpi-sub">MAE {{ fmtNum(kpis.maeModel, 2) }} vs 朴素基线 {{ fmtNum(kpis.maeNaive, 2) }}（元/MWh）</span>
      </div>
      <div class="kpi">
        <span class="kpi-label"><Activity :size="13" /> 陡段时段占比</span>
        <span class="kpi-value">{{ fmtNum(kpis.steepShare, 1) }}%</span>
        <span class="kpi-sub">陡段=供需紧张、价格对负荷敏感</span>
      </div>
      <div class="kpi">
        <span class="kpi-label"><TrendingUp :size="13" /> 训练样本</span>
        <span class="kpi-value">{{ kpis.trainDays }} 天</span>
        <span class="kpi-sub">{{ kpis.trainPoints }} 点 · 朴素基线基准日 {{ kpis.prevDay ?? '—' }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label"><AlertTriangle :size="13" /> 预测口径</span>
        <span class="kpi-value kpi-method">弹性调整持续性</span>
        <span class="kpi-sub">昨日同时段价 + 弹性隐含竞价空间日间增量</span>
      </div>
    </section>

    <section v-if="available" class="el-charts">
      <ChartCard
        title="分段弹性曲线（竞价空间 → 出清价）"
        :height="380"
        :loading="loading"
        :build-option="buildCurveOption"
        fullscreen
      >
        <template #actions>
          <span class="el-chart-sub">陡段（红）斜率大=价格敏感 · 平段（蓝）斜率小=宽松</span>
        </template>
      </ChartCard>

      <ChartCard
        title="目标日预测 vs 实际价格（96 点）"
        :height="340"
        :loading="loading"
        :build-option="buildPredictOption"
        fullscreen
      >
        <template #actions>
          <span class="el-chart-sub"><Activity :size="13" /> {{ date }} · {{ market === 'da' ? '日前' : '实时' }} · 弹性调整持续性</span>
        </template>
      </ChartCard>

      <ChartCard
        title="竞价空间 96 点曲线（陡段时段标注）"
        :height="320"
        :loading="loading"
        :build-option="buildBidSpaceOption"
        fullscreen
      >
        <template #actions>
          <span class="el-chart-sub">红点=落在陡段（价格对竞价空间敏感）的时段</span>
        </template>
      </ChartCard>
    </section>

    <DataStatusLine v-if="available && result" label="口径与数据说明" :items="noteItems" />
  </div>
</template>

<style scoped>
.elasticity-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.el-hero {
  padding: 10px 14px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffffff 0%, #f3effb 55%, #f7fbff 100%);
}

.el-hero-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.el-hero-info {
  margin-left: 2px;
}

.el-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #7c3aed;
  font-size: var(--font-md);
  font-weight: 650;
}

.el-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.el-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.el-field > span {
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.el-field :deep(.el-select),
.el-field :deep(.el-date-editor) {
  width: 160px;
}

.el-alert {
  margin: 0;
}

.el-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.kpi.good {
  border-color: #b7e4c7;
  background: linear-gradient(135deg, #ffffff 0%, #effaf1 100%);
}

.kpi.bad {
  border-color: #f5c2c7;
  background: linear-gradient(135deg, #ffffff 0%, #fdf0f1 100%);
}

.kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #50616e;
  font-size: var(--font-sm);
  font-weight: 650;
}

.kpi-value {
  color: #172b3a;
  font-size: var(--font-24);
  font-weight: 760;
}

.kpi-value.kpi-method {
  font-size: var(--font-16);
}

.kpi-sub {
  color: #687987;
  font-size: var(--font-xs);
  line-height: 1.4;
}

.el-charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.el-chart-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-xs);
  color: var(--muted, #909399);
}

@media (max-width: 1024px) {
  .el-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .el-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .el-field :deep(.el-select),
  .el-field :deep(.el-date-editor) {
    width: 100%;
  }

  .el-kpis {
    grid-template-columns: 1fr;
  }
}
</style>
