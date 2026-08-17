<script setup lang="ts">
// 偏差周月聚合面板（Epic #2033 · M2 · #2042：模板七/八）
// ---------------------------------------------------------------------------
// 周（默认）/月切换，逐日调 quant /review 聚合：合计与逐日之和恒等（缺数日如实
// 列出不进合计）；按业务成因占比来自 S1 写回；责任归因二轴仅周聚合人工补填
// （AI 只给映射建议）；「上期改进措施回查」依赖 improvement_actions 端点（未上线，
// 诚实占位）；阈值连续超标为标记占位（触发全量归 #2047）。
import { computed, onMounted, ref, watch } from 'vue'
import { shiftIsoDate } from 'shared/trading-rules/trading-calendar.mjs'
import { fetchReviewRange, type PeriodReview } from '@/services/review/reviewPeriodClient'
import {
  aggregateDeviation,
  consecutiveDeviationBreach,
  RESPONSIBILITY_AXES,
  suggestResponsibility
} from '@/services/review/deviationAggregate'
import { FEED_ABSENT_NOTE } from '@/services/review/templateInstanceApi'

const props = defineProps<{ tolerancePct: number; penaltyPrice: number }>()

type Period = 'week' | 'month'
const period = ref<Period>('week')
/** 周期锚日：周=周一，月=当月 1 日（默认本周一 / 本月） */
const anchor = ref(mondayOf(new Date().toISOString().slice(0, 10)))
const loading = ref(false)
const data = ref<PeriodReview | null>(null)

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00+08:00`)
  const dow = (d.getDay() + 6) % 7 // 周一=0
  return shiftIsoDate(iso, -dow)
}
function daysOfPeriod(p: Period, anchorIso: string): string[] {
  if (p === 'week') return Array.from({ length: 7 }, (_, i) => shiftIsoDate(anchorIso, i))
  const [y, m] = anchorIso.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}
async function load() {
  loading.value = true
  data.value = null
  try {
    const today = new Date().toISOString().slice(0, 10)
    // 只取到今天为止（本周/本月未过的日子不进聚合，也不算缺数）
    const dates = daysOfPeriod(period.value, anchor.value).filter((d) => d <= today)
    data.value = await fetchReviewRange(dates, { tolerancePct: props.tolerancePct, penaltyPrice: props.penaltyPrice })
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([period, anchor], load)

const agg = computed(() => (data.value ? aggregateDeviation(data.value.days) : null))
const breach = computed(() =>
  agg.value ? consecutiveDeviationBreach(agg.value.rows, 0.05) : null
)

// 责任归因二轴：仅周聚合人工补填；存 id 不存中文
const responsibility = ref('')
const responsibilityNote = computed(() => {
  const suggestion = agg.value?.rows.find((r) => r.causeId)?.causeId ?? null
  const s = suggestResponsibility(suggestion)
  return s ? `映射建议（AI 建议、人确认）：${s.label}——依据本周主要业务成因推导，可改选。` : '本周无已判定的业务成因，不建议默认项——数据不够时逼答第二问只会得到假归因。'
})
const periodLabel = computed(() => (period.value === 'week' ? `周（${anchor.value} 起）` : `月（${anchor.value.slice(0, 7)}）`))
</script>

<template>
  <section class="dap">
    <header class="dap-head">
      <b>偏差周/月聚合（模板七 · 偏差归因 / 模板八 · 偏差成本核算）</b>
      <span class="dap-ctrl">
        <button type="button" :class="{ on: period === 'week' }" @click="period = 'week'">周</button>
        <button type="button" :class="{ on: period === 'month' }" @click=" period = 'month'">月</button>
        <input v-model="anchor" type="date" :title="period === 'week' ? '周锚日（自动取周一）' : '月锚日'" />
      </span>
    </header>

    <p v-if="loading" class="dap-muted">逐日取 quant /review 聚合中（{{ periodLabel }}）…</p>

    <template v-else-if="agg">
      <p v-if="agg.missingDays.length" class="dap-warn">
        缺数 {{ agg.missingDays.length }} 日（未接入/覆盖区外/当日无数据，不进合计）：
        {{ agg.missingDays.join('、') }}
      </p>
      <p v-if="!agg.totals.days" class="dap-muted">本周期无可用数据日——诚实空态，不合成。</p>

      <table v-if="agg.rows.length" class="dap-table">
        <thead>
          <tr><th>日期</th><th>偏差率</th><th>总偏差 MWh</th><th>受考核 MWh</th><th>考核费估算 元</th><th>S1 业务成因</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in agg.rows" :key="r.date">
            <td>{{ r.date }}</td>
            <td :class="{ bad: r.deviationPct !== null && Math.abs(r.deviationPct) > 0.05 }">
              {{ r.deviationPct === null ? '—' : (r.deviationPct * 100).toFixed(2) + '%' }}
            </td>
            <td>{{ r.totalAbsDeviationMwh.toFixed(2) }}</td>
            <td>{{ r.assessedMwh.toFixed(2) }}</td>
            <td>{{ r.estimatedPenaltyYuan.toLocaleString() }}</td>
            <td>{{ r.causeLabel ?? '未判定' }}</td>
          </tr>
          <tr class="dap-total">
            <td>合计（{{ agg.totals.days }} 日）</td>
            <td>{{ agg.totals.deviationPct === null ? '—' : (agg.totals.deviationPct * 100).toFixed(2) + '%' }}</td>
            <td>{{ agg.totals.deviationMwh.toFixed(2) }}</td>
            <td>{{ agg.totals.assessedMwh.toFixed(2) }}</td>
            <td>{{ agg.totals.penaltyYuan.toLocaleString() }}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p class="dap-note">合计与逐日之和恒等；金额为自算口径（caliber: self-computed，结算细则未核验）。</p>

      <!-- 按业务成因占比（第一轴：负荷/新能源/通道/价格，S1 写回） -->
      <div v-if="agg.byCause.length" class="dap-cause">
        <b>业务成因分布（第一轴 · 来自 S1 晨会写回）</b>
        <span v-for="c in agg.byCause" :key="c.causeId" class="dap-chip">
          {{ c.causeLabel }} {{ c.days }} 天
        </span>
      </div>

      <!-- 责任归因二轴：仅周聚合、人工补填 -->
      <div v-if="period === 'week'" class="dap-axis">
        <label>
          责任归因（第二轴 · 仅周聚合人工补填，与第一轴正交不合并）
          <select v-model="responsibility">
            <option value="">选择…</option>
            <option v-for="a in RESPONSIBILITY_AXES" :key="a.id" :value="a.id">{{ a.label }}</option>
          </select>
        </label>
        <p class="dap-note">{{ responsibilityNote }}</p>
      </div>

      <!-- 阈值预警占位 -->
      <p v-if="breach" class="dap-warn">
        连续超标标记（占位，触发全量归 #2047）：偏差率连续 {{ breach.streak }} 日超 5%
        （{{ breach.from }} ~ {{ breach.to }}）。
      </p>

      <!-- 上期改进措施回查：improvement_actions 端点未上线，诚实占位 -->
      <details class="dap-actions">
        <summary>上期改进措施落实情况回查</summary>
        <p class="dap-note">{{ FEED_ABSENT_NOTE }}改进措施库（review.improvement_actions）读取端点随服务端化上线；上线前上期未落实项需人工带入，不做假回查。</p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.dap { display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
.dap-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dap-ctrl { display: inline-flex; gap: 4px; align-items: center; }
.dap-ctrl button { padding: 2px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 11.5px; cursor: pointer; }
.dap-ctrl button.on { border-color: var(--el-color-primary, #2563eb); color: var(--el-color-primary, #2563eb); }
.dap-ctrl input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 11.5px; }
.dap-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.dap-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11.5px; line-height: 1.6; }
.dap-table { width: 100%; border-collapse: collapse; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dap-table th, .dap-table td { padding: 3px 7px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; white-space: nowrap; }
.dap-table th:first-child, .dap-table td:first-child { text-align: left; }
.dap-table th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: 10.5px; }
.dap-total td { font-weight: 600; border-top: 1px solid var(--el-border-color, #dcdfe6); }
.dap-table .bad { color: #b91c1c; }
.dap-note { margin: 0; font-size: 11px; color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.dap-cause { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dap-cause b { font-size: 12px; }
.dap-chip { font-size: 11px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 999px; padding: 1px 8px; }
.dap-axis label { display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.dap-axis select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: 12px; }
.dap-actions summary { cursor: pointer; font-size: 11.5px; color: var(--el-text-color-secondary, #666); }
</style>
