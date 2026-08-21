<script setup lang="ts">
// 96 格偏差热力条（#2038）：主图下方一眼定位「哪段出问题」。
// 橙=实际高于申报（用多了）、蓝=低于（用少了）；深浅 = |偏差比| 到满刻度。
import type { HeatCell } from '@/services/review/reviewDashboard'

defineProps<{ cells: HeatCell[] }>()

function title(c: HeatCell): string {
  return c.ratio == null ? `${c.label} 申报为 0` : `${c.label}  ${(c.ratio * 100).toFixed(1)}%`
}
</script>

<template>
  <div class="strip-wrap" role="img" aria-label="逐点偏差热力条">
    <div class="strip">
      <i v-for="(c, i) in cells" :key="i" :class="c.tone" :style="{ opacity: c.alpha }" :title="title(c)" />
    </div>
    <div class="strip-x"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    <div class="strip-lbl">
      <span><i class="over" />用多了</span>
      <span><i class="under" />用少了</span>
    </div>
  </div>
</template>

<style scoped>
.strip-wrap { display: flex; flex-direction: column; gap: 3px; }
.strip { display: flex; gap: 1px; height: 12px; border-radius: 3px; overflow: hidden; background: var(--line-faint); }
.strip i { flex: 1; display: block; }
.strip i.over { background: var(--warning); }
.strip i.under { background: var(--accent); }
.strip i.flat { background: transparent; }
.strip-x { display: flex; justify-content: space-between; font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--font-10-5); color: var(--muted); }
.strip-lbl { display: flex; align-items: center; gap: 12px; font-size: var(--font-xs); color: var(--muted); }
.strip-lbl span { display: inline-flex; align-items: center; gap: 4px; }
.strip-lbl i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.strip-lbl i.over { background: var(--warning); }
.strip-lbl i.under { background: var(--accent); }
</style>
