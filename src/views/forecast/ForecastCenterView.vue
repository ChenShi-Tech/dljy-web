<script setup lang="ts">
// 预测中心（#79）：预测数据分组 5 页聚合为单页一级 tab，按工作流排序
// 官方回放 → 建模工作台 → 厂站预测 → 质量记分牌 → 申报决策。
// 设计约束：五个原视图组件原样挂入（懒挂载，hub 同款 visited 模式），内部逻辑零改动；
// 页内不设任何跨页跳转入口，跨模块导航是侧边栏职责。
// 一级 tab 用 ?mod= 深链；原 hub 内部 ?tab= 语义保留（chained redirect 透传），互不冲突。
// 权限：tab 按 canAccessPath(原路由) 过滤，不扩大任何角色可见面；地区能力由各组件自管。
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 异步加载保住原按路由分包：静态 import 会把五个模块的全部依赖并进
// center 首包；懒挂载只延后请求不延后 JS 下载解析。
const ForecastHubView = defineAsyncComponent(() => import('./ForecastHubView.vue'))
const ForecastWorkbenchView = defineAsyncComponent(() => import('./ForecastWorkbenchView.vue'))
const StationGenerationView = defineAsyncComponent(() => import('./StationGenerationView.vue'))
const ForecastScoreboardView = defineAsyncComponent(() => import('./ForecastScoreboardView.vue'))
const ForecastDecisionCockpitView = defineAsyncComponent(() => import('./ForecastDecisionCockpitView.vue'))
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'

const MODULES = [
  { key: 'replay', title: '官方回放', sourceRoute: '/ycsj/hub', component: ForecastHubView },
  { key: 'bench', title: '建模工作台', sourceRoute: '/ycsj/workbench', component: ForecastWorkbenchView },
  { key: 'station', title: '厂站预测', sourceRoute: '/ycsj/station-generation', component: StationGenerationView },
  { key: 'score', title: '质量记分牌', sourceRoute: '/ycsj/scoreboard', component: ForecastScoreboardView },
  { key: 'decide', title: '申报决策', sourceRoute: '/ycsj/decision-cockpit', component: ForecastDecisionCockpitView },
] as const

const route = useRoute()
const router = useRouter()
const user = getCurrentUser()
const modules = computed(() => MODULES.filter((m) => canAccessPath(m.sourceRoute, user)))

function resolveInitialModule(): string {
  const q = route.query.mod
  const hit = typeof q === 'string' ? modules.value.find((m) => m.key === q) : undefined
  return hit ? hit.key : (modules.value[0]?.key ?? '')
}

const active = ref(resolveInitialModule())
const visited = ref(new Set<string>(active.value ? [active.value] : []))

function onModChange(key: string | number) {
  const k = String(key)
  visited.value.add(k)
  // 同步 ?mod= 便于收藏/分享当前 tab；保留 hub 等子模块的其余 query（如 ?tab=）。
  void router.replace({ query: { ...route.query, mod: k } })
}

// redirect 携带 ?mod= 进入（或页内深链变化）时对齐激活 tab。
watch(() => route.query.mod, (q) => {
  if (typeof q !== 'string') return
  const hit = modules.value.find((m) => m.key === q)
  if (hit && hit.key !== active.value) {
    active.value = hit.key
    visited.value.add(hit.key)
  }
})
</script>

<template>
  <div class="forecast-center">
    <el-empty v-if="!modules.length" description="当前角色没有可见的预测模块" />
    <el-tabs v-else v-model="active" class="center-tabs" @tab-change="onModChange">
      <el-tab-pane v-for="m in modules" :key="m.key" :label="m.title" :name="m.key">
        <component :is="m.component" v-if="visited.has(m.key) || active === m.key" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.forecast-center { padding: 4px 8px 0; }
.center-tabs :deep(> .el-tabs__header) { margin-bottom: 6px; padding: 0 12px; }
.center-tabs :deep(> .el-tabs__header .el-tabs__item) { font-size: 14px; }
.center-tabs :deep(.el-tabs__content) { overflow: visible; }
</style>

