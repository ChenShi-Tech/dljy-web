<script setup lang="ts">
// JSON 查看器 artifact：折叠树 + 复制原文。适合展示结构化数据/工具原始返回。
import { ref } from 'vue'
import { Braces, Copy, Check } from 'lucide-vue-next'
import type { JsonViewArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'
import JsonTreeNode from './JsonTreeNode.vue'

const props = defineProps<{ block: JsonViewArtifactBlock }>()
const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(props.block.data, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 静默 */
  }
}
</script>

<template>
  <ArtifactFrame kind="jsonview" :title="block.title" badge="JSON">
    <template #icon><Braces :size="14" /></template>
    <template #actions>
      <button class="art-btn" :class="{ ok: copied }" @click="copy">
        <component :is="copied ? Check : Copy" :size="12" />{{ copied ? '已复制' : '复制' }}
      </button>
    </template>
    <div class="json-tree"><JsonTreeNode :value="block.data" :depth="0" /></div>
  </ArtifactFrame>
</template>

<style scoped>
.json-tree {
  padding: 10px 12px; overflow-x: auto; max-height: 420px;
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
  font-size: var(--font-12-5); line-height: 1.55;
}
</style>
