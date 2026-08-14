<script setup lang="ts">
// Artifact 统一外框：图标 + 标题（+副标题/徽标）+ 右侧操作区 + 内容区。
// 各类 artifact 复用此框，保证对话流里视觉一致。操作按钮统一用 .art-btn class
// （样式由本组件 :deep 提供，slot 内容也在本组件 DOM 子树内，故命中）。
defineProps<{ title: string; subtitle?: string; kind: string; badge?: string }>()
</script>

<template>
  <div class="artifact" :class="`is-${kind}`">
    <div class="artifact-head">
      <span class="art-icon"><slot name="icon" /></span>
      <span class="art-title" :title="title">{{ title }}</span>
      <span v-if="subtitle" class="art-sub">{{ subtitle }}</span>
      <span v-if="badge" class="art-badge">{{ badge }}</span>
      <span class="art-actions"><slot name="actions" /></span>
    </div>
    <div class="artifact-body"><slot /></div>
  </div>
</template>

<style scoped>
.artifact {
  margin: 8px 0;
  border: 1px solid rgba(125, 125, 125, 0.22);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-bg, #fff);
  animation: art-in 0.34s ease-out both;
}
@keyframes art-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}
.artifact-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  background: rgba(125, 125, 125, 0.06);
  border-bottom: 1px solid rgba(125, 125, 125, 0.16);
  font-size: 12.5px;
}
.art-icon { display: inline-flex; opacity: 0.7; flex-shrink: 0; }
.art-title {
  font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.art-sub { opacity: 0.55; font-size: 11.5px; white-space: nowrap; }
.art-badge {
  font-size: 10.5px; padding: 1px 6px; border-radius: 4px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--el-color-primary, #2563eb);
  background: var(--el-color-primary-light-9, rgba(37, 99, 235, 0.1));
}
.art-actions { margin-left: auto; display: inline-flex; gap: 4px; flex-shrink: 0; }
.artifact-body { position: relative; }

/* 操作按钮统一样式（各子组件 slot 内用 .art-btn） */
:deep(.art-btn) {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 7px; font-size: 11.5px; line-height: 1;
  border: 1px solid rgba(125, 125, 125, 0.25); border-radius: 6px;
  background: var(--panel-bg, #fff); color: inherit; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
:deep(.art-btn:hover) { background: rgba(125, 125, 125, 0.1); }
:deep(.art-btn.active) { border-color: var(--el-color-primary, #2563eb); color: var(--el-color-primary, #2563eb); }
:deep(.art-btn.ok) { color: #16a34a; border-color: #16a34a; }
</style>
