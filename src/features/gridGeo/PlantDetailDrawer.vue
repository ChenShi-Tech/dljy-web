<script setup lang="ts">
import { computed } from 'vue'
import { ExternalLink, History, Pencil } from 'lucide-vue-next'

import GridObjectDrawer from './GridObjectDrawer.vue'
import type { GridObjectReference } from './objectNavigation'
import type { GridGeoPlant, GridGeoWeatherSnapshot } from './types'

const props = withDefaults(defineProps<{
  open: boolean
  plant: GridGeoPlant | null
  date?: string
  from?: string
  to?: string
  weather?: GridGeoWeatherSnapshot | null
  canWrite?: boolean
}>(), { weather: null, canWrite: false })

const emit = defineEmits<{
  'update:open': [value: boolean]
  governance: [mode: 'edit' | 'history']
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const reference = computed<GridObjectReference | null>(() => props.plant ? { kind: 'plant', id: props.plant.plantId, regionId: props.plant.regionId, gridOperator: props.plant.gridOperator } : null)

const accuracyLabel = {
  site: '厂址级', village: '村级参考点', township: '乡镇级参考点', county: '县域参考点', approximate: '近似位置',
}

const confidenceLabel = { verified: '范围已核验', probable: '待二次核验', unverified: '未核验' }

function sourceNoteItems(value: string | undefined) {
  return value?.match(/[^。；;\r\n]+[。；;]?/gu)?.map(item => item.trim()).filter(Boolean) ?? []
}

const locationNotes = computed(() => sourceNoteItems(props.plant?.dataMeta.note))
const coordinateLicenseNotes = computed(() => sourceNoteItems(props.plant?.location.coordinateSource?.license))

function formatWeatherValue(value: number | null | undefined, unit: string, digits = 1) {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)} ${unit}` : '暂不可用'
}

function formatWeatherTime(value: string) {
  if (!value) return '未更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}
</script>

<template>
  <GridObjectDrawer v-model="isOpen" :object="reference" :date="date" :from="from" :to="to">
    <template #management>
      <div v-if="plant" class="drawer-content drawer-management">
        <div class="drawer-hero-actions">
          <button @click="emit('governance', 'history')"><History :size="14" /> 版本历史</button>
          <button :disabled="!canWrite" @click="emit('governance', 'edit')"><Pencil :size="14" /> 编辑卡片</button>
        </div>
        <dl>
          <div><dt>电厂 ID</dt><dd>{{ plant.plantId }}</dd></div>
          <div><dt>所属公司</dt><dd>{{ plant.ownerCompanyId }}</dd></div>
          <div><dt>资产版本</dt><dd>v{{ plant.version }}</dd></div>
          <div><dt>来源</dt><dd>{{ plant.dataMeta.sourceType }}</dd></div>
          <div><dt>人工覆盖</dt><dd>{{ plant.overrideState.hasOverrides ? `${plant.overrideState.count} 个字段` : '无' }}</dd></div>
        </dl>
      </div>
    </template>
    <template #extra>
      <div v-if="plant" class="drawer-content drawer-extra">
      <section>
        <h4>位置可信度</h4>
        <dl>
          <div><dt>坐标系</dt><dd>{{ plant.location.coordinateSystem }}</dd></div>
          <div><dt>精度</dt><dd>{{ accuracyLabel[plant.location.accuracyLevel] }}</dd></div>
          <div><dt>状态</dt><dd>{{ confidenceLabel[plant.location.confidence] }}</dd></div>
          <div><dt>参考误差</dt><dd>约 {{ Math.round(plant.location.uncertaintyMeters / 1000) }} km</dd></div>
        </dl>
        <details v-if="locationNotes.length" class="source-notes">
          <summary>原始位置说明</summary>
          <ul><li v-for="(note, index) in locationNotes" :key="index">{{ note }}</li></ul>
        </details>
      </section>

      <section>
        <h4>当前天气格点</h4>
        <dl v-if="weather">
          <div><dt>天气</dt><dd>{{ weather.weatherLabel }}</dd></div>
          <div><dt>模型高程</dt><dd>{{ formatWeatherValue(weather.sampledLocation.elevationM, 'm', 0) }}</dd></div>
          <div><dt>温度</dt><dd>{{ formatWeatherValue(weather.temperatureC, '°C') }}</dd></div>
          <div><dt>湿度</dt><dd>{{ formatWeatherValue(weather.relativeHumidityPercent, '%', 0) }}</dd></div>
          <div><dt>风速 / 风向</dt><dd>{{ formatWeatherValue(weather.windSpeedMs, 'm/s') }} · {{ weather.windDirectionDeg?.toFixed(0) ?? '—' }}°</dd></div>
          <div><dt>降水 / 云量</dt><dd>{{ formatWeatherValue(weather.precipitationMm, 'mm') }} · {{ formatWeatherValue(weather.cloudCoverPercent, '%', 0) }}</dd></div>
          <div><dt>短波辐照</dt><dd>{{ formatWeatherValue(weather.shortwaveRadiationWm2, 'W/m²', 0) }}</dd></div>
          <div><dt>有效时点</dt><dd>{{ formatWeatherTime(weather.validAt) }}</dd></div>
        </dl>
        <span v-else class="weather-status" role="status">缺测</span>
        <dl class="weather-basis">
          <div><dt>来源</dt><dd>Open-Meteo</dd></div>
          <div><dt>模型</dt><dd>best_match</dd></div>
          <div><dt>类型</dt><dd>数值天气格点</dd></div>
          <div><dt>观测属性</dt><dd>非场站实测</dd></div>
          <div class="field-wide"><dt>数据口径</dt><dd>真实 · 接口来源 · 非模拟数据</dd></div>
        </dl>
        <details class="source-notes">
          <summary>来源与许可说明</summary>
          <ul>
            <li>免费端点仅限非商用，生产需配置商业许可。</li>
            <li v-if="!weather">当前没有可用天气值，不以合成值补位。</li>
          </ul>
        </details>
      </section>

      <section>
        <h4>公开证据</h4>
        <a v-for="source in plant.location.evidence" :key="source.url" :href="source.url" target="_blank" rel="noreferrer">
          <span><strong>{{ source.title }}</strong><small>{{ source.publisher }} · 检索于 {{ source.accessedAt }}</small></span>
          <ExternalLink :size="15" />
        </a>
        <a v-if="plant.location.coordinateSource" :href="plant.location.coordinateSource.url" target="_blank" rel="noreferrer">
          <span><strong>坐标参考点</strong><small>{{ plant.location.coordinateSource.name }}</small></span>
          <ExternalLink :size="15" />
        </a>
        <dl v-else class="coordinate-basis">
          <div><dt>来源</dt><dd>人工录入</dd></div>
          <div><dt>目录</dt><dd>受管库</dd></div>
          <div class="field-wide"><dt>坐标服务</dt><dd>未绑定独立来源</dd></div>
        </dl>
        <details v-if="coordinateLicenseNotes.length" class="source-notes">
          <summary>坐标来源许可</summary>
          <ul><li v-for="(note, index) in coordinateLicenseNotes" :key="index">{{ note }}</li></ul>
        </details>
      </section>

      </div>
    </template>
  </GridObjectDrawer>
</template>

<style scoped>
.drawer-content { min-width: 0; padding: 0; color: var(--text); background: transparent; }
.drawer-hero-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.drawer-hero-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--panel); font-size: var(--font-sm); cursor: pointer; }
.drawer-hero-actions button:disabled { opacity: .4; cursor: not-allowed; }
.drawer-content section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.drawer-content h4 { margin: 0 0 12px; color: var(--text); font-size: var(--font-sm); font-weight: 600; line-height: 1.5; }
.drawer-content dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; margin: 0; }
.drawer-content dl div { display: grid; grid-template-columns: 80px minmax(0, 1fr); align-items: baseline; gap: 8px; min-width: 0; }
.drawer-content dt { color: var(--text-soft); font-size: var(--font-xs); line-height: 1.6; }
.drawer-content dd { overflow-wrap: anywhere; margin: 0; color: var(--text); font-size: var(--font-sm); line-height: 1.6; }
.drawer-management { padding-top: 12px; }
.drawer-management dl div:nth-child(-n + 2) { grid-column: 1 / -1; }
.drawer-content .weather-basis,.drawer-content .coordinate-basis { margin-top: 12px; }
.drawer-content .field-wide { grid-column: 1 / -1; }
.weather-status { display: inline-flex; align-items: center; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; color: var(--text-soft); background: var(--panel); font-size: var(--font-xs); line-height: 1.6; }
.source-notes { margin-top: 12px; color: var(--text-soft); font-size: var(--font-xs); line-height: 1.6; overflow-wrap: anywhere; }
.source-notes summary { width: fit-content; cursor: pointer; }
.source-notes ul { display: grid; gap: 6px; margin: 8px 0 0; padding-left: 18px; }
.drawer-content section > a { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 0; text-decoration: none; border-bottom: 1px solid var(--line); color: var(--text); }
.drawer-content section > a:last-child { padding-bottom: 0; border-bottom: 0; }
.drawer-content section > a span { display: flex; min-width: 0; flex-direction: column; gap: 3px; overflow-wrap: anywhere; }
.drawer-content section > a strong { font-size: var(--font-sm); line-height: 1.5; font-weight: 500; }
.drawer-content section > a small { color: var(--text-soft); font-size: var(--font-xs); line-height: 1.5; }
.drawer-content section > a svg { flex-shrink: 0; margin-top: 3px; color: var(--primary); }
.drawer-content section > a:hover strong { color: var(--primary); }
.drawer-content button:focus-visible,.drawer-content a:focus-visible,.source-notes summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
@media (max-width: 560px) {
  .drawer-content dl { grid-template-columns: minmax(0, 1fr); }
  .drawer-content dl div { grid-template-columns: 88px minmax(0, 1fr); }
  .drawer-content section { margin-top: 12px; padding-top: 12px; }
}
</style>
