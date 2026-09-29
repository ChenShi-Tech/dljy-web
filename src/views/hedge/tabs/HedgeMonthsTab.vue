<script setup lang="ts">
// 套保工作台「当月/后续」页签（openspec build-midlong-spot-hedging 任务 8.3，HW-03/HW-04/HB-07/HM-02；ChenShi-Tech/dljy#3421）。
//
// 月份范围可调（默认北京时间当月 + 后 2 个月，不写死），加载 /months 逐月视图（按日锁价/发电、月度未分解单列、
// 两口径套保率与判级、品种结构、机制电量、核定上限），窗口联动下方钻取区（/breakdown 维度分类 → 合同）。
// 输入框只是草稿：月卡与钻取都只认「已提交范围」（committed），点「按此范围加载」一次性同时刷新两者——
// 草稿编辑不触发任何取数，页面不会同时展示两个窗口的数据（#3421 审查 R1-01）。
// 生命周期：激活即加载；切公司/地区由 lifecycle 清空并重取；认知时点/粒度变化清空重取（HW-06）；
// 月份查询与钻取各自用序号丢弃迟到响应。顶层 FORBIDDEN：锁价侧不可用（不是 0），发电照常显示。
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import CalloutBox from '@/components/common/CalloutBox.vue'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import { fetchMonthsView } from '@/services/hedge/hedgeMonthsApi'
import type { HedgeMonthsPayload } from '@/services/hedge/hedgeMonthsApi'
import { defaultMonthRange, monthRangeError } from '@/services/hedge/hedgeMaintenanceModel'
import { injectHedgeWorkbench, useHedgeTabLifecycle } from '../useHedgeWorkbench'
import BreakdownDrill from './months/BreakdownDrill.vue'
import MonthCard from './months/MonthCard.vue'

const workbench = injectHedgeWorkbench()

/** 输入框草稿：仅 v-model，未提交不触发取数。 */
const range = reactive(defaultMonthRange())
/** 已提交范围：月卡与钻取的唯一取数窗口，初始与默认草稿一致，只在点「按此范围加载」时更新。 */
const committed = reactive(defaultMonthRange())
const rangeError = ref<string | null>(null)
const payload = ref<HedgeMonthsPayload | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const drillRef = ref<InstanceType<typeof BreakdownDrill> | null>(null)

/** 月份查询序号：用户连续改范围重查时丢弃被取代的迟到响应。 */
let monthsSeq = 0

async function loadMonths() {
  const invalid = monthRangeError(committed.fromMonth, committed.toMonth)
  rangeError.value = invalid
  if (invalid) return
  const scoped = workbench.scopedRequest()
  const mySeq = ++monthsSeq
  const current = () => scoped() && mySeq === monthsSeq
  loading.value = true
  loadError.value = null
  try {
    const data = await fetchMonthsView({
      fromMonth: committed.fromMonth, toMonth: committed.toMonth, asOf: workbench.asOf.value ?? undefined,
    })
    if (!current()) return // 迟到响应丢弃（作用域或序号已过）
    payload.value = data
    workbench.syncAsOfBanner()
  } catch (err) {
    if (!current()) return
    payload.value = null
    loadError.value = err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : '月度视图加载失败，可重试'
  } finally {
    if (current()) loading.value = false
  }
}

/** 提交草稿：一次提交同时刷新月卡与钻取（R1-01）。等 nextTick 让新范围先经 props 传到钻取再取数。 */
async function submitRange() {
  const invalid = monthRangeError(range.fromMonth, range.toMonth)
  rangeError.value = invalid
  if (invalid) return
  committed.fromMonth = range.fromMonth
  committed.toMonth = range.toMonth
  void loadMonths()
  await nextTick()
  drillRef.value?.load()
}

/** 页签整体加载：月度视图 + 钻取（钻取窗口与月度范围联动）。 */
function load() {
  void loadMonths()
  void drillRef.value?.load()
}

