<script setup lang="ts">
// 三主体专属驾驶舱（Epic #2033 · M4 · #2048）
// ---------------------------------------------------------------------------
// 按数据可得性分批（注册表就绪度台账驱动，批次即验收顺序）：
// 批1 售电先行（#2005「先做透用户侧」）——R1/R4 公司级日度行由 quant /review 真数
// （山西覆盖区可端到端验证；分客户明细缺 D4 如实标注）；批2 新能源（N1 中广核云南
// 场站真实试点）；批3 储能（E1 计划侧接事前测算，价格 illustrative 即 MOCK 须明示）。
// 无数据模板诚实呈现「等待数据接入」，不空白不假数；台账翻转须写数据来源（验收）。
import { computed, ref } from 'vue'
import { templatesBySubject, type ReviewSubject } from 'shared/review-templates/registry.mjs'

export type SubjectDaySummary = {
  date: string
  declaredTotalMwh: number | null
  deviationMwh: number | null
  deviationPct: number | null
  estimatedPenaltyYuan: number | null
} | null

const props = defineProps<{ daySummary: SubjectDaySummary }>()
const emit = defineEmits<{ (e: 'open-template', templateId: string): void }>()

const TABS: Array<{ id: ReviewSubject; label: string; batch: string; batchNote: string }> = [
  {
    id: 'retail', label: '售电', batch: '批 1（先行）',
    batchNote: '对齐 #2005「先做透用户侧」：R1/R4 公司级日度行由 quant /review 真数；R5 月度综合已就绪；R2/R3 等 D3/D4 数据。'
  },
  {
    id: 'renewable', label: '新能源', batch: '批 2',
    batchNote: 'N1 出力预测准确率为首个真实试点（中广核云南场站真实 RT 数据 + 预测域产出）；N2 偏差考核可由 /review 镜像；N3 弃电率等 D5。'
  },
  {
    id: 'storage', label: '储能', batch: '批 3',
    batchNote: 'E1 计划编排接既有事前测算——价格默认 illustrative 即 MOCK，须页面明示，接真实价格才可用于实盘编排；实际充放电与辅助服务收益等 D1/D2。'
  }
]

const active = ref<ReviewSubject>('retail')
const activeTab = computed(() => TABS.find((t) => t.id === active.value)!)
/** 主体专属 + 通用模板（templatesBySubject 语义：common 适用全部主体） */
const templates = computed(() => templatesBySubject(active.value).map((t) => ({
  id: t.id,
  name: t.name,
  readiness: t.readiness,
  slots24: t.slots24 === true,
  gapNote: t.gapNote ?? null
})))
</script>

<template>
  <section class="sc">
    <header class="sc-head">
      <b>三主体驾驶舱</b>
      <nav class="sc-tabs">
        <button
          v-for="t in TABS" :key="t.id" type="button"
          :class="{ on: active === t.id }" @click="active = t.id"
        >
          {{ t.label }}<i>{{ t.batch }}</i>
        </button>
      </nav>
    </header>
    <p class="sc-batch">{{ activeTab.batchNote }}</p>

    <!-- 批1 售电：公司级真数区（R1/R4 日度行） -->
    <div v-if="activeTab.id === 'retail'" class="sc-r1r4">
      <b>R1/R4 公司级日度行（quant /review 真数 · {{ props.daySummary?.date ?? '当日' }}）</b>
      <template v-if="props.daySummary && props.daySummary.deviationMwh !== null">
        <div class="sc-facts">
          <span>申报 {{ props.daySummary.declaredTotalMwh?.toFixed(1) ?? '—' }} MWh</span>
          <span>偏差 {{ props.daySummary.deviationMwh.toFixed(2) }} MWh</span>
          <span :class="props.daySummary.deviationPct !== null && props.daySummary.deviationPct > 0.05 ? 'bad' : ''">
            偏差率 {{ props.daySummary.deviationPct === null ? '—' : (props.daySummary.deviationPct * 100).toFixed(2) + '%' }}
          </span>
          <span>考核费估算 {{ props.daySummary.estimatedPenaltyYuan?.toLocaleString() ?? '—' }} 元</span>
        </div>
        <p class="sc-note">分客户明细缺（D4）：此处为公司级先行口径——分客户行随 D4 数据接入后展开；考核单价自算口径（D6 未核验）。</p>
      </template>
      <p v-else class="sc-note">当日无 /review 真数（未接入/覆盖区外/未取到）——R1/R4 行不出数，不合成。</p>
    </div>

    <!-- 批2 新能源：N1 真实试点说明 -->
    <p v-if="activeTab.id === 'renewable'" class="sc-note">
      N1 为 24 时段模板：底层 96 点、24 时段仅展示聚合（2026-08-13 拍板）；实际出力读中广核云南场站 RT 数据（公司私有 PG，仅该主体该地区）。
    </p>

    <!-- 批3 储能：E1 illustrative 明示 -->
    <p v-if="activeTab.id === 'storage'" class="sc-mock">
      ⚠ E1 计划侧价格默认 illustrative 即 MOCK——仅测算演示，不可用于实盘编排；接真实价格后方可实盘。
    </p>

    <!-- 主体模板清单（就绪度台账驱动） -->
    <div class="sc-list">
      <button
        v-for="t in templates" :key="t.id" type="button"
        class="sc-tpl" :class="`sc-${t.readiness}`"
        :title="t.gapNote ?? ''"
        @click="emit('open-template', t.id)"
      >
        <span>{{ t.id }} {{ t.name }}{{ t.slots24 ? ' · 24 时段' : '' }}</span>
        <i>{{ t.readiness === 'ready' ? '就绪' : t.readiness === 'data_gap' ? '等待数据接入' : '后置' }}</i>
      </button>
    </div>
    <p class="sc-note">
      无数据模板诚实呈现「等待数据接入」而非空白或假数；每批交付时注册表就绪度台账同步翻转
      （data_gap→ready 须写数据来源）——台账即分期验收清单。通用模板（T01–T13）适用全部主体。
    </p>
  </section>
</template>

<style scoped>
.sc { display: flex; flex-direction: column; gap: 8px; font-size: var(--font-12-5); }
.sc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.sc-tabs { display: inline-flex; gap: 4px; }
.sc-tabs button {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 12px;
  border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 999px;
  background: #fff; font-size: var(--font-sm); cursor: pointer;
}
.sc-tabs button.on { border-color: var(--el-color-primary, #2563eb); color: var(--el-color-primary, #2563eb); }
.sc-tabs i { font-style: normal; font-size: var(--font-10); color: var(--el-text-color-secondary, #909399); }
.sc-batch { margin: 0; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); line-height: 1.6; }
.sc-r1r4 { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; }
.sc-r1r4 b { font-size: var(--font-sm); color: #075985; }
.sc-facts { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
.sc-facts .bad { color: #b91c1c; }
.sc-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.sc-mock { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; font-size: var(--font-11-5); }
.sc-list { display: flex; flex-direction: column; gap: 4px; }
.sc-tpl {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px;
  background: #fff; font-size: var(--font-sm); cursor: pointer; text-align: left;
}
.sc-tpl:hover { border-color: var(--el-color-primary, #2563eb); }
.sc-tpl i { font-style: normal; font-size: var(--font-10-5); border-radius: 999px; padding: 0 8px; white-space: nowrap; }
.sc-ready i { background: #f0fdf4; color: #15803d; }
.sc-data_gap i { background: #fffbeb; color: #a16207; }
.sc-deferred i { background: #f1f5f9; color: #64748b; }
</style>
