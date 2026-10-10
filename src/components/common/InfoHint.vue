<script setup lang="ts">
// 通用 ⓘ 悬浮（HedgeHint 同款模式上提公共层：口径/来源/限制说明的渐进披露，
// 悬停与键盘 focus 可达）。纯呈现组件，不承载任何诚实标注的可见性语义——
// 阻断性警示与 Mock 标识不得收纳进本组件。
import { ref } from 'vue'
const position = ref({ left: '12px', top: '12px' })
function place(event: Event) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  position.value = { left: `${Math.max(12, Math.min(rect.right - 320, window.innerWidth - 332))}px`, top: `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 260))}px` }
}
defineProps<{ text?: string | null; label?: string }>()
</script>
<template>
  <span v-if="text" class="info-hint" tabindex="0" :aria-label="text" @mouseenter="place" @focus="place">
    <span aria-hidden="true">{{ label ?? 'ⓘ' }}</span>
    <span class="hint-popup" role="tooltip" :style="position">{{ text }}</span>
  </span>
</template>
<style scoped>
.info-hint { position: relative; display: inline-flex; align-items: center; margin-left: 5px; color: var(--muted); cursor: help; font-size: var(--font-xs); font-weight: 400; }
.hint-popup { display: none; position: fixed; z-index: 1000; width: min(320px, 75vw); padding: 12px; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 4px 16px #0002; font-size: var(--font-sm); line-height: 1.6; white-space: pre-line; max-height: 240px; overflow-y: auto; text-align: left; }
.info-hint:hover .hint-popup, .info-hint:focus .hint-popup { display: block; }
.info-hint:focus-visible { outline: 2px solid var(--primary); }
</style>
