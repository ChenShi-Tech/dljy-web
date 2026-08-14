<script setup lang="ts">
// 流程/时序/甘特图 artifact：mermaid 动态 import 懒加载渲染(不进主包，守性能预算)。
// securityLevel:'strict' 防注入；渲染竞态用自增 id 守护(取最后一次)。
import { ref, watch, onMounted } from 'vue'
import { GitBranch, Copy, Check } from 'lucide-vue-next'
import type { MermaidArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: MermaidArtifactBlock }>()
const svg = ref('')
const error = ref('')
const copied = ref(false)
let seq = 0

async function render() {
  const myId = ++seq
  error.value = ''
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
    const { svg: out } = await mermaid.render(`mmd-${Date.now()}-${myId}`, props.block.code)
    if (myId === seq) svg.value = out
  } catch (e) {
    if (myId === seq) {
      svg.value = ''
      error.value = e instanceof Error ? e.message : '流程图渲染失败'
    }
  }
}

onMounted(render)
watch(() => props.block.code, render)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.block.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 静默 */
  }
}
</script>

<template>
  <ArtifactFrame kind="mermaid" :title="block.title || '流程图'" badge="Mermaid">
    <template #icon><GitBranch :size="14" /></template>
    <template #actions>
      <button class="art-btn" :class="{ ok: copied }" @click="copy">
        <component :is="copied ? Check : Copy" :size="12" />{{ copied ? '已复制' : '源码' }}
      </button>
    </template>
    <div class="mermaid-host">
      <div v-if="error" class="mmd-error">⚠ {{ error }}</div>
      <div v-else-if="svg" class="mmd-svg" v-html="svg" />
      <div v-else class="mmd-loading">渲染中…</div>
    </div>
  </ArtifactFrame>
</template>

<style scoped>
.mermaid-host { padding: 12px; overflow-x: auto; text-align: center; }
.mmd-svg :deep(svg) { max-width: 100%; height: auto; }
.mmd-error { color: #dc2626; font-size: 12.5px; text-align: left; white-space: pre-wrap; }
.mmd-loading { font-size: 12.5px; opacity: 0.5; }
</style>
