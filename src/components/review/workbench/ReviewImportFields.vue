<script setup lang="ts">
import type { ReviewImportMetadata } from '@/services/data/uploadClient'
const props = defineProps<{ modelValue: ReviewImportMetadata; disabled?: boolean; fixedView?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: ReviewImportMetadata] }>()
function change<K extends keyof ReviewImportMetadata>(key: K, value: ReviewImportMetadata[K]) { emit('update:modelValue', { ...props.modelValue, [key]: value }) }
</script>
<template>
  <fieldset :disabled="disabled"><legend>本批资料口径</legend>
    <label v-if="!fixedView">业务视角<select :value="modelValue.view" @change="change('view', ($event.target as HTMLSelectElement).value as ReviewImportMetadata['view'])"><option value="generator">发电</option><option value="retail">售电</option><option value="storage">储能</option></select></label>
    <label>资料性质<select :value="String(modelValue.simulated)" @change="change('simulated', ($event.target as HTMLSelectElement).value === 'true')"><option value="false">业务资料（人工提供）</option><option value="true">模拟演练</option></select></label>
    <p v-if="modelValue.simulated">模拟数据，仅用于演练，与业务资料分开统计。</p>
    <label v-for="field in ([['basisLabel','基准口径','例如：日前申报电量'],['actualLabel','实绩口径','例如：实际用电量'],['sourceLabel','资料来源','填写原始资料名称'],['sourceVersion','资料版本','例如：五月结算修订版']] as const)" :key="field[0]">{{ field[1] }}<input :value="modelValue[field[0]]" maxlength="200" :placeholder="field[2]" @input="change(field[0], ($event.target as HTMLInputElement).value)" /></label>
    <p>时间采用北京时间，结束时间可填 24:00。单位使用 MWh 或 MW；没有数值的单元格留空。对象名称请保持一致。</p>
  </fieldset>
</template>
<style scoped>fieldset{display:flex;gap:12px;flex-wrap:wrap;border:1px solid var(--line);border-radius:8px;padding:16px}label{display:flex;align-items:center;gap:8px}input,select{font:inherit;padding:8px;border:1px solid var(--line);border-radius:5px;background:var(--panel);color:var(--text);max-width:100%}p{flex-basis:100%;line-height:1.6;margin:0}</style>
