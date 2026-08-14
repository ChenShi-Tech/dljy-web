// ============================================================================
// stores/spotSelection.ts — 现货面板跨页选中态基座（Issue #449）
// ----------------------------------------------------------------------------
// pinia store：保存现货分析面板共享筛选态。F4-F7 面板后续接入时通过
// useSpotSelection/onSelectionChange 读写并重载；本文件只提供状态基座，不触碰面板。
// ============================================================================

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ALL_PLANTS, ALL_UNITS } from '../services/market/plantOutputClient'
import type { SpotMarket } from '../services/market/spotClient'
import { currentRegion } from '../services/region/regionContext'

export type SpotSelectionDateRange = [string, string]

export type SpotSelectionField = 'date' | 'dateRange' | 'plant' | 'unit' | 'node' | 'market'

export type SpotSelectionState = {
  date: string
  dateRange: SpotSelectionDateRange
  plant: string
  unit: string
  node: string
  market: SpotMarket
}

export type SpotSelectionPatch = Partial<Omit<SpotSelectionState, 'dateRange'>> & {
  dateRange?: SpotSelectionDateRange | readonly [string, string]
}

export const DEFAULT_SPOT_SELECTION_DATE = '2026-05-01'
export const DEFAULT_SPOT_SELECTION_MARKET: SpotMarket = 'da'
export const DEFAULT_SPOT_SELECTION_DATE_RANGE: SpotSelectionDateRange = [
  DEFAULT_SPOT_SELECTION_DATE,
  DEFAULT_SPOT_SELECTION_DATE
]

export function createDefaultSpotSelection(): SpotSelectionState {
  return {
    date: DEFAULT_SPOT_SELECTION_DATE,
    dateRange: [...DEFAULT_SPOT_SELECTION_DATE_RANGE],
    plant: ALL_PLANTS,
    unit: ALL_UNITS,
    node: '',
    market: DEFAULT_SPOT_SELECTION_MARKET
  }
}

function cloneDateRange(range: SpotSelectionDateRange | readonly [string, string]): SpotSelectionDateRange {
  return [range[0], range[1]]
}

export const useSpotSelectionStore = defineStore('spotSelection', () => {
  const defaults = createDefaultSpotSelection()
  const date = ref(defaults.date)
  const dateRange = ref<SpotSelectionDateRange>(cloneDateRange(defaults.dateRange))
  const plant = ref(defaults.plant)
  const unit = ref(defaults.unit)
  const node = ref(defaults.node)
  const market = ref<SpotMarket>(defaults.market)

  function snapshot(): SpotSelectionState {
    return {
      date: date.value,
      dateRange: cloneDateRange(dateRange.value),
      plant: plant.value,
      unit: unit.value,
      node: node.value,
      market: market.value
    }
  }

  const selection = computed<SpotSelectionState>(() => snapshot())

  function setDate(value: string): void {
    date.value = value
  }

  function setDateRange(value: SpotSelectionDateRange | readonly [string, string]): void {
    dateRange.value = cloneDateRange(value)
  }

  function setPlant(value: string): void {
    plant.value = value
  }

  function setUnit(value: string): void {
    unit.value = value
  }

  function setNode(value: string): void {
    node.value = value
  }

  function setMarket(value: SpotMarket): void {
    market.value = value
  }

  function setSelection(patch: SpotSelectionPatch): void {
    if (patch.date !== undefined) setDate(patch.date)
    if (patch.dateRange !== undefined) setDateRange(patch.dateRange)
    if (patch.plant !== undefined) setPlant(patch.plant)
    if (patch.unit !== undefined) setUnit(patch.unit)
    if (patch.node !== undefined) setNode(patch.node)
    if (patch.market !== undefined) setMarket(patch.market)
  }

  function resetSelection(): void {
    setSelection(createDefaultSpotSelection())
  }

  // 切换地区时清空选中态，避免云南严格真实数据与其它地区筛选上下文串味。
  // watch 注册在 store setup 内；后续任一面板首次使用该 store 后即生效。
  watch(
    () => currentRegion.value.id,
    () => {
      resetSelection()
    }
  )

  return {
    date,
    dateRange,
    plant,
    unit,
    node,
    market,
    selection,
    snapshot,
    setDate,
    setDateRange,
    setPlant,
    setUnit,
    setNode,
    setMarket,
    setSelection,
    resetSelection
  }
})
