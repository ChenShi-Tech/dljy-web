<script setup lang="ts">
// 收益三层拆解面板（Epic #2033 · M2 · #2043：模板二/三）
// ---------------------------------------------------------------------------
// 月度三层：分品种（日前/实时增量先行，中长期未接入如实标注）/ 分时段（读
// SettlementRuleSpec）/ 单笔 Top5（M2 以日为笔，逐笔归集待 S6 #1966）。
// 与 #2042 共用 fetchReviewRange——Top5 与拆解表同一次 /review 聚合产出（同源同口径）。
// 环比超 20% 强制归因（方案原文规则）；反事实定位「策略对比」视图=决策参考非结算依据。
import { computed, onMounted, ref, watch } from 'vue'
import PnLWaterfall from '@/components/agent/dljy-ui/review/PnLWaterfall.vue'
import { fetchReviewRange, type PeriodReviewDay } from '@/services/review/reviewPeriodClient'
import {
  decomposeDaily,
  momForcesAttribution,
  monthlyPnlTop,
  rollupMonthly,
  type DailyPnlDecompose
} from '@/services/review/pnlDecompose'
import type { SettlementRuleSpec } from '@/rules/types'

const props = defineProps<{ spec: SettlementRuleSpec | null; tolerancePct: number; penaltyPrice: number }>()

const month = ref(new Date().toISOString().slice(0, 7))
const loading = ref(false)
const curDays = ref<Array<{ date: string; d: DailyPnlDecompose | null; pnlYuan: number | null }>>([])
const prevTotalYuan = ref<number | null>(null)
const prevLabel = ref('')

