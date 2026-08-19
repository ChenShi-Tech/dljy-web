<script setup lang="ts">
// ⚠ 已合并（本瘦壳不再被路由引用，保留备查）：
// 云南交易工作台并入 /dashboard 后，驾驶舱云南数据区的 cockpit tab 直接内联 SpotCockpitCore
// （见 src/views/TradingCockpitView.vue），不再经此瘦壳中转。文件保留以便回滚恢复工作台结构。
// 云南现货交易驾驶舱（xhjy/yunnan/cockpit）入口瘦壳，七模块内容见 SpotCockpitCore；
// 数据纪律（云南严格 · 真实或空 · 不回退）、诚实标注详见 SpotCockpitCore。
import SpotCockpitCore from '@/components/spot/cockpit/SpotCockpitCore.vue'
import { currentRegion } from '@/services/region/regionContext'
</script>

<template>
  <SpotCockpitCore :region-name="currentRegion.shortName" :region-id="currentRegion.id" />
</template>
