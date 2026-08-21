<script setup lang="ts">
// 复盘中心指标格（#2038）：一格 = 名称 + 主数 + 可选单位/状态 pill/副行/ⓘ。
// 口径告诫、来源、限制一律进 ⓘ 悬浮而不落在页面上——页面只留数字与状态。
import { Info } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    label: string
    /** 主数（已格式化）；无数传 '—' */
    value: string
    unit?: string
    /** good=收益/达标 bad=费用/超标 muted=占位 */
    tone?: 'good' | 'bad' | 'muted' | 'default'
    /** 主数旁状态 pill */
    pill?: { text: string; tone: 'ok' | 'warn' | 'off' | 'info' } | null
    /** 副行（HTML 关闭，纯文本） */
    sub?: string
    /** ⓘ 悬浮内容：口径/来源/限制 */
    info?: string
  }>(),
  { unit: '', tone: 'default', pill: null, sub: '', info: '' }
)
</script>

<template>
  <div class="tile panel">
    <span class="k">
      {{ label }}
      <el-tooltip v-if="info" :content="info" placement="top" :show-after="150">
        <span class="ihint" tabindex="0" aria-label="口径说明"><Info :size="12" /></span>
      </el-tooltip>
    </span>
    <span class="v" :class="tone">
      {{ value }}<small v-if="unit && value !== '—'">{{ unit }}</small>
      <i v-if="pill" class="pill" :class="pill.tone">{{ pill.text }}</i>
    </span>
    <span v-if="sub" class="s">{{ sub }}</span>
  </div>
</template>

<style scoped>
.tile { padding: 12px 14px 11px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.k { font-size: var(--font-sm); color: var(--muted); display: inline-flex; align-items: center; gap: 5px; }
.ihint {
  display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%;
  color: var(--muted); cursor: help; outline-offset: 2px;
}
.ihint:hover, .ihint:focus-visible { color: var(--text); }
.v {
  font-size: var(--font-24); font-weight: 650; letter-spacing: -0.02em; line-height: 1.15;
  font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap;
  font-family: var(--font-display); text-shadow: var(--glow-text);
}
.v small { font-size: var(--font-12-5); font-weight: 500; color: var(--muted); letter-spacing: 0; text-shadow: none; }
.v.good { color: var(--success); }
.v.bad { color: var(--danger); }
.v.muted { color: var(--muted); font-weight: 500; }
.s { font-size: var(--font-xs); color: var(--muted); font-variant-numeric: tabular-nums; }

/* pill 用 currentColor + 半透明伪元素做底色：无需为每种语义色各备一套 tint token，三主题自动跟随 */
.pill {
  position: relative; display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
  border-radius: 999px; font-size: var(--font-tb-11); font-weight: 600; font-style: normal; line-height: 1;
  white-space: nowrap; letter-spacing: 0; text-shadow: none; isolation: isolate;
}
.pill::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0.12; z-index: -1; }
.pill.ok { color: var(--success); }
.pill.warn { color: var(--warning); }
.pill.info { color: var(--accent); }
.pill.off { color: var(--muted); font-weight: 500; }
</style>
