<script setup lang="ts">
// 厂站发电预测（G1.3 + G2 真实数据 + G3.3 申报闭环）：
//   选公司·厂站 → 站级发电预测引擎 → 24h 出力曲线（含置信区间 + 装机上限）
//   → 发电侧申报建议（P10/P50/P90 三策略）+ 偏差考核罚款期望/最坏（接省级结算规则）。
// G2：data_source=auto 时后端优先用站级真实出力训练(basis=real)，缺则诚实回退合成；
//     basis/sourceType 由后端按「训练×气象」两维真实度透传，页面如实标注（不伪装真实）。
// G3.3：申报量经 /forecast/bid-advice(generator)，偏差罚款经 /forecast/deviation-risk，
//     考核价/容差/时段系数取自 dljy 结算规则 SettlementRuleSpec（TS settlementFormula 为权威）。
import { onMounted, ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchStations, type CompanyStation } from '@/services/company/companyApi'
import { selectedCompanyId } from '@/services/company/companyContext'
import { selectedRegionId } from '@/services/region/regionContext'
import { getSettlementRuleSpec, assessmentPriceOf, segmentFactorOf } from '../../rules/settlement'
import {
  runStationGeneration, fetchBidAdvice, runDeviationRisk, fetchDayWeather,
  type StationGenerationResult, type GeneratorAdvice, type GeneratorStrategy, type DeviationRiskResult,
  type StationGenerationWeatherPoint,
} from '@/services/forecast/mlForecastClient'
import { useEChart } from '../../composables/useEChart'
import { chartChrome, cssVar } from '../../composables/useTheme'
import { axisTooltip, chartToolbox, emptyOverlay, insideZoom, fmtNum } from '@/services/chart/chartOptions'
import CompanyScopeBar from '@/components/company/CompanyScopeBar.vue'

// 站级可选模型：只列 GenerationPredictionService 真实支持且非占位的本地模型。
//
// 原先此处硬编码了 8 条 `tslib:*`，标签写作「TSLib DLinear」等——但 tslib_adapter 的
// compat 运行时实为 StandardScaler+Ridge 占位（mock=True/source_type=MOCK），标签却不带
// 「占位·Ridge」后缀，正是 Mock 纪律（P1）要防的「前端选到占位、以为用的是真 PatchTST」。
// 其中 4 条（DLinear/PatchTST/TimeXer/FEDformer）已 superseded_by 指向南洋 GPU 上的真实
// Torch 模型而置为不可用，硬编码列表绕过 catalog 的 available 判定，选中即失败；余下 4 条
// 虽仍可用，但运行时同为 Ridge 占位，对站级预测并无价值（本地 XGBoost/LightGBM 更强），
// 故整体摘除而非逐条标注。
//
// 真实深度时序模型（remote:*，Epic #1898）是**云南区域级**、经 agent-backend 转发远程推理，
// 而本页 /station-generation 走 GenerationPredictionService 本地训练路径（站级、按 station_id
// 缓存模型），两者口径不同不可混用——需要真实深度模型请到「预测中心 · 建模工作台」。
const MODELS = [
  { value: 'xgboost', label: 'XGBoost' },
  { value: 'lightgbm', label: 'LightGBM' },
  { value: 'random_forest', label: 'RandomForest' },
  { value: 'stacking', label: 'Stacking 集成' },
]
const STRATEGIES: { value: GeneratorStrategy; label: string; hint: string }[] = [
  { value: 'p50', label: 'P50 中性', hint: '申报=P50，最大化中标电量期望' },
  { value: 'p10', label: 'P10 保守避考核', hint: '申报=P10，少报避欠发被罚' },
  { value: 'expected', label: '期望收益最优', hint: '[P10,P90] 内使 E[收益−罚款] 最大' },
]

const stations = ref<CompanyStation[]>([])
const loading = ref(false)
const predicting = ref(false)
const result = ref<StationGenerationResult | null>(null)
const form = ref({ stationId: null as number | null, modelType: 'xgboost' })

// G3.3 申报闭环状态
const advising = ref(false)
const strategy = ref<GeneratorStrategy>('p50')
const clearingPrice = ref(400)
const advice = ref<GeneratorAdvice | null>(null)
const risk = ref<DeviationRiskResult | null>(null)

const chartRef = ref<HTMLDivElement | null>(null)
const chart = useEChart(chartRef, { render })

