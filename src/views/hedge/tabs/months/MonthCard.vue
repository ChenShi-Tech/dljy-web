<script setup lang="ts">
// 月卡：/months 里一个月的完整视图（HW-03/HB-07/HM-02；openspec build-midlong-spot-hedging 任务 8.3，ChenShi-Tech/dljy#3421）。
//
// 当月（period=CURRENT）多一块按日锁价/发电图；全部月份共用：锁价合计与「月度未分解」单列（不摊到日）、
// 两口径套保率并列（逐时段 / 基准）、品种结构四维度、核定上限、月级守恒标注。值为服务端十进制字符串、
// 未知为 null → 「未知」，绝不用 0 冒充；FORBIDDEN 时锁价侧显示「无权限查看中长期持仓」，发电照常（HW-04）。
// 基准覆盖 NONE：显示「预计发电未覆盖」且不显示基准口径套保率；PARTIAL：如实标注缺基准场站。
import { computed } from 'vue'
import MetricTile from '@/components/common/MetricTile.vue'
import {
  BREAKDOWN_QUERY_DIMENSION_LABELS, BREAKDOWN_SPECIAL_KEY_LABELS, type HedgeMonthCapRow, type HedgeMonthStructureRow, type HedgeMonthView,
} from '@/services/hedge/hedgeMonthsApi'
import {
  assessmentText, assessmentTierText, capRowView, consistencyView, mwhText, periodLabel, ratioText,
} from './monthsModel'
import MonthDaysChart from './MonthDaysChart.vue'

const props = defineProps<{ month: HedgeMonthView; forbidden?: boolean }>()

const FORBIDDEN_TEXT = '无权限查看中长期持仓'

const gen = computed(() => props.month.generation)
const coveredDays = computed(() => gen.value.actualDays + gen.value.forecastDays)

const lockedTile = computed(() => ({
  value: props.forbidden ? FORBIDDEN_TEXT : mwhText(props.month.midlong.lockedMwh),
  tone: props.forbidden || props.month.midlong.lockedMwh === null ? ('muted' as const) : ('default' as const),
  compact: props.forbidden,
}))

const undecomposedTile = computed(() => ({
  value: props.month.monthlyUndecomposed.quantityMwh === null
    ? (props.forbidden ? FORBIDDEN_TEXT : '未知')
    : props.month.monthlyUndecomposed.quantityMwh,
  count: props.month.monthlyUndecomposed.contractIds.length,
}))

const baselineTile = computed(() => {
  const coverage = props.month.baseline.coverage
  return {
    value: props.month.baseline.totalMwh === null ? '未知' : props.month.baseline.totalMwh,
    tone: coverage === 'NONE' ? ('muted' as const) : ('default' as const),
    pill: coverage === 'NONE'
      ? { text: '未覆盖', tone: 'off' as const }
      : coverage === 'PARTIAL'
        ? { text: `${props.month.baseline.missingStationIds.length} 场站缺基准`, tone: 'warn' as const }
        : null,
  }
})

/** 结构四维度与钻取维度同键同标签（shared/hedge/contract.mjs BREAKDOWN_QUERY_DIMENSION_LABELS）。 */
const STRUCTURE_DIMENSIONS = ['productKind', 'marketScope', 'energyAttribute', 'buyerCategory'] as const

function structureRows(dimension: (typeof STRUCTURE_DIMENSIONS)[number]): HedgeMonthStructureRow[] {
  return props.month.midlong.structure?.[dimension] ?? []
}

const capRows = computed(() => props.month.caps.rows.map((row: HedgeMonthCapRow) => capRowView(row)))

const consistency = computed(() => consistencyView(props.month.consistency))
</script>

