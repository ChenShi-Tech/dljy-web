<script setup lang="ts">
// AI 工作室（/system/ai-studio）：把原先散在系统管理菜单里的 5 个 AI 编排/配置页收敛为单页 tab。
// 原「AI工作流中枢」（/xhjy/ai-orchestration-studio）是这几页的导航壳，tab 化后失去职责，随本页上线删除。
//
// 各 tab 内容仍是原 View 组件（零改造复用，只摘掉与 tab 标签重复的 h2 标题行）：
//   AI 模型设置                → LLM 凭据/采样/路由/工具能力/用量，页内再按职责分 4 段
//   技能工作室 / 子智能体工作室 → agent-backend /agent-api/agent/{skills,sub-agents}/*
//   Dify 工作流工作室          → 同源嵌入 Dify 原生 Studio（/dify-sso + /dify-studio/*）
//   高级智能体编排             → LangGraph 画布（/agent-api/agent/graphs）
//   定时任务调度               → /agent-api/agent/schedules
// 子组件走 defineAsyncComponent + el-tab-pane lazy：进页只加载当前 tab 的 chunk，
// 不把 3500+ 行五个页面打进同一个首屏包（原本每页各自路由级懒加载，合并不得劣化）。
//
// tab 状态同步到 ?tab= query：旧路由 redirect 落到对应 tab、刷新与深链保持位置。
import { defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const TABS = [
  { name: 'models', label: 'AI 模型设置', component: defineAsyncComponent(() => import('./AiSettingsView.vue')) },
  { name: 'skills', label: '技能工作室', component: defineAsyncComponent(() => import('./SkillStudioView.vue')) },
  { name: 'sub-agents', label: '子智能体工作室', component: defineAsyncComponent(() => import('./SubAgentStudioView.vue')) },
  { name: 'dify', label: 'Dify 工作流工作室', component: defineAsyncComponent(() => import('./strategy/DifyWorkflowStudioView.vue')) },
  { name: 'orchestration', label: '高级智能体编排', component: defineAsyncComponent(() => import('./AgentOrchestrationStudioView.vue')) },
  { name: 'schedules', label: '定时任务调度', component: defineAsyncComponent(() => import('./ScheduleManagementView.vue')) },
] as const

const TAB_NAMES = TABS.map((t) => t.name) as readonly string[]
const DEFAULT_TAB = TABS[0].name

const route = useRoute()
const router = useRouter()

function normalizeTab(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && TAB_NAMES.includes(value) ? value : DEFAULT_TAB
}

const activeTab = ref(normalizeTab(route.query.tab))

// 外部改 query（旧路由 redirect、浏览器前进后退）时跟随；非法 tab 落默认值。
watch(
  () => route.query.tab,
  (raw) => {
    const next = normalizeTab(raw)
    if (next !== activeTab.value) activeTab.value = next
  },
)

// 用 replace 而非 push：tab 切换是页内视图切换，不该在浏览器历史里堆一串条目。
function onTabChange(name: string | number) {
  const tab = String(name)
  if (normalizeTab(route.query.tab) === tab) return
  void router.replace({ query: { ...route.query, tab } })
}
</script>

<template>
  <div class="ai-studio">
    <header class="page-head">
      <h1>AI 工作室</h1>
      <p class="sub">技能、子智能体、工作流编排与定时任务的统一配置入口（仅系统管理员可见）。</p>
    </header>

    <el-tabs v-model="activeTab" class="studio-tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="tab in TABS" :key="tab.name" :label="tab.label" :name="tab.name">
        <!-- KeepAlive + v-if 而非 el-tab-pane 的 lazy：lazy 只延迟首次渲染，已渲染的面板会一直
             挂着，切走后子组件既不 onBeforeUnmount 也不 onDeactivated，定时任务调度的 4s 轮询
             会在其它 tab 下继续打接口（#1737 后台轮询问题）。改成只渲染当前 tab、由 KeepAlive
             缓存已访问的：切走触发 onDeactivated（该组件正是按这个语义写的清理），
             切回仍保留画布/表单/iframe 状态。 -->
        <KeepAlive>
          <component :is="tab.component" v-if="activeTab === tab.name" />
        </KeepAlive>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.ai-studio {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-head h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-head .sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* 子 View 自带 section/card 外距，tab 面板不再叠加内边距，避免双重留白。 */
.studio-tabs :deep(.el-tab-pane) {
  padding: 0;
}
</style>
