<script setup lang="ts">
// 云南日前-实时价差决策面板（xhjy/yunnan/spread）：消费 agent-backend /api/v1/spot/spread。
// 价差 = 日前出清价 − 实时出清价（系统均价）；预测=昨日同时段价差(persistence)+A 弹性增强。
// 展示：① 预测 vs 实际价差 96 点曲线；② 套利决策（greedy 回放 + cross_period_optimizer 驱动）KPI；
//      ③ 逐时段套利动作标注。数据真实（权威后端，非 Mock）；kind=决策支持参考·非结算依据；
// 严格地区 yunnan「真实或空」：available=False → 空态（不臆造）。决策上线前人工确认。
import { computed, onMounted, ref } from 'vue'
import { ArrowLeftRight, TrendingUp, Gauge, AlertTriangle } from 'lucide-vue-next'
import ChartCard from '@/components/common/ChartCard.vue'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import { onRegionChange } from '@/composables/useRegionReload'
import { chartChrome } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, fmtNum, insideZoom, emptyOverlay } from '@/services/chart/chartOptions'
import { fetchSpotRegions } from '@/services/market/spotClient'
import { fetchSpread, type SpreadResult } from '@/services/market/spreadClient'

const regions = ref<string[]>([])
const region = ref('云南')
const date = ref('2026-05-20')
const windowDays = ref(21)
const threshold = ref(20)
const thresholdOptions = [0, 20, 50, 100]

const result = ref<SpreadResult | null>(null)
const loading = ref(false)
const errorMsg = ref('')
// reload 版本守卫：快速切日期/地区/窗口/阈值时旧响应丢弃，防覆盖新（与 PlantOutputPanel 同族同模式）
const reloadSeq = ref(0)

const available = computed(() => result.value?.available === true)

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
    const data = await fetchSpread(date.value, region.value, windowDays.value, threshold.value)
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

const kpis = computed(() => {
  const r = result.value
  if (!r || !r.available) return null
  return {
    signHit: r.sign_hit_rate,
    signN: r.sign_hit_count,
    greedy: r.arbitrage?.revenue_yuan ?? null,
    greedyActed: r.arbitrage ? `${r.arbitrage.acted}/${r.arbitrage.total}` : '—',
    optAvail: r.optimizer?.available === true,
    optRealized: r.optimizer?.realized_revenue_yuan ?? null,
    optBeats: r.optimizer?.beats_never_act === true,
    crossMwh: r.optimizer?.cross_arbitrage_mwh ?? null,
    enhanced: r.elasticity_enhanced === true,
    prevDay: r.prev_day
  }
})

const signHitGood = computed(() => (kpis.value?.signHit ?? 0) > 0.55)

// 图① 预测 vs 实际价差（96 点）
function buildSpreadOption() {
  const cc = chartChrome()
  const r = result.value
  const empty = !r || !r.available || !r.spread_forecast.length
  const fc = new Map((r?.spread_forecast ?? []).map((p) => [p.time_point, p.spread]))
  const times = (r?.spread_actual ?? []).map((p) => p.time_point)
  return {
    tooltip: { ...axisTooltip({ unit: '元/MWh', digits: 2 }), confine: true },
    toolbox: chartToolbox('日前-实时价差'),
    legend: { top: 4, right: 80, itemWidth: 16, itemHeight: 8, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 24, top: 40, bottom: 36, containLabel: false },
    dataZoom: insideZoom(),
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: { color: cc.axisLabel, fontSize: 10, formatter: (v: string) => (/:00$/.test(String(v)) ? String(v) : '') },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      name: '价差(DA−RT) 元/MWh',
      scale: true,
      nameTextStyle: { color: cc.axisLabel, fontSize: 11 },
      axisLabel: { color: cc.axisLabel, fontSize: 10 },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        name: '实际价差',
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.8, color: '#0f766e' },
        itemStyle: { color: '#0f766e' },
        markLine: {
          symbol: 'none',
          silent: true,
          lineStyle: { color: '#94a3b8', type: 'dashed' },
          data: [{ yAxis: 0 }]
        },
        data: (r?.spread_actual ?? []).map((p) => p.spread)
      },
      {
        name: '预测价差',
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.6, color: '#ED7D31', type: 'dashed' },
        itemStyle: { color: '#ED7D31' },
        data: times.map((t) => fc.get(t) ?? null)
      }
    ],
    ...emptyOverlay(empty, '该日无足够真实 DA/RT 价差数据')
  }
}

