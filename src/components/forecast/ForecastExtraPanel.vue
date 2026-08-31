<script setup lang="ts">
// 扩展预测面板（SP-4b：从原 ML 预测实验室「扩展预测」tab 提取的可复用子组件）。
// 三类后端预测能力：①超短期滚动 ②中长期日均趋势 ③偏差考核风险。
// 全部计算在 agent-backend（/agent-api/v1/forecast/*），本组件只读 props（地区/目标/训练回看）→ 调用 → 渲染；
// 数据口径 basis 全程标注，不伪装 Mock。每个图独立 echarts 实例，按需 init + tab 切换 resize（父组件经 expose 调）。
import { computed, ref, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import * as echarts from 'echarts'
import DataBasisBadge from '../DataBasisBadge.vue'
import { setCurrentRegionId } from '@/services/region/regionContext'
import { nativeSlotsForTarget } from '@/services/forecast/forecastProviders'
import {
  runUltraShort, runMidterm, runDeviationRisk,
  type UltraShortResult, type MidtermResult, type DeviationRiskResult,
} from '@/services/forecast/mlForecastClient'

const props = defineProps<{
  regionId: string
  target: string
  trainDays: number
}>()

const timeLabels = Array.from({ length: 96 }, (_, i) => {
  // slot 0 = 00:00 … slot 95 = 23:45，与后端 slot*15/60 口径一致（用 i*15 避免整体晚标 15 分钟）。
  const m = i * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})
function ultraLabels(count: number): string[] {
  return count === 96 ? timeLabels : Array.from({ length: count }, (_, i) => `第${i + 1}步`)
}
function ultraFinitePoints(points: unknown): number[] | null {
  if (!Array.isArray(points) || points.length === 0) return null
  return points.every((value) => typeof value === 'number' && Number.isFinite(value)) ? points : null
}
function unavailableReasonOf(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  return (result as { available?: boolean; reason?: unknown }).available === false
    ? String((result as { reason?: unknown }).reason ?? '').trim() || '当前预测能力暂不可用，服务未返回具体原因'
    : ''
}

// 三能力状态
const ultra = ref<UltraShortResult | null>(null); const ultraLoading = ref(false)
const ultraError = ref('')
const mid = ref<MidtermResult | null>(null); const midLoading = ref(false); const midHorizon = ref(14)
const midError = ref('')
const dev = ref<DeviationRiskResult | null>(null); const devLoading = ref(false)
const devError = ref('')

const ultraNativeSlots = computed(() => nativeSlotsForTarget(props.target))
function ultraUnsupportedReason(target: string, slotsPerDay: number): string {
  if (slotsPerDay === 96) return ''
  if (target === 'price_user_da_settlement' || target === 'price_user_rt_settlement') {
    return '当前标的是小时结算价（24 点），不是 15 分钟目标，不能用于超短期滚动检验。'
  }
  return `当前目标登记为 ${slotsPerDay} 点/日，不是 15 分钟序列，不能用于超短期滚动检验。`
}
const ultraBlockedReason = computed(() => ultraUnsupportedReason(props.target, ultraNativeSlots.value))
const ultraHorizon = computed(() => (ultra.value && ultra.value.available !== false ? ultra.value.horizon : '—'))
const ultraHint = computed(() => ultraBlockedReason.value
  || `当前后端返回的是最新历史日的历史逐时段滚动检验，不读取共享预测日期，也不是实时未来整天曲线；horizon：${ultraHorizon.value}。`)

// echarts 实例管理（每图一个容器/实例，按需 init + 切换 resize）
const elUltra = ref<HTMLDivElement | null>(null)
const elMid = ref<HTMLDivElement | null>(null)
const charts: Record<string, echarts.ECharts | null> = { ultra: null, mid: null }
function paint(key: string, el: HTMLDivElement | null, option: echarts.EChartsOption) {
  if (!el) return
  if (!charts[key]) charts[key] = echarts.init(el)
  charts[key]!.setOption(option, true)
}
function lineSeries(name: string, data: number[], color: string): echarts.SeriesOption {
  // target=price 为分时电价(按时段恒定)→阶梯线；load 等连续量→直线
  // timeLabels 为时段起点标签(slot0=00:00)，须用 step:'end'，'start' 会把横段画成下一槽的值、错位一格(#335)
  return {
    name,
    type: 'line',
    ...(props.target === 'price' ? { step: 'end' as const } : {}),
    showSymbol: data.length <= 1,
    symbolSize: data.length <= 1 ? 8 : 4,
    data,
    lineStyle: { width: 2 },
    color,
  }
}
function clearChart(key: keyof typeof charts) { charts[key]?.clear() }
function clearUltraState(resetLoading = false) {
  ultra.value = null
  ultraError.value = ''
  clearChart('ultra')
  if (resetLoading) ultraLoading.value = false
}
function clearMidState(resetLoading = false) {
  mid.value = null
  midError.value = ''
  clearChart('mid')
  if (resetLoading) midLoading.value = false
}
function clearDevState(resetLoading = false) {
  dev.value = null
  devError.value = ''
  if (resetLoading) devLoading.value = false
}

// 各卡片独立世代守卫：同卡片连点作废旧请求，切地区/目标作废全部 in-flight；卡片间互不干扰
// （并行运行多个预测各自保留结果）。严格地区不串读纪律不变（#1744）。
let ultraGen = 0, midGen = 0, devGen = 0
async function doUltra() {
  const gen = ++ultraGen
  ultraLoading.value = true
  clearUltraState()
  if (ultraBlockedReason.value) {
    ultraError.value = ultraBlockedReason.value
    ultraLoading.value = false
    return
  }
  try {
    setCurrentRegionId(props.regionId)
    const r = await runUltraShort({ region_id: props.regionId, target: props.target, train_days: props.trainDays, data_source: 'auto' })
    if (gen !== ultraGen) return // 期间切了地区/目标 → 丢弃旧结果
    if (r.available === false) {
      ultraError.value = r.reason || '超短期结果当前不可用'
      return
    }
    const points = ultraFinitePoints(r.points)
    if (!points) {
      ultraError.value = (r.reason || '').trim() || '超短期暂无可展示的逐时段结果'
      return
    }
    ultra.value = { ...r, points }
    await nextTick()
    if (gen !== ultraGen) return
    paint('ultra', elUltra.value, {
      tooltip: { trigger: 'axis' }, grid: { left: 56, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: ultraLabels(points.length), axisLabel: { interval: points.length === 96 ? 15 : 0 } },
      yAxis: { type: 'value', scale: true }, series: [lineSeries('超短期滚动', points, '#67c23a')],
    })
  } catch (e) {
    if (gen !== ultraGen) return
    clearUltraState()
    ultraError.value = (e as Error).message || '超短期预测失败'
  } finally {
    if (gen === ultraGen) ultraLoading.value = false
  }
}
async function doMidterm() {
  const gen = ++midGen
  midLoading.value = true
  clearMidState()
  try {
    setCurrentRegionId(props.regionId)
    const r = await runMidterm({ region_id: props.regionId, target: props.target, train_days: props.trainDays, data_source: 'auto' }, midHorizon.value)
    if (gen !== midGen) return
    const unavailableReason = unavailableReasonOf(r)
    if (unavailableReason) {
      midError.value = unavailableReason
      return
    }
    mid.value = r
    await nextTick()
    if (gen !== midGen) return
    paint('mid', elMid.value, {
      tooltip: { trigger: 'axis' }, grid: { left: 56, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: r.daily_avg_price.map((_, i) => `D+${i + 1}`) },
      yAxis: { type: 'value', name: r.unit, scale: true },
      series: [{ name: '日均价', type: 'bar', data: r.daily_avg_price, color: '#e6a23c' }],
    })
  } catch (e) {
    if (gen !== midGen) return
    clearMidState()
    midError.value = (e as Error).message || '中长期趋势失败'
  } finally {
    if (gen === midGen) midLoading.value = false
  }
}
async function doDeviation() {
  const gen = ++devGen
  devLoading.value = true
  clearDevState()
  try {
    setCurrentRegionId(props.regionId)
    const r = await runDeviationRisk({ region_id: props.regionId, target: 'load', train_days: props.trainDays, data_source: 'auto', tolerance_pct: 3, assessment_price: 100 })
    if (gen !== devGen) return
    const unavailableReason = unavailableReasonOf(r)
    if (unavailableReason) {
      devError.value = unavailableReason
      return
    }
    dev.value = r
  } catch (e) {
    if (gen !== devGen) return
    clearDevState()
    devError.value = (e as Error).message || '偏差风险失败'
  } finally {
    if (gen === devGen) devLoading.value = false
  }
}
function invalidateExtraRequests() {
  ultraGen++; midGen++; devGen++
  clearUltraState(true)
  clearMidState(true)
  clearDevState(true)
}
// 地区/目标/历史窗切换 → 作废全部 in-flight 请求并清空旧结果与图，避免旧上下文曲线/错误残留。
watch(() => [props.regionId, props.target, props.trainDays], invalidateExtraRequests)

function resize() { Object.values(charts).forEach((c) => c?.resize()) }
defineExpose({ resize })

onMounted(() => window.addEventListener('resize', resize))
onBeforeUnmount(() => {
  invalidateExtraRequests()
  window.removeEventListener('resize', resize)
  Object.values(charts).forEach((c) => c?.dispose())
})
</script>

<template>
  <div class="extra-panel">
    <p class="hint">扩展预测能力由后端计算；各卡片独立运行。当前超短期只沿用共享任务栏的地区/目标/历史范围，不读取共享预测日期。</p>
    <el-row :gutter="12">
      <el-col :span="12" :xs="24">
        <div class="ext-card">
          <div class="ext-hd"><span>超短期滚动检验（15 分钟）</span>
            <el-button size="small" :loading="ultraLoading" :disabled="!!ultraBlockedReason" :title="ultraBlockedReason || ''" @click="doUltra">运行</el-button>
            <DataBasisBadge v-if="ultra && ultra.available !== false" :basis="ultra.basis" />
          </div>
          <p class="hint">{{ ultraHint }}</p>
          <el-alert v-if="ultraError" :title="ultraError" type="error" :closable="false" show-icon style="margin: 4px 0 10px" />
          <div ref="elUltra" class="chart sm" v-loading="ultraLoading"></div>
        </div>
      </el-col>
      <el-col :span="12" :xs="24">
        <div class="ext-card">
          <div class="ext-hd"><span>中长期日均趋势</span>
            <span class="lbl">天数</span>
            <el-input-number v-model="midHorizon" :min="7" :max="60" :step="7" size="small" />
            <el-button size="small" :loading="midLoading" @click="doMidterm">运行</el-button>
            <DataBasisBadge v-if="mid" :basis="mid.basis" />
          </div>
          <el-alert v-if="midError" :title="midError" type="error" :closable="false" show-icon style="margin: 4px 0 10px" />
          <p class="hint" v-if="mid">
            MAE {{ mid.mae.toFixed(1) }} {{ mid.unit }} · vs 持续 MASE {{ mid.mase_vs_persistence?.toFixed(3) ?? '—' }}
            <el-tag size="small" :type="mid.beats_persistence ? 'success' : 'danger'">{{ mid.beats_persistence ? '胜持续基线' : '未胜基线' }}</el-tag>
          </p>
          <p class="hint" v-else>服务中长期签约 / 套保的未来 N 天日均电价趋势。</p>
          <div ref="elMid" class="chart sm" v-loading="midLoading"></div>
        </div>
      </el-col>
      <el-col :span="12" :xs="24">
        <div class="ext-card">
          <div class="ext-hd"><span>偏差考核风险（电量）</span>
            <el-button size="small" :loading="devLoading" @click="doDeviation">运行</el-button>
            <DataBasisBadge v-if="dev" :basis="dev.forecast.basis" />
          </div>
          <p class="hint">以概率负荷预测估算申报 vs 实际偏差的罚款期望/最坏值（容差 3%，考核价 100 元/MWh）。</p>
          <el-alert v-if="devError" :title="devError" type="error" :closable="false" show-icon style="margin: 4px 0 10px" />
          <el-descriptions v-if="dev" :column="2" border size="small" style="margin-top: 6px">
            <el-descriptions-item label="期望罚款">{{ dev.deviation_risk.expected_total_penalty_yuan.toLocaleString() }} 元</el-descriptions-item>
            <el-descriptions-item label="最坏罚款">
              <!-- #1649：ci_available=false（未提供 P10/P90，站级 generator 常态）时 worst 已退化为
                   expected，是「确定性口径无下行散布」而非「无下行风险」——不得再按最坏罚款红字展示。 -->
              <el-tag v-if="dev.deviation_risk.ci_available" type="danger" size="small">{{ dev.deviation_risk.worst_total_penalty_yuan.toLocaleString() }} 元</el-tag>
              <span v-else>{{ dev.deviation_risk.worst_total_penalty_yuan.toLocaleString() }} 元（无区间，等同期望）</span>
            </el-descriptions-item>
            <el-descriptions-item label="高风险时段">{{ dev.deviation_risk.high_risk_slots }} / 96</el-descriptions-item>
            <el-descriptions-item label="容差带">±{{ dev.deviation_risk.tolerance_band_mw }} MW（{{ dev.deviation_risk.tolerance_pct }}%）</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.extra-panel { padding-top: 4px; }
.hint { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 0 0 8px; }
.lbl { color: var(--el-text-color-secondary); font-size: var(--font-md); }
.chart { width: 100%; height: 360px; }
.chart.sm { height: 240px; }
.ext-card { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
.ext-hd { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: var(--font-lg); margin-bottom: 4px; flex-wrap: wrap; }
</style>
