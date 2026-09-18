<script setup lang="ts">
// 市场洞察地区工作区宿主（dljy#2995 阶段 A）
// ----------------------------------------------------------------------------
// 六条规范路由 /insight/<pageId> 的统一宿主：按「当前全局地区 + 页 id」经
// insightWorkspace 注册表解析，四种结果：
// - page                  → 动态加载地区组件渲染（key=region:pageId，切地区销毁旧实例，
//                            避免复用旧省组件造成跨地区状态残留）；
// - fallback(page-not-delivered) → 原地渲染该页 load 指向的占位组件（不发数据请求）；
// - fallback(page-not-supported) → replace 到该地区默认入口，带一次性 query
//                            insightNotice=page-not-supported，默认页顶部提示后清掉；
// - not-registered        → 未开通说明卡（纯静态，不发任何请求，绝不借用他省数据）。
//
// 页 id 从 route.path 解析（不依赖 meta 传递），路由表是唯一事实源。

import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { currentRegion } from '@/services/region/regionContext'
import { insightPageIdFromPath, resolveInsightPage } from '@/services/region/insightWorkspace'

const route = useRoute()
const router = useRouter()

// 换页跳默认入口时保留的公共 query（业务日期）；其余参数对新页面无意义，不透传
const SWITCH_QUERY_WHITELIST = ['date', 'start', 'end']

const pageId = computed(() => insightPageIdFromPath(route.path))
const resolution = computed(() => (pageId.value ? resolveInsightPage(currentRegion.value.id, pageId.value) : null))

// page 与 page-not-delivered 都渲染 load 指向的组件（后者 load 指向占位组件）
const regionPageComponent = computed(() => {
  const current = resolution.value
  if (!current) return null
  if (current.kind === 'page') return defineAsyncComponent(current.page.load)
  if (current.kind === 'fallback' && current.reason === 'page-not-delivered' && current.page) {
    return defineAsyncComponent(current.page.load)
  }
  return null
})

// 切地区销毁旧省实例：descriptor 引用稳定，故仅地区/页变化时这里才会变
const componentKey = computed(() => `${currentRegion.value.id}:${pageId.value ?? ''}`)

// 该地区不支持此页 → 回默认入口；防御：默认入口也不支持（病态登记）时不跳，避免死循环
watch(
  () => resolution.value,
  (current) => {
    if (current?.kind === 'fallback' && current.reason === 'page-not-supported' && current.to !== route.path) {
      const query: LocationQuery = {}
      for (const key of SWITCH_QUERY_WHITELIST) {
        if (key in route.query) query[key] = route.query[key]
      }
      query.insightNotice = 'page-not-supported'
      router.replace({ path: current.to, query })
    }
  },
  { immediate: true }
)

// 一次性切换提示：到达默认入口后显示，随后把 query 清掉（刷新/分享链接不重复弹）
const switchNotice = ref<string | null>(null)

watch(
  () => route.query.insightNotice,
  (value) => {
    if (value === 'page-not-supported') {
      switchNotice.value = `所选页面在${currentRegion.value.name}不适用，已回到市场洞察默认入口`
      const nextQuery = { ...route.query }
      delete nextQuery.insightNotice
      router.replace({ query: nextQuery })
    }
  },
  { immediate: true }
)

// 切地区后旧提示即失效，收掉避免文案与当前地区不符
watch(
  () => currentRegion.value.id,
  () => {
    switchNotice.value = null
  }
)
</script>

<template>
  <div class="insight-workspace-host">
    <el-alert
      v-if="switchNotice"
      class="insight-workspace-host__notice"
      type="info"
      :title="switchNotice"
      show-icon
      @close="switchNotice = null"
    />
    <component :is="regionPageComponent" v-if="regionPageComponent" :key="componentKey" />
    <div v-else-if="resolution?.kind === 'not-registered'" class="insight-workspace-host__empty">
      <el-empty description="该地区暂未开通市场洞察工作区" />
      <p class="insight-workspace-host__empty-note">
        当前地区尚未登记市场洞察工作区；可继续使用左侧导航中的市场洞察入口，或切换到已开通的地区。
      </p>
    </div>
  </div>
</template>

<style scoped>
.insight-workspace-host {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
}

.insight-workspace-host__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 16px;
}

.insight-workspace-host__empty-note {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--font-sm);
}
</style>
