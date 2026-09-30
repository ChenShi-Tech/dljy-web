<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DataBasisBadge from '../DataBasisBadge.vue'
import UnifiedForecastChart from './UnifiedForecastChart.vue'
import { selectedRegionId } from '@/services/region/regionContext'
import {
  fetchForecastModels,
  runForecastPredict,
  type ForecastModel,
  type ForecastResult
} from '@/services/forecast/mlForecastClient'
import { FORECAST_TARGET_OPTIONS, type UnifiedForecastResult } from '@/services/forecast/forecastProviders'
import { isForecastDate, toOnlineForecastResult } from '@/services/forecast/onlineForecastResult'
import { predictionModelExclusionReason } from '@/services/forecast/predictionModelEligibility'
import { pickDefaultModelId } from '@/services/forecast/defaultModel'

const props = withDefaults(defineProps<{
  target: string
  title?: string
  regionId?: string
  targetDate?: string
  defaultTrainDays?: number
}>(), {
  title: '深度模型在线预测',
  regionId: '',
  targetDate: '',
  defaultTrainDays: 180
})

const models = ref<ForecastModel[]>([])
const modelType = ref('')
const trainDays = ref(props.defaultTrainDays)
const dataSource = ref<'auto' | 'synthetic'>('auto')
const targetDate = ref(props.targetDate)
const loading = ref(false)
const modelLoading = ref(false)
const result = ref<ForecastResult | null>(null)
const unifiedResult = ref<UnifiedForecastResult | null>(null)
const forecastError = ref('')
const catalogError = ref('')

// 与单算法/多算法入口使用同一准入规则；按模型能力命名空间识别深度/远程模型，
// 不再只认 tslib:/remote: 前缀，否则运行时无前缀 ID 的真实模型会被误隐藏。
// 前缀判断只保留给旧目录兼容；占位、不可用或原始零样本仍由统一准入规则移除。
const ONLINE_MODEL_NAMESPACES = new Set(['neural', 'deep', 'tslib', 'remote'])
const onlineModels = computed(() => models.value.filter((model) =>
  (ONLINE_MODEL_NAMESPACES.has(String(model.namespace ?? ''))
    || model.modelId.startsWith('tslib:')
    || model.modelId.startsWith('remote:'))
  && predictionModelExclusionReason(model) === null
))
const activeModel = computed(() => !catalogError.value
  ? onlineModels.value.find((model) => model.modelId === modelType.value && model.available) ?? null : null)
const activeRegionId = computed(() => props.regionId || selectedRegionId.value || 'shanxi')
const targetLabel = computed(() => FORECAST_TARGET_OPTIONS.find((item) => item.id === props.target)?.name ?? props.target)
const chartResults = computed(() => unifiedResult.value
  ? [{ provider: activeModel.value?.name ?? unifiedResult.value.modelId, result: unifiedResult.value }] : [])

let forecastReqId = 0
function clearResult() {
  ++forecastReqId
  result.value = null
  unifiedResult.value = null
  forecastError.value = ''
  loading.value = false
}

let loadModelsReqId = 0
async function loadModels() {
  const reqId = ++loadModelsReqId
  const previousModel = modelType.value
  modelLoading.value = true
  catalogError.value = ''
  // 切地区/目标时先清空目录：加载在途或失败时残留旧地区模型，predict 却发新 region，
  // 会重现跨地区口径串读（#1168 竞态）
  models.value = []
  modelType.value = ''
  try {
    const response = await fetchForecastModels(props.target, activeRegionId.value)
    if (reqId !== loadModelsReqId) return // 较早请求晚返回则丢弃，防覆盖最新地区目录
    models.value = response.models
    catalogError.value = response.available === false ? (response.unavailableReason || '当前目标模型目录不可用') : ''
    // 保留上次选择；否则取目录对本标的标记的默认算法（在线深度模型子集里才认），再退回第一个可用模型
    modelType.value = onlineModels.value.find((model) => model.modelId === previousModel && model.available)?.modelId
      ?? pickDefaultModelId(onlineModels.value, response.defaultModelId)
  } catch (error) {
    if (reqId !== loadModelsReqId) return
    catalogError.value = error instanceof Error ? error.message : '在线模型列表加载失败'
  } finally {
    if (reqId === loadModelsReqId) modelLoading.value = false
  }
}

