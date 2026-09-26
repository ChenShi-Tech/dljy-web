<script setup lang="ts">
import { ElOption, ElOptionGroup, ElSelect } from 'element-plus'
import { Check, ChevronDown, Search, TrendingUp } from 'lucide-vue-next'

defineProps<{
  modelValue: string
  groups: Array<{ id: string; label: string; metrics: Array<{ id: string; label: string }> }>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>()
function updateValue(value: string) { emit('update:modelValue', value) }
</script>

<template>
  <div class="metric-picker disclosure-metric-picker" data-testid="desk-metric-picker">
    <ElSelect
      :model-value="modelValue"
      aria-label="主图指标"
      placeholder="搜索或选择指标"
      filterable
      default-first-option
      fit-input-width
      :suffix-icon="ChevronDown"
      :show-arrow="false"
      :offset="8"
      :fallback-placements="['bottom-start', 'top-start']"
      popper-class="disclosure-metric-menu"
      no-match-text="没有匹配的指标"
      no-data-text="暂无可选指标"
      @update:model-value="updateValue"
      @change="emit('change')"
    >
      <template #prefix><TrendingUp :size="18" aria-hidden="true" /></template>
      <template #header><div class="disclosure-metric-menu-heading"><Search :size="14" aria-hidden="true" /><span>输入名称，快速查找指标</span></div></template>
      <ElOptionGroup v-for="group in groups" :key="group.id" :label="group.label">
        <ElOption v-for="metric in group.metrics" :key="metric.id" :value="metric.id" :label="metric.label" :data-metric-id="metric.id">
          <span class="disclosure-metric-option-label">{{ metric.label }}</span><Check v-if="metric.id === modelValue" :size="16" class="disclosure-metric-option-check" aria-hidden="true" />
        </ElOption>
      </ElOptionGroup>
    </ElSelect>
  </div>
</template>

<style scoped>
.disclosure-metric-picker{width:360px;max-width:100%;margin-top:8px;min-width:0;--el-color-primary:var(--primary);--el-text-color-regular:var(--text);--el-text-color-placeholder:var(--muted);--el-fill-color-blank:var(--panel-sub);--el-border-color:var(--line)}
.disclosure-metric-picker :deep(.el-select){width:100%;min-width:0}
.disclosure-metric-picker :deep(.el-select__wrapper){min-height:44px;gap:10px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-sub);box-shadow:none;transition:background .15s,border-color .15s,box-shadow .15s}
.disclosure-metric-picker :deep(.el-select__wrapper:hover){border-color:var(--primary);background:var(--primary-tint)}
.disclosure-metric-picker :deep(.el-select__wrapper.is-focused){border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-tint-border)}
.disclosure-metric-picker :deep(.el-select__prefix){color:var(--primary);flex-shrink:0}
.disclosure-metric-picker :deep(.el-select__suffix){color:var(--muted);flex-shrink:0}
.disclosure-metric-picker :deep(.el-select__caret){width:17px;height:17px;color:inherit}
.disclosure-metric-picker :deep(.el-select__selection){min-width:0}
.disclosure-metric-picker :deep(.el-select__placeholder),.disclosure-metric-picker :deep(.el-select__input){font-size:var(--font-xl);font-weight:650;line-height:1.5;color:var(--text)}
.disclosure-metric-picker :deep(.el-select__placeholder.is-transparent){color:var(--muted)}
.disclosure-metric-picker :deep(.el-select__input:focus-visible){outline:none}
@media(max-width:700px){.disclosure-metric-picker{width:100%}.disclosure-metric-picker :deep(.el-select__placeholder),.disclosure-metric-picker :deep(.el-select__input){font-size:var(--font-lg)}}
@media(prefers-reduced-motion:reduce){.disclosure-metric-picker :deep(.el-select__wrapper){transition:none}}
</style>

<style>
.disclosure-metric-menu.el-popper{box-sizing:border-box;max-width:calc(100vw - 24px);border:1px solid var(--line);border-radius:10px;background:var(--panel);box-shadow:0 12px 32px color-mix(in srgb,var(--text) 12%,transparent),0 2px 8px color-mix(in srgb,var(--text) 6%,transparent);overflow:hidden;--el-color-primary:var(--primary);--el-bg-color-overlay:var(--panel);--el-fill-color-light:var(--primary-tint);--el-text-color-regular:var(--text);--el-text-color-secondary:var(--muted);--el-border-color-light:var(--line)}
.disclosure-metric-menu .el-select-dropdown{box-sizing:border-box;max-width:calc(100vw - 24px)}
.disclosure-metric-menu .el-select-dropdown__header{padding:11px 14px;border-bottom:1px solid var(--line-soft);background:var(--panel-sub)}
.disclosure-metric-menu .disclosure-metric-menu-heading{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:var(--font-xs);line-height:1.5}
.disclosure-metric-menu .el-select-dropdown__wrap{max-height:min(380px,55dvh)}
.disclosure-metric-menu .el-select-dropdown__list{padding:7px 0}
.disclosure-metric-menu .el-select-group__wrap{padding-bottom:7px}
.disclosure-metric-menu .el-select-group__wrap:not(:last-of-type)::after{display:none}
.disclosure-metric-menu .el-select-group__title{height:auto;margin:3px 8px 5px;padding:6px 10px;border-radius:5px;background:var(--panel-sub);color:var(--text);font-size:var(--font-lg);font-weight:700;line-height:1.5}
.disclosure-metric-menu .el-select-dropdown__item{display:flex;align-items:center;gap:10px;height:auto;min-height:38px;margin:2px 8px;padding:8px 10px;border-radius:6px;color:var(--text-body);font-size:var(--font-sm);line-height:1.5;white-space:normal}
.disclosure-metric-menu .el-select-dropdown__item.is-hovering,.disclosure-metric-menu .el-select-dropdown__item:hover{background:var(--primary-tint);color:var(--primary)}
.disclosure-metric-menu .el-select-dropdown__item.is-selected{background:var(--primary-tint);color:var(--primary);font-weight:600;box-shadow:inset 2px 0 var(--primary)}
.disclosure-metric-menu .disclosure-metric-option-label{min-width:0;flex:1;overflow-wrap:anywhere}
.disclosure-metric-menu .disclosure-metric-option-check{flex-shrink:0;color:var(--primary)}
.disclosure-metric-menu .el-select-dropdown__empty{padding:22px 14px;color:var(--muted);font-size:var(--font-sm)}
</style>
