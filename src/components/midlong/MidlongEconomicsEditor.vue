<script setup lang="ts">
// 中长期合同经济内容编辑器（dljy#2939）：电量与单位、售电价格与口径、交割期、月度分解。
// 草稿录入与录入更正共用；用与后端同一份 shared/midlong 规则实时预校验（提交时仍以后端为准）。
// 数值一律以字符串编辑，不经过浮点数：输入框里的 1000.123456 原样送到后端。
import { computed, watch } from 'vue'
import {
  ENERGY_UNIT_FACTORS, EVIDENCE_BASES, EVIDENCE_BASIS_LABELS, PRICE_COMPONENTS, PRICE_COMPONENT_LABELS, PRICE_TYPES,
  PRICE_TYPE_LABELS, PRICE_UNIT_FACTORS, TAX_BASES, TAX_BASIS_LABELS, deliveryMonths, normalizeEconomics,
  type DocumentKind, type EnergyAttribute, type EvidenceBasis,
} from '@/services/midlong/midlongTypes'
import { fmtQuantity } from '@/services/midlong/midlongFormat'
import { nextRowUid, toEconomicsInput, type AllocationRow, type EconomicsDraft } from '@/services/midlong/economicsDraft'

const props = defineProps<{ modelValue: EconomicsDraft; documentKind: DocumentKind; energyAttribute: EnergyAttribute; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [EconomicsDraft] }>()

const energyUnits = Object.keys(ENERGY_UNIT_FACTORS)
const priceUnits = Object.keys(PRICE_UNIT_FACTORS)

