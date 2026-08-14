<script setup lang="ts">
// 现货页共享筛选栏：只封装 Element Plus 控件与选中态 emit，不取数、不注入地区。
import { computed } from 'vue'
import { RefreshCcw } from 'lucide-vue-next'
import { ALL_PLANTS, ALL_UNITS } from '@/services/market/plantOutputClient'

type DateRange = [string, string]
type DateFilterMode = 'single' | 'range' | 'none'
type PlantFilterMode = 'single' | 'multiple' | 'none'
type SelectOptionInput = string | { value: string; label?: string; disabled?: boolean }

interface NormalizedOption {
  value: string
  label: string
  disabled?: boolean
}

interface SpotFilterSelection {
  date: string
  dateRange: DateRange
  plant: string
  plants: string[]
  unit: string
  node: string
}

const props = withDefaults(defineProps<{
  /** 日期控件模式：single 单日、range 日期范围、none 隐藏。 */
  dateMode?: DateFilterMode
  date?: string
  dateRange?: DateRange
  dateLabel?: string
  /** 电厂控件模式：single 单选、multiple 多选、none 隐藏。 */
  plantMode?: PlantFilterMode
  plant?: string
  plants?: string[]
  plantOptions?: SelectOptionInput[]
  plantLabel?: string
  includeAllPlants?: boolean
  allPlantsValue?: string
  allPlantsLabel?: string
  showUnit?: boolean
  unit?: string
  unitOptions?: SelectOptionInput[]
  unitLabel?: string
  includeAllUnits?: boolean
  allUnitsValue?: string
  allUnitsLabel?: string
  showNode?: boolean
  node?: string
  nodeOptions?: SelectOptionInput[]
  nodeLabel?: string
  nodePlaceholder?: string
  size?: 'large' | 'default' | 'small'
  clearable?: boolean
  filterable?: boolean
  loading?: boolean
  showRefresh?: boolean
  refreshLabel?: string
}>(), {
  dateMode: 'range',
  date: '',
  dateRange: () => ['', ''] as DateRange,
  plantMode: 'single',
  plant: ALL_PLANTS,
  plants: () => [],
  plantOptions: () => [],
  plantLabel: '电厂',
  includeAllPlants: true,
  allPlantsValue: ALL_PLANTS,
  allPlantsLabel: '全部电厂',
  showUnit: false,
  unit: ALL_UNITS,
  unitOptions: () => [],
  unitLabel: '机组',
  includeAllUnits: true,
  allUnitsValue: ALL_UNITS,
  allUnitsLabel: '全部机组/厂站汇总',
  showNode: false,
  node: '',
  nodeOptions: () => [],
  nodeLabel: '价格节点',
  nodePlaceholder: '选择节点',
  size: 'default',
  clearable: false,
  filterable: true,
  loading: false,
  showRefresh: false,
  refreshLabel: '刷新'
})

const emit = defineEmits<{
  (event: 'update:date', value: string): void
  (event: 'update:dateRange', value: DateRange): void
  (event: 'update:plant', value: string): void
  (event: 'update:plants', value: string[]): void
  (event: 'update:unit', value: string): void
  (event: 'update:node', value: string): void
  (event: 'change', value: SpotFilterSelection): void
  (event: 'refresh'): void
}>()

const dateLabelText = computed(() => props.dateLabel ?? (props.dateMode === 'single' ? '日期' : '日期范围'))
const shouldIncludeAllPlants = computed(() => props.includeAllPlants ?? props.plantMode === 'single')
const selection = computed<SpotFilterSelection>(() => ({
  date: props.date,
  dateRange: props.dateRange,
  plant: props.plant,
  plants: props.plants,
  unit: props.unit,
  node: props.node
}))

function normalizeOptions(items: SelectOptionInput[]): NormalizedOption[] {
  return items.map((item) => {
    if (typeof item === 'string') return { value: item, label: item }
    return { value: item.value, label: item.label ?? item.value, disabled: item.disabled }
  })
}

function prependAllOption(options: NormalizedOption[], value: string, label: string): NormalizedOption[] {
  if (options.some((option) => option.value === value)) return options
  return [{ value, label }, ...options]
}

const plantSelectOptions = computed(() => {
  const options = normalizeOptions(props.plantOptions)
  return shouldIncludeAllPlants.value
    ? prependAllOption(options, props.allPlantsValue, props.allPlantsLabel)
    : options
})

const unitSelectOptions = computed(() => {
  const options = normalizeOptions(props.unitOptions)
  return props.includeAllUnits
    ? prependAllOption(options, props.allUnitsValue, props.allUnitsLabel)
    : options
})

const nodeSelectOptions = computed(() => normalizeOptions(props.nodeOptions))

function withPatch(patch: Partial<SpotFilterSelection>): SpotFilterSelection {
  return { ...selection.value, ...patch }
}

function normalizeDate(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeDateRange(value: unknown): DateRange {
  if (!Array.isArray(value) || value.length < 2) return ['', '']
  return [String(value[0] ?? ''), String(value[1] ?? '')]
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeString(item)).filter(Boolean)
}

function onDateInput(value: unknown) {
  const next = normalizeDate(value)
  emit('update:date', next)
  emit('change', withPatch({ date: next }))
}

