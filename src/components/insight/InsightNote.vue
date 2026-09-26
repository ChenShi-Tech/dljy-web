<script setup lang="ts">
/** 次要口径按需展开；错误、缺测和授权状态仍由所在区块直接展示。 */
withDefaults(defineProps<{ label?: string; text?: string }>(), { label: '统计口径', text: '' })
</script>

<template>
  <details class="insight-note">
    <summary>{{ label }}</summary>
    <div class="insight-note__body"><slot>{{ text }}</slot></div>
  </details>
</template>

<style scoped>
.insight-note { color: var(--muted, #64748b); font-size: var(--font-xs); line-height: 1.7; }
.insight-note summary { cursor: pointer; width: fit-content; padding: 3px 0; }
.insight-note summary:hover { color: var(--text); }
.insight-note summary:focus-visible { outline: 2px solid var(--accent, #18a999); outline-offset: 4px; border-radius: 3px; }
.insight-note__body { padding: 8px 12px; margin-top: 4px; border-left: 2px solid var(--line, #e2e8f0); max-width: 80ch; }
</style>
