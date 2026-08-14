<script setup lang="ts">
// 交易晨报三段式研判（brief）：行情研判 / 交易策略 / 风险提示，由 LLM 基于 bundle 填写。
// 顶部可选总体研判（headline + verdict 红黄绿），承接储能 DecisionCard 的判级语义。
import { computed } from 'vue'
import { Activity, BadgeCheck, TriangleAlert } from 'lucide-vue-next'
import { obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const d = computed(() => obj(props.data))
const headline = computed(() => str(d.value.headline ?? d.value.summary))
const verdict = computed(() => str(d.value.verdict, 'neutral'))
const tone = computed(() => {
  if (verdict.value === 'bullish' || verdict.value === 'green') return 'green'
  if (verdict.value === 'bearish' || verdict.value === 'red') return 'red'
  return 'yellow'
})
const icon = computed(() => (tone.value === 'green' ? BadgeCheck : tone.value === 'red' ? TriangleAlert : Activity))

const sections = computed(() =>
  [
    { key: 'market', label: '① 行情研判', text: str(d.value.market ?? d.value.market_insight) },
    { key: 'strategy', label: '② 交易策略', text: str(d.value.strategy ?? d.value.strategy_advice) },
    { key: 'risk', label: '③ 风险提示', text: str(d.value.risk ?? d.value.risk_alert) }
  ].filter((s) => s.text)
)
const sub = computed(() => {
  const meta = obj(d.value.meta)
  const region = str(meta.region_name ?? d.value.region)
  const date = str(meta.date ?? d.value.date)
  return [region, date].filter(Boolean).join(' · ')
})
</script>

<template>
  <section class="brief-summary" :class="tone">
    <header>
      <div class="brief-icon"><component :is="icon" :size="20" /></div>
      <div class="brief-head-text">
        <p class="brief-eyebrow">{{ title || '交易晨报研判' }}<template v-if="sub"> · {{ sub }}</template></p>
        <h3 v-if="headline">{{ headline }}</h3>
      </div>
    </header>
    <div class="brief-sections">
      <article v-for="s in sections" :key="s.key">
        <h4>{{ s.label }}</h4>
        <p>{{ s.text }}</p>
      </article>
      <p v-if="!sections.length" class="brief-empty">等待智能体生成研判内容…</p>
    </div>
  </section>
</template>

<style scoped>
.brief-summary { border: 1px solid var(--line-soft, #e5e7eb); border-left-width: 4px; border-radius: 8px; background: var(--panel, #fff); padding: 14px; }
.brief-summary.green { border-left-color: #16a34a; }
.brief-summary.yellow { border-left-color: #f59e0b; }
.brief-summary.red { border-left-color: #dc2626; }
header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.brief-icon { width: 38px; height: 38px; border-radius: 8px; display: grid; place-items: center; background: rgba(15, 118, 110, 0.1); color: var(--primary, #0f766e); flex: none; }
.brief-eyebrow { margin: 0 0 3px; font-size: 12px; color: var(--muted, #667085); }
h3 { margin: 0; font-size: 18px; color: var(--text, #111827); line-height: 1.4; }
.brief-sections { display: flex; flex-direction: column; gap: 12px; }
.brief-sections article h4 { margin: 0 0 4px; font-size: 13px; color: var(--primary, #0f766e); }
.brief-sections article p { margin: 0; font-size: 13.5px; color: var(--text-body, #344054); line-height: 1.6; white-space: pre-wrap; }
.brief-empty { margin: 0; color: var(--muted, #98a2b3); font-size: 13px; }
</style>
