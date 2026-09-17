<script setup lang="ts">
// 现货交易驾驶舱「快捷动作」（统一 AI 侧边栏 EN-03）。
//
// 原先是「智能体任务台 · 快捷动作」折叠卡：左侧按钮 + 右侧内嵌对话框（history-key=dashboard_overview）。
// 入口收拢后对话统一在 AI 侧边栏进行：按钮点击即唤出侧边栏并直接发送对应问题，页面不再内嵌对话框。
// 「检索最新披露」暂时去掉——披露与规则类工具在后端冻结，入口给出的结果会偏弱。
// 无工作台访问权限的角色按改动前口径禁用（权限口径保持现状）。报价决策舱入口不属于 AI，原样保留。
import { computed } from 'vue'
import { ArrowRight, Bot, ClipboardCheck, LineChart, ShieldAlert, Sparkles } from 'lucide-vue-next'
import { useAiSidebar } from '@/features/aiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'

const props = defineProps<{
  canUseAgent: boolean
  /** 明日日期（YYYY-MM-DD），插入申报草稿问题 */
  tomorrow: string
  hasBidPlan: boolean
}>()
const emit = defineEmits<{ openBidPlan: [] }>()

const ai = useAiSidebar()
const quickTasks = computed(() => [
  { icon: Sparkles, label: '生成明日申报草稿', q: `为 ${props.tomorrow} 制定日前申报策略并生成草稿` },
  { icon: LineChart, label: '今日行情解读', q: '分析今日出清价格走势与峰谷价差，解释主要驱动因素' },
  { icon: ShieldAlert, label: '执行风控巡检', q: '执行例行风控巡检：核查价格异动与风险指标' }
])

function runTask(q: string) {
  if (!props.canUseAgent) return
  ai.ask(q, { promptKey: PAGE_PROMPT_KEYS.workbench, label: '现货交易驾驶舱' })
}
</script>

<template>
  <section class="panel cockpit-quick-actions" aria-label="快捷动作">
    <div class="panel-head">
      <h2><Bot :size="15" /> 快捷动作</h2>
      <span v-if="!canUseAgent" class="muted" data-testid="quick-actions-locked">当前角色无智能体使用权限</span>
    </div>
    <div class="qa-row">
      <button
        v-for="t in quickTasks"
        :key="t.label"
        type="button"
        class="task-btn"
        data-testid="quick-task"
        :disabled="!canUseAgent"
        :title="canUseAgent ? '在 AI 侧边栏中执行' : '当前角色无智能体使用权限'"
        @click="runTask(t.q)"
      >
        <component :is="t.icon" :size="14" />
        <span>{{ t.label }}</span>
        <ArrowRight :size="13" class="task-arrow" />
      </button>
      <button v-if="hasBidPlan" type="button" class="task-btn" @click="emit('openBidPlan')">
        <ClipboardCheck :size="14" />
        <span>打开申报决策舱</span>
        <ArrowRight :size="13" class="task-arrow" />
      </button>
    </div>
    <p class="muted actions-hint"><ShieldAlert :size="12" /> 风控巡检由智能体执行：核查价格异动、CVaR 与持仓敞口，异常产出分级预警。</p>
  </section>
</template>

<style scoped>
/* 标题行与说明文字的样式原在驾驶舱页面的 scoped 样式里；抽成组件后父级 scoped 选择器够不到子组件内部，需在此自带 */
.cockpit-quick-actions { padding: 12px 14px; }
.muted { color: var(--muted); font-size: var(--font-12-5); }
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.panel-head h2 { display: flex; align-items: center; gap: 6px; font-size: var(--font-lg); margin: 0; }
.panel-head > .muted { margin-left: auto; }
.qa-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.task-btn {
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px;
  font-size: var(--font-md); border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--text); cursor: pointer; transition: all 0.15s ease;
}
.task-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.task-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.task-arrow { opacity: 0.6; }
.actions-hint { display: flex; align-items: flex-start; gap: 5px; margin: 10px 0 0; font-size: var(--font-11-5); line-height: 1.5; }
.actions-hint svg { flex: none; margin-top: 2px; }
@media (max-width: 768px) { .panel-head { flex-wrap: wrap; } }
</style>