async function runOnlineForecast() {
  if (!activeModel.value) {
    forecastError.value = '当前地区与目标没有可用的在线深度模型'
    return
  }
  if (!isForecastDate(targetDate.value)) {
    forecastError.value = '请选择有效的目标日期；不会自动改算其他日期'
    return
  }
  clearResult()
  const reqId = forecastReqId
  const ctx = { regionId: activeRegionId.value, target: props.target, modelId: modelType.value, targetDate: targetDate.value }
  loading.value = true
  try {
    const response = await runForecastPredict({
      region_id: ctx.regionId,
      target: ctx.target,
      model_type: ctx.modelId,
      train_days: trainDays.value,
      data_source: dataSource.value,
      target_date: ctx.targetDate
    })
    if (reqId !== forecastReqId) return
    unifiedResult.value = toOnlineForecastResult(response, ctx)
    result.value = response
  } catch (error) {
    if (reqId === forecastReqId) forecastError.value = error instanceof Error ? error.message : '在线预测失败'
  } finally {
    if (reqId === forecastReqId) loading.value = false
  }
}

watch(() => props.targetDate, (value) => { targetDate.value = value })
// 同步作废上下文：A→B→A也不能接受早先A的响应；旧finally不得收起新请求的loading。
watch([() => props.target, activeRegionId, targetDate, modelType, trainDays, dataSource], clearResult, { flush: 'sync' })
watch([() => props.target, activeRegionId], loadModels, { immediate: true })
onBeforeUnmount(() => { ++loadModelsReqId; ++forecastReqId })
</script>

<template>
  <el-card shadow="never" class="tslib-panel">
    <template #header>
      <div class="tslib-panel__head">
        <span>{{ title }}</span>
        <DataBasisBadge v-if="result" :basis="result.basis" prefix="口径" />
      </div>
    </template>

    <div class="tslib-panel__toolbar">
      <span class="lbl">目标</span>
      <el-tag size="small" type="info">{{ targetLabel }}</el-tag>
      <span class="lbl">目标日期</span>
      <el-date-picker v-model="targetDate" type="date" value-format="YYYY-MM-DD" size="small" :clearable="false" />
      <span class="lbl">模型</span>
      <el-select v-model="modelType" :loading="modelLoading" size="small" style="width: 210px">
        <el-option v-for="model in onlineModels" :key="model.modelId"
          :label="`${model.name ?? model.modelId}${model.available ? '' : `（不可用：${model.unavailableReason || '服务未就绪'}）`}`"
          :value="model.modelId" :disabled="!model.available" />
      </el-select>
      <span class="lbl">历史范围（天）</span>
      <el-input-number v-model="trainDays" :min="30" :max="365" :step="30" size="small" controls-position="right" />
      <span class="lbl">数据</span>
      <el-select v-model="dataSource" size="small" style="width: 120px">
        <el-option label="真实数据" value="auto" />
        <el-option label="合成验证" value="synthetic" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" :disabled="!activeModel || modelLoading" @click="runOnlineForecast">运行在线预测</el-button>
      <span v-if="result" class="summary">
        平均绝对误差 {{ result.metrics?.mae?.toFixed(2) ?? '-' }} / 均方根误差 {{ result.metrics?.rmse?.toFixed(2) ?? '-' }} {{ result.unit }}
      </span>
    </div>

    <el-alert v-if="catalogError" :title="catalogError" type="error" :closable="false" show-icon />
    <el-alert v-if="forecastError" :title="forecastError" type="error" :closable="false" show-icon />
    <el-alert v-if="dataSource === 'synthetic' || result?.mock" title="模拟或合成验证：只用于检查调用链路，不能作为真实预测效果" type="warning" :closable="false" show-icon />
    <el-alert v-if="result?.metrics?.passes_gate === false" title="本次历史样例未达到预测质量门槛；返回曲线不代表预测效果达标" type="warning" :closable="false" show-icon />
    <UnifiedForecastChart v-if="unifiedResult" :results="chartResults" :height="260" />
    <el-empty v-else :description="onlineModels.length ? '选择模型后运行在线预测' : '当前地区与目标暂无符合条件的在线模型（占位、不可用及原始零样本模型已隐藏）'" :image-size="72" />

    <el-alert
      v-for="(warning, index) in result?.warnings ?? []"
      :key="index"
      :title="warning"
      type="info"
      :closable="false"
      show-icon
      class="tslib-panel__warning"
    />
  </el-card>
</template>

<style scoped>
.tslib-panel { margin: 12px 0; }
.tslib-panel__head { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: var(--font-md); }
.tslib-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.lbl { font-size: var(--font-sm); font-weight: 600; color: var(--el-text-color-regular); }
.summary { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin-left: auto; }
.tslib-panel__warning { margin-top: 8px; }
@media (max-width: 768px) {
  .tslib-panel__toolbar { align-items: stretch; flex-direction: column; }
  .summary { margin-left: 0; }
}
</style>
