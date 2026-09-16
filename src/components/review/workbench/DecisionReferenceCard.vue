<script setup lang="ts">
import { computed } from 'vue'
import { DECLARATION_MODE_LABEL, declarationModeOf } from '@/services/declarations'
import { formatValue } from '@/services/review/decisionWorkbench'
import type { DecisionReference } from '@/services/review/workpapers'

const props = defineProps<{ reference: DecisionReference }>()
const emit = defineEmits<{ open: [value: DecisionReference] }>()
const order = computed(() => props.reference.snapshot)
// 资料性质取服务端冻结副本，不看客户端当前列表：关联之后申报改成演练也不能悄悄改写已留存的判断。
const modeLabel = computed(() => DECLARATION_MODE_LABEL[declarationModeOf(order.value)])
const energyTotal = computed(() => {
  const curve = order.value?.energyCurveMwh96
  // 缺点位或含非有限值时不给合计：半条曲线加出来的数会被当成申报总量。
  if (!Array.isArray(curve) || curve.length !== 96 || !curve.every(value => Number.isFinite(value))) return null
  return curve.reduce((sum, value) => sum + value, 0)
})
const capacity = computed(() => (Number.isFinite(order.value?.capacityMw) ? order.value.capacityMw : null))
const linkedAt = computed(() => new Date(props.reference.capturedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))
</script>

<template>
  <div class="decision-card" :class="{ simulated: reference.simulated }">
    <header>
      <b>{{ reference.targetDate }} 交易日申报</b>
      <span class="mode" :class="{ warn: reference.simulated }">{{ modeLabel }}</span>
    </header>
    <dl>
      <div v-if="capacity !== null"><dt>申报容量</dt><dd>{{ formatValue(capacity) }} MW</dd></div>
      <div v-if="energyTotal !== null"><dt>全天申报电量</dt><dd>{{ formatValue(energyTotal) }} MWh</dd></div>
      <div><dt>关联时间</dt><dd>{{ linkedAt }}</dd></div>
    </dl>
    <p class="rationale">{{ order?.quoteRationale || '这笔申报没有留存报价依据，需要回到原申报核实。' }}</p>
    <p class="notice">{{ reference.notice }}</p>
    <button type="button" @click="emit('open', reference)">打开这笔申报</button>
  </div>
</template>

<style scoped>
.decision-card{border:1px solid var(--line);border-radius:8px;padding:14px;display:grid;gap:10px}
.decision-card.simulated{border-style:dashed}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mode{font-size:var(--font-sm);border:1px solid var(--line);border-radius:999px;padding:2px 10px;color:var(--muted)}
.mode.warn{border-color:var(--warning,#c47f17);color:var(--warning,#c47f17)}
dl{display:flex;flex-wrap:wrap;gap:8px 26px;margin:0}
dl>div{display:flex;gap:8px;align-items:baseline}
dt,dd{margin:0;font-size:var(--font-sm)}
dt{color:var(--muted)}
.rationale,.notice{margin:0;font-size:var(--font-sm);color:var(--muted);line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.notice{border-top:1px solid var(--line);padding-top:10px}
button{font:inherit;font-size:var(--font-sm);padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);cursor:pointer;justify-self:start}
button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
