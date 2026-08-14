<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { TagProps } from 'element-plus'
import { getForecastFeaturePackage, listForecastScenarios, runForecast, type ForecastFeaturePackage, type ForecastScenario } from '@/services/forecast/forecast'

const route = useRoute()
const loading = ref(false)
const scenarioLoading = ref(false)
const forecastScenarios = ref<ForecastScenario[]>([])
const result = ref<Awaited<ReturnType<typeof runForecast>> | null>(null)
const featurePackage = ref<ForecastFeaturePackage | null>(null)
const form = ref({
  area: '华北',
  date: '2026-05-27',
  scenario: 'base'
})

const target = computed<'load' | 'price' | 'strategy'>(() => {
  if (route.path.includes('price')) return 'price'
  if (route.path.includes('strategy')) return 'strategy'
  return 'load'
})

const pageName = computed(() => {
  if (target.value === 'price') return '电价预测'
  if (target.value === 'strategy') return '交易策略'
  return '负荷预测'
})

const primaryUnit = computed(() => (target.value === 'price' ? '元/MWh' : 'MWh'))
const forecastExplanation = computed(() => result.value?.explanation ?? null)
const forecastBaseline = computed(() => forecastExplanation.value?.baseline ?? null)
const forecastPeak = computed(() => forecastBaseline.value?.peakForecast ?? result.value?.loadPeak ?? 0)
const forecastAverage = computed(() => forecastBaseline.value?.averageForecast ?? result.value?.avgPrice ?? 0)
const explanationSummary = computed(() => forecastExplanation.value?.summary ?? result.value?.advice ?? '')
const decisionTrace = computed(() => forecastExplanation.value?.decisionTrace ?? null)
const topFeatureSources = computed(() => featurePackage.value?.sourceFamilies.slice(0, 6) ?? [])

function levelTagType(level: 'low' | 'medium' | 'high' | string): TagProps['type'] {
  if (level === 'high') return 'danger'
  if (level === 'medium') return 'warning'
  return 'success'
}

function directionLabel(direction: 'up' | 'down' | 'flat' | string) {
  if (direction === 'up') return '上行'
  if (direction === 'down') return '下行'
  return '平稳'
}

function postureLabel(posture: string) {
  if (posture === 'defensive') return '防御'
  if (posture === 'opportunistic') return '机会'
  return '中性'
}

async function execute() {
  loading.value = true
  try {
    const request = { ...form.value, target: target.value }
    const [packageResult, forecastResult] = await Promise.all([
      getForecastFeaturePackage(request),
      runForecast(request)
    ])
    featurePackage.value = packageResult
    result.value = forecastResult
    ElMessage.success('预测完成')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  scenarioLoading.value = true
  try {
    forecastScenarios.value = await listForecastScenarios()
    await execute()
  } finally {
    scenarioLoading.value = false
  }
})
</script>

