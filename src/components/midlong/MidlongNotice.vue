<script setup lang="ts">
// 中长期售电页面的说明框（dljy#2939）：口径说明、测试数据提示、资料缺口提示统一放进浅底色条框，
// 不与正文混在同色小字里。info=中性口径 / warn=需要注意 / danger=会阻止操作或数据不可用。
import { AlertTriangle, Info, OctagonAlert } from 'lucide-vue-next'

withDefaults(defineProps<{ tone?: 'info' | 'warn' | 'danger'; title?: string }>(), { tone: 'info', title: '' })
</script>

<template>
  <div class="ml-notice" :class="tone" role="note">
    <component :is="tone === 'danger' ? OctagonAlert : tone === 'warn' ? AlertTriangle : Info" :size="16" class="ml-notice-icon" />
    <div class="ml-notice-main">
      <div v-if="title" class="ml-notice-title">{{ title }}</div>
      <div class="ml-notice-body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.ml-notice {
  display: flex; gap: 9px; padding: 10px 12px; border-radius: 8px; border: 1px solid; border-left-width: 3px;
  font-size: var(--font-md); line-height: 1.6; color: var(--text-body);
}
.ml-notice-icon { flex: none; margin-top: 3px; }
.ml-notice-main { min-width: 0; }
.ml-notice-title { font-weight: 600; margin-bottom: 2px; color: var(--text); }
.ml-notice.info { border-color: color-mix(in srgb, var(--accent) 35%, transparent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.ml-notice.info .ml-notice-icon { color: var(--accent); }
.ml-notice.warn { border-color: color-mix(in srgb, var(--warning) 45%, transparent); background: color-mix(in srgb, var(--warning) 9%, transparent); }
.ml-notice.warn .ml-notice-icon { color: var(--warning); }
.ml-notice.danger { border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.ml-notice.danger .ml-notice-icon { color: var(--danger); }
</style>
