<script setup lang="ts">
// SpotSkeleton — 现货面板通用骨架屏（共享状态 UI 基建，#450）
// ----------------------------------------------------------------------------
// 加载态占位：替代各面板手写的「el-table v-loading 转圈」/「空白 ChartCard」，
// 给数据态容器 DataState 的 loading 档提供更贴近最终布局的骨架，避免加载完成时
// 布局剧烈跳动（CLS）。三种 variant 覆盖面板最常见的两块布局：
//   - chart  ：标题条 + 一块图表占位（与 ChartCard 同款卡片框，可直接 1:1 替换）
//   - table  ：标题条 + 表头行 + N 行单元格骨架（列数可配）
//   - rows   ：N 行短条骨架（KPI/列表/属性面板用）
// 设计：尺寸与 ChartCard（chart）/ el-table（table）对齐，shimmer 用 CSS 渐变扫光，
// 颜色全部走主题变量（var(--panel-sub)/var(--line)），暗色主题自动协调。
//
// 用法：
//   <SpotSkeleton variant="chart" :height="320" />
//   <SpotSkeleton variant="table" :rows="6" :columns="5" />
//   <DataState :loading="loading" :error="error" :empty="!rows.length">
//     <template #skeleton><SpotSkeleton variant="chart" :height="360" /></template>
//     <MyChart :data="rows" />
//   </DataState>
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 骨架布局：图表块 / 表格 / 行列表 */
  variant?: 'chart' | 'table' | 'rows'
  /** chart 变体的高度（与 ChartCard height 同口径，数字=px） */
  height?: string | number
  /** table / rows 变体的行数 */
  rows?: number
  /** table 变体的列数 */
  columns?: number
  /** 是否显示标题条占位 */
  title?: boolean
  /** 是否套 ChartCard 同款卡片外框（chart 默认 true；table/rows 默认 false） */
  card?: boolean
}>(), {
  variant: 'chart',
  height: 320,
  rows: 5,
  columns: 4,
  title: true,
  card: undefined
})

// chart 默认套卡片框（与 ChartCard 视觉一致）；table/rows 默认不套（嵌入既有卡片更自然）。
const wrapCard = computed(() => props.card ?? props.variant === 'chart')
const rowList = computed(() => Array.from({ length: Math.max(1, props.rows) }, (_, i) => i))
const colList = computed(() => Array.from({ length: Math.max(1, props.columns) }, (_, i) => i))
// 行宽随机感：循环一个固定宽度序列，避免一刀切的等宽条呆板（无 Math.random，确定性渲染）。
const ROW_WIDTHS = [92, 78, 96, 84, 70, 88, 80]
const cssHeight = computed(() => (typeof props.height === 'number' ? `${props.height}px` : props.height))
</script>

<template>
  <section class="spot-skeleton" :class="{ 'spot-skeleton--card': wrapCard }">
    <header v-if="title" class="spot-skeleton__head">
      <span class="sk-bar sk-bar--title" />
    </header>
    <!-- chart：一整块图表占位 -->
    <div v-if="variant === 'chart'" class="spot-skeleton__chart" :style="{ height: cssHeight }">
      <span class="sk-block" />
    </div>
    <!-- table：表头 + 行 × 列单元格 -->
    <div v-else-if="variant === 'table'" class="spot-skeleton__table">
      <div class="spot-skeleton__row spot-skeleton__row--head">
        <span v-for="c in colList" :key="`h${c}`" class="sk-bar sk-bar--cell" />
      </div>
      <div v-for="r in rowList" :key="r" class="spot-skeleton__row">
        <span v-for="c in colList" :key="`${r}-${c}`" class="sk-bar sk-bar--cell" />
      </div>
    </div>
    <!-- rows：N 条短占位（KPI/属性/列表） -->
    <div v-else class="spot-skeleton__rows">
      <div v-for="r in rowList" :key="r" class="spot-skeleton__line">
        <span class="sk-bar sk-bar--inline" :style="{ width: `${ROW_WIDTHS[r % ROW_WIDTHS.length]}%` }" />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* shimmer 扫光：背景渐变横向流动，无限循环；暂停动画尊重 reduced-motion。 */
@keyframes sk-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.spot-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spot-skeleton--card {
  background: var(--panel, #fff);
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  padding: 14px 16px 10px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.spot-skeleton__head {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.spot-skeleton__chart {
  width: 100%;
  position: relative;
}
.spot-skeleton__table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.spot-skeleton__row {
  display: flex;
  gap: 12px;
}
.spot-skeleton__row--head {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line, #e5e7eb);
  margin-bottom: 2px;
}
.spot-skeleton__row .sk-bar--cell {
  flex: 1 1 0;
}
.spot-skeleton__rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 共用骨架条/块：渐变扫光底色（主题感知：暗色用更亮的灰，亮色用浅灰）。 */
.sk-bar,
.sk-block {
  display: block;
  background: linear-gradient(
    90deg,
    var(--panel-sub, #eef2f6) 25%,
    var(--line, #e2e8f0) 37%,
    var(--panel-sub, #eef2f6) 63%
  );
  background-size: 200% 100%;
  animation: sk-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
}
.sk-bar {
  height: 12px;
}
.sk-bar--title {
  width: 38%;
  height: 16px;
  border-radius: 4px;
}
.sk-bar--inline {
  height: 14px;
}
.sk-bar--cell {
  height: 14px;
}
.sk-block {
  width: 100%;
  height: 100%;
  border-radius: 8px;
}

@media (prefers-reduced-motion: reduce) {
  .sk-bar,
  .sk-block {
    animation: none;
  }
}
</style>
