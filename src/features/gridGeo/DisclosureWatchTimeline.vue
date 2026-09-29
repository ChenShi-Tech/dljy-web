<script setup lang="ts">
// 日前盯盘「运行日看板」：机组检修条与负荷预测曲线共用同一 0–24 时刻列，
// 较高负荷时段作为一条贯穿所有行与曲线的纵向暖色带（甘特行用 CSS 底色、曲线用同色 markArea）。
// 日级 / 单点 / 未知时段只列在“日级 / 持续性未知”里，不画小时区间（DW-04/DW-12）。
import { Info } from 'lucide-vue-next'
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
const loadTip = computed(() => [
  load.value ? `负荷预测资料日期 ${load.value.coverageDate}` : '',
  props.timeline.highLoadNote,
  load.value?.method ?? '',
  load.value && load.value.missingPoints > 0 ? `缺测 ${load.value.missingPoints} 个时点，曲线在缺测处断开，不插值不补零` : '',
].filter(Boolean).join('。'))

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
    <header>
      <h3>运行日 {{ timeline.tradeDate }}</h3>
      <el-tooltip content="只画目标日 00:00–24:00 内可确认的计划区间；时刻为北京时间。日级名单与只有状态点的停运不画区间，列在下方。" placement="top" :show-after="150">
        <span class="hint" tabindex="0" aria-label="时间轴口径"><Info :size="12" />口径</span>
      </el-tooltip>
      <span v-if="bands.length" class="legend"><i class="swatch" />较高负荷时段</span>
    </header>

    <div class="board">
      <div class="scale" aria-hidden="true"><span v-for="hour in scaleHours" :key="hour" :style="{ left: `${(hour / 24) * 100}%` }">{{ String(hour).padStart(2, '0') }}</span></div>
      <ol v-if="timeline.rows.length" class="gantt" data-testid="watch-timeline-rows">
        <li v-for="row in timeline.rows" :key="row.itemId" :class="row.level">
          <span class="row-label" :title="row.label">{{ row.label }}</span>
          <span class="track"><i v-for="(band, index) in bands" :key="index" class="band" :style="band" /><b class="bar" :style="position(row.startMinute, row.endMinute)" :aria-label="`${row.label}：${row.startText}–${row.endText}（${levelLabel(row.level)}）`" /></span>
          <span class="row-time" :title="`${row.startText}–${row.endText}`">{{ row.startText }}–{{ row.endText }}<em v-if="row.level !== 'focus'">{{ levelLabel(row.level) }}</em></span>
        </li>
      </ol>
      <p v-else class="empty">没有可在目标日内画出的计划区间</p>
      <div v-if="load" class="load-row">
        <span class="row-label">负荷预测</span>
        <div ref="chartEl" class="load-chart" role="img" :aria-label="loadLabel" data-testid="watch-load-chart" />
        <span class="row-time" />
      </div>
    </div>

    <p class="foot" data-testid="watch-load-note">
      <span v-if="timeline.hiddenRows">另有 {{ timeline.hiddenRows }} 项区间见“全部事项”</span>
      <el-tooltip :content="loadTip" placement="top" :show-after="150">
        <span class="hint" tabindex="0" :aria-label="`负荷背景说明：${loadTip}`"><Info :size="12" />{{ load ? `负荷 ${load.coverageDate}` : '负荷背景' }}</span>
      </el-tooltip>
      <span v-if="load && load.missingPoints > 0" class="gap">缺测 {{ load.missingPoints }} 点</span>
      <span class="sr-only">{{ timeline.highLoadNote }}</span>
    </p>

    <details v-if="timeline.undrawn.length" class="undrawn" data-testid="watch-undrawn">
      <summary>日级 / 持续性未知（{{ timeline.undrawn.length }} 项，不画小时区间）</summary>
      <ul><li v-for="entry in timeline.undrawn" :key="entry.itemId"><strong>{{ entry.label }}</strong><span>{{ entry.windowLabel }}</span><small>{{ entry.reason }}</small></li></ul>
    </details>
  </section>
</template>

<style scoped>
/* 共轴：标签列与时刻列定宽，中间轨道列就是 0–24；甘特、刻度、负荷图三者同列。 */
.watch-timeline{--label-w:136px;--time-w:184px;--gap:10px;display:grid;gap:8px;padding:12px 14px 10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
header{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
h3{margin:0;font-size:var(--font-sm);font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
.hint{display:inline-flex;align-items:center;gap:3px;color:var(--muted);font-size:var(--font-xs);cursor:help;border-bottom:1px dotted currentColor}
.hint:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.legend{display:inline-flex;align-items:center;gap:5px;margin-left:auto;color:var(--text-soft);font-size:var(--font-xs)}
.swatch{width:14px;height:10px;border-radius:2px;background:color-mix(in srgb,var(--warning) 16%,transparent);border:1px solid color-mix(in srgb,var(--warning) 40%,transparent)}
.board{display:grid;gap:3px}
.scale{position:relative;height:16px;margin:0 calc(var(--time-w) + var(--gap)) 0 calc(var(--label-w) + var(--gap));color:var(--muted);font-size:var(--font-xs);font-variant-numeric:tabular-nums}
.scale span{position:absolute;transform:translateX(-50%)}
.scale span:first-child{transform:none}
.scale span:last-child{transform:translateX(-100%)}
.gantt{list-style:none;margin:0;padding:0;display:grid;gap:3px}
.gantt li,.load-row{display:grid;grid-template-columns:var(--label-w) minmax(0,1fr) var(--time-w);gap:var(--gap);align-items:center;font-size:var(--font-xs)}
.row-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-body)}
.track{position:relative;height:16px;background:var(--panel-sub);border-left:1px solid var(--line-soft);border-right:1px solid var(--line-soft)}
.band{position:absolute;top:-2px;bottom:-2px;background:color-mix(in srgb,var(--warning) 16%,transparent)}
.bar{position:absolute;top:3px;bottom:3px;border-radius:2px;background:var(--primary)}
li.general .bar{background:color-mix(in srgb,var(--text-soft) 55%,transparent)}
li.review .bar{background:transparent;border:1px dashed var(--warning)}
.row-time{overflow:hidden;text-overflow:ellipsis;color:var(--text-soft);white-space:nowrap;font-variant-numeric:tabular-nums}
.row-time em{margin-left:4px;font-style:normal;color:var(--warning)}
.load-row{align-items:stretch;margin-top:4px}
.load-row .row-label{align-self:center;color:var(--text-soft)}
.load-chart{height:150px;width:100%}
.empty{margin:0;color:var(--muted);font-size:var(--font-xs)}
.foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:0;font-size:var(--font-xs);color:var(--muted)}
.gap{color:var(--warning)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.undrawn summary{cursor:pointer;font-size:var(--font-xs);color:var(--text-soft)}
.undrawn summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.undrawn ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.undrawn li{display:grid;grid-template-columns:var(--label-w) minmax(0,1fr);gap:2px var(--gap);font-size:var(--font-xs);color:var(--text-body)}
.undrawn li small{grid-column:2;color:var(--muted)}
@media(max-width:700px){
  .watch-timeline{--label-w:0px;--time-w:0px;--gap:0px;padding:10px 12px}
  .gantt li{grid-template-columns:minmax(0,1fr) auto;gap:2px 8px}
  .gantt .track{grid-column:1/-1;grid-row:2}
  .load-row{grid-template-columns:minmax(0,1fr)}
  .load-row .row-label,.load-row .row-time{display:none}
  .undrawn li{grid-template-columns:minmax(0,1fr)}
  .undrawn li small{grid-column:1}
}
</style>
