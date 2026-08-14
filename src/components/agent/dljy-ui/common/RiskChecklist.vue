<script setup lang="ts">
// 风险清单（common）：渲染风险项 + 等级 + 说明，可选展示地区风控阈值。
// 消费 MorningBriefBundle.risk（breaches/key_risks/thresholds）。跨板块复用
// （晨报风险提示/申报前体检/复盘），故入 common 包。
import { computed } from 'vue'
import { ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-vue-next'
import { arr, fmt, num, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

type Risk = { label: string; level: string; detail: string }
const LEVEL: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'l-high' },
  red: { label: '高', cls: 'l-high' },
  warn: { label: '中', cls: 'l-warn' },
  yellow: { label: '中', cls: 'l-warn' },
  info: { label: '低', cls: 'l-info' },
  green: { label: '低', cls: 'l-info' }
}
function lvl(s: string) {
  return LEVEL[s] ?? LEVEL.info
}

const items = computed<Risk[]>(() => {
  const breaches = arr(props.data.breaches ?? props.data.items).map((r) => {
    const o = obj(r)
    return {
      label: str(o.title ?? o.label ?? o.key, '风险项'),
      level: str(o.level, 'info'),
      detail: str(o.detail ?? o.note)
    }
  })
  const keyRisks = arr(props.data.key_risks).map((r) => ({ label: str(r), level: 'info', detail: '' }))
  return [...breaches, ...keyRisks]
})

const thresholds = computed(() => obj(props.data.thresholds))
const hasThresholds = computed(() => Object.keys(thresholds.value).length > 0)
const worst = computed(() => {
  if (items.value.some((i) => lvl(i.level).cls === 'l-high')) return ShieldAlert
  if (items.value.some((i) => lvl(i.level).cls === 'l-warn')) return TriangleAlert
  return ShieldCheck
})
</script>

<template>
  <section class="risk-checklist">
    <header>
      <component :is="worst" :size="18" />
      <h3>{{ title || '风险清单' }}</h3>
    </header>
    <div v-if="hasThresholds" class="risk-thresholds">
      <span v-if="thresholds.price_cap != null">限价上限 {{ fmt(thresholds.price_cap, 0) }} 元/MWh</span>
      <span v-if="thresholds.deviation_tolerance_pct != null">免考核带 ±{{ fmt(thresholds.deviation_tolerance_pct, 1) }}%</span>
      <span v-if="num(thresholds.peak_valley_spread) > 0">峰谷价差 {{ fmt(thresholds.peak_valley_spread, 0) }} 元/MWh</span>
    </div>
    <ul class="risk-list">
      <li v-for="(it, i) in items" :key="i">
        <span class="risk-lv" :class="lvl(it.level).cls">{{ lvl(it.level).label }}</span>
        <div class="risk-body">
          <span class="risk-label">{{ it.label }}</span>
          <span v-if="it.detail" class="risk-detail">{{ it.detail }}</span>
        </div>
      </li>
      <li v-if="!items.length" class="risk-empty">暂无风险提示</li>
    </ul>
  </section>
</template>

<style scoped>
.risk-checklist {
  border: 1px solid var(--line-soft, #e5e7eb);
  border-radius: 8px;
  background: var(--panel, #fff);
  padding: 14px;
}
header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
header svg { color: #d97706; }
h3 { margin: 0; font-size: 16px; color: var(--text, #111827); }
.risk-thresholds { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 10px; font-size: 12px; color: var(--muted, #667085); }
.risk-thresholds span { background: var(--panel-sub, #f8fafc); border: 1px solid var(--line-soft, #e5e7eb); border-radius: 6px; padding: 2px 8px; }
.risk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.risk-list li { display: flex; gap: 9px; align-items: flex-start; }
.risk-lv { font-size: 11.5px; font-weight: 600; padding: 1px 8px; border-radius: 999px; flex: none; margin-top: 1px; }
.l-high { color: #dc2626; background: rgba(220, 38, 38, 0.12); }
.l-warn { color: #b45309; background: rgba(245, 158, 11, 0.14); }
.l-info { color: #6b7280; background: rgba(107, 114, 128, 0.12); }
.risk-body { min-width: 0; }
.risk-label { display: block; font-size: 13px; color: var(--text-body, #344054); }
.risk-detail { display: block; margin-top: 2px; font-size: 12px; color: var(--muted, #98a2b3); line-height: 1.5; }
.risk-empty { color: var(--muted, #98a2b3); font-size: 13px; }
</style>
