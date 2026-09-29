<script setup lang="ts">
// 套保工作台「当月/后续」页签（openspec build-midlong-spot-hedging 任务 8.x；#3420 自外壳拆出，显示保持原样）。
//
// 每次被激活都重取当月的月度视图；切公司/地区立即清空，激活中则按新范围重取，切换前发出的旧请求晚到一律丢弃（HW-06）。
import { ref } from 'vue'
import { fetchMonths } from '@/services/hedge/hedgeApi'
import { injectHedgeWorkbench, today2Range, useHedgeTabLifecycle } from '../useHedgeWorkbench'

const workbench = injectHedgeWorkbench()

const monthData = ref<Record<string, unknown> | null>(null)
const monthLoading = ref(false)

async function loadMonth() {
  const current = workbench.scopedRequest()
  monthLoading.value = true
  try {
    const range = today2Range()
    const data = await fetchMonths({ fromMonth: range.fromDate.slice(0, 7), toMonth: range.fromDate.slice(0, 7) })
    if (current()) monthData.value = data
  } catch {
    if (current()) monthData.value = null
  }
  if (current()) monthLoading.value = false
}

useHedgeTabLifecycle(workbench, {
  load: loadMonth,
  reset: () => { monthData.value = null },
})
</script>

<template>
  <section v-if="monthData" data-test="month-view" class="body">
    <h3>当月/后续月份（月度视图）</h3>
    <pre>{{ JSON.stringify(monthData.months ?? monthData, null, 2).slice(0, 2000) }}</pre>
  </section>
</template>
