<script setup lang="ts">
// 市场叙事卡（insight · Neon）：渲染 LLM 三段式市场解读（态势/归因/建议）。
// LLM 经 ```dljy-ui 围栏产出 segments 或 narrative 文本；前端只排版、不计算。
import { computed } from 'vue'
import { arr, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

type Seg = { heading: string; body: string }
const DEFAULT_HEADINGS = ['市场态势', '驱动归因', '操作建议']

const segments = computed<Seg[]>(() => {
  const segs = arr(props.data.segments)
  if (segs.length) {
    return segs.map((s, i) => {
      const o = obj(s)
      return { heading: str(o.heading, DEFAULT_HEADINGS[i] ?? `要点 ${i + 1}`), body: str(o.body ?? o.text) }
    })
  }
  const text = str(props.data.narrative ?? props.data.text ?? props.data.content)
  if (!text) return []
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p, i) => ({ heading: DEFAULT_HEADINGS[i] ?? '', body: p }))
})
</script>

<template>
  <section class="mic-narr">
    <header><h3>{{ title || '市场叙事' }}</h3><span class="sub">AI 解读</span></header>
    <div v-if="segments.length" class="segs">
      <div v-for="(s, i) in segments" :key="i" class="seg">
        <div v-if="s.heading" class="seg-h"><span class="idx">{{ i + 1 }}</span>{{ s.heading }}</div>
        <p class="seg-b">{{ s.body }}</p>
      </div>
    </div>
    <p v-else class="empty">点击各卡片右上「✨ AI 解读」生成市场研判</p>
  </section>
</template>

<style scoped>
.mic-narr { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 12px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
h3 { margin: 0; font-size: 15.5px; color: var(--text, #111827); }
.sub { font-size: 11.5px; color: var(--muted, #667085); }
.segs { display: flex; flex-direction: column; gap: 12px; }
.seg-h { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--primary, #0f766e); margin-bottom: 4px; }
.idx { width: 17px; height: 17px; border-radius: 50%; background: var(--primary-tint, rgba(34, 211, 238, .16)); color: var(--primary, #0891b2); font-size: 11px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.seg-b { margin: 0; font-size: 13px; color: var(--text-body, #344054); line-height: 1.65; white-space: pre-wrap; }
.empty { margin: 0; color: var(--muted, #98a2b3); font-size: 13px; }
</style>