function reset() {
  monthsSeq++
  payload.value = null
  loading.value = false
  loadError.value = null
  // 未提交的草稿一并丢弃：切公司后输入框与数据都回到已提交范围，三者恒为同一窗口。
  range.fromMonth = committed.fromMonth
  range.toMonth = committed.toMonth
  drillRef.value?.reset()
}

useHedgeTabLifecycle(workbench, { load, reset })

// 认知时点/粒度变化（公司/地区不变）：清空并按新作用域重取（HW-05/HW-06）。
// 公司/地区变化会连带 scopeKey 变化，但那一次由上面的 lifecycle reset + load 处理，这里跳过避免双重加载。
let lastContextKey = workbench.contextKey.value
watch(workbench.scopeKey, () => {
  if (workbench.contextKey.value !== lastContextKey) {
    lastContextKey = workbench.contextKey.value
    return
  }
  payload.value = null
  void loadMonths()
  void drillRef.value?.load()
})

onBeforeUnmount(() => { monthsSeq++ })
</script>

<template>
  <div class="hedge-months-tab">
    <div class="range-bar" data-test="months-range">
      <label>起始月份 <input v-model="range.fromMonth" type="month" data-test="months-from" /></label>
      <label>结束月份 <input v-model="range.toMonth" type="month" data-test="months-to" /></label>
      <button type="button" data-test="months-load" :disabled="loading" @click="submitRange">按此范围加载</button>
      <span class="hint">默认当月 + 后 2 个月；一次最多 12 个月</span>
    </div>
    <p v-if="rangeError" class="field-error" data-test="months-range-error">{{ rangeError }}</p>

    <p v-if="loadError" class="load-error" data-test="load-error">{{ loadError }}</p>
    <p v-else-if="loading" data-test="loading">加载中…</p>

    <template v-if="payload">
      <!-- 顶层 FORBIDDEN（HW-04）：锁价侧无权限不是 0，明确说无权限；发电侧照常显示。 -->
      <CalloutBox v-if="payload.status === 'FORBIDDEN'" tone="warn" title="无权限查看中长期持仓">
        <p>锁价、品种结构、套保率与钻取不可用（不是 0）；发电与发电覆盖天数照常显示。</p>
      </CalloutBox>

      <section v-if="payload.gaps.length" class="gaps" data-test="gaps">
        <h4>数据缺口</h4>
        <ul><li v-for="(gap, i) in payload.gaps" :key="i">{{ gap.code }}：{{ gap.message }}</li></ul>
      </section>

      <section class="months" data-test="month-view">
        <MonthCard
          v-for="month in payload.months"
          :key="month.month"
          :month="month"
          :forbidden="payload.status === 'FORBIDDEN'"
        />
        <p v-if="!payload.months.length" class="hint">该范围内没有月份视图</p>
      </section>
    </template>

    <!-- 钻取区独立于月度载荷挂载（自带加载/错误/FORBIDDEN 状态），窗口只跟已提交范围（与月卡同一窗口）。 -->
    <BreakdownDrill ref="drillRef" :from-month="committed.fromMonth" :to-month="committed.toMonth" />
  </div>
</template>

<style scoped>
.hedge-months-tab { display: flex; flex-direction: column; gap: 12px; }
.range-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.range-bar input { margin-left: 4px; }
.months { display: flex; flex-direction: column; gap: 14px; }
.gaps h4 { margin: 0 0 4px; font-size: var(--font-md, 14px); }
.gaps ul { margin: 0; padding-left: 18px; color: var(--warning, #e6a23c); font-size: var(--font-sm, 13px); }
.hint { color: var(--muted, #909399); font-size: var(--font-xs, 12px); }
.field-error { color: var(--danger, #b91c1c); font-size: var(--font-sm, 13px); margin: 0; }
.load-error { color: var(--danger, #b91c1c); }
</style>
