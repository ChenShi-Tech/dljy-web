// 空间资产页面的视图与地形偏好持久化。
//
// 背景：#1427 把驾驶舱与市场空间态势的默认视图从三维地球改成省级平面图后，
// 用户每次进页面都落在 2D，三维地形要手点才回得来；而地形源/晕渲/山地夸张
// 三个参数当时只在「电厂地理空间」有面板，其余页面写死 arcgis-terrain。
// 这里统一成「首次默认三维、之后记住上次选择」，并让各页共用同一份偏好模型。
//
// 存储按 scope 隔离：驾驶舱看惯 2D 不该把气象专项页也拖成 2D。
import { ref, watch, type Ref } from 'vue'

import type { GridGeoTerrainProvider, GridGeoViewMode } from './types'

const VIEW_MODES: readonly GridGeoViewMode[] = ['2d', '2.5d', '3d']
const TERRAIN_PROVIDERS: readonly GridGeoTerrainProvider[] = ['arcgis-terrain', 'cesium-world-terrain', 'ellipsoid']

/** 山地夸张滑块区间，与 TerrainControlPanel 的 min/max 同口径。 */
export const VERTICAL_EXAGGERATION_RANGE = { min: 1, max: 2.2 } as const

const STORAGE_PREFIX = 'dljy.grid-geo.view-pref'

export type GridGeoViewPreferenceScope = 'command' | 'market' | 'assets' | 'weather' | 'topology'

type StoredPreference = {
  viewMode?: unknown
  terrainProvider?: unknown
  hillshadeEnabled?: unknown
  verticalExaggeration?: unknown
}

export type GridGeoViewPreference = {
  viewMode: Ref<GridGeoViewMode>
  terrainProvider: Ref<GridGeoTerrainProvider>
  hillshadeEnabled: Ref<boolean>
  verticalExaggeration: Ref<number>
}

/** 环境变量指定的默认地形源；未配置或取值非法时回 ArcGIS（免 token 那档）。 */
export function envDefaultTerrainProvider(): GridGeoTerrainProvider {
  const raw = String(import.meta.env.VITE_GRID_GEO_TERRAIN_PROVIDER ?? '').trim()
  return TERRAIN_PROVIDERS.includes(raw as GridGeoTerrainProvider) ? raw as GridGeoTerrainProvider : 'arcgis-terrain'
}

function readStored(scope: GridGeoViewPreferenceScope): StoredPreference {
  // 隐私模式/禁用存储时 localStorage 取值会抛，偏好丢失可接受、页面崩溃不可接受。
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.${scope}`)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as StoredPreference : {}
  } catch {
    return {}
  }
}

function clampExaggeration(value: number): number {
  const { min, max } = VERTICAL_EXAGGERATION_RANGE
  return Math.min(max, Math.max(min, value))
}

/**
 * 建立一份持久化的视图偏好。
 *
 * @param scope 存储隔离键，各空间页面各用各的
 * @param defaults 首次进入（无历史选择）时的取值；`viewMode` 不传则为三维
 */
export function useGridGeoViewPreference(
  scope: GridGeoViewPreferenceScope,
  defaults: { viewMode?: GridGeoViewMode; verticalExaggeration?: number } = {}
): GridGeoViewPreference {
  const stored = readStored(scope)

  const viewMode = ref<GridGeoViewMode>(
    VIEW_MODES.includes(stored.viewMode as GridGeoViewMode)
      ? stored.viewMode as GridGeoViewMode
      : defaults.viewMode ?? '3d'
  )
  const terrainProvider = ref<GridGeoTerrainProvider>(
    TERRAIN_PROVIDERS.includes(stored.terrainProvider as GridGeoTerrainProvider)
      ? stored.terrainProvider as GridGeoTerrainProvider
      : envDefaultTerrainProvider()
  )
  const hillshadeEnabled = ref<boolean>(
    typeof stored.hillshadeEnabled === 'boolean' ? stored.hillshadeEnabled : true
  )
  const verticalExaggeration = ref<number>(
    typeof stored.verticalExaggeration === 'number' && Number.isFinite(stored.verticalExaggeration)
      ? clampExaggeration(stored.verticalExaggeration)
      : clampExaggeration(defaults.verticalExaggeration ?? 1.35)
  )

  watch([viewMode, terrainProvider, hillshadeEnabled, verticalExaggeration], () => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(`${STORAGE_PREFIX}.${scope}`, JSON.stringify({
        viewMode: viewMode.value,
        terrainProvider: terrainProvider.value,
        hillshadeEnabled: hillshadeEnabled.value,
        verticalExaggeration: verticalExaggeration.value
      }))
    } catch {
      // 写失败只丢记忆，不影响当前会话内的切换。
    }
  })

  return { viewMode, terrainProvider, hillshadeEnabled, verticalExaggeration }
}
