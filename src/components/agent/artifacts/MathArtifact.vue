<script setup lang="ts">
// 公式 artifact：KaTeX 渲染。支持多公式——按 \[ \] \( \) $$ $ 分隔符逐段渲染，
// 容忍 agent 输出的杂乱/多段分隔符；throwOnError:false 时非法片段以红色提示而不整体崩。
import { computed } from 'vue'
import 'katex/dist/katex.min.css'
import katex from 'katex'
import type { MathArtifactBlock } from '../../../utils/artifactBlocks'

const props = defineProps<{ block: MathArtifactBlock }>()

const htmls = computed(() => {
  const parts = props.block.code
    .split(/\$\$|\\\[|\\\]|\\\(|\\\)/)
    .map((s) => s.trim())
    .filter(Boolean)
  const segs = parts.length ? parts : [props.block.code]
  return segs
    .map((s) => {
      try {
        return katex.renderToString(s, { displayMode: true, throwOnError: false, output: 'html' })
      } catch {
        return ''
      }
    })
    .filter(Boolean)
})
</script>

<template>
  <div class="math-artifact">
    <div v-for="(h, i) in htmls" :key="i" class="math-line" v-html="h" />
  </div>
</template>

<style scoped>
.math-artifact {
  margin: 8px 0;
  padding: 12px 10px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid rgba(125, 125, 125, 0.18);
  border-radius: 8px;
  background: var(--panel-bg, #fff);
}
.math-line { text-align: center; margin: 6px 0; }
.math-line:first-child { margin-top: 0; }
.math-line:last-child { margin-bottom: 0; }
</style>
