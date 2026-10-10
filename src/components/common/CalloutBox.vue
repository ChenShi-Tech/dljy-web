<script setup lang="ts">
// 公共说明框（#2954）：合并复盘 ReviewCallout 与中长期 MidlongNotice 两套口径——
// info=中性口径说明 / warn=需要交易员留意 / danger=会阻止操作或数据不可用 / mock=模拟数据（固定带标题，不能省）。
// Notion 风格浅底色条框：语义图标 + 左侧色条 + color-mix 淡底，颜色全走主题 token，四档主题自动适配。
import { AlertTriangle, FlaskConical, Info, OctagonAlert } from 'lucide-vue-next'

withDefaults(defineProps<{ tone?: 'info' | 'warn' | 'danger' | 'mock'; title?: string }>(), { tone: 'info', title: '' })

const ICONS = { info: Info, warn: AlertTriangle, danger: OctagonAlert, mock: FlaskConical }
</script>

<template>
  <div class="callout-box" :class="tone" :role="tone === 'info' ? 'note' : 'status'">
    <component :is="ICONS[tone]" :size="16" class="icon" />
    <div class="main">
      <b v-if="tone === 'mock' || title" class="title">{{ tone === 'mock' ? title || '模拟数据' : title }}</b>
      <div class="body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.callout-box {
  display: flex; gap: 9px; padding: 10px 12px; border-radius: 8px; border: 1px solid; border-left-width: 3px;
  font-size: var(--font-md); line-height: 1.7; color: var(--text);
}
.icon { flex: none; margin-top: 3px; }
.main { min-width: 0; }
.title { font-size: var(--font-md); font-weight: 600; margin-bottom: 2px; color: var(--text); }
.body :deep(p) { margin: 0; color: inherit; }
.callout-box.info { border-color: color-mix(in srgb, var(--accent) 35%, transparent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.callout-box.info .icon { color: var(--accent); }
.callout-box.warn, .callout-box.mock { border-color: color-mix(in srgb, var(--warning) 45%, transparent); background: color-mix(in srgb, var(--warning) 9%, transparent); }
.callout-box.warn .icon, .callout-box.mock .icon { color: var(--warning); }
.callout-box.warn .title, .callout-box.mock .title { color: var(--warning); }
.callout-box.danger { border-color: color-mix(in srgb, var(--danger) 45%, transparent); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.callout-box.danger .icon { color: var(--danger); }
</style>