<template>
  <div class="page-stack">
    <section class="panel">
      <div class="panel-title">
        <h2>{{ pageName }}</h2>
        <span>当前为静态预测服务，后续替换为模型接口</span>
      </div>
      <div class="toolbar forecast-toolbar">
        <el-select v-model="form.area" placeholder="区域">
          <el-option label="华北" value="华北" />
          <el-option label="山西" value="山西" />
          <el-option label="蒙西" value="蒙西" />
        </el-select>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" />
        <el-select v-model="form.scenario" placeholder="情景">
          <el-option v-for="item in forecastScenarios" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-button type="primary" :loading="loading || scenarioLoading" @click="execute">运行预测</el-button>
      </div>
    </section>

    <section v-if="result" class="content-grid three-columns">
      <div class="panel compact">
        <span>预测峰值</span>
        <strong>{{ forecastPeak.toLocaleString() }} {{ primaryUnit }}</strong>
      </div>
      <div class="panel compact">
        <span>平均预测</span>
        <strong>{{ forecastAverage.toLocaleString() }} {{ primaryUnit }}</strong>
      </div>
      <div class="panel compact">
        <span>风险评分</span>
        <strong>{{ result.metrics.riskScore }}</strong>
      </div>
    </section>

    <section v-if="result" class="panel">
      <div class="panel-title">
        <h2>策略建议</h2>
        <span>{{ result.name }} · {{ postureLabel(decisionTrace?.posture ?? result.strategyAdvice.posture) }}</span>
      </div>
      <p class="advice">{{ explanationSummary }}</p>
      <div v-if="forecastBaseline && forecastExplanation" class="forecast-insight-grid">
        <article>
          <span>峰谷区间</span>
          <strong>{{ forecastBaseline.peakHour }} / {{ forecastBaseline.valleyHour }}</strong>
          <small>价差/负荷差 {{ forecastBaseline.spread.toLocaleString() }} {{ primaryUnit }}</small>
        </article>
        <article>
          <span>置信等级</span>
          <strong>{{ forecastExplanation.confidenceBand }}</strong>
          <small>场景置信度 {{ result.confidence }}%</small>
        </article>
        <article>
          <span>误差指标</span>
          <strong>MAPE {{ result.metrics.mapePct }}%</strong>
          <small>波动指数 {{ result.metrics.volatilityIndex }}</small>
        </article>
      </div>
    </section>

    <section v-if="forecastExplanation" class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>输入驱动</h2>
          <span>{{ forecastExplanation.featureSchemaVersion }}</span>
        </div>
        <el-table :data="forecastExplanation.featureDrivers" height="260">
          <el-table-column prop="name" label="特征" min-width="120" />
          <el-table-column label="方向" width="86">
            <template #default="{ row }">
              <el-tag :type="row.direction === 'up' ? 'warning' : row.direction === 'down' ? 'success' : 'info'" effect="plain">
                {{ directionLabel(row.direction) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="权重" width="88">
            <template #default="{ row }">{{ Math.round(row.weight * 100) }}%</template>
          </el-table-column>
          <el-table-column prop="rationale" label="说明" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>风险贡献</h2>
          <span>{{ forecastExplanation.riskContributions.length }} 项</span>
        </div>
        <el-table :data="forecastExplanation.riskContributions" height="260">
          <el-table-column prop="name" label="风险" min-width="120" />
          <el-table-column label="等级" width="84">
            <template #default="{ row }">
              <el-tag :type="levelTagType(row.level)" effect="plain">{{ row.level }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="贡献" width="86">
            <template #default="{ row }">{{ row.contributionPct }}%</template>
          </el-table-column>
          <el-table-column prop="mitigation" label="控制措施" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </section>

    <section v-if="decisionTrace" class="panel">
      <div class="panel-title">
        <h2>动作跟踪</h2>
        <span>{{ decisionTrace.summary }}</span>
      </div>
      <el-table :data="decisionTrace.recommendedActions" height="220">
        <el-table-column prop="timeWindow" label="窗口" width="120" />
        <el-table-column prop="target" label="目标" width="100" />
        <el-table-column label="优先级" width="96">
          <template #default="{ row }">
            <el-tag :type="levelTagType(row.priority)" effect="plain">{{ row.priority }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="recommendation" label="建议" min-width="220" />
        <el-table-column prop="riskControl" label="风控条件" min-width="220" />
      </el-table>
      <div class="watch-list">
        <el-tag v-for="item in decisionTrace.watchItems" :key="item" effect="plain">
          {{ item }}
        </el-tag>
      </div>
    </section>

    <section v-if="featurePackage" class="panel">
      <div class="panel-title">
        <h2>模型输入特征包</h2>
        <span>{{ featurePackage.packageSchemaVersion }} · {{ featurePackage.runtimeStatus }} · {{ featurePackage.featureCount }} 项特征</span>
      </div>

      <div class="forecast-feature-summary">
        <article>
          <span>模型</span>
          <strong>{{ featurePackage.model.modelKey }}</strong>
          <small>{{ featurePackage.featureSchemaVersion }}</small>
        </article>
        <article>
          <span>覆盖合同</span>
          <strong>{{ featurePackage.overrideContract.acceptedRequestKey }}</strong>
          <small>{{ featurePackage.overrideContract.mergeRule }}</small>
        </article>
        <article>
          <span>私有缓存</span>
          <strong>{{ featurePackage.privateCacheTargets.length }}</strong>
          <small>{{ featurePackage.privateCacheTargets.map((item) => item.namespace).join(', ') }}</small>
        </article>
      </div>

      <section class="content-grid two-columns">
        <div>
          <h3 class="subsection-title">来源业务族</h3>
          <div class="feature-source-list">
            <article v-for="source in topFeatureSources" :key="source.family">
              <strong>{{ source.family }}</strong>
              <span>{{ source.localApis.join(', ') }}</span>
              <small>{{ source.featureKeys.join(', ') }}</small>
            </article>
          </div>
        </div>

        <div>
          <h3 class="subsection-title">特征明细</h3>
          <el-table :data="featurePackage.featureRows" height="260" border>
            <el-table-column prop="featureKey" label="特征键" min-width="170" fixed="left" />
            <el-table-column prop="label" label="含义" min-width="120" />
            <el-table-column prop="value" label="静态值" width="110" />
            <el-table-column prop="sourceFamily" label="来源族" min-width="130" />
            <el-table-column prop="localApi" label="本地 API" min-width="220" show-overflow-tooltip />
            <el-table-column prop="modelUse" label="模型用途" min-width="220" show-overflow-tooltip />
          </el-table>
        </div>
      </section>

      <div class="restore-notes feature-policy">
        <p>{{ featurePackage.gitPolicy }}</p>
      </div>
    </section>

    <section v-if="result" class="panel">
      <div class="panel-title">
        <h2>预测曲线</h2>
        <span>{{ result.granularity }} · {{ result.horizonHours }}h</span>
      </div>
      <el-table :data="result.series" height="360">
        <el-table-column prop="hour" label="时段" width="100" />
        <el-table-column prop="actual" label="历史/基准" />
        <el-table-column prop="forecast" label="预测值" />
        <el-table-column prop="lowerBound" label="下界" />
        <el-table-column prop="upperBound" label="上界" />
        <el-table-column prop="confidence" label="置信度" />
      </el-table>
    </section>
  </div>
</template>
