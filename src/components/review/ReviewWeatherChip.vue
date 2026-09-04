<script setup lang="ts">
// 复盘头部天气 chip（清单 R7a）：复盘日期旁的天气外生参考（icon+温度，悬停看 vs 前一日）。
// 纯展示（不进考核口径）；地区无代表点 / 该日无再分析数据 / 请求失败 → 整体隐藏，不出装饰值。
import { computed, ref, watch } from 'vue'
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Sun } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'
import { shiftDate } from '@/services/review/reviewDashboard'
import {
  fetchDailyWeather,
  regionWeatherCity,
  weatherChipText,
  weatherChipTooltip,
  weatherIconKind,
  type DayWeather,
  type WeatherIconKind
} from '@/services/review/reviewWeather'

const props = defineProps<{ date: string }>()

const city = computed(() => regionWeatherCity(currentRegion.value.id))
const cur = ref<DayWeather | null>(null)
const prev = ref<DayWeather | null>(null)
let seq = 0

const ICONS: Record<WeatherIconKind, typeof Sun> = {
  sun: Sun, cloud: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning
}
const iconKind = computed(() => (cur.value ? weatherIconKind(cur.value.wmo) : 'cloud'))
const tooltip = computed(() => {
  if (!city.value || !cur.value) return ''
  return weatherChipTooltip(city.value.city, cur.value, prev.value ?? undefined)
})

watch(
  [() => props.date, city],
  async () => {
    const s = ++seq
    cur.value = null
    prev.value = null
    const c = city.value
    // 一次请求带前一日（悬停对比），日期非法/缺代表点不发
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(props.date)) return
    const map = await fetchDailyWeather(c, shiftDate(props.date, -1), props.date)
    if (s !== seq) return
    if (!map) return
    cur.value = map.get(props.date) ?? null
    prev.value = map.get(shiftDate(props.date, -1)) ?? null
  },
  { immediate: true }
)
</script>

<template>
  <span v-if="cur" class="wx-chip" :title="tooltip">
    <component :is="ICONS[iconKind]" :size="13" />
    <span>{{ weatherChipText(cur) }}</span>
  </span>
</template>

<style scoped>
.wx-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 9px;
  border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel);
  font-size: var(--font-12-5); color: var(--text-body); white-space: nowrap; cursor: help;
}
</style>
