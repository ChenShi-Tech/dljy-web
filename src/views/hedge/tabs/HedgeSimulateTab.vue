<script setup lang="ts">
// 套保工作台「补仓试算」页签（openspec build-midlong-spot-hedging HM-07；#3420 自外壳拆出，显示保持原样）。
//
// 无状态试算：POST 但服务端不落库，结果只留在本页（刷新即消失）。不在激活时加载；切公司/地区清空结果与状态，
// 切换前发出的试算晚到一律丢弃（HW-06）。外壳 KeepAlive 保活本页签，切走再切回不丢输入与结果。
import { ref } from 'vue'
import { HedgeApiError, postSimulate } from '@/services/hedge/hedgeApi'
import { injectHedgeWorkbench, today2Range, useHedgeTabLifecycle } from '../useHedgeWorkbench'

const workbench = injectHedgeWorkbench()

const simulateResult = ref<Record<string, unknown> | null>(null)
const simulateQuantity = ref('')
const simulateStatus = ref<string | null>(null)

async function runSimulate() {
  const current = workbench.scopedRequest()
  simulateStatus.value = null
  try {
    const range = today2Range()
    const result = await postSimulate({
      window: { fromDate: range.fromDate, toDate: range.toDate },
      adjustments: [{ quantityMwh: simulateQuantity.value, shape: { kind: 'FLAT' } }],
    })
    if (!current()) return
    simulateResult.value = result
    simulateStatus.value = '试算完成（不落库，刷新即消失）'
  } catch (err) {
    if (current()) simulateStatus.value = err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : '试算失败'
  }
}

useHedgeTabLifecycle(workbench, {
  reset: () => {
    simulateResult.value = null
    simulateStatus.value = null
  },
})
</script>

<template>
  <section data-test="simulate-view" class="body">
    <h3>补仓试算（不落库；刷新即消失）</h3>
    <input v-model="simulateQuantity" data-test="simulate-qty" placeholder="试算电量 MWh" />
    <button data-test="simulate-run" @click="runSimulate">试算</button>
    <p data-test="simulate-status">{{ simulateStatus }}</p>
    <pre v-if="simulateResult">{{ JSON.stringify(simulateResult, null, 2).slice(0, 2000) }}</pre>
  </section>
</template>
