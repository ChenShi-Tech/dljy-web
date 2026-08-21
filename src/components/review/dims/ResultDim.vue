<script setup lang="ts">
// 结果维（#2038）：申报回测（日前收益/均价/价差盈亏）+ 结算对账 + 分时价差盈亏 24 桶；
// 云南追加电网结算单口径的三段式电量分解（与偏差考核是两套口径，各自独立呈现）。
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { axisTooltip, chartToolbox, emptyOverlay } from '@/services/chart/chartOptions'
import type { ReviewResult, SettlementReviewResult } from '@/services/quant/quantClient'
import { hourlySpreadPnl } from '@/services/review/reviewDashboard'
import MetricTile from '../MetricTile.vue'
import PnlDecomposePanel from '../PnlDecomposePanel.vue'
import TemplateChips from '../TemplateChips.vue'
import type { TemplateCard } from '@/services/review/cockpitModel'
import type { SettlementRuleSpec } from '@/rules/types'

const props = defineProps<{
  result: ReviewResult | null
  settlementReview: SettlementReviewResult | null
  settlementReviewError: string
  isYunnan: boolean
  outOfCoverage: boolean
  coverage: { start: string; end: string } | null
  reviewMonth: string
  settlementRowCount: number
  importedDeviationFee: number
  reconcileDiff: number
  templates: TemplateCard[]
  spec: SettlementRuleSpec | null
  tolerancePct: number
  penaltyPrice: number
}>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()

const router = useRouter()
const fmtInt = (n: number) => Math.round(n).toLocaleString('zh-CN')
const fmtSigned = (n: number) => `${n > 0 ? '+' : ''}${fmtInt(n)}`

const spreadPnl = computed(() => props.result?.backtest.da_rt_spread_pnl_yuan ?? null)
const pnl24 = computed(() => (props.result ? hourlySpreadPnl(props.result.detail) : null))
const hasPriceBars = computed(() => !!pnl24.value && pnl24.value.missing < (props.result?.detail.length ?? 0))

/** 结算明细：源行缺字段显示「—」不折成 0（「没这项」≠「这项是零」） */
const num = (v: number | null) => (v == null ? '—' : String(v))
const money = (v: number | null) => (v == null ? '—' : fmtInt(v))

function goImport() {
  router.push({ path: '/data-ops/console', query: { to: '/ops/import-hub' } })
}

const chartEl = ref<HTMLElement | null>(null)
const chart = useEChart(chartEl, { render })

function render() {
  if (!chartEl.value) return
  const gain = cssVar('--primary') || '#0f766e'
  const loss = cssVar('--warning') || '#d97706'
  // 无回测结果（地区未接入 / 加载失败）也要画空态，不能留一块白板
  const hours = pnl24.value?.hours ?? new Array<number>(24).fill(0)
  const emptyText = !pnl24.value ? '本日无申报回测数据' : '本日无日前/实时价格，无法拆分'
  chart.setOption({
    ...emptyOverlay(!hasPriceBars.value, emptyText),
    tooltip: axisTooltip({ unit: '元', digits: 0, pointer: 'shadow' }),
    toolbox: chartToolbox('分时价差盈亏'),
    grid: { left: 56, right: 16, top: 24, bottom: 26 },
    xAxis: { type: 'category', data: hours.map((_, h) => `${String(h).padStart(2, '0')}:00`) },
    yAxis: { type: 'value', name: '元' },
    series: [{
      name: '价差盈亏', type: 'bar', barMaxWidth: 26,
      data: hasPriceBars.value ? hours.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? gain : loss, borderRadius: v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } })) : []
    }]
  }, { replaceMerge: ['graphic', 'series'] })
}
onMounted(render)
watch(pnl24, () => render(), { flush: 'post' })
</script>

