// ============================================================================
// composables/useSpotSelection.ts — 现货面板选中态读取与变更广播
// ----------------------------------------------------------------------------
// 泛化 useRegionReload.ts 的 onRegionChange 形态：不引入事件库，直接 watch
// pinia store 选中态，供 F4-F7 后续按字段订阅并重载。
// ============================================================================

import { watch, type WatchStopHandle } from 'vue'
import {
  useSpotSelectionStore,
  type SpotSelectionField,
  type SpotSelectionState
} from '../stores/spotSelection'

export type SpotSelectionChangePayload = {
  selection: SpotSelectionState
  previous: SpotSelectionState
  changed: SpotSelectionField[]
}

export type SpotSelectionChangeCallback = (payload: SpotSelectionChangePayload) => void | Promise<void>

export type SpotSelectionChangeOptions = {
  fields?: readonly SpotSelectionField[]
}

export function useSpotSelection() {
  return useSpotSelectionStore()
}

function changedFields(selection: SpotSelectionState, previous: SpotSelectionState): SpotSelectionField[] {
  const changed: SpotSelectionField[] = []
  if (selection.date !== previous.date) changed.push('date')
  if (selection.dateRange[0] !== previous.dateRange[0] || selection.dateRange[1] !== previous.dateRange[1]) {
    changed.push('dateRange')
  }
  if (selection.plant !== previous.plant) changed.push('plant')
  if (selection.unit !== previous.unit) changed.push('unit')
  if (selection.node !== previous.node) changed.push('node')
  if (selection.market !== previous.market) changed.push('market')
  return changed
}

export function onSelectionChange(
  reload: SpotSelectionChangeCallback,
  options: SpotSelectionChangeOptions = {}
): WatchStopHandle {
  const store = useSpotSelectionStore()
  const fields = new Set(options.fields ?? [])

  return watch(
    () => store.snapshot(),
    (selection, previous) => {
      const changed = changedFields(selection, previous)
      if (!changed.length) return
      if (fields.size && !changed.some((field) => fields.has(field))) return
      void reload({ selection, previous, changed })
    }
  )
}