function monthDays(ym: string, upToToday = false): string[] {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const today = new Date().toISOString().slice(0, 10)
  return Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
    .filter((d) => (upToToday ? d <= today : true))
}
function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  curDays.value = []
  prevTotalYuan.value = null
  try {
    const [cur, prev] = await Promise.all([
      fetchReviewRange(monthDays(month.value, true), { tolerancePct: props.tolerancePct, penaltyPrice: props.penaltyPrice }),
      fetchReviewRange(monthDays(prevMonthOf(month.value)), { tolerancePct: props.tolerancePct, penaltyPrice: props.penaltyPrice })
    ])
    curDays.value = cur.days.map((day: PeriodReviewDay) => {
      if (!day.ok) return { date: day.date, d: null, pnlYuan: null }
      const d = decomposeDaily(day.result.detail, props.spec)
      return { date: day.date, d, pnlYuan: d.totalYuan }
    })
    const prevRoll = rollupMonthly(
      prev.days.map((day: PeriodReviewDay) =>
        day.ok ? { date: day.date, d: decomposeDaily(day.result.detail, props.spec) } : { date: day.date, d: null }
      )
    )
    prevTotalYuan.value = prevRoll.days ? prevRoll.totalYuan : null
    prevLabel.value = prevMonthOf(month.value)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(month, load)

const rollup = computed(() => rollupMonthly(curDays.value))
const top5 = computed(() =>
  monthlyPnlTop(
    curDays.value.filter((x): x is { date: string; d: DailyPnlDecompose; pnlYuan: number } => x.pnlYuan !== null)
  )
)
const forcesAttribution = computed(() =>
  momForcesAttribution(rollup.value.totalYuan, prevTotalYuan.value)
)
/** PnLWaterfall 真数据：分品种层（日前/实时增量），合计=两层之和（恒等）。 */
const waterfallData = computed(() => {
  const r = rollup.value
  const segs: Array<{ label: string; valueYuan: number; kind: 'gain' | 'cost' | 'total' }> = []
  for (const v of r.byVariety) {
    if (v.revenueYuan === null) continue // 中长期未接入不画假柱
    segs.push({ label: v.variety, valueYuan: v.revenueYuan, kind: v.revenueYuan >= 0 ? 'gain' : 'cost' })
  }
  return { segments: segs, totalYuan: r.totalYuan, caliber: 'self-computed', note: `${r.days} 个数据日聚合；价格缺失点 ${r.priceGapPoints} 个未计入对应层` }
})

// 模板三 B 档：事实自动带入（下表），成因与经验人填（本地草稿，提交随 #2037）
const topDraft = ref<Record<string, { mainCause: string; lesson: string; toCase: boolean }>>({})
function draftOf(date: string) {
  return (topDraft.value[date] ??= { mainCause: '', lesson: '', toCase: false })
}
</script>

<template>
  <section class="pdp">
    <header class="pdp-head">
      <b>收益三层拆解与典型交易（模板二 · 月度拆解 / 模板三 · Top5）</b>
      <input v-model="month" type="month" />
    </header>

    <p v-if="loading" class="pdp-muted">逐日取 quant /review 分解中（本月 + 上月环比基线）…</p>

    <template v-else>
      <p v-if="!rollup.days" class="pdp-muted">{{ month }} 无可用数据日——诚实空态，不合成。</p>

      <template v-else>
        <!-- 第一层：分品种（喂 M1 预留位 PnLWaterfall 真数据） -->
        <PnLWaterfall :data="waterfallData" :title="`${month} 收益三层拆解 · 分品种`" />
        <p v-for="v in rollup.byVariety" v-show="v.revenueYuan === null" :key="v.variety" class="pdp-note">
          {{ v.variety }}：{{ v.note }}
        </p>

        <!-- 第二层：分时段 -->
        <div v-if="rollup.bySegment" class="pdp-seg">
          <b>分时段（峰平谷 · 读 SettlementRuleSpec）</b>
          <table class="pdp-table">
            <thead><tr><th>时段</th><th>收益 元</th><th>占比</th></tr></thead>
            <tbody>
              <tr v-for="s in rollup.bySegment" :key="s.segment">
                <td>{{ s.segment }}</td>
                <td>{{ Math.round(s.revenueYuan).toLocaleString() }}</td>
                <td>{{ (s.share * 100).toFixed(1) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="pdp-warn">本省峰谷时段未参数化（SettlementRuleSpec 未沉淀）：分时段层不出数，不借用他省划分。</p>

        <!-- 环比强制归因 -->
        <p v-if="forcesAttribution" class="pdp-warn">
          环比 {{ prevLabel }} 变动超 20%（{{ prevTotalYuan!.toLocaleString() }} → {{ Math.round(rollup.totalYuan).toLocaleString() }} 元）：
          按方案规则本层主要归因<b>必填</b>——在 Top5 表「主要成因」栏填写。
        </p>
        <p v-else class="pdp-note">
          环比 {{ prevLabel }}：{{ prevTotalYuan === null ? '上期无数据（不强制归因）' : `${Math.round(prevTotalYuan).toLocaleString()} 元` }}。
        </p>

        <!-- 第三层：单笔 Top5（M2 以日为笔） -->
        <div class="pdp-top">
          <b>单笔 Top5 盈亏榜 <i>（M2 以日为笔；逐笔成交归集待 S6 持仓线 #1966 接通后替换）</i></b>
          <table class="pdp-table">
            <thead>
              <tr><th>#</th><th>日期</th><th>类型</th><th>盈亏 元</th><th>主要成因（人填）</th><th>可复制经验/改进点</th><th>入案例库</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in top5" :key="t.date">
                <td>{{ t.rank }}</td>
                <td>{{ t.date }}</td>
                <td :class="t.type === '亏损' ? 'bad' : 'good'">{{ t.type }}</td>
                <td>{{ Math.round(t.pnlYuan).toLocaleString() }}</td>
                <td><input v-model="draftOf(t.date).mainCause" class="pdp-input" placeholder="市场机会/策略有效/执行到位…" /></td>
                <td><input v-model="draftOf(t.date).lesson" class="pdp-input" placeholder="可复制经验或改进点" /></td>
                <td><input v-model="draftOf(t.date).toCase" type="checkbox" /></td>
              </tr>
            </tbody>
          </table>
          <p class="pdp-note">
            Top5 与拆解表同源同口径（同一次 /review 聚合产出）；金额 self-computed。
            「是否入库=是」自动登记案例库——案例库写入端点随 #2045 服务端化上线，当前为本地勾选不留库。
          </p>
        </div>

        <!-- 反事实定位：策略对比视图（占位声明） -->
        <p class="pdp-note">
          反事实分析定位为「策略对比」视图：包装 quant 引擎的假设推演，页面将显著标注
          <b>「决策参考，非结算依据」</b>——与正式复盘口径分离呈现。
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.pdp { display: flex; flex-direction: column; gap: 10px; font-size: var(--font-12-5); }
.pdp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.pdp-head input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.pdp-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.pdp-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.pdp-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.pdp-seg b, .pdp-top b { font-size: var(--font-12-5); display: block; margin-bottom: 4px; }
.pdp-top i { font-style: normal; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.pdp-table { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); font-variant-numeric: tabular-nums; }
.pdp-table th, .pdp-table td { padding: 3px 7px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; white-space: nowrap; }
.pdp-table th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: var(--font-10-5); }
.pdp-table th:nth-child(n+5), .pdp-table td:nth-child(n+5) { text-align: left; white-space: normal; }
.pdp-table .good { color: #15803d; }
.pdp-table .bad { color: #b91c1c; }
.pdp-input { width: 100%; min-width: 120px; padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-11-5); box-sizing: border-box; }
</style>
