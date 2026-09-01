<script setup lang="ts">
// 偏差维（Epic #2033 · #2038 外壳）：四格指标 + 申报 vs 实际 96 点主图（阶梯线 + 容差带 + 最差点标记）
// + 96 格热力条 + 周月聚合与责任归因面板（#2042）+ 本维模板清单。
// 指标数据来自 quant /review 一份响应；口径告诫（caliber_caveats）进考核费 ⓘ，不落页面。
// 偏差率走 cockpitModel.deviationMetricOf（#2038 首版口径，不另起一套实现）。
import { computed, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import type { ReviewFailure, ReviewResult } from '@/services/quant/quantClient'
import { heatCells } from '@/services/review/reviewDashboard'
import { deviationMetricOf, type TemplateCard } from '@/services/review/cockpitModel'
import MetricTile from '../MetricTile.vue'
import DeviationHeatStrip from '../DeviationHeatStrip.vue'
import DeviationAggregatePanel from '../DeviationAggregatePanel.vue'
import TemplateChips from '../TemplateChips.vue'

const props = defineProps<{
  result: ReviewResult | null
  failure: ReviewFailure | null
  loading: boolean
  templates: TemplateCard[]
  tolerancePct: number
  penaltyPrice: number
}>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()

const fmtInt = (n: number) => Math.round(n).toLocaleString('zh-CN')

const declaredTotal = computed(() =>
  (props.result?.detail ?? []).reduce((sum: number, p) => sum + (p.declared || 0), 0)
)
/** 比值 → 百分数一位小数；申报总量 ≤0 时 deviationMetricOf 给 null（不用 0 冒充无偏差）。 */
const ratePct = computed(() => {
  const m = deviationMetricOf({
    totalAbsDeviationMwh: props.result?.deviation.total_abs_deviation_mwh ?? null,
    declaredTotalMwh: declaredTotal.value || null,
    estimatedPenaltyYuan: props.result?.deviation.estimated_penalty_yuan ?? null
  })
  return m.deviationPct === null ? null : Math.round(m.deviationPct * 1000) / 10
})
const worstLabel = computed(() => String(props.result?.deviation.worst_point.datetime ?? '').slice(-5) || '—')
const worstDev = computed(() => props.result?.deviation.worst_point.deviation ?? 0)
const caveatText = computed(() => (props.result?.caliber_caveats ?? []).join('\n'))
const cells = computed(() => heatCells(props.result?.detail ?? []))

// 偏差率状态 pill：以当前容差带为目标——超出容差即「超带」。
// 不出「达标」字样：偏差率目标值待管理要求给定（Epic #2033 待确认项 P2），此处只陈述与容差的关系。
const ratePill = computed(() => {
  if (ratePct.value === null || !props.result) return null
  const tol = props.result.deviation.tolerance_pct
  return ratePct.value <= tol ? { text: '带内', tone: 'ok' as const } : { text: '超带', tone: 'warn' as const }
})

const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render })

function render() {
  const r = props.result
  if (!r || !chartEl.value) return
  const declared = r.detail.map((p) => p.declared)
  const actual = r.detail.map((p) => p.actual)
  const tol = r.deviation.tolerance_pct / 100
  const lower = declared.map((v) => v * (1 - tol))
  const bandHeight = declared.map((v) => v * 2 * tol)
  const worstIdx = r.detail.findIndex((p) => p.datetime === r.deviation.worst_point.datetime)
  const primary = cssVar('--primary') || '#0f766e'
  const ink = cssVar('--text') || '#1f2a37'
  const danger = cssVar('--danger') || '#dc2626'
  chart.setOption({
    ...emptyOverlay(!r.detail.length),
    tooltip: axisTooltip({ unit: 'MWh' }),
    legend: bottomLayoutLegend({ data: ['申报电量', '实际电量'], textStyle: { fontSize: 10 } }),
    toolbox: bottomToolbox('申报vs实际偏差', 8),
    grid: { left: 48, right: 16, top: 56, bottom: 56 },
    dataZoom: insideZoom(),
    xAxis: { type: 'category', data: r.detail.map((p) => String(p.datetime).slice(-5)) },
    yAxis: { type: 'value', name: 'MWh', scale: true },
    series: [
      // 容差带：下界透明 + 高度带色叠成一条带（stack 技法），tooltip 里不出现
      { name: '_band_lo', type: 'line', step: 'end', stack: 'band', showSymbol: false, silent: true, data: lower, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, tooltip: { show: false }, emphasis: { disabled: true } },
      { name: '_band', type: 'line', step: 'end', stack: 'band', showSymbol: false, silent: true, data: bandHeight, lineStyle: { opacity: 0 }, areaStyle: { color: primary, opacity: 0.12 }, tooltip: { show: false }, emphasis: { disabled: true } },
      // 分时电量按时段恒定，阶梯线真实呈现；申报为决策值虚线、实际计量实线加粗
      { name: '申报电量', type: 'line', step: 'end', showSymbol: false, data: declared, lineStyle: { width: 1.6, type: 'dashed', color: primary }, itemStyle: { color: primary } },
      {
        name: '实际电量', type: 'line', step: 'end', showSymbol: false, data: actual,
        lineStyle: { width: 2, color: ink }, itemStyle: { color: ink },
        markPoint: worstIdx >= 0 ? {
          symbol: 'circle', symbolSize: 10,
          itemStyle: { color: 'transparent', borderColor: danger, borderWidth: 2 },
          label: { show: true, position: 'top', color: danger, fontWeight: 600, fontSize: 11, formatter: () => `${worstLabel.value} ${worstDev.value > 0 ? '+' : ''}${worstDev.value}` },
          data: [{ coord: [worstIdx, actual[worstIdx]] }]
        } : undefined
      }
    ]
  }, { replaceMerge: ['graphic', 'series'] }) // 空态 graphic 需整组替换才能在有数据时清掉
}