function onDateRangeInput(value: unknown) {
  const next = normalizeDateRange(value)
  emit('update:dateRange', next)
  emit('change', withPatch({ dateRange: next }))
}

function onPlantInput(value: unknown) {
  const next = normalizeString(value)
  emit('update:plant', next)
  emit('change', withPatch({ plant: next }))
}

function onPlantsInput(value: unknown) {
  const next = normalizeStringArray(value)
  emit('update:plants', next)
  emit('change', withPatch({ plants: next }))
}

function onUnitInput(value: unknown) {
  const next = normalizeString(value)
  emit('update:unit', next)
  emit('change', withPatch({ unit: next }))
}

function onNodeInput(value: unknown) {
  const next = normalizeString(value)
  emit('update:node', next)
  emit('change', withPatch({ node: next }))
}
</script>

<template>
  <section class="spot-filter-bar">
    <slot name="leading" :selection="selection" />

    <label
      v-if="dateMode !== 'none'"
      class="spot-filter-bar__field"
      :class="{ 'spot-filter-bar__field--range': dateMode === 'range' }"
    >
      <span>{{ dateLabelText }}</span>
      <el-date-picker
        v-if="dateMode === 'range'"
        :model-value="dateRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        :clearable="clearable"
        :size="size"
        @update:model-value="onDateRangeInput"
      />
      <el-date-picker
        v-else
        :model-value="date"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="选择日期"
        :clearable="clearable"
        :size="size"
        @update:model-value="onDateInput"
      />
    </label>

    <slot name="after-date" :selection="selection" />

    <label
      v-if="plantMode !== 'none'"
      class="spot-filter-bar__field"
      :class="{ 'spot-filter-bar__field--plant-multiple': plantMode === 'multiple' }"
    >
      <span>{{ plantLabel }}</span>
      <el-select
        v-if="plantMode === 'multiple'"
        :model-value="plants"
        multiple
        collapse-tags
        collapse-tags-tooltip
        :filterable="filterable"
        :clearable="clearable"
        :size="size"
        placeholder="选择电厂"
        @update:model-value="onPlantsInput"
      >
        <el-option
          v-for="option in plantSelectOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
          :disabled="option.disabled"
        />
      </el-select>
      <el-select
        v-else
        :model-value="plant"
        :filterable="filterable"
        :clearable="clearable"
        :size="size"
        placeholder="选择电厂"
        @update:model-value="onPlantInput"
      >
        <el-option
          v-for="option in plantSelectOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
          :disabled="option.disabled"
        />
      </el-select>
    </label>

    <slot name="after-plant" :selection="selection" />

    <label v-if="showUnit" class="spot-filter-bar__field">
      <span>{{ unitLabel }}</span>
      <el-select
        :model-value="unit"
        :filterable="filterable"
        :clearable="clearable"
        :size="size"
        placeholder="选择机组"
        @update:model-value="onUnitInput"
      >
        <el-option
          v-for="option in unitSelectOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
          :disabled="option.disabled"
        />
      </el-select>
    </label>

    <slot name="after-unit" :selection="selection" />

    <label v-if="showNode" class="spot-filter-bar__field spot-filter-bar__field--node">
      <span>{{ nodeLabel }}</span>
      <el-select
        :model-value="node"
        :filterable="filterable"
        :clearable="clearable"
        :disabled="!nodeSelectOptions.length"
        :size="size"
        :placeholder="nodePlaceholder"
        @update:model-value="onNodeInput"
      >
        <el-option
          v-for="option in nodeSelectOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
          :disabled="option.disabled"
        />
      </el-select>
    </label>

    <slot name="after-node" :selection="selection" />
    <slot :selection="selection" />

    <div v-if="$slots.actions || showRefresh" class="spot-filter-bar__actions">
      <slot name="actions" :selection="selection">
        <el-button :icon="RefreshCcw" :loading="loading" :size="size" @click="emit('refresh')">
          {{ refreshLabel }}
        </el-button>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.spot-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #dfe7eb;
  border-radius: 8px;
  background: #fff;
}

.spot-filter-bar__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.spot-filter-bar__field > span {
  color: #50616e;
  font-size: 12px;
  font-weight: 650;
}

.spot-filter-bar__field :deep(.el-select),
.spot-filter-bar__field :deep(.el-date-editor) {
  width: 190px;
}

.spot-filter-bar__field--range :deep(.el-date-editor) {
  width: 280px;
}

.spot-filter-bar__field--plant-multiple :deep(.el-select),
.spot-filter-bar__field--node :deep(.el-select) {
  width: 230px;
}

.spot-filter-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 768px) {
  .spot-filter-bar {
    align-items: stretch;
  }

  .spot-filter-bar__field,
  .spot-filter-bar__actions {
    width: 100%;
  }

  .spot-filter-bar__field :deep(.el-select),
  .spot-filter-bar__field :deep(.el-date-editor),
  .spot-filter-bar__field--range :deep(.el-date-editor),
  .spot-filter-bar__field--plant-multiple :deep(.el-select),
  .spot-filter-bar__field--node :deep(.el-select) {
    width: 100%;
  }
}
</style>