const stationOptions = computed(() => {
  const rank = (t: string | null | undefined) => (t === '光伏' ? 0 : t === '风电' ? 1 : 2)
  return [...stations.value].sort((a, b) => rank(a.type) - rank(b.type))
})
const selectedStation = computed(() => stations.value.find((s) => s.id === form.value.stationId) ?? null)

// 站级隔离：偏差考核结算规则跟随厂站所属地区（与上方预测 region_id 同源，见 predict() line 113），
// 不随全局地区切换器漂移，厂站是物理资产、归属地区固定；缺则降级"未参数化"，不静默套别省。
const settlementRegionId = computed(() => String(selectedStation.value?.regionId || selectedRegionId.value))
const settlementRule = computed(() => getSettlementRuleSpec(settlementRegionId.value))
const tolerancePct = computed(() => settlementRule.value?.deviationTolerancePct ?? 3)
const assessmentPrice = computed(() =>
  settlementRule.value ? assessmentPriceOf(settlementRule.value, clearingPrice.value, clearingPrice.value) : 100)
const segmentFactors = computed(() =>
  settlementRule.value ? Array.from({ length: 24 }, (_, h) => segmentFactorOf(settlementRule.value!, h)) : null)

// basis 真实度 → 角标样式/文案（C5 诚实标注）
const sourceTag = computed(() => {
  const t = result.value?.sourceType
  if (t === 'REAL') return { type: 'success' as const, text: '真实(出力+气象)' }
  if (t === 'MIXED') return { type: 'warning' as const, text: '混合(部分真实)' }
  return { type: 'info' as const, text: '合成基线' }
})

async function reloadStations() {
  loading.value = true
  try {
    stations.value = await fetchStations()
    const firstSolar = stationOptions.value[0]
    form.value.stationId = firstSolar ? firstSolar.id : null
    result.value = null
    advice.value = null
    risk.value = null
    render()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载场站失败')
  } finally {
    loading.value = false
  }
}

async function predict() {
  const station = selectedStation.value
  if (!station) {
    ElMessage.warning('请先选择场站')
    return
  }
  predicting.value = true
  chart.showLoading()
  try {
    // #844 G2.2：预测前先取预测日真实 NWP（Open-Meteo），填 weather_points → weather_basis=real。
    // 与 station-generation 同源解析坐标（region_id+station_id），拿不到/部分覆盖则不传 weather_points，
    // 后端自动合成典型日回退 + 既有 warning（前端 toast 如实提示）。fetchDayWeather 自带当日缓存。
    const regionId = String(station.regionId || selectedRegionId.value)
    let weather_points: StationGenerationWeatherPoint[] | undefined
    try {
      const wp = await fetchDayWeather({ region_id: regionId, station_id: String(station.id) })
      // 24 点全覆盖→real；部分覆盖仍传入，后端按覆盖度判 basis（covered<n→synthetic+warning，诚实）
      if (wp.points.length > 0) {
        weather_points = wp.points as StationGenerationWeatherPoint[]
      }
      if (wp.points.length < 24) {
        ElMessage.info(`真实气象仅覆盖 ${wp.points.length}/24 时段，不足部分后端合成典型日`)
      }
    } catch {
      // 真实气象不可用：不传 weather_points，后端合成典型日 + warning；前端如实提示
      ElMessage.info('真实气象暂不可用，使用合成典型日气象（pvlib 晴空）')
    }
    result.value = await runStationGeneration({
      station_id: String(station.id),
      installed_capacity: Number(station.capacity) || 100,
      station_type: station.type ?? '光伏',
      model_type: form.value.modelType,
      region_id: regionId,  // 站级真实出力按厂站所属地区加载
      data_source: 'auto',
      weather_points,
    })
    advice.value = null
    risk.value = null
    render()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '预测失败')
  } finally {
    predicting.value = false
    chart.hideLoading()
  }
}

