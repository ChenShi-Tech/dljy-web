<script setup lang="ts">
import * as echarts from 'echarts'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, MapPinned, RefreshCw } from 'lucide-vue-next'
import { ensureBoundaryForRegion } from './flatmap/geoJsonLoader'

const props = defineProps<{ regionId: string; regionLabel: string; scopeKey: string; eventScope?: string | null }>()
const expanded = ref(false)
const loading = ref(false)
const error = ref('')
const mapElement = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let mapName: string | null = null
let requestId = 0
function css(name: string, fallback: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback }
function draw() {
  if (!mapElement.value || !mapName || !expanded.value) return
  if (!chart) {
    chart = echarts.init(mapElement.value)
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(mapElement.value)
    themeObserver = new MutationObserver(draw)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  chart.setOption({
    animation: false,
    tooltip: { show: false },
    geo: {
      map: mapName, roam: false, silent: true, layoutCenter: ['50%', '50%'], layoutSize: '92%',
      label: { show: false },
      itemStyle: { areaColor: css('--primary-tint', '#13372f'), borderColor: css('--primary', '#2dd4bf'), borderWidth: 1.2 },
      emphasis: { disabled: true },
    },
    series: [],
  }, { notMerge: true })
}
function dispose() { observer?.disconnect(); observer = null; themeObserver?.disconnect(); themeObserver = null; chart?.dispose(); chart = null }
async function load() {
  const request = ++requestId
  const regionId = props.regionId
  loading.value = true
  error.value = ''
  try {
    const boundary = await ensureBoundaryForRegion(regionId)
    if (request !== requestId || !expanded.value) return
    if (!boundary) { error.value = '当前地区暂无已登记的省域边界'; return }
    mapName = boundary.mapName
    await nextTick()
    if (request === requestId) draw()
  } catch (cause) {
    if (request === requestId) error.value = cause instanceof Error ? cause.message : '区域边界暂不可用'
  } finally { if (request === requestId) loading.value = false }
}
watch(expanded, (value) => {
  if (value) void load()
  else { requestId += 1; loading.value = false; dispose(); mapName = null }
})
watch(() => [props.regionId, props.scopeKey], () => { requestId += 1; expanded.value = false; loading.value = false; error.value = ''; dispose(); mapName = null })
onBeforeUnmount(() => { requestId += 1; dispose() })
</script>

<template>
  <section class="disclosure-region-context" aria-label="辅助区域范围">
    <h3><MapPinned :size="15" />空间范围<small>辅助查看</small></h3>
    <p v-if="eventScope" class="event-scope"><span>所选事件范围</span><strong>{{ eventScope }}</strong></p>
    <button type="button" class="map-toggle" data-testid="desk-region-toggle" :aria-expanded="expanded" aria-controls="disclosure-region-map" @click="expanded = !expanded"><MapPinned :size="14" /><span>{{ expanded ? '收起区域图' : '展开区域图' }} · {{ regionLabel }}</span><ChevronUp v-if="expanded" :size="15" /><ChevronDown v-else :size="15" /></button>
    <div v-if="expanded" id="disclosure-region-map" class="map-content">
      <div ref="mapElement" class="boundary-map" role="img" :aria-label="`${regionLabel}省域边界示意，不包含任何事件或设备点位`" />
      <div v-if="loading" class="map-state" role="status">正在读取当前省域边界…</div>
      <div v-else-if="error" class="map-state error" role="status"><span>{{ error }}</span><button type="button" @click="load"><RefreshCw :size="12" />重试</button></div>
      <p>底图只示{{ regionLabel }}省域；所选事件范围以来源名称为准。未绘制事件、设备坐标或线路。</p>
    </div>
  </section>
</template>

<style scoped>
.disclosure-region-context{padding:16px 18px;border-top:1px solid var(--line-soft)}h3{display:flex;align-items:center;gap:6px;color:var(--text-soft);font-size:var(--font-sm);font-weight:600;margin:0 0 12px}h3 small{margin-left:auto;color:var(--muted);font-size:var(--font-xs);font-weight:400}.event-scope{margin:0 0 12px;padding:10px;background:var(--primary-tint);border-radius:6px}.event-scope span,.event-scope strong{display:block}.event-scope span{font-size:var(--font-xs);color:var(--muted)}.event-scope strong{margin-top:5px;font-size:var(--font-sm);font-weight:500;color:var(--text-body)}.map-toggle{display:flex;align-items:center;gap:7px;width:100%;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-sub);color:var(--text-soft);font:inherit;font-size:var(--font-xs);cursor:pointer}.map-toggle>span{flex:1;text-align:left}.map-toggle:hover,.map-toggle[aria-expanded=true]{color:var(--primary);border-color:var(--primary-tint-border)}.map-toggle:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.map-content{position:relative;padding-top:7px}.boundary-map{height:205px;width:100%;border:1px solid var(--line-soft);border-radius:7px;background:var(--panel-sub)}.map-content>p{color:var(--muted);font-size:var(--font-xs);line-height:1.7;margin:9px 0 0}.map-state{position:absolute;inset:8px 0 auto;height:204px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:9px;font-size:var(--font-xs);color:var(--muted);background:var(--panel-sub);text-align:center;padding:15px}.map-state.error{color:var(--warning)}.map-state button{display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:4px;padding:5px 9px;color:var(--text-soft);background:var(--panel);font:inherit;font-size:var(--font-xs);cursor:pointer}
</style>
