<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SettlementReviewResult } from '@/services/quant/quantClient'
import { finite, formatValue } from '@/services/review/decisionWorkbench'
import { exportCsv } from '@/utils/exportCsv'
const props = defineProps<{ settlement: SettlementReviewResult }>()
const search = ref('')
const simulated = computed(() => props.settlement.mock || props.settlement.sourceType === 'MOCK')
const rows = computed(() => props.settlement.plants.filter(p => p.plant.includes(search.value.trim())))
const max = computed(() => Math.max(...props.settlement.plants.map(p => Math.abs(p.totalFee ?? 0)), 1))
const segments = computed(() => [
  { label: '中长期电量', value: props.settlement.summary.ltmEnergy },
  { label: '日前增量', value: props.settlement.summary.daDevEnergy },
  { label: '实时增量', value: props.settlement.summary.rtDevEnergy },
  { label: '实际上网电量', value: props.settlement.summary.actualOnGridEnergy }
])
function download() {
  exportCsv(`厂站结算资料-${props.settlement.date}.csv`, ['厂站', '中长期电量（MWh）', '日前增量（MWh）', '实时增量（MWh）', '实际上网电量（MWh）', '总电费（元）', '加权均价（元/MWh）', '资料性质'],
    rows.value.map(p => [p.plant, p.ltmEnergy ?? '', p.daDevEnergy ?? '', p.rtDevEnergy ?? '', p.actualOnGridEnergy ?? '', p.totalFee ?? '', p.avgPrice ?? '', simulated.value ? '模拟数据' : '电网结算资料；非单笔决策收益']))
}
</script>
<template>
  <section class="settlement panel">
    <header><div><h2>结算资料核验 <span v-if="settlement.mock || settlement.sourceType === 'MOCK'" class="warning">模拟数据</span></h2><p>当前授权范围 · {{ settlement.date }} · {{ settlement.plant_count }} 座厂站。以下为结算资料汇总，未分配到单笔申报。</p></div><button type="button" @click="download">导出厂站明细</button></header>
    <div class="metrics"><div><span>实际上网电量</span><strong>{{ formatValue(settlement.summary.actualOnGridEnergy, 1) }}<small>MWh</small></strong></div><div><span>结算总电费</span><strong>{{ formatValue(settlement.summary.totalFee, 0) }}<small>元</small></strong></div><div><span>电量加权均价</span><strong>{{ formatValue(settlement.summary.avgPrice, 2) }}<small>元/MWh</small></strong></div></div>
    <div class="segments" aria-label="中长期电量加日前增量加实时增量等于实际上网电量"><template v-for="(segment, index) in segments" :key="segment.label"><span v-if="index" class="operator">{{ index === 3 ? '=' : '+' }}</span><div><span>{{ segment.label }}</span><b>{{ formatValue(segment.value, 1) }} <small>MWh</small></b></div></template></div>
    <p class="note">日前、实时增量表示结算电量的组成；结算电费不等于交易净收益。正式对账仍需同主体、同周期的账单明细与费用口径。</p>
    <details><summary>查看厂站分布与明细</summary><div class="filter"><label>查找厂站 <input v-model="search" type="search" placeholder="输入厂站名称" /></label><span>{{ rows.length }} 座</span></div><div class="table-wrap"><table><thead><tr><th>厂站</th><th>实际上网（MWh）</th><th>电费分布</th><th>总电费（元）</th><th>均价（元/MWh）</th></tr></thead><tbody><tr v-for="(p, i) in rows" :key="`${p.plant}-${i}`"><td>{{ p.plant }}</td><td>{{ formatValue(p.actualOnGridEnergy, 1) }}</td><td class="bar-cell"><div v-if="finite(p.totalFee)" class="bar" :class="{ negative: p.totalFee < 0 }" :style="{ width: `${Math.abs(p.totalFee) / max * 100}%` }" /><span v-else>—</span></td><td>{{ formatValue(p.totalFee, 0) }}</td><td>{{ formatValue(p.avgPrice, 2) }}</td></tr><tr v-if="!rows.length"><td colspan="5">没有匹配的厂站。</td></tr></tbody></table></div></details>
  </section>
</template>
<style scoped>
.settlement { padding: 18px; min-width: 0; } header { display: flex; justify-content: space-between; gap: 16px; align-items: start; flex-wrap: wrap; } h2 { margin: 0; font-size: var(--font-lg); } p { color: var(--muted); font-size: var(--font-sm); line-height: 1.6; margin: 8px 0 16px; } button, input { font: inherit; font-size: var(--font-sm); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; color: var(--text); background: var(--panel); } button, summary { cursor: pointer; } .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 8px 0 20px; } .metrics span, .segments span { font-size: var(--font-sm); color: var(--muted); } strong { display: block; font-size: var(--font-24); font-weight: 600; margin-top: 8px; font-variant-numeric: tabular-nums; } small { font-size: var(--font-sm); color: var(--muted); font-weight: 400; margin-left: 5px; } .segments { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 8px; background: var(--panel-sub); } .segments > div { flex: 1; } .segments b { display: block; font-size: var(--font-lg); margin-top: 8px; } .note { margin: 12px 0; } summary { font-size: var(--font-sm); } .filter { display: flex; gap: 16px; align-items: center; margin: 16px 0 8px; font-size: var(--font-sm); } .filter input { max-width: 200px; } .table-wrap { overflow: auto; max-height: 380px; } table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); font-variant-numeric: tabular-nums; } th, td { padding: 9px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; } th:first-child, td:first-child { text-align: left; } .bar-cell { width: 22%; min-width: 100px; } .bar { height: 10px; border-radius: 2px; background: var(--primary); } .bar.negative { background: var(--warning); } .warning { font-size: var(--font-sm); color: var(--warning); } @media(max-width: 650px) { .metrics { grid-template-columns: 1fr; gap: 18px; } .segments { flex-direction: column; align-items: stretch; } .operator { text-align: center; } .segments > div { display: flex; justify-content: space-between; align-items: center; } .segments b { margin: 0; } }
</style>