// G3.3：基于站级 P10/P50/P90 出力出申报量 + 偏差罚款（发电侧 generator）
async function advise() {
  const r = result.value
  if (!r || !r.points.length) {
    ElMessage.warning('请先生成发电预测')
    return
  }
  advising.value = true
  try {
    const p50 = r.points.map((p) => p.power_mw)
    const lower = r.points.map((p) => p.lower_mw)
    const upper = r.points.map((p) => p.upper_mw)
    const bid = await fetchBidAdvice({
      subject_type: 'generator', strategy: strategy.value, clearing_price: clearingPrice.value,
      tolerance_pct: tolerancePct.value, assessment_price: assessmentPrice.value,
      forecast_points: p50, forecast_lower: lower, forecast_upper: upper,
    })
    advice.value = bid.advice.generator ?? null
    const declared = advice.value?.bid_curve.map((c) => c.qty_mw) ?? p50
    risk.value = await runDeviationRisk({
      tolerance_pct: tolerancePct.value, assessment_price: assessmentPrice.value,
      segment_factors: segmentFactors.value ?? undefined, slot_hours: 1,
      declared_mw: declared, actual_points: p50, actual_lower: lower, actual_upper: upper,
    })
    render()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '申报建议失败')
  } finally {
    advising.value = false
  }
}

watch(strategy, () => { if (result.value) advise() })

function render() {
  const cc = chartChrome()
  const primary = cssVar('--primary') || '#409eff'
  const warn = cssVar('--el-color-warning') || '#e6a23c'
  const baselineColor = '#67c23a'   // 晴空基线（无云理论出力），绿色虚线参照
  const actualColor = '#f56c6c'     // 实际出力（历史实测），红色实线参照
  const r = result.value
  const hasData = !!r && r.points.length > 0
  const labels = hasData ? r!.points.map((p) => `${String(p.hour).padStart(2, '0')}:00`) : []
  const power = hasData ? r!.points.map((p) => p.power_mw) : []
  const lower = hasData ? r!.points.map((p) => p.lower_mw) : []
  const band = hasData ? r!.points.map((p) => +(p.upper_mw - p.lower_mw).toFixed(4)) : []
  // #765 PR-2 三线对比：晴空基线（始终有）+ 实际出力（仅历史日有真实数据）
  const clearsky = hasData && r!.clearsky_baseline_mw ? r!.clearsky_baseline_mw.map((p) => p.mw) : []
  const hasActual = hasData && !!r!.actual_mw && r!.actual_mw.length > 0
  const actual = hasActual ? r!.actual_mw!.map((p) => p.mw) : []
  const bidQty = advice.value ? advice.value.bid_curve.map((c) => c.qty_mw) : []
  const cap = r?.installed_capacity_mw ?? 0
  const legendData = ['预测出力', '置信区间', '晴空基线',
    ...(hasActual ? ['实际出力'] : []), ...(advice.value ? ['申报量'] : [])]

  chart.setOption({
    ...emptyOverlay(!hasData, '选择场站与模型后点击「预测」生成 24h 出力曲线'),
    legend: { top: 4, left: 10, data: legendData, textStyle: { fontSize: 11 } },
    tooltip: { ...axisTooltip({ unit: 'MW' }), confine: true },
    toolbox: chartToolbox('厂站发电预测'),
    dataZoom: insideZoom(),
    grid: { left: 56, right: 20, top: hasData ? 40 : 20, bottom: 28 },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { fontSize: 10, color: cc.axisLabel } },
    yAxis: { type: 'value', name: 'MW', min: 0, nameTextStyle: { color: cc.axisLabel, fontSize: 10 }, axisLabel: { fontSize: 10, color: cc.axisLabel }, splitLine: { lineStyle: { color: cc.splitLine } } },
    series: [
      { name: '下限', type: 'line', stack: 'conf', data: lower, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, legendHoverLink: false },
      { name: '置信区间', type: 'line', stack: 'conf', data: band, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, areaStyle: { color: primary, opacity: 0.14 } },
      // 晴空基线：无云理论出力（pvlib 晴空 GHI × 装机 × PR），虚线参照；与实际的差=云量/损耗影响
      { name: '晴空基线', type: 'line', data: clearsky, smooth: false, showSymbol: false, connectNulls: true,
        lineStyle: { width: 2, color: baselineColor, type: 'dashed' } },
      // 实际出力：历史日真实逐时出力回放（未来日缺席，connectNulls=false 缺数显缺口）
      ...(hasActual ? [{
        name: '实际出力', type: 'line', data: actual, smooth: false, showSymbol: false, connectNulls: false,
        lineStyle: { width: 2, color: actualColor },
      }] : []),
      {
        name: '预测出力', type: 'line', data: power, smooth: false, showSymbol: false,
        lineStyle: { width: 2, color: primary },
        areaStyle: { color: primary, opacity: 0.05 },
        markLine: hasData ? {
          symbol: 'none', silent: true,
          lineStyle: { type: 'dashed', color: cc.axisLabel },
          data: [{ yAxis: cap, name: '装机容量' }],
          label: { formatter: `装机 ${fmtNum(cap, 0)} MW`, fontSize: 10, color: cc.axisLabel, position: 'insideEndTop' },
        } : undefined,
      },
      ...(advice.value ? [{
        name: '申报量', type: 'line', data: bidQty, step: 'middle', showSymbol: false,
        lineStyle: { width: 2, color: warn, type: 'dashed' },
      }] : []),
    ],
  }, { notMerge: true })
}