<template>
  <section class="month-card" :data-test="`month-card-${month.month}`">
    <header class="card-head">
      <h3>{{ month.month }}</h3>
      <span class="badge" :class="month.period">{{ periodLabel(month.period) }}</span>
      <span v-if="forbidden" class="badge danger" data-test="month-forbidden">{{ FORBIDDEN_TEXT }}</span>
      <span
        v-if="consistency"
        class="badge consistency"
        :class="consistency.tone"
        :data-test="`month-consistency-${month.month}`"
      >{{ consistency.text }}</span>
    </header>

    <div class="tiles">
      <MetricTile label="锁价合计" :value="lockedTile.value" unit="MWh" :tone="lockedTile.tone" :compact="lockedTile.compact"
        :sub="forbidden ? '' : (month.midlong.note ?? '')" :info="'中长期合同月度锁价（分解到日的部分 + 月度未分解）'" />
      <MetricTile label="月度未分解" :value="undecomposedTile.value" unit="MWh"
        :tone="undecomposedTile.value === '未知' || forbidden ? 'muted' : 'default'"
        :sub="`${undecomposedTile.count} 份合同只登记月量（不摊到日）`" :info="month.monthlyUndecomposed.note" />
      <MetricTile label="机制电量" :value="mwhText(month.mechanism.value)" unit="MWh"
        :tone="month.mechanism.value === null ? 'muted' : 'default'" sub="月度基准 × 比例（计划口径）"
        :info="month.mechanism.note" />
      <MetricTile label="发电基准" :value="baselineTile.value" unit="MWh" :tone="baselineTile.tone" :pill="baselineTile.pill"
        :sub="month.baseline.note ?? ''" :info="`${month.baseline.label}：场站 × 月的预计发电量合计`" />
      <MetricTile label="发电覆盖天数" :value="`${coveredDays} / ${gen.totalDays}`"
        :sub="`实际 ${gen.actualDays} 天 · 预测 ${gen.forecastDays} 天 · 未覆盖 ${gen.uncoveredDays} 天`"
        :tone="gen.uncoveredDays > 0 ? 'warn' : 'default'" />
    </div>

    <div class="ratios">
      <div class="ratio-block" data-test="ratio-interval">
        <h4>逐时段口径</h4>
        <p>含机制：<b data-test="interval-with-mechanism">{{ ratioText(month.ratios.interval.withMechanism) }}</b></p>
        <p>仅中长期：<b data-test="interval-midlong-only">{{ ratioText(month.ratios.interval.midlongOnly) }}</b></p>
        <p class="assessment" data-test="interval-assessment">
          判级：{{ assessmentText(month.ratios.interval.assessment) }}<span v-if="assessmentTierText(month.ratios.interval.assessment)">（{{ assessmentTierText(month.ratios.interval.assessment) }}）</span>
        </p>
      </div>
      <div class="ratio-block" data-test="ratio-baseline">
        <h4>基准口径（{{ month.ratios.baseline.label }}）</h4>
        <!-- 基准覆盖 NONE：预计发电未覆盖，不显示套保率（HW-03），不能让「不可计算」看起来像算过但为 0 -->
        <p v-if="month.baseline.coverage === 'NONE'" class="uncovered" data-test="baseline-uncovered">
          预计发电未覆盖——不显示基准口径套保率<span v-if="month.baseline.note">（{{ month.baseline.note }}）</span>
        </p>
        <template v-else>
          <p>含机制：<b data-test="baseline-with-mechanism">{{ ratioText(month.ratios.baseline.withMechanism) }}</b></p>
          <p>仅中长期：<b data-test="baseline-midlong-only">{{ ratioText(month.ratios.baseline.midlongOnly) }}</b></p>
          <p v-if="month.baseline.coverage === 'PARTIAL'" class="partial" data-test="baseline-partial">
            部分场站缺基准（{{ month.baseline.missingStationIds.map((id) => `场站 #${id}`).join('、') }}），基准口径不完整
          </p>
          <p class="assessment" data-test="baseline-assessment">
            判级：{{ assessmentText(month.ratios.baseline.assessment) }}<span v-if="assessmentTierText(month.ratios.baseline.assessment)">（{{ assessmentTierText(month.ratios.baseline.assessment) }}）</span>
          </p>
        </template>
      </div>
    </div>

    <div class="structure" data-test="midlong-structure">
      <h4>锁价品种结构</h4>
      <p v-if="forbidden || !month.midlong.structure" class="hint">{{ FORBIDDEN_TEXT }}</p>
      <div v-else class="structure-grid">
        <div v-for="dimension in STRUCTURE_DIMENSIONS" :key="dimension" class="structure-col">
          <h5>{{ BREAKDOWN_QUERY_DIMENSION_LABELS[dimension] }}</h5>
          <p v-for="row in structureRows(dimension)" :key="row.key" class="structure-row">
            <span>{{ BREAKDOWN_SPECIAL_KEY_LABELS[row.key as keyof typeof BREAKDOWN_SPECIAL_KEY_LABELS] ?? row.label }}</span>
            <b>{{ row.quantityMwh }} MWh</b>
          </p>
          <p v-if="!structureRows(dimension).length" class="hint">无</p>
        </div>
      </div>
    </div>

    <div v-if="month.period === 'CURRENT'" class="days-chart" data-test="current-month-days">
      <h4>按日已分解锁价与发电（未知日断开，不做平滑/插值；月度未分解不摊到日）</h4>
      <MonthDaysChart :days="month.days" />
    </div>

    <div class="caps" data-test="caps">
      <h4>核定上限（HB-07）</h4>
      <p class="hint">{{ month.caps.note }}</p>
      <table v-if="capRows.length">
        <thead>
          <tr><th>交易单元</th><th>核定上限（MWh）</th><th>已锁价（MWh）</th><th>剩余可签（MWh）</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in capRows" :key="row.subjectId" :data-test="`cap-row-${row.subjectId}`">
            <td>#{{ row.subjectId }}</td>
            <td>{{ row.capMwh }}</td>
            <td>{{ row.lockedMwh }}</td>
            <td :class="{ negative: row.exceeded }">{{ row.remainingMwh }}</td>
            <td><span class="badge" :class="row.tone" :data-test="`cap-status-${row.subjectId}`">{{ row.statusText }}</span></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint">暂无交易单元的核定上限登记</p>
    </div>
  </section>
