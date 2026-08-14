<script setup lang="ts">
// 引用来源 artifact：编号列表 + 标题(可点链接) + 来源·日期 + 摘录。
// 契合数据采集员/合规专员的披露来源标注。
import { Quote, ExternalLink } from 'lucide-vue-next'
import type { CiteArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

defineProps<{ block: CiteArtifactBlock }>()
</script>

<template>
  <ArtifactFrame kind="cite" title="引用来源" :badge="`${block.sources.length}`">
    <template #icon><Quote :size="14" /></template>
    <ol class="cite-list">
      <li v-for="(s, i) in block.sources" :key="i" class="cite-item">
        <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="cite-title">
          {{ s.title }}<ExternalLink :size="11" />
        </a>
        <span v-else class="cite-title plain">{{ s.title }}</span>
        <div v-if="s.source || s.date" class="cite-meta">
          <span v-if="s.source">{{ s.source }}</span><span v-if="s.date"> · {{ s.date }}</span>
        </div>
        <div v-if="s.snippet" class="cite-snippet">{{ s.snippet }}</div>
      </li>
    </ol>
  </ArtifactFrame>
</template>

<style scoped>
.cite-list { margin: 0; padding: 8px 12px 8px 32px; }
.cite-item { margin: 7px 0; font-size: 13px; }
.cite-title {
  font-weight: 600; color: var(--el-color-primary, #2563eb); text-decoration: none;
  display: inline-flex; align-items: center; gap: 3px;
}
.cite-title.plain { color: inherit; }
.cite-title:not(.plain):hover { text-decoration: underline; }
.cite-meta { font-size: 11.5px; opacity: 0.6; margin-top: 1px; }
.cite-snippet {
  font-size: 12px; opacity: 0.8; margin-top: 3px; padding-left: 8px;
  border-left: 2px solid rgba(125, 125, 125, 0.25);
}
</style>
