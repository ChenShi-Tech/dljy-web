<script setup lang="ts">
// 晨报数据预检栏（原 MorningBriefView 中栏，随 #2023 入口合并抽成工作台挂件）。
//
// fetchMorningBriefBundle 确定性装配 bundle，直接用 dljy-ui 组件渲染一屏结构化数据——
// 不依赖 LLM，点预检即有内容（后端 bundle 的 7 类数据这里全部上屏）。
// 「所有数字来自同一次装配」是晨报当初从聊天式重构成确定性流程的核心，本栏是它的可见半边。
import { computed, ref } from 'vue'
import DataQualityPanel from '@/components/agent/dljy-ui/common/DataQualityPanel.vue'
import RiskChecklist from '@/components/agent/dljy-ui/common/RiskChecklist.vue'
import MarketSnapshot from '@/components/agent/dljy-ui/brief/MarketSnapshot.vue'
import ForecastBandCard from '@/components/agent/dljy-ui/brief/ForecastBandCard.vue'
import { currentRegion } from '@/services/region/regionContext'
import { fetchMorningBriefBundle, type MorningBriefBundle } from '@/services/agent/morningBriefClient'

const props = defineProps<{ date: string }>()

const bundle = ref<MorningBriefBundle | null>(null)
const loading = ref(false)
const error = ref('')

const forecastBand = computed(() => (bundle.value?.forecast_band ?? {}) as Record<string, unknown>)
const risk = computed(() => (bundle.value?.risk ?? {}) as Record<string, unknown>)
const basisLabel = computed(() =>
  bundle.value ? (bundle.value.basis === 'captured' ? '真实采集' : '含模拟/缺失') : ''
)

async function run(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    bundle.value = await fetchMorningBriefBundle({
      date: props.date,
      region_id: currentRegion.value.id,
      region_name: currentRegion.value.name
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 生成晨报前若还没预检过则先跑一次（与合并前 generate() 的行为一致）。 */
async function ensureLoaded(): Promise<void> {
  if (!bundle.value && !error.value) await run()
}

defineExpose({ run, ensureLoaded })
</script>

<template>
  <aside v-if="bundle || error || loading" class="mb-rail">
    <div v-if="error" class="mb-err">
      数据预检失败：{{ error }}（请确认 agent-backend 已启动）
    </div>
    <template v-else-if="bundle">
      <div class="mb-rail-tag" :class="bundle.basis === 'captured' ? 't-real' : 't-mock'">
        数据口径：{{ basisLabel }}
      </div>
      <DataQualityPanel :data="bundle" title="数据预检" :basis="bundle.basis" />
      <MarketSnapshot :data="bundle" title="市场快照" :basis="bundle.basis" />
      <ForecastBandCard :data="forecastBand" title="次日价格预测带" basis="forecast" />
      <RiskChecklist :data="risk" title="风险清单" basis="synthetic" />
    </template>
    <div v-else class="mb-loading">数据预检中…</div>
  </aside>
</template>

<style scoped>
.mb-rail {
  width: 380px; flex: none; overflow-y: auto; padding-right: 2px;
  display: flex; flex-direction: column; gap: 12px;
}
.mb-rail-tag { font-size: var(--font-sm); padding: 5px 10px; border-radius: 8px; align-self: flex-start; }
.mb-rail-tag.t-real { color: #15803d; background: rgba(22, 163, 74, 0.12); }
.mb-rail-tag.t-mock { color: #b45309; background: rgba(245, 158, 11, 0.14); }
.mb-err, .mb-loading {
  font-size: var(--font-md); padding: 12px 16px; background: var(--panel, #fff);
  border: 1px solid var(--line-soft, #e5e7eb); border-radius: 14px;
}
.mb-err { color: #dc2626; }
.mb-loading { color: var(--muted, #667085); }
@media (max-width: 1024px) {
  .mb-rail { width: auto; max-height: 46vh; }
}
</style>
