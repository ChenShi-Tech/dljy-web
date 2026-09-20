<script setup lang="ts">
import { computed } from 'vue'
import InsightNote from '@/components/insight/InsightNote.vue'

type Row = { metricId: string; label: string; text: string; unit: string; note: string }
const props = defineProps<{ card: { key: string; title: string; rows: Row[]; note?: string; eligibility?: string }; tone?: string }>()
const unitText = (unit: string) => unit === 'yuan/MWh' ? '元/MWh' : unit
const primary = computed(() => props.card.rows[0])
const range = computed(() => {
  const min = props.card.rows.find(row => /(?:minimum|spread-minimum)$/.test(row.metricId))
  const max = props.card.rows.find(row => /(?:maximum|spread-maximum)$/.test(row.metricId))
  const value = Number(primary.value?.text.replaceAll(',', ''))
  const low = Number(min?.text.replaceAll(',', ''))
  const high = Number(max?.text.replaceAll(',', ''))
  if (!min || !max || !Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high) || high < low) return null
  return { min, max, position: high === low ? 50 : Math.max(0, Math.min(100, (value - low) / (high - low) * 100)) }
})
</script>

<template>
  <article class="overview-metric" :class="`overview-metric--${tone || 'teal'}`">
    <h4>{{ card.title }}</h4>
    <div v-if="primary" class="overview-metric__value">
      <strong>{{ primary.text }}</strong><span>{{ unitText(primary.unit) }}</span>
    </div>
    <span v-if="primary" class="overview-metric__label">{{ primary.label }}</span>
    <div v-if="range" class="overview-metric__range" aria-label="最小值至最大值，标记为均值">
      <div class="overview-metric__track"><i :style="{ left: `${range.position}%` }" /></div>
      <div class="overview-metric__ends"><span>最低 {{ range.min.text }}</span><span>最高 {{ range.max.text }}</span></div>
    </div>
    <div class="overview-metric__secondary">
      <span v-for="row in card.rows.slice(1).filter(row => !range || (row !== range.min && row !== range.max)).slice(0, 2)" :key="row.metricId">
        {{ row.label }} <b>{{ row.text }} {{ unitText(row.unit) }}</b>
      </span>
    </div>
    <p v-if="card.eligibility" class="overview-metric__eligibility">{{ card.eligibility }}</p>
    <InsightNote label="指标明细">
      <dl><template v-for="row in card.rows" :key="row.metricId"><dt>{{ row.label }}</dt><dd>{{ row.text }} {{ unitText(row.unit) }} {{ row.note }}</dd></template></dl>
      <p v-if="card.note">{{ card.note }}</p>
    </InsightNote>
  </article>
</template>

<style scoped>
.overview-metric { --metric-color: var(--accent, #159e90); min-width: 0; padding: 20px; border-radius: 14px; background: color-mix(in srgb, var(--metric-color) 5%, var(--panel, #fff)); border: 1px solid color-mix(in srgb, var(--metric-color) 14%, var(--line, #e2e8f0)); }
.overview-metric--blue { --metric-color: #548ed5; }
.overview-metric--amber { --metric-color: #c99a50; }
h4 { margin: 0 0 18px; font-size: var(--font-sm); color: var(--text); font-weight: 600; line-height: 1.6; }
.overview-metric__value { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
.overview-metric__value strong { font-size: clamp(1.8rem, 2.5vw, 2.6rem); letter-spacing: -0.05em; font-weight: 650; line-height: 1.15; color: var(--metric-color); }
.overview-metric__value span, .overview-metric__label { font-size: var(--font-xs); color: var(--muted); }
.overview-metric__label { display: block; margin-top: 8px; }
.overview-metric__range { margin: 24px 0 16px; }
.overview-metric__track { height: 5px; background: color-mix(in srgb, var(--metric-color) 20%, transparent); position: relative; border-radius: 5px; margin: 0 4px; }
.overview-metric__track i { position: absolute; top: -3px; width: 5px; height: 11px; border-radius: 2px; transform: translateX(-50%); background: var(--metric-color); }
.overview-metric__ends { display: flex; justify-content: space-between; gap: 8px; margin-top: 9px; font-size: var(--font-xs); color: var(--muted); font-variant-numeric: tabular-nums; }
.overview-metric__secondary { display: flex; gap: 8px 20px; flex-wrap: wrap; margin: 14px 0 8px; font-size: var(--font-xs); color: var(--muted); }
.overview-metric__secondary b { color: var(--text); font-weight: 500; margin-left: 4px; }
.overview-metric__eligibility { font-size: var(--font-xs); color: var(--muted); }
dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; } dd { margin: 0; text-align: right; } p { margin: 6px 0 0; }
</style>
