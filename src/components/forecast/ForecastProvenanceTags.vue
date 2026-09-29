<script setup lang="ts">
// 预测来源标签：后端响应带 mock / sourceType / warnings 时的统一展示（沿用 ForecastProfileBar 的「模拟数据」el-tag 样式）。
// 短标签 + 悬浮提示（title），不在页面写长段说明；旧后端无这些字段时什么都不渲染。
import { computed } from 'vue'
import {
  isMixedProvenance, isMockProvenance, provenanceWarnings, type ForecastProvenance,
} from '@/services/forecast/forecastProvenance'

const props = defineProps<{ provenance?: ForecastProvenance | null; hideWarnings?: boolean }>()

const mock = computed(() => isMockProvenance(props.provenance))
const mixed = computed(() => !mock.value && isMixedProvenance(props.provenance))
const warnings = computed(() => (props.hideWarnings ? [] : provenanceWarnings(props.provenance)))
</script>

<template>
  <span v-if="mock || mixed || warnings.length" class="fp-tags">
    <el-tag v-if="mock" class="fp-mock" size="small" type="warning" effect="plain" round title="模拟数据：仅用于链路演示，不可作为真实报价或申报依据">模拟数据</el-tag>
    <el-tag v-else-if="mixed" class="fp-mixed" size="small" type="warning" effect="plain" round title="部分来源为模拟或合成数据">混合来源</el-tag>
    <el-tag v-if="warnings.length" class="fp-warn" size="small" type="info" effect="plain" round :title="warnings.join('\n')">提示 {{ warnings.length }}</el-tag>
  </span>
</template>

<style scoped>
.fp-tags { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fp-warn { cursor: help; }
</style>