// 切回本维时 result 早已就绪、watch 不会触发——挂载后必须主动渲染一次
onMounted(render)
watch(() => props.result, () => { if (props.result) render() }, { flush: 'post' })
watch(() => props.loading, (v: boolean) => (v ? chart.showLoading() : chart.hideLoading()))
</script>

<template>
  <div class="dim">
    <div class="tiles">
      <MetricTile
        label="偏差率" :value="ratePct === null ? '—' : String(ratePct)" :unit="ratePct === null ? '' : '%'"
        :tone="ratePct === null ? 'muted' : 'default'" :pill="ratePill"
        :sub="result ? `容差 ±${result.deviation.tolerance_pct}%` : ''"
        info="总偏差电量 ÷ 申报总量。申报总量为 0 或缺失时不出数（不用 0% 冒充无偏差）。"
      />
      <MetricTile
        label="受考核电量" :value="result ? fmtInt(result.deviation.assessed_mwh) : '—'" unit="MWh"
        :tone="result ? 'default' : 'muted'"
        :sub="result ? `总偏差 ${fmtInt(result.deviation.total_abs_deviation_mwh)} MWh` : ''"
      />
      <MetricTile
        label="估算考核费" :value="result ? fmtInt(result.deviation.estimated_penalty_yuan) : '—'" unit="元"
        :tone="result ? 'bad' : 'muted'" :info="caveatText" :sub="result ? '自算口径' : ''"
      />
      <MetricTile
        label="最差时点" :value="worstLabel" :tone="result ? 'default' : 'muted'"
        :sub="result ? `${worstDev > 0 ? '+' : ''}${worstDev} MWh` : ''"
      />
    </div>

    <section v-if="failure" class="panel guidance" :class="`state-${failure.kind}`">
      <el-empty :image-size="72">
        <template #description>
          <strong>{{ failure.title }}</strong>
          <p>{{ failure.description }}</p>
          <small v-if="failure.detail">{{ failure.detail }}</small>
        </template>
      </el-empty>
    </section>
    <section v-else class="panel chart">
      <div class="top"><h3>申报 vs 实际 · 96 点</h3></div>
      <div ref="chartEl" class="host chart-host" />
      <DeviationHeatStrip v-if="cells.length" :cells="cells" class="heat" />
    </section>

    <DeviationAggregatePanel :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" />
    <TemplateChips :templates="templates" label="偏差复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 720px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
/* 对冲全局 .chart{height:360px}，否则热力条溢出卡片 */
.chart { padding: 12px 14px 12px; display: flex; flex-direction: column; gap: 8px; height: auto; }
.top h3 { margin: 0; font-size: var(--font-13-5); font-weight: 600; }
.host { width: 100%; height: 300px; }
.heat { margin-left: 48px; margin-right: 16px; }
.guidance { padding: 12px 16px; }
.guidance strong { display: block; color: var(--text); }
.guidance p { margin: 6px 0; color: var(--muted); }
.guidance small { color: var(--muted); }
</style>
