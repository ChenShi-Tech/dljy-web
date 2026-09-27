<script setup lang="ts">
// 品牌标识：尖顶六边形 + 上扬折线箭头 + 3 个节点 + 基线（电网 × 交易增长），
// 出自品牌开场动效收尾定格画面，与 public/favicon.svg 同一套几何（单位半径坐标，y 向下）。
// 线稿取 currentColor，颜色由外层容器决定；bold 为小尺寸（≤ 32px）加粗笔画，避免糊成一团。
import { computed } from 'vue'

const props = withDefaults(defineProps<{ size?: number; weight?: 'normal' | 'bold' }>(), {
  size: 24,
  weight: 'normal'
})

const WEIGHTS = {
  normal: { hex: 0.075, base: 0.035, bolt: 0.095, dot: 0.078 },
  bold: { hex: 0.11, base: 0.06, bolt: 0.13, dot: 0.1 }
} as const

const w = computed(() => WEIGHTS[props.weight])
</script>

<template>
  <svg
    class="brand-emblem"
    :width="size"
    :height="size"
    viewBox="-1.1 -1.1 2.2 2.2"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <polygon points="0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5" :stroke-width="w.hex" />
    <polyline points="-0.52,0.5 0.52,0.5" :stroke-width="w.base" />
    <polyline points="-0.5,0.3 -0.12,-0.08 0.06,0.12 0.46,-0.34" :stroke-width="w.bolt" />
    <polyline points="0.439,-0.121 0.46,-0.34 0.246,-0.289" :stroke-width="w.bolt" />
    <circle cx="-0.5" cy="0.3" :r="w.dot" fill="currentColor" stroke="none" />
    <circle cx="-0.12" cy="-0.08" :r="w.dot" fill="currentColor" stroke="none" />
    <circle cx="0.06" cy="0.12" :r="w.dot" fill="currentColor" stroke="none" />
  </svg>
</template>
