<script setup lang="ts">
// 预测页通用「一句话功能介绍」条：用平实语言说明本页基础功能，置于页面顶部。
// cfg 驱动页（ForecastMultiTypeCurve/ForecastDailyCurve）从 cfg.intro 取文案；
// 独立视图直接传 text。
defineProps<{ text: string }>()
</script>

<template>
  <p class="forecast-intro">{{ text }}</p>
</template>

<style scoped>
.forecast-intro {
  margin: 0 0 12px;
  padding: 9px 12px;
  font-size: var(--font-md);
  line-height: 1.6;
  color: var(--el-text-color-regular);
  background: var(--panel, #fff);
  border-left: 3px solid var(--el-color-primary);
  border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
</style>
