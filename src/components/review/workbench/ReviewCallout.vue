<script setup lang="ts">
// 复盘分析面板共用的说明框：口径说明、资料缺口、模拟数据提示不再和正文混成同色小字。
// note = 中性口径说明；warn = 需要交易员留意的限制；mock = 模拟数据（固定带标题，不能省）。
withDefaults(defineProps<{ tone?: 'note' | 'warn' | 'mock'; title?: string }>(), { tone: 'note', title: '' })
</script>

<template>
  <div class="review-callout" :class="tone" :role="tone === 'note' ? 'note' : 'status'">
    <b v-if="tone === 'mock' || title" class="title">{{ tone === 'mock' ? title || '模拟数据' : title }}</b>
    <div class="body"><slot /></div>
  </div>
</template>

<style scoped>
.review-callout {
  display: grid; gap: 2px; padding: 10px 12px; border-radius: 6px;
  background: var(--panel-sub); border: 1px solid var(--line-soft); border-left: 3px solid var(--line);
  font-size: var(--font-sm); line-height: 1.7; color: var(--text);
}
.review-callout.warn, .review-callout.mock { background: var(--warning-tint); border-left-color: var(--warning); }
.title { font-size: var(--font-sm); font-weight: 600; }
.warn .title, .mock .title { color: var(--warning); }
.body :deep(p) { margin: 0; color: inherit; }
</style>
