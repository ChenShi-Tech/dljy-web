<script setup lang="ts">
// AI 工作室（/system/ai-studio）：把原先散在系统管理菜单里的 AI 编排/配置页收敛为单页 tab。
// 原「AI工作流中枢」（/xhjy/ai-orchestration-studio）是这几页的导航壳，tab 化后失去职责，随本页上线删除。
//
// 各 tab 内容仍是原 View 组件（零改造复用，只摘掉与 tab 标签重复的 h2 标题行）：
//   AI 模型设置                → LLM 凭据/采样/路由/工具能力/用量，页内再按职责分 4 段
//   技能工作室 / 子智能体工作室 → agent-backend /agent-api/agent/{skills,sub-agents}/*
//   Dify 工作流工作室          → 同源嵌入 Dify 原生 Studio（/dify-sso + /dify-studio/*）
//   定时任务调度               → /agent-api/agent/schedules
// 「高级智能体编排」（LangGraph 画布）tab 已随主仓 #2582 删后端 /agent-api/agent/graphs* 下线（#2540）。
// 子组件走 defineAsyncComponent + el-tab-pane lazy：进页只加载当前 tab 的 chunk，
// 不把 2000+ 行四个页面打进同一个首屏包（原本每页各自路由级懒加载，合并不得劣化）。
//
// tab 状态同步到 ?tab= query：旧路由 redirect 落到对应 tab、刷新与深链保持位置。
//
// 已迁至平台后台（ChenShi-Tech/dljy#3464）：内部版 AI 设施整组由平台后台接管，登记在
// features/platformAdminMigration/registry.ts。被迁走的 tab 不渲染，tab 栏上方原位置显示提示与后台链接；
// 「AI 模型设置」里的个人自助内容（长期记忆、语音播报）单独成「个人设置」tab 保留。
// 客户交付版不受影响（登记表客户版恒答未迁移，tab 与原来完全一致）。
import { defineAsyncComponent, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IS_CUSTOMER_EDITION, IS_INTERNAL_EDITION } from '@/services/edition'
import { hiddenEntriesOf, isTabHidden } from '@/features/platformAdminMigration/registry'
import MigratedToAdminNotice from '@/features/platformAdminMigration/MigratedToAdminNotice.vue'

// 「模型接入」tab 按档分流（#2410 → #2668）：内部档是完整的「AI 模型设置」页（联网搜索密钥、
// 我方管理令牌、采样参数、工作流参数……）；交付档只有「模型服务」面（档位启用 + 角色路由），
// 它不含任何供应商 / 型号 / 密钥信息，所以可以进交付产物。
// 用编译期常量做条件而非运行期 v-if——后者只是把界面藏起来，完整设置页照样在交付出去的 JS 里，
// devtools 搜一下就有。编译期常量 + vite.config 里的模块解析层重定向让那个页面根本不进模块图。
const MODEL_SETTINGS_TAB = IS_CUSTOMER_EDITION
  ? [{ name: 'models', label: '模型服务', component: defineAsyncComponent(() => import('@/components/ai/ModelServicesPanel.vue')) }]
  : [{ name: 'models', label: 'AI 模型设置', component: defineAsyncComponent(() => import('./AiSettingsView.vue')) }]

type StudioTab = { name: string; label: string; component: Component }

const STUDIO_TABS: StudioTab[] = [
  ...MODEL_SETTINGS_TAB,
  { name: 'skills', label: '技能工作室', component: defineAsyncComponent(() => import('./SkillStudioView.vue')) },
  { name: 'sub-agents', label: '子智能体工作室', component: defineAsyncComponent(() => import('./SubAgentStudioView.vue')) },
  { name: 'dify', label: 'Dify 工作流工作室', component: defineAsyncComponent(() => import('./strategy/DifyWorkflowStudioView.vue')) },
  { name: 'schedules', label: '定时任务调度', component: defineAsyncComponent(() => import('./ScheduleManagementView.vue')) },
]

// 「AI 模型设置」整 tab 迁走时，个人自助部分单独成 tab 并排第一（成为默认 tab）。
// 先过编译期常量 IS_INTERNAL_EDITION：交付档里整条分支被折叠掉，连 tab 标签都不进产物。
const PERSONAL_TAB: StudioTab[] = IS_INTERNAL_EDITION && isTabHidden('ai-studio', 'models')
  ? [{ name: 'personal', label: '个人设置', component: defineAsyncComponent(() => import('@/components/ai/PersonalAiSettingsPanel.vue')) }]
  : []

const TABS: StudioTab[] = [...PERSONAL_TAB, ...STUDIO_TABS.filter((t) => !isTabHidden('ai-studio', t.name))]
const MIGRATED_ENTRIES = hiddenEntriesOf('ai-studio')
const PAGE_SUB = MIGRATED_ENTRIES.length
  ? '个人 AI 设置：长期记忆与语音播报（仅系统管理员可见）。'
  : '技能、子智能体、工作流编排与定时任务的统一配置入口（仅系统管理员可见）。'

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
      <p class="sub">{{ PAGE_SUB }}</p>
    </header>

    <!-- 已迁至平台后台的 tab 不渲染，原位置（tab 栏上方）给出提示与后台链接（#3464） -->
    <MigratedToAdminNotice v-if="MIGRATED_ENTRIES.length" :entries="MIGRATED_ENTRIES" />

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
  font-size: var(--font-20);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-head .sub {
  margin: 4px 0 0;
  font-size: var(--font-md);
  color: var(--el-text-color-secondary);
}

/* 子 View 自带 section/card 外距，tab 面板不再叠加内边距，避免双重留白。 */
.studio-tabs :deep(.el-tab-pane) {
  padding: 0;
}
</style>
