<script setup lang="ts">
// 面板内「说明」悬浮卡（dljy#3385）：把口径说明、参数细节收进点开才显示的弹层，首屏只留状态与操作。
// 与 PageHelpTip（按路由 name 查注册表、挂在顶栏）互补：内容由调用方经 slot 传入，可挂在工具栏或任意卡片上。
// 传 label 时渲染为「ⓘ 说明」文字按钮，不传则只有图标（卡片角落用）。
import { Info } from 'lucide-vue-next'

withDefaults(defineProps<{ title: string; label?: string; width?: number }>(), { label: '', width: 340 })
</script>

<template>
  <el-popover placement="bottom-end" :width="width" trigger="click" popper-class="info-pop-popper">
    <template #reference>
      <button
        type="button"
        class="info-pop"
        :class="{ labeled: label }"
        :aria-label="`查看「${title}」说明`"
        :title="`查看「${title}」说明`"
      >
        <Info :size="14" />
        <span v-if="label">{{ label }}</span>
      </button>
    </template>

    <div class="info-pop-card">
      <div class="info-pop-title">{{ title }}</div>
      <div class="info-pop-body"><slot /></div>
    </div>
  </el-popover>
</template>

<style scoped>
/* 低存在感：默认灰调，hover/focus 才高亮，不和操作按钮抢视线。 */
.info-pop {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px; flex: none;
  width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 50%;
  background: transparent; color: var(--muted); cursor: pointer; font-size: var(--font-sm);
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.info-pop.labeled { width: auto; padding: 0 8px; border-radius: var(--radius-sm, 6px); border-color: var(--line); }
.info-pop:hover, .info-pop:focus-visible {
  color: var(--primary); border-color: color-mix(in srgb, var(--primary) 40%, transparent);
  background: color-mix(in srgb, var(--primary) 8%, transparent); outline: none;
}

.info-pop-card { display: flex; flex-direction: column; gap: 6px; }
.info-pop-title { font-size: var(--font-md); font-weight: 600; color: var(--text); }
.info-pop-body { font-size: var(--font-sm); line-height: 1.65; color: var(--text-soft); }
.info-pop-body :deep(p) { margin: 0 0 6px; }
.info-pop-body :deep(p:last-child) { margin-bottom: 0; }
.info-pop-body :deep(ul) { margin: 0; padding-left: 16px; }
.info-pop-body :deep(li + li) { margin-top: 4px; }
.info-pop-body :deep(b) { color: var(--text); font-weight: 600; }
.info-pop-body :deep(code) {
  font-family: var(--ck-mono, ui-monospace, monospace); font-size: 0.92em; padding: 1px 4px; border-radius: 3px;
  background: color-mix(in srgb, var(--muted) 14%, transparent); word-break: break-all;
}
</style>
