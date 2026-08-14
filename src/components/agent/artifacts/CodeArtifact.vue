<script setup lang="ts">
// 代码 artifact：语言徽标 + 行号 + 高亮 + 一键复制 + 长代码折叠。
import { computed, ref } from 'vue'
import { Code2, Copy, Check, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { CodeArtifactBlock } from '../../../utils/artifactBlocks'
import ArtifactFrame from './ArtifactFrame.vue'

const props = defineProps<{ block: CodeArtifactBlock }>()

const COLLAPSE_AT = 18
const collapsed = ref(props.block.lines > COLLAPSE_AT)
const copied = ref(false)

const title = computed(() => props.block.label || props.block.lang || '代码')
const badge = computed(() => props.block.lang || undefined)
const lineNos = computed(() => Array.from({ length: props.block.lines }, (_, i) => i + 1))

async function copy() {
  try {
    await navigator.clipboard.writeText(props.block.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用（非安全上下文）时静默 */
  }
}
</script>

<template>
  <ArtifactFrame kind="code" :title="title" :badge="badge">
    <template #icon><Code2 :size="14" /></template>
    <template #actions>
      <button class="art-btn" :class="{ ok: copied }" @click="copy">
        <component :is="copied ? Check : Copy" :size="12" />{{ copied ? '已复制' : '复制' }}
      </button>
      <button v-if="block.lines > COLLAPSE_AT" class="art-btn" @click="collapsed = !collapsed">
        <component :is="collapsed ? ChevronDown : ChevronUp" :size="12" />
        {{ collapsed ? `展开 ${block.lines} 行` : '收起' }}
      </button>
    </template>

    <div class="code-wrap" :class="{ collapsed }">
      <div class="code-scroll">
        <pre class="gutter"><span v-for="n in lineNos" :key="n">{{ n }}</span></pre>
        <pre class="code"><code v-html="block.html" /></pre>
      </div>
      <div v-if="collapsed" class="fade" />
    </div>
  </ArtifactFrame>
</template>

<style scoped>
.code-wrap { position: relative; }
.code-wrap.collapsed .code-scroll { max-height: 320px; overflow: hidden; }
.code-scroll {
  display: flex;
  overflow-x: auto;
  background: rgba(20, 24, 34, 0.96);
  font-size: 12.5px;
  line-height: 1.55;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.gutter {
  margin: 0; padding: 10px 8px 10px 12px;
  display: flex; flex-direction: column;
  text-align: right; user-select: none;
  color: rgba(229, 231, 235, 0.3);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.code {
  margin: 0; padding: 10px 14px;
  color: #e5e7eb; flex: 1;
  white-space: pre; tab-size: 2;
}
.code :deep(code) { background: none; padding: 0; font-family: inherit; }
.fade {
  position: absolute; left: 0; right: 0; bottom: 0; height: 52px;
  pointer-events: none;
  background: linear-gradient(transparent, rgba(20, 24, 34, 0.96));
}
</style>
