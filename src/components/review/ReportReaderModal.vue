<script setup lang="ts">
// 复盘报告阅读弹层（#2038，从 ReviewCenterView 抽出）：Markdown 已在父组件渲染为 HTML。
import { X } from 'lucide-vue-next'

defineProps<{ report: { title: string; html: string } | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div v-if="report" class="overlay" @click.self="emit('close')">
    <div class="modal panel" role="dialog" aria-modal="true" :aria-label="report.title">
      <header>
        <b>{{ report.title }}</b>
        <button type="button" class="close" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
      </header>
      <div class="body md" v-html="report.html" />
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 50; background: var(--mask-bg); display: grid; place-items: center; }
.modal { width: min(760px, 92vw); max-height: 84vh; display: flex; flex-direction: column; overflow: hidden; }
.modal header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.close { border: none; background: transparent; cursor: pointer; color: var(--muted); display: grid; place-items: center; }
.close:hover { color: var(--text); }
.body { padding: 14px 18px; overflow-y: auto; font-size: var(--font-13-5); line-height: 1.8; }
.md :deep(table) { border-collapse: collapse; font-size: var(--font-12-5); }
.md :deep(th), .md :deep(td) { border: 1px solid var(--line); padding: 3px 8px; }
.md :deep(pre) { background: var(--panel-sub); color: var(--text); padding: 10px; border-radius: var(--radius-sm); overflow-x: auto; border: 1px solid var(--line-soft); }
</style>
