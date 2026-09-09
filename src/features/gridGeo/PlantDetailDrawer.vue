<script setup lang="ts">
/**
 * 电厂完整信息抽屉
 * ------------------------------------------------------------------
 * 原先内嵌在「电厂地理空间」页。2026-09-08 那页并入「空间联动驾驶舱」，这块要在驾驶舱
 * 里打开，于是抽成组件。
 *
 * 字号一并抬过：原实现里有 8px / 8.5px / 9px 的文字，在 580px 宽的抽屉里几乎读不出来。
 * 现在最小 12px，正文 13px——与左侧导航项（--font-tb-13）同档，这是用户提的验收线。
 */
import { computed } from 'vue'
import { ExternalLink, Factory, History, Pencil, Sun, Wind } from 'lucide-vue-next'

import PlantBusinessAttributes from './PlantBusinessAttributes.vue'
import type { GridGeoPlant, GridGeoPlantType, GridGeoWeatherSnapshot } from './types'

const props = withDefaults(defineProps<{
  open: boolean
  plant: GridGeoPlant | null
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

const typeLabel: Record<GridGeoPlantType, string> = {
  wind: '风电', solar: '光伏', hydro: '水电', thermal: '火电', storage: '储能', other: '其他',
}

const accuracyLabel = {
  site: '厂址级', village: '村级参考点', township: '乡镇级参考点', county: '县域参考点', approximate: '近似位置',
}

const confidenceLabel = { verified: '范围已核验', probable: '待二次核验', unverified: '未核验' }

function typeIcon(item: GridGeoPlant) {
  return item.plantType === 'wind' ? Wind : item.plantType === 'solar' ? Sun : Factory
}

function formatCapacity(value: number | null) {
  return value === null ? '缺测' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} MW`
}

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
  <el-drawer v-model="isOpen" size="580px" append-to-body class="grid-geo-drawer" :with-header="false">
    <div v-if="plant" class="drawer-content">
      <div class="drawer-hero">
        <span :class="['drawer-icon', `type-${plant.plantType}`]"><component :is="typeIcon(plant)" :size="28" /></span>
        <small>PLANT SPACE PROFILE</small>
        <h2>{{ plant.standardName }}</h2>
        <p>{{ plant.location.locationLabel }}</p>
        <div class="drawer-hero-actions">
          <button @click="emit('governance', 'history')"><History :size="14" /> 版本历史</button>
          <button :disabled="!props.canWrite" @click="emit('governance', 'edit')"><Pencil :size="14" /> 编辑卡片</button>
        </div>
      </div>

      <section>
        <h4>资产身份</h4>
        <dl>
          <div><dt>电厂 ID</dt><dd>{{ plant.plantId }}</dd></div>
          <div><dt>类型</dt><dd>{{ typeLabel[plant.plantType] }}</dd></div>
          <div><dt>装机</dt><dd>{{ formatCapacity(plant.capacityMw) }}</dd></div>
          <div><dt>所属公司</dt><dd>{{ plant.ownerCompanyId }}</dd></div>
          <div><dt>资产版本</dt><dd>v{{ plant.version }}</dd></div>
          <div><dt>来源 / 存储</dt><dd>{{ plant.dataMeta.sourceType }} / DB</dd></div>
          <div><dt>人工覆盖</dt><dd>{{ plant.overrideState.hasOverrides ? `${plant.overrideState.count} 个字段` : '无' }}</dd></div>
        </dl>
      </section>

      <section>
        <h4>位置可信度</h4>
        <dl>
          <div><dt>坐标系</dt><dd>{{ plant.location.coordinateSystem }}</dd></div>
          <div><dt>精度</dt><dd>{{ accuracyLabel[plant.location.accuracyLevel] }}</dd></div>
          <div><dt>状态</dt><dd>{{ confidenceLabel[plant.location.confidence] }}</dd></div>
          <div><dt>参考误差</dt><dd>约 {{ Math.round(plant.location.uncertaintyMeters / 1000) }} km</dd></div>
        </dl>
        <p class="honesty-note">{{ plant.dataMeta.note }}</p>
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
        <p v-else class="weather-empty">当前没有可用天气值，不以合成值补位。</p>
        <p class="weather-basis">Open-Meteo best_match 数值天气格点 · 口径：真实 · 接口来源 · 非模拟数据 · 不是场站传感器实测。免费端点仅限非商用，生产需配置商业许可。</p>
      </section>

      <section>
        <h4>公开证据</h4>
        <a v-for="source in plant.location.evidence" :key="source.url" :href="source.url" target="_blank" rel="noreferrer">
          <span><strong>{{ source.title }}</strong><small>{{ source.publisher }} · 检索于 {{ source.accessedAt }}</small></span>
          <ExternalLink :size="15" />
        </a>
        <a v-if="plant.location.coordinateSource" :href="plant.location.coordinateSource.url" target="_blank" rel="noreferrer">
          <span><strong>坐标参考点</strong><small>{{ plant.location.coordinateSource.name }} · {{ plant.location.coordinateSource.license }}</small></span>
          <ExternalLink :size="15" />
        </a>
        <p v-else class="honesty-note">坐标由受管库人工录入，尚未绑定独立坐标服务来源。</p>
      </section>

      <PlantBusinessAttributes :plant="plant" />

      <section>
        <h4>集成契约</h4>
        <div class="integration-grid">
          <span>节点价格<small>{{ plant.integrationRefs.nodePriceFamily }}</small></span>
          <span>机组出力<small>{{ plant.integrationRefs.outputFamily }}</small></span>
          <span>发电预测<small>{{ plant.integrationRefs.forecastEndpoint || 'station-generation' }}</small></span>
          <span>结算分析<small>yn_spot_settlement · exact-only</small></span>
        </div>
      </section>
    </div>
  </el-drawer>
</template>

<style scoped>
.drawer-content { min-height: 100%; padding: 20px; color: var(--text); background: var(--bg); }
.drawer-hero { padding: 24px; border-radius: 16px; color: #e8f9ff; background: radial-gradient(circle at 80% 0, rgba(55, 205, 244, .2), transparent 38%), linear-gradient(145deg, #071b2c, #05111e); }
.drawer-icon { display: grid; width: 52px; height: 52px; place-items: center; border-radius: 14px; color: #31d9ff; background: rgba(49, 217, 255, .12); }
.drawer-icon.type-solar { color: #b49aff; background: rgba(164, 126, 255, .14); }
.drawer-hero small { display: block; margin-top: 12px; color: #6ed3ef; font-size: var(--font-11-5); letter-spacing: .16em; }
.drawer-hero h2 { margin: 5px 0; font-size: var(--font-20); }
.drawer-hero p { margin: 0; color: #a3c6d4; font-size: var(--font-sm); }
.drawer-hero-actions { display: flex; gap: 7px; margin-top: 14px; }
.drawer-hero-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 8px 11px; border: 1px solid rgba(86, 197, 229, .25); border-radius: 8px; color: #bdeaf5; background: rgba(38, 150, 181, .1); font-size: var(--font-sm); cursor: pointer; }
.drawer-hero-actions button:disabled { opacity: .4; cursor: not-allowed; }
.drawer-content section { margin-top: 18px; padding: 15px; border: 1px solid var(--line); border-radius: 13px; background: var(--panel); }
.drawer-content h4 { margin: 0 0 11px; font-size: var(--font-lg); }
.drawer-content dl { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 0; }
.drawer-content dl div { min-width: 0; padding: 9px; border-radius: 8px; background: var(--bg); }
.drawer-content dt { color: var(--text-soft); font-size: var(--font-11-5); }
.drawer-content dd { overflow-wrap: anywhere; margin: 3px 0 0; color: var(--text); font-size: var(--font-sm); }
.honesty-note { margin: 10px 0 0; padding: 9px; border-radius: 8px; color: #a5822c; background: rgba(235, 180, 48, .12); font-size: var(--font-11-5); line-height: 1.5; }
.weather-empty { color: var(--text-soft); font-size: var(--font-sm); }
.weather-basis { margin: 10px 0 0; padding: 9px; border-radius: 8px; color: #4d8f7a; background: rgba(66, 180, 140, .1); font-size: var(--font-11-5); line-height: 1.5; }
.drawer-content section > a { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 7px; padding: 10px; text-decoration: none; border: 1px solid var(--line); border-radius: 8px; color: var(--text); }
.drawer-content section > a span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.drawer-content section > a strong { font-size: var(--font-sm); }
.drawer-content section > a small { color: var(--text-soft); font-size: var(--font-11-5); }
.integration-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.integration-grid span { display: flex; padding: 10px; flex-direction: column; gap: 3px; border-radius: 8px; background: var(--bg); font-size: var(--font-sm); }
.integration-grid small { overflow: hidden; color: var(--text-soft); font-size: var(--font-11-5); text-overflow: ellipsis; white-space: nowrap; }
</style>
