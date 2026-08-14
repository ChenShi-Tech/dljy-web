import { computed, type Ref } from 'vue'
import {
  ALL_PLANTS,
  ALL_UNITS,
  type PlantDimRow
} from '@/services/market/plantOutputClient'

export { ALL_PLANTS, ALL_UNITS } from '@/services/market/plantOutputClient'

type ReadableRef<T> = { readonly value: T }

export interface PlantUnitFilterRow {
  plant?: string | null
  standardPlant?: string | null
  unitName?: string | null
}

export interface PlantUnitEnsureResult {
  changed: boolean
  plantChanged: boolean
  unitChanged: boolean
}

export interface UsePlantUnitFilterOptions<Row extends PlantUnitFilterRow> {
  /** 现货出力长表行；composable 只做本地派生筛选，不取数。 */
  rows: ReadableRef<readonly Row[]>
  /** 当前选中的电厂值；非法值会在 ensureSelections() 中复位为 ALL_PLANTS。 */
  selectedPlant: Ref<string>
  /** 当前选中的机组值；非法值会在 ensureSelections() 中复位为 ALL_UNITS。 */
  selectedUnit: Ref<string>
  /** 可选：外部已经整理好的电厂选项，适合接 yn_dim_plant 权威维表。 */
  plantOptions?: ReadableRef<readonly string[]>
  /** 可选：权威电厂维表；未提供 plantOptions 时用于补齐电厂选项。 */
  plants?: ReadableRef<readonly PlantDimRow[]>
  allPlantsValue?: string
  allUnitsValue?: string
  allPlantsLabel?: string
  allUnitsLabel?: string
  unitFallbackLabel?: string
  locale?: string
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

function uniqSorted(values: Iterable<string>, locale: string): string[] {
  const set = new Set<string>()
  for (const value of values) {
    const text = clean(value)
    if (text) set.add(text)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, locale))
}

/**
 * 提供现货电厂/机组筛选的共享派生逻辑。
 *
 * 输入为调用方已经取回的 rows 与选中态 ref；输出 rowsByPlant、unitOptions、
 * filteredRows 与 ensureSelections，供出力、联动等面板复用。该 composable
 * 不触发 fetchCaptured，也不改变地区注入、Mock 拦截或业务取数路径。
 */
export function usePlantUnitFilter<Row extends PlantUnitFilterRow>(options: UsePlantUnitFilterOptions<Row>) {
  const allPlantsValue = options.allPlantsValue ?? ALL_PLANTS
  const allUnitsValue = options.allUnitsValue ?? ALL_UNITS
  const allPlantsLabel = options.allPlantsLabel ?? '全部电厂'
  const allUnitsLabel = options.allUnitsLabel ?? '全部机组/厂站汇总'
  const unitFallbackLabel = options.unitFallbackLabel ?? '厂站汇总'
  const locale = options.locale ?? 'zh-CN'

  const plantOptions = computed(() => {
    if (options.plantOptions) return uniqSorted(options.plantOptions.value, locale)

    const values: string[] = []
    for (const plant of options.plants?.value ?? []) {
      if (plant.isActive === 0) continue
      values.push(plant.standardName)
    }
    for (const row of options.rows.value) {
      values.push(row.standardPlant || row.plant || '')
    }
    return uniqSorted(values, locale)
  })

  const rowsByPlant = computed(() => {
    const selected = options.selectedPlant.value
    if (selected === allPlantsValue) return options.rows.value
    return options.rows.value.filter((row) => row.plant === selected || row.standardPlant === selected)
  })

  const unitOptions = computed(() => {
    const values = rowsByPlant.value.map((row) => clean(row.unitName) || unitFallbackLabel)
    return uniqSorted(values, locale)
  })

  const filteredRows = computed(() => {
    const unit = options.selectedUnit.value
    if (unit === allUnitsValue) return rowsByPlant.value
    return rowsByPlant.value.filter((row) => (clean(row.unitName) || unitFallbackLabel) === unit)
  })

  const plantLabel = computed(() => (
    options.selectedPlant.value === allPlantsValue ? allPlantsLabel : options.selectedPlant.value
  ))

  const unitLabel = computed(() => (
    options.selectedUnit.value === allUnitsValue ? allUnitsLabel : options.selectedUnit.value
  ))

  function ensureSelections(): PlantUnitEnsureResult {
    const beforePlant = options.selectedPlant.value
    const beforeUnit = options.selectedUnit.value

    if (options.selectedPlant.value !== allPlantsValue && !plantOptions.value.includes(options.selectedPlant.value)) {
      options.selectedPlant.value = allPlantsValue
    }
    if (options.selectedUnit.value !== allUnitsValue && !unitOptions.value.includes(options.selectedUnit.value)) {
      options.selectedUnit.value = allUnitsValue
    }

    const plantChanged = beforePlant !== options.selectedPlant.value
    const unitChanged = beforeUnit !== options.selectedUnit.value
    return { changed: plantChanged || unitChanged, plantChanged, unitChanged }
  }

  return {
    plantOptions,
    rowsByPlant,
    unitOptions,
    filteredRows,
    plantLabel,
    unitLabel,
    ensureSelections
  }
}