onMounted(reloadStations)
watch(selectedCompanyId, reloadStations)
</script>

<template>
  <div class="sg" v-loading="loading">
    <el-alert :type="result ? (result.sourceType === 'REAL' ? 'success' : result.sourceType === 'MIXED' ? 'warning' : 'info') : 'warning'"
      :closable="false" show-icon class="mb mock-alert">
      <template #title>
        <span v-if="!result">数据口径：站级出力优先用<b>公司台账真实出力</b>训练（缺则合成基线）；预测引擎为<b>真实光伏物理 + ML</b>。</span>
        <span v-else>
          数据口径：训练<b>{{ result.train_basis === 'real' ? '真实出力' : '合成基线' }}</b> ·
          气象<b>{{ result.weather_basis === 'real' ? '真实' : '合成典型日' }}</b>。
        </span>
        <el-tag v-if="result" size="small" :type="sourceTag.type" effect="dark" style="margin-left: 8px">{{ result.sourceType }} · {{ sourceTag.text }}</el-tag>
      </template>
    </el-alert>

    <CompanyScopeBar />

    <div class="toolbar">
      <span class="lbl">场站</span>
      <el-select v-model="form.stationId" placeholder="选择场站" filterable style="width: 240px">
        <el-option v-for="s in stationOptions" :key="s.id" :label="`${s.name}（${s.type ?? '—'}${s.capacity ? ' · ' + s.capacity + 'MW' : ''}）`" :value="s.id" />
      </el-select>
      <span class="lbl">模型</span>
      <el-select v-model="form.modelType" style="width: 210px">
        <el-option v-for="m in MODELS" :key="m.value" :label="m.label" :value="m.value" />
      </el-select>
      <el-button type="primary" :loading="predicting" @click="predict">预测</el-button>
      <span class="spacer" />
      <span v-if="selectedStation && selectedStation.type !== '光伏'" class="hint">注：引擎为光伏物理模型，非光伏类型仅供格式参考</span>
    </div>

    <div class="stats" v-if="result">
      <div class="stat-card"><div class="stat-label">峰值出力</div><div class="stat-value">{{ fmtNum(result.peak_mw, 1) }} <small>MW</small></div></div>
      <div class="stat-card"><div class="stat-label">日发电量</div><div class="stat-value">{{ fmtNum(result.daily_energy_mwh, 0) }} <small>MWh</small></div></div>
      <div class="stat-card"><div class="stat-label">装机容量</div><div class="stat-value">{{ fmtNum(result.installed_capacity_mw, 0) }} <small>MW</small></div></div>
      <div class="stat-card"><div class="stat-label">模型 / 日期</div><div class="stat-value sm">{{ result.model_type }} · {{ result.date }}</div></div>
    </div>

    <el-card shadow="never">
      <template #header><span style="font-weight:600;font-size: var(--font-md)">站级发电量预测 · 24h 出力曲线（晴空基线 / 实际 / 预测 三线对比 + 置信区间 + 装机上限）</span></template>
      <div ref="chartRef" class="chart"></div>
      <div class="tri-hint">
        <span style="color:#67c23a">■</span> 晴空基线 = 无云理论出力（pvlib 晴空 GHI × 装机 × PR=0.8，非实测）；
        <span style="color:#f56c6c">■</span> 实际出力（仅历史日有真实数据回放）。
        晴空基线与实际的差距 = 云量衰减 + 温度/线损等损耗影响；预测线越贴近实际出力越好。
      </div>
    </el-card>

    <!-- G3.3 发电侧申报建议 + 偏差考核风险 -->
    <el-card shadow="never" class="mt" v-if="result">
      <template #header>
        <div class="adv-head">
          <span style="font-weight:600;font-size: var(--font-md)">发电侧申报建议 · 偏差考核风险（预测 → 申报区间 → 罚款期望/最坏）</span>
          <span class="rule-src" v-if="settlementRule">考核口径：{{ settlementRule.regionId }} · {{ settlementRule.version }}（容差 ±{{ tolerancePct }}%）</span>
          <span class="rule-src warn" v-else>当前地区结算规则未参数化，采用通用容差 ±{{ tolerancePct }}%（仅示意）</span>
        </div>
      </template>
      <div class="toolbar adv-toolbar">
        <span class="lbl">申报策略</span>
        <el-radio-group v-model="strategy" size="small">
          <el-radio-button v-for="s in STRATEGIES" :key="s.value" :value="s.value">{{ s.label }}</el-radio-button>
        </el-radio-group>
        <span class="lbl">出清价</span>
        <el-input-number v-model="clearingPrice" :min="0" :max="2000" :step="20" size="small" controls-position="right" style="width: 120px" />
        <span class="unit">元/MWh</span>
        <el-button type="primary" size="small" :loading="advising" @click="advise">生成申报建议</el-button>
        <span class="spacer" />
        <span class="hint">{{ STRATEGIES.find((s) => s.value === strategy)?.hint }}</span>
      </div>

      <div class="stats" v-if="advice && risk">
        <div class="stat-card"><div class="stat-label">申报总量（{{ advice.strategy }}）</div><div class="stat-value">{{ fmtNum(advice.total_declared_mwh, 1) }} <small>MWh</small></div></div>
        <div class="stat-card"><div class="stat-label">P50 期望电量</div><div class="stat-value">{{ fmtNum(advice.p50_total_mwh, 1) }} <small>MWh</small></div></div>
        <div class="stat-card risk"><div class="stat-label">期望偏差罚款</div><div class="stat-value">{{ fmtNum(risk.deviation_risk.expected_total_penalty_yuan, 0) }} <small>元</small></div></div>
        <div class="stat-card risk"><div class="stat-label">最坏偏差罚款（80%CI）</div><div class="stat-value">{{ fmtNum(risk.deviation_risk.worst_total_penalty_yuan, 0) }} <small>元</small></div></div>
        <div class="stat-card"><div class="stat-label">高风险时段</div><div class="stat-value">{{ risk.deviation_risk.high_risk_slots }} <small>段</small></div></div>
      </div>
      <div v-else class="adv-empty">点击「生成申报建议」：基于站级 P10/P50/P90 出力出申报量曲线（叠加于上图），并按当前地区结算规则估算偏差罚款。</div>
      <div class="adv-note" v-if="advice">{{ advice.note }}</div>
    </el-card>
  </div>