<template>
  <div class="dim">
    <div class="tiles">
      <MetricTile label="日前收益" :value="result ? fmtInt(result.backtest.da_revenue_yuan) : '—'" unit="元" :sub="result ? `申报均价 ${result.backtest.avg_da_price} 元/MWh` : ''" />
      <MetricTile
        label="价差盈亏" :value="spreadPnl == null ? '—' : fmtSigned(spreadPnl)" :unit="spreadPnl == null ? '' : '元'"
        :tone="spreadPnl == null ? 'muted' : spreadPnl >= 0 ? 'good' : 'bad'"
        :info="['Σ (日前价 − 实时价) × (实际 − 申报)，逐点求和；申报回测口径', result?.backtest.note].filter(Boolean).join('\n')"
      />
      <MetricTile
        label="结算对账" :value="settlementRowCount ? fmtSigned(reconcileDiff) : '—'" :unit="settlementRowCount ? '元' : ''"
        :tone="settlementRowCount ? (reconcileDiff >= 0 ? 'bad' : 'good') : 'muted'"
        :pill="settlementRowCount ? null : { text: '未导入', tone: 'off' }"
        :sub="settlementRowCount ? `${reviewMonth} 结算单 ${settlementRowCount} 行 · 偏差费 ${fmtInt(importedDeviationFee)} 元按日均摊` : ''"
        info="差异 = 当日自算考核费 − 结算单月度偏差费用按日均摊；只作量级对照，正式对账以分日结算单为准"
      />
      <div v-if="!settlementRowCount" class="tile-action panel">
        <span class="k">结算单</span>
        <button type="button" class="lnk" @click="goImport">导入结算单 ›</button>
        <span class="s">{{ reviewMonth }}</span>
      </div>
      <MetricTile v-else label="结算单偏差费" :value="fmtInt(importedDeviationFee)" unit="元" :sub="`${reviewMonth} 月度合计`" />
    </div>

    <!-- 结算口径复盘（云南三段式）：电网结算单口径——实际上网电量按中长期/日前增量/实时增量三段分解逐段计价 -->
    <section v-if="isYunnan" class="panel settlement">
      <div class="top">
        <h3>结算口径 · 三段式电量分解</h3>
        <span class="tag">电网结算单</span>
        <span v-if="settlementReview" class="tag off">{{ settlementReview.plant_count }} 座厂站</span>
        <span v-if="settlementReview?.mock" class="tag warn" :title="settlementReview.warning ?? '结构同构的模拟结算单，仅供联调查看形态，不可作为结算或复盘依据'">模拟数据</span>
      </div>

      <p v-if="outOfCoverage && coverage" class="muted">结算数据覆盖 {{ coverage.start }} ~ {{ coverage.end }}，请换到区间内日期</p>
      <p v-else-if="settlementReviewError" class="err">{{ settlementReviewError }}</p>

      <template v-if="settlementReview">
        <div class="seg-row">
          <div class="seg-card"><div class="lbl">中长期</div><div class="val">{{ settlementReview.summary.ltmEnergy.toFixed(1) }}<i>MWh</i></div></div>
          <div class="op">+</div>
          <div class="seg-card"><div class="lbl">日前增量</div><div class="val">{{ settlementReview.summary.daDevEnergy.toFixed(1) }}<i>MWh</i></div><div class="fee">{{ fmtInt(settlementReview.summary.daDevFee) }} 元</div></div>
          <div class="op">+</div>
          <div class="seg-card"><div class="lbl">实时增量</div><div class="val">{{ settlementReview.summary.rtDevEnergy.toFixed(1) }}<i>MWh</i></div><div class="fee">{{ fmtInt(settlementReview.summary.rtDevFee) }} 元</div></div>
          <div class="op">=</div>
          <div class="seg-card total">
            <div class="lbl">实际上网</div>
            <div class="val">{{ settlementReview.summary.actualOnGridEnergy.toFixed(1) }}<i>MWh</i></div>
            <div class="fee">总电费 {{ fmtInt(settlementReview.summary.totalFee) }} 元 · 均价 {{ settlementReview.summary.avgPrice ?? '—' }}</div>
          </div>
        </div>
        <details class="plants">
          <summary>分厂站明细</summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>厂站</th><th>中长期</th><th>日前出清</th><th>日前增量</th><th>实时增量</th><th>实际上网</th><th>总电费(元)</th><th>均价</th></tr></thead>
              <tbody>
                <tr v-for="p in settlementReview.plants" :key="p.plant">
                  <td class="name">{{ p.plant }}</td>
                  <td>{{ num(p.ltmEnergy) }}</td><td>{{ num(p.daClearedEnergy) }}</td><td>{{ num(p.daDevEnergy) }}</td>
                  <td>{{ num(p.rtDevEnergy) }}</td><td>{{ num(p.actualOnGridEnergy) }}</td><td>{{ money(p.totalFee) }}</td><td>{{ num(p.avgPrice) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>
    </section>

    <section class="panel chart">
      <div class="top">
        <h3>价差盈亏 · 24 时段</h3>
        <span class="legend"><i class="gain" />盈<i class="loss" />亏</span>
      </div>
      <div ref="chartEl" class="host chart-host" />
    </section>
    <PnlDecomposePanel :spec="spec" :tolerance-pct="tolerancePct" :penalty-price="penaltyPrice" />
    <TemplateChips :templates="templates" label="结果复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 720px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
.tile-action { padding: 12px 14px 11px; display: flex; flex-direction: column; gap: 6px; }
.tile-action .k { font-size: var(--font-sm); color: var(--muted); }
.tile-action .s { font-size: var(--font-xs); color: var(--muted); }
.lnk { align-self: flex-start; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: var(--font-14-5); font-weight: 600; cursor: pointer; padding: 2px 0; }
.lnk:hover { text-decoration: underline; }

.top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.top h3 { margin: 0; font-size: var(--font-13-5); font-weight: 600; }
.chart { padding: 12px 14px 8px; display: flex; flex-direction: column; gap: 6px; }
.host { width: 100%; height: 240px; }
.legend { margin-left: auto; font-size: var(--font-sm); color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; margin-left: 8px; }
.legend i.gain { background: var(--primary); }
.legend i.loss { background: var(--warning); }

.settlement { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.tag {
  position: relative; display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 4px;
  font-size: var(--font-tb-11); font-weight: 600; color: var(--accent); isolation: isolate;
}
.tag::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0.12; z-index: -1; }
.tag.off { color: var(--muted); font-weight: 500; }
.tag.warn { color: var(--warning); }
.muted { margin: 0; color: var(--muted); font-size: var(--font-12-5); }
.err { margin: 0; color: var(--danger); font-size: var(--font-12-5); }
.seg-row { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; }
.seg-card { flex: 1 1 140px; min-width: 120px; padding: 10px 12px; border: 1px solid var(--line-soft); border-radius: var(--radius-sm); background: var(--panel-sub); }
.seg-card.total { border-color: var(--primary-tint-border); background: var(--primary-tint); }
.seg-card .lbl { color: var(--muted); font-size: var(--font-sm); }
.seg-card .val { margin-top: 4px; font-size: var(--font-20); font-weight: 600; font-variant-numeric: tabular-nums; }
.seg-card .val i { margin-left: 3px; font-size: var(--font-tb-11); font-weight: 400; font-style: normal; color: var(--muted); }
.seg-card .fee { margin-top: 3px; color: var(--text-soft); font-size: var(--font-tb-11); }
.op { display: flex; align-items: center; color: var(--muted); font-size: var(--font-18); }
.plants summary { cursor: pointer; color: var(--text-soft); font-size: var(--font-sm); }
.table-wrap { overflow-x: auto; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
th, td { padding: 5px 8px; border-bottom: 1px solid var(--line-faint); text-align: right; white-space: nowrap; }
th { color: var(--muted); font-weight: 500; }
th:first-child, td.name { text-align: left; }
</style>
