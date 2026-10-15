<script setup lang="ts">
// 今明两日页签·数据腿新鲜度面板（openspec build-midlong-spot-hedging 任务 8.2，HW-01；ChenShi-Tech/dljy#3420）。
//
// 逐腿展示状态与时刻（/overview 的 legs.rows，契约 HedgeLegRow）：供应商预测按来源各一行；
// 状态/原因用契约中文标签（STALE 标「过期」，FAILED 等显示后端给出的原因）；publishAssumption 有值时
// 标注「发布时刻为登记假设」。腿行的取数与文本全在 hedgeTodayModel（本组件只做展示），旧后端无 rows 时整块不显示。
import HedgeHint from '../HedgeHint.vue'
import type { HedgeLegRowView } from '@/services/hedge/hedgeTodayModel'
import { formatIsoShort, legPublishText, legStatusLabel, legStatusTone } from '@/services/hedge/hedgeTodayModel'

defineProps<{
  rows: HedgeLegRowView[]
  /** legs.degraded：任一腿缺失时后端置真，提示指标可能按不完整口径计算。 */
  degraded: boolean
}>()
</script>

<template>
  <section v-if="rows.length" class="legs" data-test="legs-panel">
    <h3>数据状态 <HedgeHint text="各来源的数据截止时间和可用状态。过期来源仍可用于历史回看，缺失数据不补零。" /><span v-if="degraded" class="degraded" data-test="legs-degraded">有缺项</span></h3>
    <div class="leg-grid">
      <div v-for="row in rows" :key="`${row.key}:${row.sourceKey ?? ''}`" class="leg-tile" data-test="leg-row" :data-leg="row.key">
        <span
          :title="[row.labelMojibakeRaw, row.reasonMojibakeRaw, row.noteMojibakeRaw].filter(Boolean).length
            ? `该来源文本编码解析失败，原文：${[row.labelMojibakeRaw, row.reasonMojibakeRaw, row.noteMojibakeRaw].filter(Boolean).join(' / ')}`
            : undefined"
        >{{ row.label }}<HedgeHint :text="[row.reason ?? row.note, legPublishText(row)].filter(Boolean).join('；')" /></span>
        <span class="status" :class="legStatusTone(row.status)" data-test="leg-status">{{ legStatusLabel(row.status) }}</span>
        <small>{{ formatIsoShort(row.dataThrough) ?? '—' }}</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.legs h3 { margin: 0 0 8px; }
.legs h3 small { font-size: var(--font-xs); color: var(--muted); font-weight: 400; margin-left: 6px; }
.degraded { margin-left: 8px; font-size: var(--font-xs); color: var(--warning, #b45309); }
.grid-wrap { overflow-x: auto; }
table { border-collapse: collapse; font-size: var(--font-sm); white-space: nowrap; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; }
td.reason { white-space: normal; color: var(--muted); font-size: var(--font-xs); }
.status { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: var(--font-xs); border: 1px solid transparent; }
.status.ok { color: var(--muted); border-color: var(--line); }
.status.warn { color: var(--warning, #b45309); border-color: var(--warning, #b45309); }
.status.danger { color: var(--danger); border-color: var(--danger); }
.status.muted { color: var(--muted); border-style: dashed; border-color: var(--line); }
</style>

<style scoped>
.leg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.leg-tile { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--font-sm); }
.leg-tile small { color: var(--muted); }
</style>
