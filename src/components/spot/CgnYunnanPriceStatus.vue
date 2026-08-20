<script setup lang="ts">
// 驾驶舱与实时监盘共用的中广核云南私有价格来源/新鲜度标识。
import { computed } from 'vue'
import type { CgnYunnanPriceBundle } from '@/services/market/cgnYunnanLivePrice'

const props = defineProps<{
  bundle: CgnYunnanPriceBundle | null
}>()

const availabilityText = computed(() => ({
  complete: '日前/实时完整',
  partial: '日前/实时部分缺失',
  unavailable: '当日无数据'
})[props.bundle?.availability ?? 'unavailable'])

const freshnessText = computed(() => ({
  fresh: '数据新鲜',
  stale: '数据已过期',
  unavailable: '无更新时间'
})[props.bundle?.freshness ?? 'unavailable'])

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    : value
}
</script>

<template>
  <span v-if="bundle" class="cgn-price-status" aria-label="中广核云南实时价格来源状态">
    <span class="source">厂侧 PostgreSQL</span>
    <span class="non-official">非电网官方接口</span>
    <span class="availability" :class="bundle.availability">{{ availabilityText }}</span>
    <span class="freshness" :class="bundle.freshness">{{ freshnessText }}</span>
    <span class="latest">最新 {{ formatTime(bundle.latestAt) }}</span>
    <span class="coverage">节点 {{ bundle.node.snapshots.total }} · 场站价 {{ bundle.plants.total }}</span>
  </span>
</template>

<style scoped>
.cgn-price-status { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--muted); font-size: var(--font-xs); }
.cgn-price-status > span { padding: 2px 7px; border-radius: 999px; border: 1px solid var(--line); }
.source { color: var(--success); border-color: color-mix(in srgb, var(--success) 42%, var(--line)) !important; }
.non-official, .stale, .partial { color: var(--warning); }
.fresh, .complete { color: var(--success); }
.unavailable { color: var(--danger); }
.latest, .coverage { border: none !important; padding-inline: 2px !important; }
</style>