// 图② 逐时段套利方向（预测符号决定买DA卖RT / 卖DA买RT；|预测|>阈值才动）
function buildActionOption() {
  const cc = chartChrome()
  const r = result.value
  const empty = !r || !r.available || !r.spread_forecast.length
  const th = r?.threshold ?? threshold.value
  const fc = r?.spread_forecast ?? []
  const times = fc.map((p) => p.time_point)
  // 动作：+1 卖DA买RT（预测DA>RT），-1 买DA卖RT（预测RT>DA），0 不动（|预测|≤阈值）
  const actions = fc.map((p) => (Math.abs(p.spread) <= th ? 0 : p.spread > 0 ? 1 : -1))
  return {
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (ps: Array<{ dataIndex: number }>) => {
        const i = ps[0]?.dataIndex ?? 0
        const a = actions[i]
        const label = a === 1 ? '卖日前/买实时' : a === -1 ? '买日前/卖实时' : '不动（低置信）'
        return `${times[i]}<br/>预测价差 ${fmtNum(fc[i]?.spread, 2)} 元/MWh<br/><b>${label}</b>`
      }
    },
    toolbox: chartToolbox('套利动作'),
    grid: { left: 56, right: 24, top: 24, bottom: 36, containLabel: false },
    dataZoom: insideZoom(),
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: { color: cc.axisLabel, fontSize: 10, formatter: (v: string) => (/:00$/.test(String(v)) ? String(v) : '') },
      axisLine: { lineStyle: { color: cc.splitLine } }
    },
    yAxis: {
      type: 'value',
      min: -1.4,
      max: 1.4,
      interval: 1,
      axisLabel: {
        color: cc.axisLabel,
        fontSize: 10,
        formatter: (v: number) => (v === 1 ? '卖DA买RT' : v === -1 ? '买DA卖RT' : v === 0 ? '不动' : '')
      },
      splitLine: { lineStyle: { color: cc.splitLine } }
    },
    series: [
      {
        name: '套利动作',
        type: 'bar',
        data: actions,
        itemStyle: {
          color: (p: { value: number }) => (p.value > 0 ? '#dc2626' : p.value < 0 ? '#2563eb' : '#cbd5e1')
        },
        barWidth: '60%'
      }
    ],
    ...emptyOverlay(empty, '该日无套利动作序列')
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
  <div class="spread-panel">
    <RegionDataBanner />

    <section class="sp-hero">
      <div class="sp-hero-main">
        <div class="sp-kicker"><ArrowLeftRight :size="16" /><span>云南 · 日前-实时价差预测与套利决策</span></div>
        <p>
          价差 = 日前出清价 − 实时出清价（系统均价）。以昨日同时段价差（persistence，叠加 A 价格弹性的竞价空间日间增量）预测目标日价差符号+幅度，
          按预测信号驱动储能跨期套利（cross_period_optimizer），按实际价差回放结算收益。
        </p>
        <div class="sp-tags">
          <el-tag size="small" type="warning">决策支持参考 · 非结算依据</el-tag>
          <el-tag size="small" type="success">真实数据：节点电价 DA/RT</el-tag>
          <el-tag size="small" type="info">套利收益=回放参考·非真实成交</el-tag>
        </div>
      </div>
    </section>

    <section class="sp-controls">
      <label class="sp-field">
        <span>地区</span>
        <el-select v-model="region" :disabled="!regions.length" filterable @change="onRegionSelect">
          <el-option v-for="r in regions.length ? regions : [region]" :key="r" :label="r" :value="r" />
        </el-select>
      </label>
      <label class="sp-field">
        <span>目标日</span>
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" @change="reload" />
      </label>
      <label class="sp-field">
        <span>训练窗口</span>
        <el-select v-model="windowDays" @change="reload">
          <el-option :label="'近 14 天'" :value="14" />
          <el-option :label="'近 21 天'" :value="21" />
          <el-option :label="'近 31 天'" :value="31" />
        </el-select>
      </label>
      <label class="sp-field">
        <span>套利置信门</span>
        <el-select v-model="threshold" @change="reload">
          <el-option v-for="t in thresholdOptions" :key="t" :label="`|预测| > ${t}`" :value="t" />
        </el-select>
      </label>
    </section>

    <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="sp-alert" show-icon />
    <el-alert
      v-else-if="!loading && !available"
      type="warning"
      :closable="false"
      class="sp-alert"
      show-icon
      title="该日/地区暂无足够真实 DA/RT 价差数据"
      description="价差引擎仅云南有真实日前/实时系统价；严格地区「真实或空」，缺真实数据走空态（不臆造）。请更换为数据覆盖范围内（2026-05）的云南日期重试。"
    />

    <section v-if="available && kpis" class="sp-kpis">
      <div class="kpi" :class="{ good: signHitGood, bad: !signHitGood }">
        <span class="kpi-label"><Gauge :size="13" /> 价差符号命中率</span>
        <span class="kpi-value">{{ fmtNum((kpis.signHit ?? 0) * 100, 1) }}%</span>
        <span class="kpi-sub">滚动回测 {{ kpis.signN }} 时段 · 阈值 0.55{{ kpis.enhanced ? ' · 弹性增强' : '' }}</span>
      </div>
      <div class="kpi" :class="{ good: (kpis.greedy ?? 0) > 0 }">
        <span class="kpi-label"><TrendingUp :size="13" /> 套利回放收益（greedy）</span>
        <span class="kpi-value">{{ fmtNum(kpis.greedy, 0) }} 元</span>
        <span class="kpi-sub">动作 {{ kpis.greedyActed }} 时段 · 不动基线 0</span>
      </div>
      <div class="kpi" :class="{ good: kpis.optBeats }">
        <span class="kpi-label"><TrendingUp :size="13" /> 优化器驱动收益（cvxpy）</span>
        <span class="kpi-value">{{ kpis.optAvail ? `${fmtNum(kpis.optRealized, 0)} 元` : '不可用' }}</span>
        <span class="kpi-sub">{{ kpis.optAvail ? `跨期套利 ${fmtNum(kpis.crossMwh, 0)} MWh · ${kpis.optBeats ? '不劣于不动' : '劣于不动（按目标日实际价结算或亏损）'}` : 'cross_period_optimizer 需 cvxpy' }}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label"><AlertTriangle :size="13" /> 基准日 / 口径</span>
        <span class="kpi-value kpi-method">persistence</span>
        <span class="kpi-sub">naive 基准日 {{ kpis.prevDay ?? '—' }} · 决策上线前人工确认</span>
      </div>
    </section>

    <section v-if="available" class="sp-charts">
      <ChartCard
        title="预测 vs 实际价差（96 点，DA−RT）"
        :height="360"
        :loading="loading"
        :build-option="buildSpreadOption"
        fullscreen
      >
        <template #actions>
          <span class="sp-chart-sub">价差&lt;0=实时高于日前（买日前/卖实时）；&gt;0 反之</span>
        </template>
      </ChartCard>

      <ChartCard
        title="逐时段套利动作（|预测价差| > 置信门才动）"
        :height="280"
        :loading="loading"
        :build-option="buildActionOption"
        fullscreen
      >
        <template #actions>
          <span class="sp-chart-sub">红=卖日前/买实时 · 蓝=买日前/卖实时 · 灰=不动</span>
        </template>
      </ChartCard>
    </section>

    <section v-if="available && result" class="sp-notes">
      <h4>口径与数据说明</h4>
      <ul>
        <li v-for="(n, i) in result.notes" :key="i">{{ n }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.spread-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sp-hero {
  padding: 16px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffffff 0%, #eef4fb 55%, #f7fbff 100%);
}

.sp-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #2563eb;
  font-size: 13px;
  font-weight: 650;
}

