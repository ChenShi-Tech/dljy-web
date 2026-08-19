<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DataBasisBadge from '../DataBasisBadge.vue'
import UnifiedForecastChart from './UnifiedForecastChart.vue'
import { selectedRegionId } from '@/services/region/regionContext'
import {
  fetchForecastModels,
  runForecastPredict,
  type ForecastModel,
  type ForecastResult
} from '@/services/forecast/mlForecastClient'
import type { UnifiedForecastResult } from '@/services/forecast/forecastProviders'

const props = withDefaults(defineProps<{
  target: string
  title?: string
  regionId?: string
  targetDate?: string
  defaultTrainDays?: number
}>(), {
  title: 'TSLib 在线预测',
  regionId: '',
  targetDate: '',
  defaultTrainDays: 180
})

const models = ref<ForecastModel[]>([])
const modelType = ref('')
const trainDays = ref(props.defaultTrainDays)
const dataSource = ref<'auto' | 'synthetic'>('synthetic')
const loading = ref(false)
const modelLoading = ref(false)
const result = ref<ForecastResult | null>(null)

const tslibModels = computed(() => models.value.filter((model) =>
  model.modelId.startsWith('tslib:') && model.available
))
const activeModel = computed(() => tslibModels.value.find((model) => model.modelId === modelType.value) ?? null)
const activeRegionId = computed(() => props.regionId || selectedRegionId.value || 'shanxi')
const chartResults = computed(() => {
  const r = result.value
  if (!r) return []
  const unified: UnifiedForecastResult = {
    points: r.points,
    lower: r.lower?.length === r.points.length ? r.lower : undefined,
    upper: r.upper?.length === r.points.length ? r.upper : undefined,
    unit: r.unit,
    basis: r.basis,
    granularity: 96,
    modelId: String(r.task?.model_type ?? modelType.value),
    metrics: {
      mae: r.metrics?.mae,
      rmse: r.metrics?.rmse,
      mase: r.metrics?.mase_vs_naive,
      improve_vs_knn_pct: r.metrics?.improve_vs_knn_pct,
      passes_gate: r.metrics?.passes_gate
    },
    warnings: r.warnings
  }
  return [{ provider: String(r.task?.model_type ?? modelType.value), result: unified }]
})

let loadModelsReqId = 0
async function loadModels() {
  const reqId = ++loadModelsReqId
  modelLoading.value = true
  // 切地区/目标时先清空目录：加载在途或失败时残留旧地区模型，predict 却发新 region，
  // 会重现跨地区口径串读（#1168 竞态）
  models.value = []
  try {
    const response = await fetchForecastModels(props.target, activeRegionId.value)
    if (reqId !== loadModelsReqId) return // 较早请求晚返回则丢弃，防覆盖最新地区目录
    models.value = response.models
    if (!tslibModels.value.some((model) => model.modelId === modelType.value)) {
      modelType.value = tslibModels.value[0]?.modelId ?? ''
    }
  } catch (error) {
    if (reqId !== loadModelsReqId) return
    ElMessage.error(error instanceof Error ? error.message : 'TSLib 模型列表加载失败')
  } finally {
    if (reqId === loadModelsReqId) modelLoading.value = false
  }
}

async function runOnlineForecast() {
  if (!activeModel.value) {
    ElMessage.warning('当前地区没有可用的 TSLib 模型目录产物')
    return
  }
  loading.value = true
  try {
    result.value = await runForecastPredict({
      region_id: activeRegionId.value,
      target: props.target,
      model_type: modelType.value,
      train_days: trainDays.value,
      data_source: dataSource.value,
      target_date: props.targetDate || undefined
    })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'TSLib 在线预测失败')
  } finally {
    loading.value = false
  }
}

watch(() => props.target, loadModels)
// 切全局地区时模型目录必须随之刷新：quality/skill 徽标是地区维，
// 否则切地区后目录冻结旧地区、predict 却发新地区，跨地区口径串读（#1168）。
watch(activeRegionId, loadModels)
onMounted(loadModels)
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
      <el-tag size="small" type="info">{{ target }}</el-tag>
      <span class="lbl">模型</span>
      <el-select v-model="modelType" :loading="modelLoading" size="small" style="width: 210px">
        <el-option v-for="model in tslibModels" :key="model.modelId" :label="model.name ?? model.modelId" :value="model.modelId" />
      </el-select>
      <span class="lbl">训练窗口</span>
      <el-input-number v-model="trainDays" :min="30" :max="365" :step="30" size="small" controls-position="right" />
      <span class="lbl">数据</span>
      <el-select v-model="dataSource" size="small" style="width: 120px">
        <el-option label="合成验证" value="synthetic" />
        <el-option label="自动回放" value="auto" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" :disabled="!activeModel" @click="runOnlineForecast">运行 TSLib</el-button>
      <span v-if="result" class="summary">
        MAE {{ result.metrics?.mae?.toFixed(2) ?? '-' }} / RMSE {{ result.metrics?.rmse?.toFixed(2) ?? '-' }}
      </span>
    </div>

    <UnifiedForecastChart v-if="result" :results="chartResults" :height="260" />
    <el-empty v-else :description="tslibModels.length ? '选择 TSLib 模型后运行在线预测' : '当前地区没有可用的 TSLib 模型目录产物'" :image-size="72" />

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
.tslib-panel__head { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 13px; }
.tslib-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.lbl { font-size: 12px; font-weight: 600; color: var(--el-text-color-regular); }
.summary { color: var(--el-text-color-secondary); font-size: 12px; margin-left: auto; }
.tslib-panel__warning { margin-top: 8px; }
@media (max-width: 768px) {
  .tslib-panel__toolbar { align-items: stretch; flex-direction: column; }
  .summary { margin-left: 0; }
}
</style>
