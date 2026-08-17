<script setup lang="ts">
// 复盘三问结论条（Epic #2033 · M1 · #2040，S1 体系消费元素之一）
// ---------------------------------------------------------------------------
// 三行只读结论，把 S1 已有的过程数据收敛成晨会开口第一句话：
//   ① 成交没成交（中标率，analyzeClearing 前端真算）
//   ② 偏差怎么样（执行偏差 + 环比昨日写回链上的记录）
//   ③ 赚亏多少（回测收益，立场换措辞：售电=成本 / 电厂=收入 / 储能=套利）
// 数字全部复用既有取数，零新口径、零写回（#2040 验收：只读元素）。
// #2005 未定稿前立场运行时为 null：按拍板先做售电/电厂两态 + 中性兜底，不猜。
import { computed } from 'vue'

const props = defineProps<{
  reviewedDate: string
  hasReviewed: boolean
  /** 中标率 0–1；出清未登记/无昨单为 null */
  clearRate: number | null
  deviationMwh: number | null
  /** 偏差率 0–1（总偏差/申报总量）；申报为 0 或未取到为 null */
  deviationPct: number | null
  /** 昨日晨会写回链上的执行偏差（MWh）；昨日未记录为 null */
  prevDeviationMwh: number | null
  /** 环比对照所属标的日（T-2），仅文案用 */
  prevReviewedDate: string
  pnl: { daRevenueYuan: number | null; spreadPnlYuan: number | null } | null
  /** #2005 立场（RETAILER/GENERATOR/STORAGE/LOAD…）；未接线时为 null → 中性措辞 */
  position: string | null
}>()

type PnlWording = { question: string; label: string; note: string }

/** 立场 → 第三问措辞（#2040：售电/电厂两态先行；null/未知走中性，不猜方向）。 */
const PNL_WORDING: Record<string, PnlWording> & { neutral: PnlWording } = {
  RETAILER: {
    question: '购电成本怎么样',
    label: '购电成本（回测）',
    note: '售电视角：日前收益为负即购电支出；价差盈亏为正表示日前买入优于实时'
  },
  LOAD: {
    question: '购电成本怎么样',
    label: '购电成本（回测）',
    note: '用户侧视角：日前收益为负即购电支出；价差盈亏为正表示日前买入优于实时'
  },
  GENERATOR: {
    question: '售电收入怎么样',
    label: '售电收入（回测）',
    note: '电厂视角：日前收益为正即售电收入；价差盈亏为正表示日前卖出优于实时'
  },
  STORAGE: {
    question: '套利窗口吃到没',
    label: '套利价差盈亏（回测）',
    note: '储能视角：价差盈亏衡量日前/实时两腿价差捕获情况'
  },
  neutral: { question: '回测收益怎么样', label: '回测收益', note: '立场未接入（#2005 未定稿）：按中性口径展示，方向解释见数字注脚' }
}

const pnlWording = computed<PnlWording>(() =>
  props.position && PNL_WORDING[props.position] ? PNL_WORDING[props.position] : PNL_WORDING.neutral
)

const momDeviation = computed<{ deltaMwh: number; pct: number; better: boolean } | null>(() => {
  if (props.deviationMwh === null || props.prevDeviationMwh === null) return null
  const delta = props.deviationMwh - props.prevDeviationMwh
  const base = Math.abs(props.prevDeviationMwh) > 1e-9 ? Math.abs(props.prevDeviationMwh) : null
  return {
    deltaMwh: delta,
    pct: base === null ? 0 : delta / base,
    better: delta < 0
  }
})

function fmtPct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${(v * 100).toFixed(digits)}%`
}
function fmtMoney(v: number | null): string {
  return v === null ? '—' : `${Math.round(v).toLocaleString()} 元`
}
</script>

<template>
  <section class="tq" :data-has-reviewed="hasReviewed">
    <div class="tq-item">
      <span class="tq-q">① 成交没成交</span>
      <b v-if="!hasReviewed" class="tq-a muted">{{ reviewedDate }} 无申报单，无从谈起</b>
      <template v-else-if="clearRate !== null">
        <b class="tq-a" :class="clearRate < 0.85 ? 'bad' : 'good'">{{ fmtPct(clearRate) }}</b>
        <span class="tq-sub">中标率</span>
      </template>
      <template v-else>
        <b class="tq-a muted">出清未登记</b>
        <span class="tq-sub">中标情况无从对照</span>
      </template>
    </div>

    <div class="tq-item">
      <span class="tq-q">② 偏差怎么样</span>
      <template v-if="deviationMwh !== null">
        <b class="tq-a">{{ deviationMwh.toFixed(2) }} MWh</b>
        <span class="tq-sub">偏差率 {{ fmtPct(deviationPct, 2) }}</span>
        <span v-if="momDeviation" class="tq-sub mom" :class="momDeviation.better ? 'good' : 'bad'">
          环比{{ prevReviewedDate }}：
          {{ momDeviation.deltaMwh > 0 ? '+' : '' }}{{ momDeviation.deltaMwh.toFixed(2) }} MWh
          （{{ momDeviation.better ? '收窄' : '扩大' }}）
        </span>
        <span v-else class="tq-sub muted">昨日（{{ prevReviewedDate }}）未记录，环比缺席</span>
      </template>
      <template v-else>
        <b class="tq-a muted">{{ hasReviewed ? '实际电量未取到' : '无昨单，无基准' }}</b>
        <span class="tq-sub">量化口径以 ② 执行偏差区为准</span>
      </template>
    </div>

    <div class="tq-item">
      <span class="tq-q">③ {{ pnlWording.question }}</span>
      <template v-if="pnl && (pnl.spreadPnlYuan !== null || pnl.daRevenueYuan !== null)">
        <b class="tq-a" :class="(pnl.spreadPnlYuan ?? 0) >= 0 ? 'good' : 'bad'">{{ fmtMoney(pnl.spreadPnlYuan) }}</b>
        <span class="tq-sub">{{ pnlWording.label }} · 日前收益 {{ fmtMoney(pnl.daRevenueYuan) }}</span>
        <span class="tq-sub muted">{{ pnlWording.note }}</span>
      </template>
      <template v-else>
        <b class="tq-a muted">回测未取到</b>
        <span class="tq-sub">随执行偏差加载，无昨单时无回测</span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.tq { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 900px) { .tq { grid-template-columns: 1fr; } }
.tq-item {
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 10px; background: #fff; min-width: 0;
}
.tq-q { font-size: 11px; color: var(--el-text-color-secondary, #666); font-weight: 600; }
.tq-a { font-size: 17px; color: var(--el-text-color-primary, #303133); font-variant-numeric: tabular-nums; }
.tq-a.good { color: #16a34a; }
.tq-a.bad { color: #b91c1c; }
.tq-a.muted { color: var(--el-text-color-secondary, #666); font-size: 13.5px; }
.tq-sub { font-size: 11px; color: var(--el-text-color-secondary, #666); }
.tq-sub.mom.good { color: #15803d; }
.tq-sub.mom.bad { color: #b91c1c; }
.tq-sub.muted { opacity: 0.85; }
</style>
