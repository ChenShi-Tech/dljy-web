<script setup lang="ts">
// 导引高亮环（dljy#3404）：fixed 定位围住目标元素，四周用超大 spread 的 box-shadow 暗化，
// 整体 pointer-events:none——用户仍要亲手点被高亮的控件，导引绝不接管输入。
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

export type GuideRect = { top: number; left: number; width: number; height: number }

const props = defineProps<{ rect: GuideRect | null; zIndex: number }>()

const style = computed<CSSProperties>(() => {
  if (!props.rect) return { display: 'none' }
  const pad = 6
  return {
    position: 'fixed',
    top: `${props.rect.top - pad}px`,
    left: `${props.rect.left - pad}px`,
    width: `${props.rect.width + pad * 2}px`,
    height: `${props.rect.height + pad * 2}px`,
    borderRadius: `calc(var(--radius) + 2px)`,
    zIndex: props.zIndex,
  }
})
</script>

<template>
  <div class="guide-ring" :style="style" aria-hidden="true" />
</template>

<style scoped>
.guide-ring {
  pointer-events: none;
  border: 2px solid var(--accent);
  box-shadow:
    0 0 0 9999px var(--mask-bg),
    0 0 0 4px color-mix(in srgb, var(--accent) 24%, transparent);
  animation: guide-ring-pulse 1.8s ease-in-out infinite;
}

@keyframes guide-ring-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 9999px var(--mask-bg),
      0 0 0 4px color-mix(in srgb, var(--accent) 24%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 9999px var(--mask-bg),
      0 0 0 8px color-mix(in srgb, var(--accent) 40%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .guide-ring {
    animation: none;
  }
}
</style>
