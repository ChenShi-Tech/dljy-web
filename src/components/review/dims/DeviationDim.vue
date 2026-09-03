<script setup lang="ts">
// 偏差维（Epic #2033 · #2038 外壳）：四格指标 + 申报 vs 实际 96 点主图（阶梯线 + 容差带 + 最差点标记）
// + 96 格热力条 + 周月聚合与责任归因面板（#2042）+ 本维模板清单。
// 指标数据来自 quant /review 一份响应；口径告诫（caliber_caveats）进考核费 ⓘ，不落页面。
// 偏差率走 cockpitModel.deviationMetricOf（#2038 首版口径，不另起一套实现）。
import { computed, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, insideZoom } from '@/services/chart/chartOptions'
import { classifyReviewError, fetchReview, type ReviewFailure, type ReviewResult } from '@/services/quant/quantClient'
import { shiftIsoDate } from 'shared/trading-rules/trading-calendar.mjs'
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

// ── 对比日叠加（清单 R1）：叠另一天的实际电量曲线（灰虚线），「跟可比日比」是复盘第一诉求 ──
// 切主日期即清空对比（定一种行为：旧对比日在新主日期语境下未必可比，宁空勿错）。
// 对比日只取实际侧（不传申报曲线），失败/覆盖窗外如实提示，不落任何合计。
const cmpDate = ref('')
const cmpLoading = ref(false)
const cmpError = ref('')
const cmpDetail = ref<ReviewResult['detail']>([])
let cmpSeq = 0
const cmpDayPrev = computed(() => (props.result ? shiftIsoDate(props.result.date, -1) : ''))
const cmpDayPrevWeek = computed(() => (props.result ? shiftIsoDate(props.result.date, -7) : ''))

async function loadCompare() {
  const seq = ++cmpSeq
  const target = cmpDate.value
  cmpDetail.value = []
  cmpError.value = ''
  if (!target || !props.result || target === props.result.date) return
  cmpLoading.value = true
  try {
    const out = await fetchReview({
      date: target,
      tolerance_pct: props.tolerancePct,
      penalty_price: props.penaltyPrice
    })
    if (seq !== cmpSeq) return
    cmpDetail.value = out.detail
  } catch (e) {
    if (seq !== cmpSeq) return
    const f = classifyReviewError(e)
    cmpError.value = f.detail || f.description || f.title
  } finally {
    if (seq === cmpSeq) cmpLoading.value = false
  }
}
watch(cmpDate, loadCompare)
watch([() => props.tolerancePct, () => props.penaltyPrice], loadCompare)
watch(() => props.result?.date, () => { cmpDate.value = '' })
// 对比数据就绪/清空后必须重渲染：render 只监听主 result 不会感知 cmpDetail 变化
watch(cmpDetail, () => { if (props.result) render() }, { flush: 'post' })

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
  const amber = '#d97706'
  // 对比日实际曲线：按主图 96 点长度对齐（对比日个别时点缺数补 null，不出假点）
  const cmpActual = cmpDetail.value.length
    ? Array.from({ length: declared.length }, (_, i) => cmpDetail.value[i]?.actual ?? null)
    : []
  const cmpName = `对比日实际 ${cmpDate.value}`
  const legendData = cmpActual.length ? ['申报电量', '实际电量', cmpName] : ['申报电量', '实际电量']
  // 极值标注（清单 R2）：申报/实际各自最高最低点描点标值；最差点保持红色大标
  const extremumMarks = (color: string) => {
    const data: Record<string, unknown>[] = [{ type: 'max' }, { type: 'min' }]
    return {
      symbol: 'circle', symbolSize: 6,
      itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.5 },
      label: { show: true, position: 'top', fontSize: 10, color, formatter: (p: { value: unknown }) => `${p.value}` },
      data
    }
  }
  const actualMarks = extremumMarks(amber)
  if (worstIdx >= 0) {
    actualMarks.data.push({
      coord: [worstIdx, actual[worstIdx]],
      symbolSize: 10,
      itemStyle: { color: 'transparent', borderColor: danger, borderWidth: 2 },
      label: { show: true, position: 'top', color: danger, fontWeight: 600, fontSize: 11, formatter: () => `${worstLabel.value} ${worstDev.value > 0 ? '+' : ''}${worstDev.value}` }
    })
  }
  chart.setOption({
    ...emptyOverlay(!r.detail.length),
    tooltip: axisTooltip({ unit: 'MWh' }),
    legend: bottomLayoutLegend({ data: legendData, textStyle: { fontSize: 10 } }),
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
      { name: '申报电量', type: 'line', step: 'end', showSymbol: false, data: declared, lineStyle: { width: 1.6, type: 'dashed', color: primary }, itemStyle: { color: primary }, markPoint: extremumMarks(primary) },
      {
        name: '实际电量', type: 'line', step: 'end', showSymbol: false, data: actual,
        lineStyle: { width: 2, color: ink }, itemStyle: { color: ink },
        markPoint: actualMarks
      },
      // 对比日实际（清单 R1）：灰虚线弱化呈现，图例可开关
      ...(cmpActual.length ? [{
        name: cmpName, type: 'line', step: 'end', showSymbol: false, data: cmpActual,
        lineStyle: { width: 1.4, type: 'dashed', color: '#94a3b8' }, itemStyle: { color: '#94a3b8' }
      }] : [])
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

    <!-- 待口径确认的功能入口（大白话提示）：覆盖率/填写率两个指标还没上线 -->
    <p class="pending-note">
      复盘覆盖率 / 填写率两个指标还没上线：要先定统计口径——覆盖率按天算还是按模板算？填写率里哪些单算“该填的”？
      口径确认后开发，不拿假数字先凑。
    </p>

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
      <div class="top">
        <h3>申报 vs 实际 · 96 点</h3>
        <div class="cmp">
          <span class="muted">对比日</span>
          <select v-model="cmpDate" class="cmp-select" title="叠加另一天的实际电量曲线（灰虚线）对比">
            <option value="">无</option>
            <option v-if="cmpDayPrev" :value="cmpDayPrev">前一日（{{ cmpDayPrev }}）</option>
            <option v-if="cmpDayPrevWeek" :value="cmpDayPrevWeek">上周同星期（{{ cmpDayPrevWeek }}）</option>
          </select>
          <input v-model="cmpDate" type="date" class="cmp-date" title="或任选对比日期（采集覆盖区内）" />
          <span v-if="cmpLoading" class="muted">取对比日…</span>
          <span v-else-if="cmpError" class="cmp-err" :title="cmpError">对比日不可比，悬停看原因</span>
        </div>
      </div>
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
.top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.top h3 { margin: 0; font-size: var(--font-13-5); font-weight: 600; }
.cmp { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-11-5); }
.cmp-select, .cmp-date { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); background: #fff; }
.cmp-err { color: #b45309; cursor: help; }
.host { width: 100%; height: 300px; }
.heat { margin-left: 48px; margin-right: 16px; }
.guidance { padding: 12px 16px; }
.pending-note { margin: 0; padding: 8px 12px; font-size: var(--font-12-5, 12px); color: var(--muted); border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 6px; line-height: 1.6; }
.guidance strong { display: block; color: var(--text); }
.guidance p { margin: 6px 0; color: var(--muted); }
.guidance small { color: var(--muted); }
</style>
