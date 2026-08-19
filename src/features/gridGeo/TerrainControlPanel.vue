<script setup lang="ts">
// 三维地形控制面板。原先只在「电厂地理空间」内联实现，驾驶舱/市场态势/气象
// 三页把地形源写死为 arcgis-terrain，用户没有任何入口切换或确认地形是否真的加载。
// 抽成共用组件后各空间页共用同一份控件与同一套降级提示。
import { computed } from 'vue'
import { Mountain } from 'lucide-vue-next'

import type { GridGeoTerrainProvider, GridGeoTerrainStatus, GridGeoViewMode } from './types'
import { VERTICAL_EXAGGERATION_RANGE } from './useViewPreference'

const provider = defineModel<GridGeoTerrainProvider>('provider', { required: true })
const hillshade = defineModel<boolean>('hillshade', { required: true })
const exaggeration = defineModel<number>('exaggeration', { required: true })

const props = defineProps<{
  status: GridGeoTerrainStatus
  /** 宿主当前视图模式：2D 走平面图，地形参数不参与渲染，面板需说明而非假装生效。 */
  viewMode: GridGeoViewMode
  /** 晕渲图层是否真的加载成功；未传视为未知（尚未尝试）。 */
  hillshadeAvailable?: boolean | null
}>()

const emit = defineEmits<{ 'request-3d': [] }>()

/** Cesium World Terrain 走 ion 服务，没有 token 时选中必然回退，不能只写在 option 文案里。 */
const ionTokenConfigured = computed(() => String(import.meta.env.VITE_CESIUM_ION_TOKEN ?? '').trim().length > 0)

const flatMode = computed(() => props.viewMode === '2d')

/**
 * 勾着但实际没加载上——晕渲源与 ArcGIS 影像同域，该域对部分出口 IP 整体 403。
 * 不点破的话复选框看起来是生效的。
 */
const hillshadeBroken = computed(() => !flatMode.value && hillshade.value && props.hillshadeAvailable === false)

const statusText = computed(() => {
  if (flatMode.value) return '未启用'
  if (props.status.status === 'loading') return '加载中'
  if (props.status.status === 'ready') return '在线'
  return '已降级'
})

const statusHint = computed(() => {
  if (flatMode.value) return '当前是平面地图，地形参数不参与渲染。切到 2.5D 或 3D 后生效。'
  if (props.status.status === 'fallback') return `${props.status.fallbackFrom ? '外部地形异常，' : ''}已回退到「${props.status.label}」。`
  if (props.status.status === 'error') return props.status.error || '地形加载失败，已回退到椭球体。'
  return ''
})
</script>

<template>
  <div class="terrain-control" :class="{ flat: flatMode }">
    <div class="terrain-head">
      <span><Mountain :size="14" aria-hidden="true" /> 地形环境</span>
      <small :class="flatMode ? 'inactive' : status.status">{{ statusText }}</small>
    </div>

    <select v-model="provider" aria-label="地形供应商" :disabled="flatMode">
      <option value="arcgis-terrain">ArcGIS Terrain 3D · 免 token</option>
      <option value="cesium-world-terrain" :disabled="!ionTokenConfigured">
        Cesium World Terrain · {{ ionTokenConfigured ? '需 token' : '未配置 token' }}
      </option>
      <option value="ellipsoid">椭球地形 · 离线回退</option>
    </select>

    <label class="hillshade-toggle" :class="{ unavailable: hillshadeBroken }">
      <input v-model="hillshade" type="checkbox" :disabled="flatMode" />
      <span>叠加多向地形晕渲{{ hillshadeBroken ? '（当前网络不可用）' : '' }}</span>
    </label>

    <label class="exaggeration">
      <span>山地夸张 <b>{{ exaggeration.toFixed(2) }}×</b></span>
      <input
        v-model.number="exaggeration"
        type="range"
        :min="VERTICAL_EXAGGERATION_RANGE.min"
        :max="VERTICAL_EXAGGERATION_RANGE.max"
        step="0.05"
        :disabled="flatMode"
        aria-label="山地夸张倍数"
      />
    </label>

    <p v-if="statusHint" class="terrain-hint" :title="status.error || statusHint">{{ statusHint }}</p>
    <button v-if="flatMode" type="button" class="to-3d" @click="emit('request-3d')">切到 3D 地形</button>
  </div>
</template>

<style scoped>
.terrain-control { padding: 9px 10px; border: 1px solid rgba(107, 194, 227, .16); border-radius: 11px; background: rgba(5, 21, 38, .78); backdrop-filter: blur(9px); font-size: var(--font-10); }
.terrain-head { display: flex; margin-bottom: 7px; align-items: center; justify-content: space-between; gap: 8px; }
.terrain-head span { display: inline-flex; align-items: center; gap: 5px; color: #9fd0e2; font-weight: 600; }
.terrain-head small { padding: 1px 6px; border-radius: 6px; color: #7fe0c2; background: rgba(63, 190, 152, .13); font-size: var(--font-8-5); }
.terrain-head small.loading { color: #8fc7dd; background: rgba(96, 168, 200, .13); }
.terrain-head small.fallback, .terrain-head small.error { color: #f1c66b; background: rgba(204, 150, 42, .14); }
.terrain-head small.inactive { color: #8296a2; background: rgba(130, 150, 162, .12); }
.terrain-control select { width: 100%; height: 31px; padding: 0 8px; color: #b9d8e5; border: 1px solid rgba(107, 194, 227, .18); border-radius: 8px; outline: 0; background: #071b2d; font-size: var(--font-9-5); }
.terrain-control label { display: flex; margin-top: 8px; flex-direction: column; gap: 4px; color: #8cb4c3; }
.terrain-control label b { color: #72dbf7; font-weight: 600; }
.hillshade-toggle { flex-direction: row !important; align-items: center; gap: 6px !important; }
.hillshade-toggle input { accent-color: #48cdea; }
.hillshade-toggle.unavailable span { color: #d8aa56; }
.exaggeration input { accent-color: #48cdea; }
.terrain-control :disabled { cursor: not-allowed; opacity: .45; }
.terrain-hint { margin: 6px 0 0; color: #d8aa56; font-size: var(--font-8-5); line-height: 1.45; }
.terrain-control.flat .terrain-hint { color: #8296a2; }
.to-3d { width: 100%; height: 27px; margin-top: 7px; border: 1px solid rgba(99, 228, 255, .3); border-radius: 8px; color: #63e4ff; background: rgba(58, 174, 225, .12); cursor: pointer; font-size: var(--font-9-5); }
.to-3d:hover { background: rgba(58, 174, 225, .22); }
</style>