function patch(partial: Partial<EconomicsDraft>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

// 环境价值只属于绿电：切到常规电能时清空（字段随之隐藏，不能留一个看不见也改不了的值被提交；后端同样拒绝）。
watch(() => props.energyAttribute, (value) => {
  if (value !== 'GREEN' && props.modelValue.environmentPrice) patch({ environmentPrice: '' })
}, { immediate: true })

function patchRow(uid: number, partial: Partial<AllocationRow>) {
  patch({ allocations: props.modelValue.allocations.map((row) => (row.uid === uid ? { ...row, ...partial } : row)) })
}

function addRow() {
  const used = new Set(props.modelValue.allocations.map((r) => r.deliveryMonth))
  const nextMonth = months.value.find((m) => !used.has(m)) ?? ''
  patch({ allocations: [...props.modelValue.allocations, { uid: nextRowUid(), deliveryMonth: nextMonth, quantity: '', price: '', evidenceBasis: 'FORMAL' }] })
}

function removeRow(uid: number) {
  patch({ allocations: props.modelValue.allocations.filter((row) => row.uid !== uid) })
}

const months = computed(() => deliveryMonths(props.modelValue.deliveryStart || null, props.modelValue.deliveryEnd || null))

const check = computed(() => normalizeEconomics({ ...toEconomicsInput(props.modelValue), documentKind: props.documentKind, energyAttribute: props.energyAttribute }))
defineExpose({ check })
</script>

<template>
  <div class="ml-econ">
    <div class="ml-econ-grid">
      <label class="ml-field" data-guide="ml-econ-delivery-start">
        <span>交割开始日期</span>
        <el-date-picker :model-value="modelValue.deliveryStart" type="date" value-format="YYYY-MM-DD" :disabled="disabled" @update:model-value="(v: string) => patch({ deliveryStart: v ?? '' })" />
      </label>
      <label class="ml-field" data-guide="ml-econ-delivery-end">
        <span>交割结束日期（含当日）</span>
        <el-date-picker :model-value="modelValue.deliveryEnd" type="date" value-format="YYYY-MM-DD" :disabled="disabled" @update:model-value="(v: string) => patch({ deliveryEnd: v ?? '' })" />
      </label>
      <label class="ml-field" data-guide="ml-econ-quantity">
        <span>合同电量</span>
        <el-input :model-value="modelValue.totalQuantity" placeholder="未填 = 未知" :disabled="disabled" @update:model-value="(v: string) => patch({ totalQuantity: v })">
          <template #append>
            <el-select :model-value="modelValue.quantityUnit" placeholder="单位" style="width: 96px" :disabled="disabled" @update:model-value="(v: string) => patch({ quantityUnit: v })">
              <el-option v-for="u in energyUnits" :key="u" :label="u" :value="u" />
            </el-select>
          </template>
        </el-input>
      </label>
      <label class="ml-field" data-guide="ml-econ-price">
        <span>售电价格</span>
        <el-input :model-value="modelValue.sellerPrice" placeholder="未填 = 待核对（不当 0）" :disabled="disabled" @update:model-value="(v: string) => patch({ sellerPrice: v })">
          <template #append>
            <el-select :model-value="modelValue.priceUnit" placeholder="单位" style="width: 110px" :disabled="disabled" @update:model-value="(v: string) => patch({ priceUnit: v })">
              <el-option v-for="u in priceUnits" :key="u" :label="u" :value="u" />
            </el-select>
          </template>
        </el-input>
      </label>
      <label class="ml-field">
        <span>价格类型</span>
        <el-select :model-value="modelValue.priceType" placeholder="有价格时默认固定价" clearable :disabled="disabled" @update:model-value="(v: string) => patch({ priceType: v ?? '' })">
          <el-option v-for="t in PRICE_TYPES" :key="t" :label="PRICE_TYPE_LABELS[t]" :value="t" />
        </el-select>
      </label>
      <label class="ml-field" data-guide="ml-econ-tax-basis">
        <span>含税口径</span>
        <el-select :model-value="modelValue.taxBasis" placeholder="未知" clearable :disabled="disabled" @update:model-value="(v: string) => patch({ taxBasis: v ?? '' })">
          <el-option v-for="t in TAX_BASES" :key="t" :label="TAX_BASIS_LABELS[t]" :value="t" />
        </el-select>
      </label>
      <label class="ml-field">
        <span>价格构成</span>
        <el-select :model-value="modelValue.priceComponent" :placeholder="energyAttribute === 'GREEN' ? '绿电默认未核对' : '默认电能量价'" clearable :disabled="disabled" @update:model-value="(v: string) => patch({ priceComponent: v ?? '' })">
          <el-option v-for="t in PRICE_COMPONENTS" :key="t" :label="PRICE_COMPONENT_LABELS[t]" :value="t" />
        </el-select>
      </label>
      <label v-if="energyAttribute === 'GREEN'" class="ml-field">
        <span>环境价值价格（与电能量价分开）</span>
        <el-input :model-value="modelValue.environmentPrice" placeholder="未填 = 未知" :disabled="disabled" @update:model-value="(v: string) => patch({ environmentPrice: v })" />
      </label>
    </div>

    <div v-if="documentKind === 'OBLIGATION'" class="ml-alloc" data-guide="ml-econ-alloc">
      <div class="ml-alloc-head">
        <span class="ml-alloc-title">月度分解（{{ modelValue.allocations.length }}）</span>
        <el-checkbox data-guide="ml-econ-alloc-complete" :model-value="modelValue.allocationDeclaredComplete" :disabled="disabled" @update:model-value="(v: boolean | string | number) => patch({ allocationDeclaredComplete: Boolean(v) })">
          分解已完整（须与合同电量严格相等）
        </el-checkbox>
        <el-button size="small" :disabled="disabled || !months.length" @click="addRow">添加月份</el-button>
      </div>
      <p v-if="months.length === 1 && !modelValue.allocations.length" class="ml-alloc-hint">单月交割合同无需填写分解：该月电量即合同电量。</p>
      <p v-else-if="!modelValue.allocations.length" class="ml-alloc-hint">未填写分解时，合同电量进入「跨期未分解」，持仓不会按月均摊。</p>
      <div v-for="row in modelValue.allocations" :key="row.uid" class="ml-alloc-row">
        <el-select :model-value="row.deliveryMonth" placeholder="月份" style="width: 120px" :disabled="disabled" @update:model-value="(v: string) => patchRow(row.uid, { deliveryMonth: v })">
          <el-option v-for="m in months" :key="m" :label="m" :value="m" />
        </el-select>
        <el-input :model-value="row.quantity" placeholder="月度电量" style="width: 150px" :disabled="disabled" @update:model-value="(v: string) => patchRow(row.uid, { quantity: v })" />
        <el-input :model-value="row.price" placeholder="月度价格（可空）" style="width: 150px" :disabled="disabled" @update:model-value="(v: string) => patchRow(row.uid, { price: v })" />
        <el-select :model-value="row.evidenceBasis" style="width: 120px" :disabled="disabled" @update:model-value="(v: EvidenceBasis) => patchRow(row.uid, { evidenceBasis: v })">
          <el-option v-for="b in EVIDENCE_BASES" :key="b" :label="EVIDENCE_BASIS_LABELS[b]" :value="b" />
        </el-select>
        <el-button link type="danger" :disabled="disabled" @click="removeRow(row.uid)">删除</el-button>
      </div>
    </div>

    <div class="ml-econ-check" :class="{ bad: check.errors.length }" data-guide="ml-econ-check">
      <template v-if="check.errors.length">
        <div v-for="(e, i) in check.errors" :key="i">✕ {{ e.message }}</div>
      </template>
      <template v-else>
        <span>规范后：合同电量 {{ fmtQuantity(check.value.totalQuantity) }} MWh</span>
        <span>正式分解 {{ fmtQuantity(check.value.formalAllocatedQuantity) }} MWh</span>
        <span v-if="check.value.unallocatedQuantity !== null">未分解 {{ fmtQuantity(check.value.unallocatedQuantity) }} MWh</span>
        <span>售电价格 {{ check.value.sellerPrice === null ? '待核对' : `${check.value.sellerPrice} 元/MWh` }}</span>
      </template>
      <div v-for="(w, i) in check.warnings" :key="`w${i}`" class="warn">! {{ w.message }}</div>
    </div>
  </div>
</template>

<style scoped>
.ml-econ { display: flex; flex-direction: column; gap: 12px; }
.ml-econ-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px 14px; }
.ml-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-md); color: var(--muted); }
.ml-field :deep(.el-date-editor), .ml-field :deep(.el-select) { width: 100%; }
.ml-alloc { border-top: 1px solid var(--line-soft); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.ml-alloc-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ml-alloc-title { font-weight: 600; color: var(--text); }
.ml-alloc-hint { margin: 0; font-size: var(--font-sm); color: var(--muted); }
.ml-alloc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ml-econ-check { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 8px 10px; border-radius: 6px; background: var(--surface-hover); font-size: var(--font-sm); color: var(--text-soft); }
.ml-econ-check.bad { color: var(--danger); flex-direction: column; }
.ml-econ-check .warn { color: var(--warning); width: 100%; }
</style>
