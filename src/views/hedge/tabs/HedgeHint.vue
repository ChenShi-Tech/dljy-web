<script setup lang="ts">
import { ref } from 'vue'
const position = ref({ left: '12px', top: '12px' })
function place(event: Event) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  position.value = { left: `${Math.max(12, Math.min(rect.right - 320, window.innerWidth - 332))}px`, top: `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 260))}px` }
}
defineProps<{ text?: string | null; label?: string }>()
</script>
<template>
  <span v-if="text" class="hedge-hint" tabindex="0" :aria-label="text" @mouseenter="place" @focus="place">
    <span aria-hidden="true">{{ label ?? 'ⓘ' }}</span>
    <span class="hint-popup" role="tooltip" :style="position">{{ text }}</span>
  </span>
</template>
<style scoped>
.hedge-hint { position: relative; display: inline-flex; align-items: center; margin-left: 5px; color: var(--muted); cursor: help; font-size: var(--font-xs); vertical-align: super; font-weight: 400; }
.hint-popup { display: none; position: fixed; z-index: 1000; width: min(320px, 75vw); padding: 12px; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 4px 16px #0002; font-size: var(--font-sm); line-height: 1.6; white-space: pre-line; max-height: 240px; overflow-y: auto; text-align: left; }
.hedge-hint:hover .hint-popup, .hedge-hint:focus .hint-popup { display: block; }
.hedge-hint:focus-visible { outline: 2px solid var(--primary); }
</style>
