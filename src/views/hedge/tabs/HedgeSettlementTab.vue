<script setup lang="ts">
// 套保工作台「结算复核」页签（openspec build-midlong-spot-hedging 任务 8.x；#3420 自外壳拆出，显示保持原样）。
//
// 已实现指标，不判级。每次被激活都重取本月初至明天的正式结算日口径；切公司/地区立即清空，激活中则按新范围重取，
// 切换前发出的旧请求晚到一律丢弃（HW-06）。
import { ref } from 'vue'
import { fetchSettlement } from '@/services/hedge/hedgeApi'
import { injectHedgeWorkbench, today2Range, useHedgeTabLifecycle } from '../useHedgeWorkbench'

const workbench = injectHedgeWorkbench()

const settlementData = ref<Record<string, unknown> | null>(null)
const settlementLoading = ref(false)

async function loadSettlement() {
  const current = workbench.scopedRequest()
  settlementLoading.value = true
  try {
    const range = today2Range()
    const data = await fetchSettlement({
      fromDate: `${range.fromDate.slice(0, 7)}-01`, toDate: range.toDate, granularity: 'DAY', view: 'FORMAL',
    })
    if (current()) settlementData.value = data
  } catch {
    if (current()) settlementData.value = null
  }
  if (current()) settlementLoading.value = false
}

useHedgeTabLifecycle(workbench, {
  load: loadSettlement,
  reset: () => { settlementData.value = null },
})
</script>

<template>
  <section data-test="settlement-view" class="body">
    <h3>结算复核（已实现指标，不判级）</h3>
    <p v-if="settlementLoading">加载中…</p>
    <p v-else-if="!settlementData">暂无已入库结算数据（新月份入库后自动出现）</p>
    <pre v-else>{{ JSON.stringify(settlementData, null, 2).slice(0, 2000) }}</pre>
  </section>
</template>
