<script setup lang="ts">
// 扩展预测面板（SP-4b：从原 ML 预测实验室「扩展预测」tab 提取的可复用子组件）。
// 四类后端预测能力：①超短期滚动 ②PatchTST 序列预测 ③中长期日均趋势 ④偏差考核风险。
// 全部计算在 agent-backend（/agent-api/v1/forecast/*），本组件只读 props（地区/目标/训练回看）→ 调用 → 渲染；
// 数据口径 basis 全程标注，不伪装 Mock。每个图独立 echarts 实例，按需 init + tab 切换 resize（父组件经 expose 调）。
import { ref, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import * as echarts from 'echarts'
import DataBasisBadge from '../DataBasisBadge.vue'
import { setCurrentRegionId } from '@/services/region/regionContext'
import {
  runUltraShort, runMidterm, runDeviationRisk, runPatchtstSeq,
  type UltraShortResult, type MidtermResult, type DeviationRiskResult, type PatchtstResult,
} from '@/services/forecast/mlForecastClient'

const props = defineProps<{
  regionId: string
  target: string
  trainDays: number
}>()

const error = ref('')

const timeLabels = Array.from({ length: 96 }, (_, i) => {
  // slot 0 = 00:00 … slot 95 = 23:45，与后端 slot*15/60 口径一致（用 i*15 避免整体晚标 15 分钟）。
  const m = i * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})

// ── 四能力状态 ──
const ultra = ref<UltraShortResult | null>(null); const ultraLoading = ref(false)
const mid = ref<MidtermResult | null>(null); const midLoading = ref(false); const midHorizon = ref(14)
const dev = ref<DeviationRiskResult | null>(null); const devLoading = ref(false)
const patch = ref<PatchtstResult | null>(null); const patchLoading = ref(false)

// ── echarts 实例管理（每图一个容器/实例，按需 init + 切换 resize）──
const elUltra = ref<HTMLDivElement | null>(null)
const elMid = ref<HTMLDivElement | null>(null)
const elPatch = ref<HTMLDivElement | null>(null)
const charts: Record<string, echarts.ECharts | null> = { ultra: null, mid: null, patch: null }
function paint(key: string, el: HTMLDivElement | null, option: echarts.EChartsOption) {
  if (!el) return
  if (!charts[key]) charts[key] = echarts.init(el)
  charts[key]!.setOption(option, true)
}
function lineSeries(name: string, data: number[], color: string): echarts.SeriesOption {
  // target=price 为分时电价(按时段恒定)→阶梯线；load 等连续量→直线
  // timeLabels 为时段起点标签(slot0=00:00)，须用 step:'end'——'start' 会把横段画成下一槽的值、错位一格(codex #335 P2)
  return { name, type: 'line', ...(props.target === 'price' ? { step: 'end' as const } : {}), showSymbol: false, data, lineStyle: { width: 2 }, color }
}

// 各卡片独立世代守卫：同卡片连点作废旧请求，切地区/目标作废全部 in-flight；卡片间互不干扰
// （并行运行多个预测各自保留结果，codex P2）。严格地区不串读纪律不变（#1744）。
let ultraGen = 0, midGen = 0, devGen = 0, patchGen = 0
async function doUltra() {
  const gen = ++ultraGen
  ultraLoading.value = true; error.value = ''
  try {
    setCurrentRegionId(props.regionId)
    const r = await runUltraShort({ region_id: props.regionId, target: props.target, train_days: props.trainDays, data_source: 'auto' })
    if (gen !== ultraGen) return // 期间切了地区/目标 → 丢弃旧结果
    ultra.value = r
    await nextTick()
    paint('ultra', elUltra.value, {
      tooltip: { trigger: 'axis' }, grid: { left: 56, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: timeLabels, axisLabel: { interval: 15 } },
      yAxis: { type: 'value', scale: true }, series: [lineSeries('超短期滚动', r.points, '#67c23a')],
    })
  } catch (e) { error.value = (e as Error).message || '超短期预测失败：后端不可达？' } finally { ultraLoading.value = false }
}
async function doMidterm() {
  const gen = ++midGen
  midLoading.value = true; error.value = ''
  try {
    setCurrentRegionId(props.regionId)
    const r = await runMidterm({ region_id: props.regionId, target: props.target, train_days: props.trainDays, data_source: 'auto' }, midHorizon.value)
    if (gen !== midGen) return
    mid.value = r
    await nextTick()
    paint('mid', elMid.value, {
      tooltip: { trigger: 'axis' }, grid: { left: 56, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: r.daily_avg_price.map((_, i) => `D+${i + 1}`) },
      yAxis: { type: 'value', name: r.unit, scale: true },
      series: [{ name: '日均价', type: 'bar', data: r.daily_avg_price, color: '#e6a23c' }],
    })
  } catch (e) { error.value = (e as Error).message || '中长期趋势失败：后端不可达？' } finally { midLoading.value = false }
}
async function doDeviation() {
  const gen = ++devGen
  devLoading.value = true; error.value = ''
  try {
    setCurrentRegionId(props.regionId)
    const r = await runDeviationRisk({ region_id: props.regionId, target: 'load', train_days: props.trainDays, data_source: 'auto', tolerance_pct: 3, assessment_price: 100 })
    if (gen !== devGen) return
    dev.value = r
  } catch (e) { error.value = (e as Error).message || '偏差风险失败：后端不可达？' } finally { devLoading.value = false }
}
async function doPatchtst() {
  const gen = ++patchGen
  patchLoading.value = true; error.value = ''
  try {
    setCurrentRegionId(props.regionId)
    const r = await runPatchtstSeq({ region_id: props.regionId, target: props.target, train_days: props.trainDays, data_source: 'auto' })
    if (gen !== patchGen) return
    patch.value = r
    // 不可用(无 torch / 样本<30)：后端只回 {available:false,reason}，无 points/指标。
    // 仅经模板显示 reason，绝不绘图(否则 r.points=undefined 喂 ECharts、模板 .toFixed 崩溃，B18)。
    // 并清空上一轮可能残留的旧曲线，避免「当前不可用原因 + 旧地区/窗口曲线」并存的串读式误导。
    if (!r.available) { charts.patch?.clear(); return }
    await nextTick()
    paint('patch', elPatch.value, {
      tooltip: { trigger: 'axis' }, grid: { left: 56, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: timeLabels, axisLabel: { interval: 15 } },
      yAxis: { type: 'value', scale: true }, series: [lineSeries('次日序列', r.points, '#9b59b6')],
    })
  } catch (e) { error.value = (e as Error).message || 'PatchTST 失败：后端不可达？' } finally { patchLoading.value = false }
}

// 地区/目标切换 → 作废全部 in-flight 请求并清空旧结果与图（4 个独立 gen 同时 ++），避免别地区/别目标的旧曲线残留被误读（严格地区不串读纪律）。
watch(() => [props.regionId, props.target], () => {
  ultraGen++; midGen++; devGen++; patchGen++ // 作废全部进行中的 doX（旧地区请求 resolve 后被各自 gen 校验丢弃）
  ultra.value = null; mid.value = null; dev.value = null; patch.value = null
  error.value = ''
  Object.values(charts).forEach((c) => c?.clear())
})

function resize() { Object.values(charts).forEach((c) => c?.resize()) }
defineExpose({ resize })

onMounted(() => window.addEventListener('resize', resize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  Object.values(charts).forEach((c) => c?.dispose())
})
</script>

<template>
  <div class="extra-panel">
    <p class="hint">扩展预测能力（超短期/中长期/偏差/序列）由 agent-backend 计算，沿用共享任务栏的地区/目标/历史范围；各卡片按需运行。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon style="margin: 4px 0 10px" />
    <el-row :gutter="12">
      <el-col :span="12" :xs="24">
        <div class="ext-card">
          <div class="ext-hd"><span>超短期滚动（下一 15min）</span>
            <el-button size="small" :loading="ultraLoading" @click="doUltra">运行</el-button>
            <DataBasisBadge v-if="ultra" :basis="ultra.basis" />
          </div>
          <p class="hint">用最近时段实际值滚动外推，误差远低于日前预测；horizon：{{ ultra?.horizon ?? '—' }}。</p>
          <div ref="elUltra" class="chart sm" v-loading="ultraLoading"></div>
        </div>
      </el-col>
      <el-col :span="12" :xs="24">
        <div class="ext-card">
          <div class="ext-hd"><span>PatchTST 序列预测（前日 96 点 → 次日 96 点）</span>
            <el-button size="small" :loading="patchLoading" @click="doPatchtst">运行</el-button>
            <DataBasisBadge v-if="patch && patch.available" :basis="patch.basis" />
          </div>
          <p class="hint" v-if="patch && patch.available">
            样本外 {{ patch.n_test_days }} 天 · MAE {{ patch.mae.toFixed(1) }} · MASE {{ patch.mase_vs_persistence?.toFixed(3) ?? '—' }}
            <el-tag size="small" :type="patch.beats_persistence ? 'success' : 'danger'">{{ patch.beats_persistence ? '胜持续基线' : '未胜基线' }}</el-tag>
          </p>
          <p class="hint" v-else-if="patch && !patch.available">{{ patch.reason }}</p>
          <p class="hint" v-else>深度时序模型；接入 darts/neuralforecast 后为真实 PatchTST。</p>
          <div ref="elPatch" class="chart sm" v-loading="patchLoading"></div>
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
.hint { color: var(--el-text-color-secondary); font-size: 12px; margin: 0 0 8px; }
.lbl { color: var(--el-text-color-secondary); font-size: 13px; }
.chart { width: 100%; height: 360px; }
.chart.sm { height: 240px; }
.ext-card { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
.ext-hd { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; margin-bottom: 4px; flex-wrap: wrap; }
</style>
