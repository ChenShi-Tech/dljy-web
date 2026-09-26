<script setup lang="ts">
// 偏差维（Epic #2033 · #2038 外壳）：四格指标 + 申报 vs 实际 96 点主图（阶梯线 + 容差带 + 最差点标记）
// + 96 格热力条 + 周月聚合与责任归因面板（#2042）+ 本维模板清单。
// 指标数据来自 quant /review 一份响应；口径告诫（caliber_caveats）进考核费 ⓘ，不落页面。
// 偏差率走 cockpitModel.deviationMetricOf（#2038 首版口径，不另起一套实现）。
import { computed, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { axisTooltip, bottomLayoutLegend, bottomToolbox, emptyOverlay, fmtNum, insideZoom } from '@/services/chart/chartOptions'
import { classifyReviewError, fetchReview, type ReviewFailure, type ReviewResult } from '@/services/quant/quantClient'
import { deviationDetailRows, heatCells, type DeviationDetailRow } from '@/services/review/reviewDashboard'
import { exportCsv } from '@/utils/exportCsv'
import { deviationMetricOf, type TemplateCard } from '@/services/review/cockpitModel'
import { reviewCompletionOf, type ReviewCompletion } from '@/services/review/reviewCompletion'
import { fetchTemplateInstanceFeed } from '@/services/review/templateInstanceClient'
import type { TemplateInstanceFeed } from '@/services/review/templateInstanceApi'
import { captureCoverage } from '@/services/market/captureCoverage'
import { currentRegion } from '@/services/region/regionContext'
import { todayBeijing } from '@/utils/beijingDate'
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
  reviewDate?: string
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

// ── 偏差 96 点逐时明细表（清单 R8）：图-表同屏，数据直接用响应 detail（零新增取数）──
// 带内外判定与主图容差带同口径（deviationDetailRows）；合计行受考核电量与 KPI 卡同源。
const showDetail = ref(false)
const detailRows = computed<DeviationDetailRow[]>(() =>
  props.result ? deviationDetailRows(props.result.detail, props.tolerancePct) : []
)
const detailTotals = computed(() => ({
  declared: detailRows.value.reduce((s, r) => s + r.declared, 0),
  actual: detailRows.value.reduce((s, r) => s + r.actual, 0),
  assessed: detailRows.value.reduce((s, r) => s + r.assessedMwh, 0)
}))
const fmt2 = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })

function exportDetailCsv() {
  const r = props.result
  if (!r || !detailRows.value.length) return
  exportCsv(`偏差明细-${r.date}.csv`, ['时点', '申报(MWh)', '实际(MWh)', '偏差(MWh)', '考核电量(MWh)', '是否带内'], [
    ...detailRows.value.map((row) => [row.label, row.declared, row.actual, row.deviation, row.assessedMwh, row.inBand ? '带内' : '超带']),
    ['合计', detailTotals.value.declared, detailTotals.value.actual, '', detailTotals.value.assessed, '']
  ])
}

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

// ── 复盘完成度（清单附录 B1 口径，2026-09-03 拍板）：覆盖率按天、填写率按实例提交 ──
// 覆盖率 = 当月有已提交日锚实例的天数 ÷ 当月可回测天数（采集覆盖窗∩已过天，真实分母）；
// 填写率 = 当月已提交实例 ÷ 触发引擎生成的当月应填实例（分母由引擎生成，缺席不出 %）。
// 实例端点缺席时产出按 0 计（真实：已知提交为 0）并标注原因，不伪造数字。
const completionFeed = ref<TemplateInstanceFeed | null>(null)
const completionLoaded = ref(false)
async function loadCompletionFeed() {
  completionFeed.value = await fetchTemplateInstanceFeed()
  completionLoaded.value = true
}
onMounted(loadCompletionFeed)
watch(() => currentRegion.value.id, () => { void loadCompletionFeed() })