</template>

<style scoped>
.sg { padding: 12px 16px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.mb { margin-bottom: 12px; }
.mt { margin-top: 12px; }
.mock-alert :deep(.el-alert__title) { font-size: var(--font-md); }
.toolbar { display: flex; align-items: center; gap: 8px; background: var(--panel); padding: 10px 12px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); flex-wrap: wrap; margin: 12px 0; }
.toolbar .lbl { font-size: var(--font-md); color: var(--el-text-color-regular); font-weight: 600; }
.toolbar .spacer { flex: 1; }
.toolbar .hint { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.toolbar .unit { font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.adv-toolbar { margin: 0 0 12px; }
.adv-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rule-src { font-size: var(--font-sm); color: var(--el-text-color-secondary); font-weight: 400; }
.rule-src.warn { color: var(--el-color-warning); }
.adv-empty { font-size: var(--font-sm); color: var(--el-text-color-secondary); padding: 8px 2px; }
.adv-note { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-top: 6px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; }
.stat-card { background: var(--el-bg-color-overlay, #fff); border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; padding: 12px 14px; }
.stat-card.risk { border-color: var(--el-color-warning-light-5, #f3d19e); }
.stat-label { color: var(--el-text-color-secondary, #909399); font-size: var(--font-sm); margin-bottom: 6px; }
.stat-value { font-size: var(--font-22); font-weight: 600; }
.stat-value small { font-size: var(--font-sm); color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.stat-value.sm { font-size: var(--font-lg); }
.chart { height: 320px; width: 100%; }
.tri-hint { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin-top: 8px; line-height: 1.6; }
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar .spacer { display: none; }
}
</style>