</template>

<style scoped>
.month-card { border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-head h3 { margin: 0; font-size: var(--font-lg, 16px); }
.badge { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: var(--font-xs, 12px); border: 1px solid; }
.badge.CURRENT { color: var(--accent, #409eff); border-color: currentColor; }
.badge.FORWARD { color: var(--muted, #909399); border-color: currentColor; }
.badge.PAST { color: var(--muted, #909399); border-color: currentColor; }
.badge.danger { color: var(--danger, #f56c6c); border-color: currentColor; }
.badge.consistency.ok { color: var(--success, #67c23a); border-color: currentColor; }
.badge.consistency.partial { color: var(--warning, #e6a23c); border-color: currentColor; }
.badge.consistency.danger { color: var(--danger, #f56c6c); border-color: currentColor; }
.badge.ok { color: var(--success, #67c23a); border-color: currentColor; }
.badge.warn { color: var(--warning, #e6a23c); border-color: currentColor; }
.badge.muted { color: var(--muted, #909399); border-color: currentColor; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.ratios { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ratio-block { border: 1px solid var(--border, #f0f0f0); border-radius: 6px; padding: 10px 12px; }
.ratio-block h4, .structure h4, .days-chart h4, .caps h4 { margin: 0 0 6px; font-size: var(--font-md, 14px); }
.ratio-block p { margin: 4px 0; font-size: var(--font-sm, 13px); }
.ratio-block .uncovered { color: var(--warning, #e6a23c); }
.ratio-block .partial { color: var(--warning, #e6a23c); }
.ratio-block .assessment { color: var(--muted, #909399); }
.structure-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.structure-col h5 { margin: 0 0 4px; font-size: var(--font-sm, 13px); color: var(--muted, #909399); }
.structure-row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; font-size: var(--font-sm, 13px); }
.hint { color: var(--muted, #909399); font-size: var(--font-xs, 12px); margin: 4px 0; }
.caps table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 13px); }
.caps th, .caps td { border-bottom: 1px solid #f0f0f0; padding: 4px 8px; text-align: left; }
.caps td.negative { color: var(--danger, #f56c6c); font-weight: 600; }
@media (max-width: 900px) { .ratios { grid-template-columns: 1fr; } }
</style>
