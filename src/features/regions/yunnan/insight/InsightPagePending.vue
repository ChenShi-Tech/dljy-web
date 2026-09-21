<script setup lang="ts">
// 市场洞察「正在建设」占位页（云南，dljy#2995 阶段 A）
// 六页均未交付（delivered:false）时由宿主渲染本组件。纯静态说明：
// 不发任何数据请求、不渲染任何图表，也绝不借用山西/他省数据填充。
// 「原有入口」链接来自 insightLegacyLinks 登记表（旧路径 → 本页的迁移映射），
// 用户点链接回到现有入口继续工作。

import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { insightPageIdFromPath } from '@/services/region/insightWorkspace'
import { legacyPathsForInsightPage } from '@/services/region/insightLegacyLinks'
import { navigation } from '@/data/navigation'

const route = useRoute()

const pageTitle = computed(() => {
  const pageId = insightPageIdFromPath(route.path)
  if (!pageId) return ''
  const insightGroup = navigation.find((item) => item.path === '/insight')
  return insightGroup?.children?.find((child) => child.path === `/insight/${pageId}`)?.title ?? ''
})

// 本页对应的旧入口（含旧入口在现有导航里的标题）；没有登记旧入口的页（如跨省与电网边界）显示为空
const legacyEntries = computed(() => {
  const pageId = insightPageIdFromPath(route.path)
  if (!pageId) return []
  const paths = legacyPathsForInsightPage(pageId)
  const titled = paths
    .map((path) => {
      for (const group of navigation) {
        const hit = group.children?.find((child) => child.path === path)
        if (hit) return { path, title: hit.title }
      }
      return { path, title: path }
    })
  return titled
})
</script>

<template>
  <div class="insight-page-pending">
    <el-empty :description="`${pageTitle ? pageTitle + '：' : ''}该页面正在建设，当前请使用原有入口`">
      <div v-if="legacyEntries.length" class="legacy-links">
        <span class="legacy-links__label">原有入口：</span>
        <router-link v-for="entry in legacyEntries" :key="entry.path" :to="entry.path" class="legacy-links__item">
          {{ entry.title }}
        </router-link>
      </div>
    </el-empty>
  </div>
</template>

<style scoped>
.insight-page-pending {
  display: flex;
  justify-content: center;
  padding: 48px 16px;
}

.legacy-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: center;
}

.legacy-links__label {
  color: var(--el-text-color-secondary);
}

.legacy-links__item {
  color: var(--el-color-primary);
}
</style>
