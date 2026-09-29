<script setup lang="ts">
// 日前盯盘时间轴：目标日内可确认的计划区间（HTML 甘特条）+ 一条负荷预测曲线（ECharts）。
// 日级 / 单点 / 未知时段只列在“日级 / 持续性未知”里，不画小时区间（DW-04/DW-12）。
import { computed, onMounted, ref, watch } from 'vue'
import { useEChart } from '@/composables/useEChart'
import { cssVar } from '@/composables/useTheme'
import { buildWatchLoadChartOption, levelLabel, type WatchTimeline } from './disclosureWatchModel'

const props = defineProps<{ timeline: WatchTimeline }>()
const chartEl = ref<HTMLDivElement | null>(null)
const chart = useEChart(chartEl, { render })
const scaleHours = [0, 3, 6, 9, 12, 15, 18, 21, 24]
const bands = computed(() => props.timeline.highLoadBands.map((band) => ({ left: `${(band.fromMinute / 1440) * 100}%`, width: `${((band.toMinute - band.fromMinute) / 1440) * 100}%` })))
const load = computed(() => props.timeline.load)
const loadLabel = computed(() => load.value ? `云南统调负荷预测曲线，资料日期 ${load.value.coverageDate}，有效 ${load.value.validPoints} 个时点，缺测 ${load.value.missingPoints} 个时点` : '')

function position(from: number, to: number) {
  return { left: `${(from / 1440) * 100}%`, width: `${Math.max(0.4, ((to - from) / 1440) * 100)}%` }
}
function render() {
  if (!props.timeline.load) return
  chart.setOption(buildWatchLoadChartOption(props.timeline, {
    line: cssVar('--primary') || '#2563eb',
    band: cssVar('--warning') || '#f59e0b',
    axis: cssVar('--muted') || '#909399',
    split: cssVar('--line-soft') || '#e5e7eb',
  }), true)
}
onMounted(render)
watch(() => props.timeline, render)
</script>

<template>
  <section class="watch-timeline" aria-label="目标日可确认区间与负荷背景" data-testid="watch-timeline">
    <header><h3>目标日时间轴 · {{ timeline.tradeDate }}</h3><small>只画目标日 00:00–24:00 内可确认的计划区间 · 北京时间</small></header>
    <div class="scale" aria-hidden="true"><span v-for="hour in scaleHours" :key="hour" :style="{ left: `${(hour / 24) * 100}%` }">{{ String(hour).padStart(2, '0') }}</span></div>
    <ol v-if="timeline.rows.length" class="gantt" data-testid="watch-timeline-rows">
      <li v-for="row in timeline.rows" :key="row.itemId" :class="row.level">
        <span class="row-label" :title="row.label">{{ row.label }}</span>
        <span class="track"><i v-for="(band, index) in bands" :key="index" class="band" :style="band" /><b class="bar" :style="position(row.startMinute, row.endMinute)" :aria-label="`${row.label}：${row.startText}–${row.endText}（${levelLabel(row.level)}）`" /></span>
        <span class="row-time">{{ row.startText }}–{{ row.endText }}<em v-if="row.level !== 'focus'">{{ levelLabel(row.level) }}</em></span>
      </li>
    </ol>
    <p v-else class="empty">没有可在目标日内画出的计划区间。</p>
    <p v-if="timeline.hiddenRows" class="note">另有 {{ timeline.hiddenRows }} 项区间未在图中列出，见“全部事项”。</p>
    <div class="load-block">
      <div v-if="load" ref="chartEl" class="load-chart" role="img" :aria-label="loadLabel" data-testid="watch-load-chart" />
      <p class="note" data-testid="watch-load-note">
        <template v-if="load">负荷预测 {{ load.coverageDate }} · </template>{{ timeline.highLoadNote }}
        <span v-if="load?.method" class="method-hint" tabindex="0" :title="load.method" :aria-label="`较高负荷时段方法说明：${load.method}`">方法说明</span>
        <template v-if="load && load.missingPoints > 0"> · 缺测 {{ load.missingPoints }} 个时点，曲线在缺测处断开</template>
      </p>
    </div>
    <details v-if="timeline.undrawn.length" class="undrawn" data-testid="watch-undrawn">
      <summary>日级 / 持续性未知（{{ timeline.undrawn.length }} 项，不画小时区间）</summary>
      <ul><li v-for="entry in timeline.undrawn" :key="entry.itemId"><strong>{{ entry.label }}</strong><span>{{ entry.windowLabel }}</span><small>{{ entry.reason }}</small></li></ul>
    </details>
  </section>
</template>

<style scoped>
.watch-timeline{display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-sub)}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
h3{margin:0;font-size:var(--font-sm);color:var(--text)}
header small,.note,.empty{color:var(--muted);font-size:var(--font-xs);line-height:1.5;margin:0}
.scale{position:relative;height:16px;margin-left:calc(clamp(96px,24%,180px) + 8px);margin-right:calc(96px + 8px);color:var(--muted);font-size:var(--font-xs)}
.scale span{position:absolute;transform:translateX(-50%)}
.gantt{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.gantt li{display:grid;grid-template-columns:clamp(96px,24%,180px) minmax(0,1fr) 96px;gap:8px;align-items:center;font-size:var(--font-xs)}
.row-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-body)}
.track{position:relative;height:14px;border-radius:3px;background:var(--panel);border:1px solid var(--line-soft)}
.band{position:absolute;top:0;bottom:0;background:var(--warning-tint)}
.bar{position:absolute;top:2px;bottom:2px;border-radius:2px;background:var(--primary)}
li.general .bar{background:var(--accent)}
li.review .bar{background:transparent;border:1px dashed var(--warning)}
.row-time{color:var(--text-soft);white-space:nowrap}
.row-time em{margin-left:4px;font-style:normal;color:var(--warning)}
.load-chart{height:180px;width:100%}
.method-hint{margin-left:4px;color:var(--primary);text-decoration:underline dotted;cursor:help}
.method-hint:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.undrawn summary{cursor:pointer;font-size:var(--font-xs);color:var(--text-soft)}
.undrawn ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.undrawn li{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:var(--font-xs);color:var(--text-body)}
.undrawn li small{color:var(--muted)}
@media(max-width:700px){.gantt li{grid-template-columns:minmax(0,1fr) auto}.gantt .track{grid-column:1/-1;grid-row:2}.scale{margin-left:0;margin-right:0}}
</style>
