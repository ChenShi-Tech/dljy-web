<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { ArrowRight, TrendingUp } from 'lucide-vue-next'
import { loadDisclosureDeskSeries, type DeskDataResult } from './disclosureDeskData'
import { buildDisclosureDeskInsights, type DeskInsight, type DeskInsightWindow } from './disclosureDeskInsights'

const props = defineProps<{ regionId: string; dateFrom: string; dateTo: string; scopeKey: string; refreshKey: number; selection: DeskInsightWindow | null }>()
const emit = defineEmits<{ focus: [insight: DeskInsight] }>()
const results = shallowRef<DeskDataResult[]>([])
const loading = shallowRef(false)
const failures = shallowRef<string[]>([])
let request = 0
const metrics = [{ id: 'price', label: '电价' }, { id: 'load', label: '负荷' }, { id: 'new-energy', label: '新能源' }, { id: 'non-market', label: '非市场化电源' }]
const insights = computed(() => buildDisclosureDeskInsights(results.value, props.selection))
const unavailable = computed(() => [...failures.value, ...results.value.filter((result) => !['available', 'partial'].includes(result.status)).map((result) => `${result.metric.label}：${result.reason || '暂无可用样本'}`)])
const missingComparison = computed(() => results.value.filter((result) => ['available', 'partial'].includes(result.status) && !insights.value.some((item) => item.id === `${result.metric.id}:difference`)).map((result) => result.metric.label))
function numberText(value: number) { return `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` }
async function load() {
  const token = ++request
  results.value = []; failures.value = []; loading.value = true
  const context = { regionId: props.regionId, dateFrom: props.dateFrom, dateTo: props.dateTo, scopeKey: props.scopeKey, refreshKey: props.refreshKey }
  // Selection and hover reuse this window's samples; only a date/region/company change or refresh reads again.
  const settled = await Promise.allSettled(metrics.map((metric) => loadDisclosureDeskSeries({ ...context, metricId: metric.id })))
  if (token !== request) return
  results.value = settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : [])
  failures.value = settled.flatMap((item, index) => item.status === 'rejected' ? [`${metrics[index].label}：读取失败，请刷新重试`] : [])
  loading.value = false
}
watch(() => [props.regionId, props.dateFrom, props.dateTo, props.scopeKey, props.refreshKey], load, { immediate: true })
onBeforeUnmount(() => { request += 1 })
</script>

<template>
  <section class="window-insights" data-testid="desk-window-insights" aria-label="选区关键变化">
    <h3><TrendingUp :size="15" />{{ selection ? '选区关键变化' : '当期关键变化' }}</h3>
    <p v-if="loading" role="status">正在读取电价与供需样本…</p>
    <template v-else>
      <button v-for="item in insights" :key="item.id" type="button" :data-testid="`desk-insight-${item.id}`" @click="emit('focus', item)">
        <span>{{ item.label }}</span><strong>{{ numberText(item.value) }} <small>{{ item.unit }}</small><ArrowRight :size="13" /></strong>
        <time>{{ item.time.slice(5) }}</time><small>{{ item.detail }}</small>
      </button>
      <p v-if="!insights.length">当前窗口没有可计算的价差、预测偏差或连续 15 分钟变化。</p>
      <p v-else>在有效样本中比较；点击定位原始时段与曲线。预测偏差只比较同地区、同口径数据。</p>
      <details v-if="unavailable.length || missingComparison.length"><summary>样本情况</summary><p v-for="message in unavailable" :key="message">{{ message }}</p><p v-if="missingComparison.length">{{ missingComparison.join('、') }}：所选范围缺少可比较的预测与实际样本。</p></details>
    </template>
  </section>
</template>

<style scoped>
.window-insights{padding:16px 18px;border-top:1px solid var(--line-soft)}
h3{display:flex;align-items:center;gap:6px;margin:0 0 12px;font-size:var(--font-sm);font-weight:600;color:var(--text-soft)}
button{display:block;width:100%;text-align:left;padding:10px;margin:7px 0 0;border:1px solid var(--line-soft);border-radius:6px;background:var(--panel-sub);color:var(--text-body);cursor:pointer}
button:hover,button:focus-visible{border-color:var(--primary);background:var(--primary-tint)}
button>span,button>small,time,summary{font-size:var(--font-xs);color:var(--muted);line-height:1.6}
button>small{display:block;margin-top:3px}strong{display:flex;align-items:center;gap:4px;font-size:var(--font-sm);margin:4px 0;font-variant-numeric:tabular-nums}strong small{font-size:var(--font-xs);font-weight:400}strong svg{margin-left:auto;color:var(--primary)}
p{font-size:var(--font-xs);color:var(--muted);line-height:1.7;margin:9px 0 0}details{margin-top:10px}summary{cursor:pointer}
</style>