const completionMonth = computed(() => (props.result?.date ?? todayBeijing()).slice(0, 7))
const completion = computed<ReviewCompletion | null>(() => {
  if (!completionFeed.value) return null
  return reviewCompletionOf({
    month: completionMonth.value,
    today: todayBeijing(),
    coverage: captureCoverage(currentRegion.value.id, 'review'),
    feed: completionFeed.value
  })
})
const pctText = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`)

const COVERAGE_INFO =
  '口径：当月有已提交复盘实例的天数 ÷ 当月可回测天数（采集覆盖窗内已过天）。' +
  '产出以日锚实例（如 T08 日档）的提交状态计，全部来自复盘模板实例库真实数据，不合成。'
const FILL_INFO =
  '口径：已提交（submitted/reviewed）实例 ÷ 触发引擎生成的当月应填实例。' +
  '应填清单由引擎按周期生成（#2037），分母为 0 或实例端点缺席时不出数，不拿假数字凑。'

type TileView = { value: string; unit: string; tone: 'good' | 'bad' | 'muted' | 'default'; sub: string; info: string }
const coverageView = computed<TileView>(() => {
  const c = completion.value
  if (!c) return { value: '—', unit: '', tone: 'muted', sub: '读取实例库…', info: COVERAGE_INFO }
  if (c.reviewableDays === 0) {
    return { value: '—', unit: '', tone: 'muted', sub: '本月不在采集覆盖窗内', info: COVERAGE_INFO + ' 本月无可复盘天：采集覆盖窗不含当月已过天。' }
  }
  if (!c.feedAvailable) {
    return {
      value: pctText(c.coveragePct), unit: '%', tone: 'default',
      sub: `产出 ${c.producedDays}/${c.reviewableDays} 天 · 实例端点未部署`,
      info: COVERAGE_INFO + ' 当前实例端点未部署，产出按真实 0 计；端点接入后自动出真数。'
    }
  }
  return { value: pctText(c.coveragePct), unit: '%', tone: 'default', sub: `产出 ${c.producedDays}/${c.reviewableDays} 天`, info: COVERAGE_INFO }
})
const fillView = computed<TileView>(() => {
  const c = completion.value
  if (!c) return { value: '—', unit: '', tone: 'muted', sub: '读取实例库…', info: FILL_INFO }
  if (!c.feedAvailable) {
    return { value: '—', unit: '', tone: 'muted', sub: '实例端点未部署', info: FILL_INFO + ' 当前环境实例端点未部署（代理 404），部署后自动出数。' }
  }
  if (c.instancesTotal === 0) {
    return { value: '—', unit: '', tone: 'muted', sub: '本月无应填实例', info: FILL_INFO }
  }
  return { value: pctText(c.fillPct), unit: '%', tone: 'default', sub: `已提交 ${c.instancesSubmitted}/${c.instancesTotal}`, info: FILL_INFO }
})

// 两张完成度卡仅在「实例端点可用且引擎已生成应填实例」时渲染：
// - 端点缺席：没有产出数据源，0% 是噪音；
// - 端点在但 0 实例：没有任何"该填的"义务被生成，拿可回测天数当分母算出 0%
//   属于无义务假分母（比假数字更隐蔽的误导），同样不渲染。
// 引擎生成首批实例后两卡自动出现，无需改代码。
const showCompletionTiles = computed(
  () => completionLoaded.value && completion.value?.feedAvailable === true && completion.value.instancesTotal > 0
)

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

  // 极值说明进 tooltip 卡片（替代在图上常驻长文字/改极值标签）：极值点平时只标裸数值，
  const extremumIndex = (arr: number[], mode: 'max' | 'min') => {
    let idx = -1
    arr.forEach((v, i) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return
      if (idx < 0 || (mode === 'max' ? n > Number(arr[idx]) : n < Number(arr[idx]))) idx = i
    })
    return idx
  }
  const noteIdx = {
    declaredMax: extremumIndex(declared, 'max'),
    declaredMin: extremumIndex(declared, 'min'),
    actualMax: extremumIndex(actual, 'max'),
    actualMin: extremumIndex(actual, 'min')
  }
  const extremumNotesAt = (i: number): { text: string; color: string }[] => {
    if (i < 0) return []
    const notes: { text: string; color: string }[] = []
    if (i === noteIdx.declaredMax) notes.push({ text: `申报电量当日最高 ${fmtNum(declared[i])} MWh`, color: primary })
    if (i === noteIdx.declaredMin) notes.push({ text: `申报电量当日最低 ${fmtNum(declared[i])} MWh`, color: primary })
    if (i === noteIdx.actualMax) notes.push({ text: `实际电量当日最高 ${fmtNum(actual[i])} MWh`, color: amber })
    if (i === noteIdx.actualMin) notes.push({ text: `实际电量当日最低 ${fmtNum(actual[i])} MWh`, color: amber })
    if (i === worstIdx) {
      notes.push({ text: `实际偏离申报（偏差＝实际−申报）${worstDev.value > 0 ? '+' : ''}${worstDev.value} MWh`, color: danger })
    }
    return notes
  }
  // 与 axisTooltip 同构的卡片行 + 极值说明追加区（axisTooltip.formatter 不便就地扩展，故本地重建）
  type TipParam = { seriesName?: string; marker?: string; axisValueLabel?: string; name?: string; value?: unknown; dataIndex?: number }
  const reviewTooltip = {
    ...axisTooltip({ unit: 'MWh' }),
    formatter: (params: TipParam | TipParam[]) => {
      const list = (Array.isArray(params) ? params : [params]).filter((p) => !String(p.seriesName ?? '').startsWith('_'))
      if (!list.length) return ''
      const head = list[0].axisValueLabel ?? list[0].name ?? ''
      const rows = list
        .map((p) => {
          const text = fmtNum(p.value)
          const suffix = text === '-' ? '' : ' MWh'
          return `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>${p.marker ?? ''}${p.seriesName ?? ''}</span><b>${text}${suffix}</b></div>`
        })
        .join('')
      const notes = extremumNotesAt(list[0].dataIndex ?? -1)
      const notesHtml = notes.length
        ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(128,128,128,.25)">` +
          notes.map((n) =>
            `<div style="display:flex;align-items:center;gap:6px;line-height:1.7">` +
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${n.color}"></span>` +
            `<span style="color:${n.color}">${n.text}</span></div>`
          ).join('') + `</div>`
        : ''
      return `<div style="font-weight:600;margin-bottom:2px">${head}</div>${rows}${notesHtml}`
    }
  }

  chart.setOption({
    ...emptyOverlay(!r.detail.length),
    tooltip: reviewTooltip,
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
    <div class="tiles" :class="{ 'tiles-6': showCompletionTiles }">
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
      <template v-if="showCompletionTiles">
        <MetricTile
          label="复盘覆盖率" :value="coverageView.value" :unit="coverageView.unit"
          :tone="coverageView.tone" :sub="`${completionMonth} · ${coverageView.sub}`"
          :info="coverageView.info"
        />
        <MetricTile
          label="复盘填写率" :value="fillView.value" :unit="fillView.unit"
          :tone="fillView.tone" :sub="fillView.sub" :info="fillView.info"
        />
      </template>
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
      <div class="top">
        <h3>申报 vs 实际 · 96 点</h3>
        <div class="cmp">
          <span class="muted" title="对比日说明：叠加所选日期的实际电量曲线（灰色虚线）与当天对比；清空日期即取消对比。日期需在采集覆盖窗内，否则如实提示不可比。">对比日</span>
          <input v-model="cmpDate" type="date" class="cmp-date" title="任选对比日期（采集覆盖区内）" />
          <span v-if="cmpLoading" class="muted">取对比日…</span>
          <span v-else-if="cmpError" class="cmp-err" :title="cmpError">对比日不可比，悬停看原因</span>
          <button v-if="result && detailRows.length" type="button" class="detail-toggle" @click="showDetail = !showDetail">
            {{ showDetail ? '收起明细' : '96 点明细' }}
          </button>
        </div>
      </div>
      <div ref="chartEl" class="host chart-host" />
      <DeviationHeatStrip v-if="cells.length" :cells="cells" class="heat" />
      <!-- 逐时明细（清单 R8）：与主图/热力条同源同口径，合计受考核电量 = KPI 卡 -->
      <div v-if="showDetail && detailRows.length" class="detail96">
        <div class="detail96-bar">
          <span class="muted">逐时明细 · 与图上数据同源，带内判定同容差带（±{{ result?.deviation.tolerance_pct }}%）</span>
          <button type="button" class="detail-toggle" @click="exportDetailCsv">导出 CSV</button>
        </div>
        <div class="detail96-scroll">
          <table>
            <thead>
              <tr><th>时点</th><th>申报 MWh</th><th>实际 MWh</th><th>偏差 MWh</th><th>考核电量 MWh</th><th>带内</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in detailRows" :key="row.label">
                <td class="mono">{{ row.label }}</td>
                <td class="num">{{ fmt2(row.declared) }}</td>
                <td class="num">{{ fmt2(row.actual) }}</td>
                <td class="num" :class="row.tone">{{ (row.deviation > 0 ? '+' : '') + fmt2(row.deviation) }}</td>
                <td class="num">{{ fmt2(row.assessedMwh) }}</td>
                <td :class="row.inBand ? 'in' : 'out'">{{ row.inBand ? '带内' : '超带' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>合计</td>
                <td class="num">{{ fmt2(detailTotals.declared) }}</td>
                <td class="num">{{ fmt2(detailTotals.actual) }}</td>
                <td />
                <td class="num" title="与上方「受考核电量」指标卡同口径">{{ fmt2(detailTotals.assessed) }}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>

    <DeviationAggregatePanel :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" :review-date="reviewDate" />
    <TemplateChips :templates="templates" label="偏差复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
/* 完成度两张卡仅在实例端点可用时出现（tiles-6）；缺席期指标区保持原 4 张 */
.tiles.tiles-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
@media (max-width: 1100px) { .tiles, .tiles.tiles-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) { .tiles, .tiles.tiles-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
/* 对冲全局 .chart{height:360px}，否则热力条溢出卡片 */
.chart { padding: 12px 14px 12px; display: flex; flex-direction: column; gap: 8px; height: auto; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.top h3 { margin: 0; font-size: var(--font-13-5); font-weight: 600; }
.cmp { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-11-5); }
.cmp-select, .cmp-date { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); background: #fff; }
.cmp-err { color: #b45309; cursor: help; }
.host { width: 100%; height: 300px; }
.heat { margin-left: 48px; margin-right: 16px; }
/* 96 点逐时明细表（清单 R8）：可折叠、窄高滚动，与热力条同方向着色 */
.detail-toggle { border: 1px solid var(--line); border-radius: 6px; background: #fff; font: inherit; font-size: var(--font-11-5); padding: 2px 8px; cursor: pointer; color: var(--text-body); }
.detail-toggle:hover { border-color: var(--primary); color: var(--primary); }
.detail96 { display: flex; flex-direction: column; gap: 6px; }
.detail96-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--font-11-5); }
.detail96-scroll { max-height: 260px; overflow-y: auto; border: 1px solid var(--line-soft); border-radius: 6px; }
.detail96 table { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); }
.detail96 th, .detail96 td { border-bottom: 1px solid var(--line-soft); padding: 3px 10px; text-align: right; white-space: nowrap; }
.detail96 th:first-child, .detail96 td:first-child { text-align: left; }
.detail96 thead th { position: sticky; top: 0; background: var(--panel-sub, #f7f8fa); font-weight: 600; z-index: 1; }
.detail96 tfoot td { position: sticky; bottom: 0; background: var(--panel-sub, #f7f8fa); font-weight: 600; border-bottom: 0; }
.detail96 tfoot td:first-child { text-align: left; }
.detail96 .mono { font-family: ui-monospace, monospace; }
.detail96 .num { font-variant-numeric: tabular-nums; }
.detail96 td.over { color: #b45309; }
.detail96 td.under { color: #0369a1; }
.detail96 td.flat { color: var(--muted); }
.detail96 td.in { color: var(--muted); }
.detail96 td.out { color: #b45309; font-weight: 600; }
.guidance { padding: 12px 16px; }
.pending-note { margin: 0; padding: 8px 12px; font-size: var(--font-12-5, 12px); color: var(--muted); border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 6px; line-height: 1.6; }
.guidance strong { display: block; color: var(--text); }
.guidance p { margin: 6px 0; color: var(--muted); }
.guidance small { color: var(--muted); }
</style>
