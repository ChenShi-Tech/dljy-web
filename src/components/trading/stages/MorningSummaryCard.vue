<script setup lang="ts">
// 本日适用措施卡（trading-day-morning-summary-and-lazy-stages 任务 2.1，S1 摘要块分区之二）
// ---------------------------------------------------------------------------
// 数据 = fetchCarryOverActions()（复盘中心 open + carried_over 未闭环清单），展示字段
// 全部在 morningSummary.ts 头注释指认出处（owner=负责人、dueDate=回查日）。
// 三态诚实呈现（spec「摘要数据源三态诚实显示」）：无权限 / 读取失败（可重试）/ 无措施
// 空态，不拿占位数据冒充。回查日已过且未闭环的条目置顶并标「已过期未验证」。
// 条目点击跳复盘中心改进验证视图（task=improvement），本卡只读、不写回任何状态。
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardList } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'
import { fetchCarryOverActions } from '@/services/review/reviewStoreClient'
import {
  toMorningSummaryState,
  type MorningSummaryState
} from '@/services/review/morningSummary'

const props = defineProps<{ targetDate: string }>()

const router = useRouter()
const loading = ref(true)
const state = ref<MorningSummaryState | null>(null)

// scope = 请求实际携带的隔离维度：公司（与 identityHeaders 同源键）+ 地区 + 标的日。
// 切换任一维度重取；loadToken 保证慢响应不覆盖新上下文（与容器 loadDeclaration 同款）。
const COMPANY_KEY = 'dljy.currentCompanyId'
const scope = computed(() => ({
  companyId: localStorage.getItem(COMPANY_KEY) ?? '',
  region: currentRegion.value.id,
  targetDate: props.targetDate
}))

let loadToken = 0
async function load() {
  const token = ++loadToken
  loading.value = true
  try {
    const feed = await fetchCarryOverActions()
    if (token !== loadToken) return
    state.value = toMorningSummaryState(feed, todayIso())
  } catch {
    if (token !== loadToken) return
    state.value = { kind: 'unavailable' }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

watch(scope, () => { void load() }, { immediate: true })

function openImprovement() {
  router.push({ path: '/xhjy/review', query: { task: 'improvement' } })
}

const actions = computed(() => (state.value?.kind === 'ok' ? state.value.actions : []))
</script>

<template>
  <section class="msc">
    <header class="msc-head">
      <ClipboardList :size="14" />
      <b>本日适用措施</b>
      <span class="msc-src">复盘中心 · 未闭环</span>
      <span v-if="state?.kind === 'ok'" class="msc-count">{{ actions.length }} 条</span>
    </header>

    <p v-if="loading" class="msc-muted">查未闭环措施…</p>

    <template v-else-if="state?.kind === 'ok'">
      <ul class="msc-list">
        <li v-for="a in actions" :key="a.id">
          <button type="button" class="msc-item" :class="{ 'msc-item-overdue': a.overdue }" @click="openImprovement">
            <span class="msc-action">{{ a.action }}</span>
            <span class="msc-meta">
              <em v-if="a.overdue" class="msc-overdue">已过期未验证</em>
              <span>负责人：{{ a.owner ?? '未指定' }}</span>
              <span v-if="a.dueDate">回查日：{{ a.dueDate }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <p v-else-if="state?.kind === 'empty'" class="msc-empty">无未闭环措施——改进清单已清。</p>
    <p v-else-if="state?.kind === 'unauthorized'" class="msc-empty">无权限查看复盘措施（需复盘数据授权）。</p>
    <template v-else-if="state?.kind === 'unavailable'">
      <p class="msc-empty">复盘措施读取失败。</p>
      <button type="button" class="msc-retry" @click="load">重试</button>
    </template>
  </section>
</template>

<style scoped>
.msc { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; min-width: 0; }
.msc-head { display: flex; align-items: center; gap: 6px; font-size: var(--font-sm); }
.msc-head b { font-size: var(--font-12-5); }
.msc-src { margin-left: auto; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #666); border: 1px dashed var(--el-border-color, #dcdfe6); border-radius: 999px; padding: 0 7px; }
.msc-count { font-size: var(--font-10-5); color: var(--el-text-color-secondary, #666); }
.msc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.msc-item { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 6px 9px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; background: #f8fafc; cursor: pointer; min-width: 0; }
.msc-item:hover { border-color: var(--el-color-primary, #2563eb); }
.msc-item-overdue { border-color: var(--el-color-warning, #e6a23c); }
.msc-action { font-size: var(--font-12-5); font-weight: 600; color: var(--el-text-color-primary, #303133); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msc-meta { display: flex; gap: 10px; font-size: var(--font-xs); color: var(--el-text-color-secondary, #666); flex-wrap: wrap; }
.msc-overdue { font-style: normal; color: var(--el-color-warning, #b45309); font-weight: 600; }
.msc-muted { margin: 0; font-size: var(--font-11-5); color: var(--el-text-color-secondary, #666); }
.msc-empty { margin: 0; font-size: var(--font-sm); color: var(--el-text-color-secondary, #666); }
.msc-retry { align-self: flex-start; padding: 0; border: none; background: none; color: #2563eb; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
</style>