.sp-hero p {
  margin: 8px 0 10px;
  color: #5c6b76;
  line-height: 1.7;
}

.sp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sp-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sp-field > span {
  color: #50616e;
  font-size: 12px;
  font-weight: 650;
}

.sp-field :deep(.el-select),
.sp-field :deep(.el-date-editor) {
  width: 170px;
}

.sp-alert {
  margin: 0;
}

.sp-kpis {
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
  font-size: 12px;
  font-weight: 650;
}

.kpi-value {
  color: #172b3a;
  font-size: 22px;
  font-weight: 760;
}

.kpi-value.kpi-method {
  font-size: 16px;
}

.kpi-sub {
  color: #687987;
  font-size: 11px;
  line-height: 1.4;
}

.sp-charts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.sp-chart-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted, #909399);
}

.sp-notes {
  padding: 14px 18px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fbfcfd;
}

.sp-notes h4 {
  margin: 0 0 8px;
  color: #172b3a;
  font-size: 14px;
}

.sp-notes ul {
  margin: 0;
  padding-left: 18px;
  color: #5c6b76;
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 1024px) {
  .sp-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .sp-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .sp-field :deep(.el-select),
  .sp-field :deep(.el-date-editor) {
    width: 100%;
  }

  .sp-kpis {
    grid-template-columns: 1fr;
  }
}
</style>
