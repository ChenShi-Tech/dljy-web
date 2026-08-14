<script setup lang="ts">
// S3 方向判断（09:30–10:30）—— 把 S2 的市场判断变成一个可执行的方向决策
//
// 内在逻辑是一条**判据递进链**：
//   S2 市场判断（松紧+价格中枢）→ 预期价差 ΔP（人拍板，可参考 ML 价格预测）
//   → R4 规则表（ΔP × 置信度 × S2 数据暴露系数）→ 偏置档位 → 申报曲线 = 预测负荷 × (1+偏置)。
// 偏置档位不由人拍脑袋：S2 门禁落「可参考」时暴露系数 0.5，偏置自动减半；「仅展示」强制归零
// ——上一步的数据口径**机械地**约束这一步敢押多大。
//
// 曲线生成分两层（此前只有 ①，被指"固化"——正解是把 ② 接上，而非让 ① 更花哨）：
//   ① 形态模板（双峰/平坦/夜间）：无预测数据时的兜底出发点，总量守恒；
//   ② ML 价格预测参考 + AI 建议：复用申报工作台同一套 /agent-api 预测端点，
//      预测数值先算好，AI 只解释"为什么这样建议"，采纳与否由人点按钮。
//
// 方向与价差的号位一致性有校验：判「增持」（预期实时价高于日前）却填负价差，
// 说明两处有一处想错了，界面拦下来让人先想清楚。
import { computed, onMounted, ref } from 'vue'
import { Compass, LineChart, Save, Sparkles, TriangleAlert, Zap } from 'lucide-vue-next'
import { decideBias } from 'shared/trading-rules/demand-bias.mjs'
import { exposureFactorOf, USAGE_GATE_LABEL } from 'shared/trading-rules/data-integrity.mjs'
import { DEFAULT_REGIME_BANDS, REGIME_LABEL } from 'shared/trading-rules/supply-demand.mjs'
import { breakevenSpread } from 'shared/trading-rules/storage-arbitrage.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'
import { applyBias, buildLoadCurve96, LOAD_SHAPE_LABEL, type LoadShapeId } from '@/services/trading/loadShape'
import { runForecastPredict, runMidterm, unavailableReasonOf, type ForecastResult, type MidtermResult } from '@/services/forecast/mlForecastClient'
import { dualCurveDecision, type MidtermCurve } from '@/services/trading/priceDistribution'
import {
  arbitrageWindowList,
  digestOf,
  driftAssessment,
  hourlyPointsOf,
  toHourlyQuantiles,
  type ArbitrageWindowRow,
  type HourlyQuantiles
} from '@/services/trading/priceDistribution'
import { buildOodaDecision, defaultStorageParams, type StorageParams } from '@/services/quant/quant'
import { listStorageAssets, type StorageAsset } from '@/services/trading/storageAssetsClient'
import { currentRegion } from '@/services/region/regionContext'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import AiAssistFill from '@/components/trading/AiAssistFill.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

// ── 上游产出：S2 市场判断 ───────────────────────────────────────────────────
const upstream = computed(() => props.declaration?.preflight?.dataGate ?? null)
const exposureFactor = computed(() =>
  upstream.value ? exposureFactorOf(upstream.value.gate as Parameters<typeof exposureFactorOf>[0]) : 0.5
)

// ── 方向决策输入 ────────────────────────────────────────────────────────────
type Direction = 'add' | 'reduce' | 'hold'
const DIRECTION_LABEL: Record<Direction, string> = { add: '增持', reduce: '减持', hold: '观望' }
const DIRECTION_NOTE: Record<Direction, string> = {
  add: '预期实时价高于日前 → 日前多报锁量',
  reduce: '预期实时价低于日前 → 日前少报、留量吃实时',
  hold: '无足够把握 → 按预测原样申报，不加偏置'
}

const direction = ref<Direction>('hold')
const priceSpread = ref(0) // 预期 ΔP = 实时 − 日前（元/MWh），号位与方向须一致
const confidence = ref(60)
const rationale = ref('')
const rationaleValid = computed(() => rationale.value.trim().length >= 8)

/** 方向与价差号位一致性：判增持却填负价差（或反之），必有一处想错了。 */
const signConflict = computed(() => {
  if (direction.value === 'add') return priceSpread.value <= 0
  if (direction.value === 'reduce') return priceSpread.value >= 0
  return false
})

/** R4 偏置：观望强制零偏置；增持/减持按规则表 + 暴露系数裁剪。 */
const bias = computed(() => {
  if (direction.value === 'hold' || signConflict.value) {
    return { biasRatio: 0, tableRatio: 0, confidence: 'low' as const, reason: direction.value === 'hold' ? '观望：不加偏置，按预测原样申报' : '方向与价差号位冲突，偏置不生效' }
  }
  return decideBias({
    priceSpreadYuanPerMwh: priceSpread.value,
    confidenceScore: confidence.value,
    managementBand: 0.2,
    exposureFactor: effectiveExposureFactor.value
  })
})

// ── 申报曲线生成 ────────────────────────────────────────────────────────────
const totalMwh = ref(960)
const shape = ref<LoadShapeId>('double-peak')
const SHAPES = Object.keys(LOAD_SHAPE_LABEL) as LoadShapeId[]

const baseCurve = computed(() => buildLoadCurve96(totalMwh.value, shape.value))
const declaredCurve = computed(() => applyBias(baseCurve.value, bias.value.biasRatio))
const declaredTotal = computed(() => declaredCurve.value.reduce((a, b) => a + b, 0))

// ── ML 价格预测参考（复用申报工作台同一套 /agent-api 预测端点）─────────────
// 用途：给「预期价差 ΔP」提供数值参照——预测的日内价格形态（峰谷分布、均值）是
// 判断"实时会比日前高还是低"的输入之一。诚实标注：预测服务不在线/数据不可用时
// 显示原因，不编数字。
const forecast = ref<ForecastResult | null>(null)
const forecastLoading = ref(false)
const forecastError = ref('')

async function loadForecast() {
  forecastLoading.value = true
  forecastError.value = ''
  forecast.value = null
  try {
    const r = await runForecastPredict({
      region_id: currentRegion.value.id,
      target: 'price',
      target_date: props.targetDate
    })
    if (r?.unavailable_reason || r?.unavailableReason) {
      forecastError.value = `预测不可用：${unavailableReasonOf(r)}`
    } else {
      forecast.value = r
    }
  } catch (e) {
    forecastError.value = e instanceof Error ? e.message : '预测服务不可达（agent-backend 8000 未起？）'
  } finally {
    forecastLoading.value = false
  }
}

/** 预测分位曲线（P10/P50/P90 → 24 小时聚合）与分布摘要（Z1：看分布而非点价）。 */
const quantiles = computed<HourlyQuantiles | null>(() =>
  forecast.value ? toHourlyQuantiles(forecast.value.lower, forecast.value.points, forecast.value.upper) : null
)

const forecastDigest = computed(() => (quantiles.value ? digestOf(quantiles.value) : null))

/**
 * 模型漂移判定（手册 S3 异常处理：漂移告警 → 回退保守 + 人工加大安全边际）。
 * 漂移时暴露系数机械封顶 0.5（偏置自动减半），不是提示完就算。
 */
const drift = computed(() => driftAssessment(forecast.value?.metrics))
const effectiveExposureFactor = computed(() =>
  drift.value.drifted ? Math.min(exposureFactor.value, 0.5) : exposureFactor.value
)

// ── 储能套利窗口清单（F2.4）+ P90 价差 vs 盈亏平衡自动比对 ──────────────────
// 资产参数取企业档案（同 S4），未建档用默认并如实标注；盈亏平衡用 R3 口径
// （充电价参考取预测谷段 P50；容量收益未计 = 要求价差偏保守，标注说明）。
const assets = ref<StorageAsset[]>([])
const assetNote = ref('')
onMounted(async () => {
  try {
    assets.value = await listStorageAssets()
    if (!assets.value.length) assetNote.value = '企业储能档案未建档——套利窗口按默认参数评估，S4 建档后自动换用'
  } catch {
    assetNote.value = '储能档案读取失败——套利窗口按默认参数评估'
  }
})
const regionAsset = computed(
  () => assets.value.find((a) => a.region === currentRegion.value.id) ?? assets.value[0] ?? null
)
const assetLabel = computed(() =>
  regionAsset.value ? `${regionAsset.value.assetName}（档案）` : '默认参数'
)
const requiredSpread = computed(() => {
  const a = regionAsset.value
  const r = breakevenSpread({
    chargePriceYuanPerMwh: forecastDigest.value?.valley ?? 0,
    roundTripEfficiency: a?.etaRoundTrip ?? 0.87,
    chargeAdderYuanPerMwh: a?.chargeAdderYuanPerMwh ?? 71.56,
    cycleCostYuanPerMwh: a?.cycleCostYuanPerMwh ?? 110,
    // 容量收益（R11）在 S4 计划块按档案容量电价核算，此处未计 → 要求价差偏保守（更高）
    cCapYuanPerMwh: 0,
    cAsYuanPerMwh: 0
  })
  return r.requiredSpreadYuanPerMwh
})
const storageParams = computed<StorageParams>(() => {
  const a = regionAsset.value
  const side = Math.sqrt(a?.etaRoundTrip ?? 0.87) * 100
  return {
    ...defaultStorageParams,
    powerMw: a?.powerMw ?? defaultStorageParams.powerMw,
    energyMwh: a?.capacityMwh ?? defaultStorageParams.energyMwh,
    chargeEfficiency: Math.round(side * 10) / 10,
    dischargeEfficiency: Math.round(side * 10) / 10,
    minSoc: Math.round((a?.socMin ?? 0.1) * 1000) / 10,
    maxSoc: Math.round((a?.socMax ?? 0.9) * 1000) / 10
  }
})
const arbitrageRows = computed<ArbitrageWindowRow[]>(() =>
  quantiles.value ? arbitrageWindowList(quantiles.value, requiredSpread.value) : []
)
/** P90 口径价差超盈亏平衡×1.15 → 「准备执行」信号（手册 S3 步骤④） */
const prepareExecute = computed(() => arbitrageRows.value.some((r) => r.verdict === 'execute'))
/** 凯利仓位上限红线：复用 quant 域 OODA 链（胜率启发式，样本回填后转贝叶斯） */
const kellyCap = computed(() =>
  quantiles.value ? buildOodaDecision(hourlyPointsOf(quantiles.value), storageParams.value).kelly : null
)

// ── 日前 vs 中长期双曲线对比（#2006 · 会议 §5.1）─────────────────────────────
// 中长期侧消费预测域 /midterm 日均价序列（模型活在预测域，本面板只消费结果）；
// 需要显式拉取（中长期预测非每日必跑），拉不到诚实空态不编曲线。
const midterm = ref<MidtermResult | null>(null)
const midtermLoading = ref(false)
const midtermError = ref('')
async function loadMidterm() {
  midtermLoading.value = true
  midtermError.value = ''
  midterm.value = null
  try {
    midterm.value = await runMidterm({ region_id: currentRegion.value.id, target: 'price' }, 14)
  } catch (e) {
    midtermError.value = e instanceof Error ? e.message : '中长期价预测不可达（预测域服务）'
  } finally {
    midtermLoading.value = false
  }
}
const midtermCurve = computed<MidtermCurve | null>(() => {
  const m = midterm.value
  if (!m || !Array.isArray(m.daily_avg_price) || !m.daily_avg_price.length) return null
  return {
    dailyAvgPrice: m.daily_avg_price.map(Number).filter(Number.isFinite),
    maseVsPersistence: Number.isFinite(Number(m.mase_vs_persistence)) ? Number(m.mase_vs_persistence) : null
  }
})
const dualDecision = computed(() =>
  dualCurveDecision(
    forecastDigest.value ? { mean: forecastDigest.value.mean, avgBandWidth: forecastDigest.value.avgBandWidth } : null,
    midtermCurve.value
  )
)
/** 中长期日均价迷你条形（首日=最近可锁价，趋势一眼可见） */
const midtermSpark = computed(() => {
  const p = midtermCurve.value?.dailyAvgPrice ?? []
  if (p.length < 2) return null
  const max = Math.max(...p)
  const min = Math.min(...p)
  return p.map((v, i) => ({ i, v, h: Math.max(6, Math.round(((v - min) / Math.max(max - min, 1e-6)) * 40) + 6) }))
})

/** S2 态势对应的策略速查（F3.1 决策树建议的分档表形态：储能/售电策略各一句）。 */
const regimeBand = computed(() =>
  upstream.value?.regime
    ? DEFAULT_REGIME_BANDS.find((b) => b.regime === upstream.value?.regime) ?? null
    : null
)

/** 分布带状图（SVG path：P90-P10 带 + P50 线），24 小时。 */
const bandChart = computed(() => {
  const q = quantiles.value
  if (!q) return null
  const W = 480
  const H = 150
  const padL = 10
  const padR = 10
  const padT = 10
  const padB = 18
  const all = [...q.p10, ...q.p90]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const x = (h: number) => padL + (h / 23) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - min) / Math.max(max - min, 1e-6)) * (H - padT - padB)
  const line = (arr: number[]) =>
    arr.map((v, h) => `${h === 0 ? 'M' : 'L'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const upper = q.p90.map((v, h) => `${x(h).toFixed(1)},${y(v).toFixed(1)}`)
  const lowerRev = [...q.p10].reverse().map((v, i) => `${x(23 - i).toFixed(1)},${y(v).toFixed(1)}`)
  const band = `M${upper.join(' L')} L${lowerRev.join(' L')} Z`
  return { W, H, band, p50: line(q.p50), p10: line(q.p10), p90: line(q.p90) }
})

// ── AI 建议（判据先算好，AI 解释与建议，人拍板采纳）──────────────────────────
// 注入：S2 判断 + R4 规则表机制 + ML 预测摘要 + 当前人选方向。AI 给出「建议方向 +
// 建议 ΔP 区间 + 理由」，人看后自己改输入框——AI 不直接改任何表单值。
const aiOpen = ref(false)
const aiContext = computed(() => ({
  targetDate: props.targetDate,
  s2Judgement: upstream.value ? {
    regime: upstream.value.regime, priceCenterLow: upstream.value.priceCenterLow,
    priceCenterHigh: upstream.value.priceCenterHigh, gate: upstream.value.gate
  } : null,
  mlPriceForecast: forecastDigest.value,
  quantileBand: quantiles.value ? { avgBandWidth: forecastDigest.value?.avgBandWidth, widestBandHour: forecastDigest.value?.widestBandHour } : null,
  modelDrift: drift.value,
  arbitrageWindows: arbitrageRows.value.length
    ? { requiredSpreadYuanPerMwh: requiredSpread.value, windows: arbitrageRows.value, prepareExecute: prepareExecute.value }
    : null,
  kellyCap: kellyCap.value,
  dualCurve: dualDecision.value,
  mlForecastUnavailable: forecastError.value || null,
  currentInput: { direction: direction.value, priceSpread: priceSpread.value, confidence: confidence.value },
  biasRule: '偏置 = R4 规则表(ΔP×置信度) × 暴露系数(S2 门禁: 可申报1/可参考0.5/仅展示0，模型漂移时封顶0.5)，管理带 ±20%',
  exposureFactor: effectiveExposureFactor.value
}))
// ── AI 辅助填报：方向/ΔP/置信度/理由四项都是**人工经验判断**（无数据库可查）────
// 复用同一份上下文（S2 判断 + ML 预测摘要 + R4 机制），产出结构化建议供一键采纳。
const ASSIST_LABELS = {
  direction: '方向', priceSpread: '预期价差 ΔP', confidence: '置信度', rationale: '决策理由'
}
function applyAssist(s: Record<string, unknown>) {
  if (s.direction === 'add' || s.direction === 'reduce' || s.direction === 'hold') direction.value = s.direction
  if (typeof s.priceSpread === 'number' && Number.isFinite(s.priceSpread)) priceSpread.value = s.priceSpread
  if (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) {
    confidence.value = Math.max(0, Math.min(100, Math.round(s.confidence)))
  }
  if (typeof s.rationale === 'string' && s.rationale.trim()) rationale.value = s.rationale.trim()
}

const aiQuestion = computed(() =>
  `请基于注入上下文给出 S3 方向判断建议。S2 市场判断与 ML 价格预测摘要（如有）已是算好的结果，` +
  `不得改数字。请回答：① 建议方向（增持/减持/观望）及理由——把 S2 松紧、预测峰谷形态、` +
  `与当前人选方向的分歧讲清楚；② 建议的预期价差 ΔP 区间（元/MWh）与置信度，说明依据；` +
  `③ 该建议在 R4 规则表下大约落什么偏置档位；④ 反对意见：什么情形下该建议会错。` +
  `你只建议，采纳与否由交易员自己改左侧输入框。`
)

// ── 写回 ────────────────────────────────────────────────────────────────────
const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')
const written = computed(() => props.declaration?.preflight?.forecast ?? null)

async function writeBack() {
  if (!props.declaration || !rationaleValid.value || signConflict.value) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const updated = await savePreflight(
      props.declaration.id,
      'forecast',
      {
        curveMwh96: declaredCurve.value,
        source: 'S3-direction',
        direction: direction.value,
        confidence: confidence.value,
        biasRatio: bias.value.biasRatio,
        rationale: rationale.value.trim(),
        // 概率分布消费结论（#1963）：分位摘要 + 漂移回退标志 + 套利窗口/P90 比对
        quantileDigest: quantiles.value
          ? {
              ...forecastDigest.value,
              driftFallback: drift.value.drifted || null,
              exposureFactorApplied: effectiveExposureFactor.value
            }
          : null,
        arbitrage: arbitrageRows.value.length
          ? {
              assetLabel: assetLabel.value,
              requiredSpreadYuanPerMwh: requiredSpread.value,
              prepareExecute: prepareExecute.value,
              windows: arbitrageRows.value
            }
          : null,
        kellyCapPct: kellyCap.value?.riskAdjustedFraction ?? null,
        // 双曲线对比结论（#2006）：日前 vs 中长期 + 置信度 + 先后顺序建议
        dualCurve: dualDecision.value
          ? {
              daMean: dualDecision.value.daMean,
              daBandPct: dualDecision.value.daBandPct,
              mltNear: dualDecision.value.mltNear,
              mltAvg: dualDecision.value.mltAvg,
              daPremiumPct: dualDecision.value.daPremiumPct,
              confident: dualDecision.value.confident,
              verdict: dualDecision.value.verdict
            }
          : null
      },
      `S3 方向判断：${DIRECTION_LABEL[direction.value]}（置信 ${confidence.value}），偏置 ${(bias.value.biasRatio * 100).toFixed(1)}%`
    )
    emit('updated', updated)
    saveMsg.value = '方向与申报曲线已写回，S4 申报执行可一键套用'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dr">
    <!-- 上游判断 -->
    <section v-if="upstream?.regime" class="dr-upstream">
      <Compass :size="13" />
      S2 市场判断：<strong>{{ REGIME_LABEL[upstream.regime as keyof typeof REGIME_LABEL] }}</strong>
      <span v-if="upstream.priceCenterLow != null">，均价指引 {{ upstream.priceCenterLow }}–{{ upstream.priceCenterHigh }} 元/MWh</span>
      · 数据门禁 {{ USAGE_GATE_LABEL[upstream.gate as keyof typeof USAGE_GATE_LABEL] }} → 暴露系数
      <strong>{{ exposureFactor }}</strong>
      <template v-if="exposureFactor === 0.5">（偏置自动减半）</template>
      <template v-else-if="exposureFactor === 0">（偏置强制归零）</template>
      <span v-if="regimeBand" class="dr-strategy">
        策略速查（F3.1）：储能「{{ regimeBand.storageStrategy }}」· 售电「{{ regimeBand.retailStrategy }}」（边际机组：{{ regimeBand.marginalUnit }}）
      </span>
    </section>
    <section v-else class="dr-upstream warn">
      <TriangleAlert :size="13" />
      S2 早间分析尚未产出市场判断——方向决策没有依据，暴露系数按 0.5 保守处理。建议
      <button type="button" class="dr-jump" @click="emit('go', 'market-analysis')">先回 S2 完成分析</button>。
    </section>

    <!-- 模型漂移告警（手册 S3 异常处理：回退保守 + 人工加大安全边际） -->
    <section v-if="drift.drifted" class="dr-drift">
      <TriangleAlert :size="13" />
      预测模型漂移告警：{{ drift.reasons.join('；') }}——已回退保守处理（暴露系数封顶 0.5，偏置自动减半），
      请人工加大安全边际后再定方向。
    </section>

    <div class="dr-grid">
      <!-- 方向决策 -->
      <section class="dr-panel">
        <h3>
          方向决策
          <AiAssistFill
            kind="direction"
            :context="aiContext"
            :field-labels="ASSIST_LABELS"
            label="AI 帮我判断方向"
            @apply="applyAssist"
          />
        </h3>
        <div class="dr-directions">
          <label v-for="(label, key) in DIRECTION_LABEL" :key="key" :class="{ on: direction === key }">
            <input v-model="direction" type="radio" :value="key" />
            <strong>{{ label }}</strong>
            <em>{{ DIRECTION_NOTE[key] }}</em>
          </label>
        </div>
        <div class="dr-fields">
          <label>
            预期价差 ΔP（实时−日前，元/MWh）
            <input v-model.number="priceSpread" type="number" step="5" :disabled="direction === 'hold'" />
          </label>
          <label>
            置信度（0–100）
            <input v-model.number="confidence" type="number" min="0" max="100" :disabled="direction === 'hold'" />
          </label>
        </div>
        <p v-if="signConflict" class="dr-conflict">
          方向与价差号位冲突：{{ DIRECTION_LABEL[direction] }}对应
          {{ direction === 'add' ? '正' : '负' }}价差，当前填了 {{ priceSpread }}。两处必有一处想错了。
        </p>
        <label class="dr-rationale">
          决策理由（≥8 字，须可追溯到具体数值；随单据留痕，监管质询时是自证材料）
          <input v-model="rationale" type="text" placeholder="如：高峰供需比 1.04 逼近紧张档，预计实时高于日前 60 元" />
        </label>

        <div class="dr-bias" :class="{ zero: bias.biasRatio === 0 }">
          R4 偏置档位：<strong>{{ (bias.biasRatio * 100).toFixed(1) }}%</strong>
          <template v-if="bias.tableRatio !== bias.biasRatio">
            （规则表 {{ (bias.tableRatio * 100).toFixed(1) }}% × 暴露系数 {{ exposureFactor }}）
          </template>
          <em>{{ bias.reason }}</em>
        </div>
      </section>

      <!-- 申报曲线 -->
      <section class="dr-panel">
        <h3>申报曲线（预测 × 偏置）</h3>
        <div class="dr-fields">
          <label>日预测电量 MWh<input v-model.number="totalMwh" type="number" step="10" /></label>
          <label>
            负荷形态
            <select v-model="shape">
              <option v-for="s in SHAPES" :key="s" :value="s">{{ LOAD_SHAPE_LABEL[s] }}</option>
            </select>
          </label>
        </div>
        <p class="dr-curve-sum">
          基准 {{ totalMwh }} MWh → 申报 <strong>{{ declaredTotal.toFixed(1) }}</strong> MWh
          （偏置 {{ (bias.biasRatio * 100).toFixed(1) }}%）· 96 点，形态生成后可在 S4 逐点微调
        </p>
        <div class="dr-spark">
          <span
            v-for="(v, i) in declaredCurve.filter((_, idx) => idx % 4 === 0)"
            :key="i"
            class="dr-bar"
            :style="{ height: `${Math.max(4, (v / Math.max(...declaredCurve, 0.001)) * 46)}px` }"
            :title="`${String(i).padStart(2, '0')}:00 ≈ ${(v * 4).toFixed(1)} MW`"
          />
        </div>
        <p class="dr-tip">
          预览为逐小时抽样（悬停看功率）。形态模板是兜底出发点（总量守恒）；下方 ML 价格预测
          与 AI 建议给"往哪偏、偏多少"提供参照，S4 还可逐点微调。
        </p>

        <!-- ML 价格预测参考：P10/P50/P90 概率分布上屏（Z1：看分布而非点价） -->
        <h3><LineChart :size="13" /> ML 价格概率分布（P10/P50/P90）</h3>
        <div class="dr-forecast">
          <button type="button" class="dr-fc-btn" :disabled="forecastLoading" @click="loadForecast">
            {{ forecastLoading ? '预测中…' : `跑 ${targetDate} 价格预测` }}
          </button>
          <span v-if="forecastError" class="dr-err">{{ forecastError }}</span>
          <template v-else-if="forecastDigest">
            <span>均值 <strong>{{ forecastDigest.mean }}</strong></span>
            <span>峰 <strong>{{ forecastDigest.peak }}</strong>（{{ forecastDigest.peakHour }} 时）</span>
            <span>谷 <strong>{{ forecastDigest.valley }}</strong>（{{ forecastDigest.valleyHour }} 时）</span>
            <span>峰谷差 <strong>{{ forecastDigest.spread }}</strong></span>
            <span class="dr-band-note" :title="'P90−P10 逐小时均值：带宽越宽不确定性越大，越该保守'">
              平均带宽 <strong>{{ forecastDigest.avgBandWidth }}</strong>（最宽 {{ forecastDigest.widestBandWidth }} @{{ forecastDigest.widestBandHour }} 时）
            </span>
          </template>
          <span v-else-if="!forecastLoading" class="dr-muted">
            未跑——分布与套利窗口需预测在线（agent-backend 8000）
          </span>
        </div>

        <div v-if="bandChart" class="dr-band-chart">
          <svg :viewBox="`0 0 ${bandChart.W} ${bandChart.H}`" role="img" aria-label="价格概率分布带状图：P90-P10 带与 P50 中位线">
            <path :d="bandChart.band" fill="#93c5fd" fill-opacity="0.35" />
            <path :d="bandChart.p10" fill="none" stroke="#60a5fa" stroke-width="1" stroke-dasharray="3 2" />
            <path :d="bandChart.p90" fill="none" stroke="#60a5fa" stroke-width="1" stroke-dasharray="3 2" />
            <path :d="bandChart.p50" fill="none" stroke="#1d4ed8" stroke-width="2" />
            <text v-for="h in [0, 6, 12, 18, 23]" :key="h" :x="10 + (h / 23) * 460" :y="bandChart.H - 4" text-anchor="middle" font-size="9" fill="#889">{{ h }}时</text>
          </svg>
          <p class="dr-band-legend">
            实线 = P50 中位；带 = P90–P10 区间（虚线为两沿）。<strong>决策看带宽不只看中位</strong>——
            高价时段带宽最宽时，按 P10（不利侧）核可做性，见下方套利窗口的保守口径比对。
          </p>
        </div>

        <!-- 套利窗口清单（F2.4，储能立场）+ P90 价差 vs 盈亏平衡自动比对 + 凯利仓位红线 -->
        <div v-if="forecastDigest" class="dr-arb">
          <h4><Zap :size="13" /> 套利窗口清单（储能立场 · 保守口径判级）</h4>
          <p v-if="assetNote" class="dr-arb-note">{{ assetNote }}</p>
          <template v-if="arbitrageRows.length">
            <table class="dr-arb-table">
              <thead>
                <tr><th>充电窗口（谷）</th><th>放电窗口（峰）</th><th>谷价 P50</th><th>峰价 P50</th><th>P50 价差</th><th>P90 保守价差</th><th>判级（vs 要求 {{ requiredSpread }}）</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in arbitrageRows" :key="`${r.chargeFrom}-${r.dischargeFrom}`" :class="r.verdict">
                  <td>{{ r.chargeFrom }}–{{ r.chargeTo + 1 }} 时</td>
                  <td>{{ r.dischargeFrom }}–{{ r.dischargeTo + 1 }} 时</td>
                  <td>{{ r.chargePriceP50 }}</td>
                  <td>{{ r.dischargePriceP50 }}</td>
                  <td>{{ r.p50Spread }}</td>
                  <td><strong>{{ r.conservativeSpread }}</strong></td>
                  <td>{{ r.verdictLabel }}（×{{ r.safetyMultiple }}）</td>
                </tr>
              </tbody>
            </table>
            <p class="dr-arb-verdict" :class="{ exec: prepareExecute }">
              <template v-if="prepareExecute">
                <strong>准备执行</strong>：存在 P90 保守口径价差（峰 P10 − 谷 P90）超过盈亏平衡
                {{ requiredSpread }} 元/MWh × 1.15 的窗口——可进 S4 出充放计划。
              </template>
              <template v-else>
                无「准备执行」信号：各窗口 P90 保守口径未同时超盈亏平衡 × 1.15——按判级列执行或等待窗口。
              </template>
              盈亏平衡要求价差 {{ requiredSpread }} 元/MWh（R3 口径 · 充电价参考取预测谷段 P50 ·
              容量收益未计故偏保守 · 资产参数：{{ assetLabel }}）。
            </p>
          </template>
          <p v-else class="dr-arb-empty">
            预测形态下无可配对的「谷段在前、峰段在后」窗口——不硬凑循环（与 R2 时序可行性同构）。
          </p>
        <!-- 日前 vs 中长期双曲线对比（#2006：会议决策核心输入） -->
        <div class="dr-dual">
          <h4>日前 vs 中长期价 双曲线对比</h4>
          <div class="dr-dual-bar">
            <button type="button" class="dr-fc-btn" :disabled="midtermLoading" @click="loadMidterm">
              {{ midtermLoading ? '取中长期预测中…' : '取中长期价预测（预测域 /midterm · 14 天）' }}
            </button>
            <span v-if="midtermError" class="dr-err">{{ midtermError }}</span>
            <span v-else-if="!midtermCurve && !midtermLoading" class="dr-muted">未取——对比需日前分布与中长期日均价两条曲线齐备</span>
          </div>
          <template v-if="dualDecision">
            <div class="dr-dual-curves">
              <div class="dr-dual-side">
                <span class="dr-dual-title">日前（P50 均值）</span>
                <strong>{{ Math.round(dualDecision.daMean) }}</strong>
                <span class="dr-dual-unit">元/MWh · 带宽 {{ dualDecision.daBandPct }}%</span>
              </div>
              <div class="dr-dual-side">
                <span class="dr-dual-title">中长期（近期/均值）</span>
                <strong>{{ Math.round(dualDecision.mltNear) }}</strong>
                <span class="dr-dual-unit">/ {{ Math.round(dualDecision.mltAvg) }} 元/MWh</span>
              </div>
              <div v-if="midtermSpark" class="dr-dual-spark">
                <span v-for="b in midtermSpark" :key="b.i" class="dr-ms-bar" :style="{ height: b.h + 'px' }" :title="`D+${b.i + 1} ≈ ${Math.round(b.v)}`" />
              </div>
            </div>
            <p class="dr-dual-verdict" :class="`v-${dualDecision.verdict}`">
              <em :class="dualDecision.confident ? 'hi' : 'lo'">{{ dualDecision.confident ? '高置信' : '低置信' }}</em>
              {{ dualDecision.hint }}
              <span class="dr-dual-note">{{ dualDecision.confidenceNote }}</span>
            </p>
          </template>
          <p v-else-if="midtermCurve" class="dr-muted">日前分布未产出（先跑上方价格预测）——双曲线对比需要两条曲线齐备。</p>
        </div>

          <p v-if="kellyCap" class="dr-kelly">
            凯利仓位上限红线：风险折减仓位 <strong>{{ kellyCap.riskAdjustedFraction }}%</strong>
            （半 Kelly {{ kellyCap.halfKellyFraction }}% × 风险预算约束 → 建议不超过
            {{ kellyCap.recommendedMwh }} MWh）——「能挣多少/最多赔多少」先看这条线，禁止满仓裸奔；
            持仓率合规带 80–120% 与凯利上限取更严者。
          </p>
        </div>
      </section>
    </div>

    <!-- AI 建议：判据先算好（S2 判断 + ML 预测摘要 + R4 机制），AI 只解释与建议，人拍板 -->
    <details class="dr-ai" :open="aiOpen" @toggle="aiOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        <Sparkles :size="13" /> AI 方向与曲线建议
        <em>注入 S2 判断 + ML 预测摘要 + R4 规则机制；AI 给建议方向/ΔP 区间/反对意见，不改你的输入——采纳自己改</em>
      </summary>
      <AgentChatPanel
        v-if="aiOpen"
        scenario="declaration_prep"
        :initial-question="aiQuestion"
        :context-payload="aiContext"
        history-key="s3_direction_advice"
      />
    </details>

    <div class="dr-actions">
      <button
        type="button"
        class="primary"
        :disabled="!declaration || !rationaleValid || signConflict || saving"
        @click="writeBack"
      >
        <Save :size="13" /> {{ written ? '更新写回' : '写回并进入 S4 申报执行' }}
      </button>
      <button type="button" class="ghost" @click="emit('go', 'declare')">跳到 S4 申报执行</button>
      <span v-if="saveMsg" class="dr-ok">{{ saveMsg }}</span>
      <span v-if="saveError" class="dr-err">{{ saveError }}</span>
      <span v-if="written" class="dr-ok">
        已写回：{{ DIRECTION_LABEL[(written.direction ?? 'hold') as Direction] }}
        · 申报合计 {{ written.curveMwh96.reduce((a, b) => a + b, 0).toFixed(1) }} MWh（{{ written.writtenBy }}）
      </span>
    </div>
  </div>
</template>

<style scoped>
.dr { display: flex; flex-direction: column; gap: 12px; }
.dr-upstream { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #f8fbff; font-size: 12px; }
.dr-upstream.warn { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
.dr-jump { padding: 0; border: none; background: none; color: #1d4ed8; font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

.dr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
.dr-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.dr-panel h3 { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; margin: 0 0 8px; font-size: 13px; }

.dr-directions { display: flex; gap: 8px; flex-wrap: wrap; }
.dr-directions label { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 8px; cursor: pointer; font-size: 12px; }
.dr-directions label.on { border-color: #2563eb; background: #eff6ff; }
.dr-directions input { display: none; }
.dr-directions em { font-style: normal; font-size: 10px; line-height: 1.5; color: var(--el-text-color-secondary, #667); }

.dr-fields { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.dr-fields label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dr-fields input, .dr-fields select { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }

.dr-conflict { margin: 8px 0 0; padding: 6px 10px; border-radius: 6px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.dr-rationale { display: flex; flex-direction: column; gap: 3px; margin-top: 10px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dr-rationale input { padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }

.dr-bias { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #eff6ff; font-size: 12px; }
.dr-bias.zero { background: #f8fafc; }
.dr-bias em { display: block; margin-top: 2px; font-style: normal; font-size: 11px; color: var(--el-text-color-secondary, #667); }

.dr-curve-sum { margin: 8px 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.dr-spark { display: flex; align-items: flex-end; gap: 2px; height: 50px; padding: 2px 0; }
.dr-bar { flex: 1; background: #93c5fd; border-radius: 1px 1px 0 0; }
.dr-tip { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }

.dr-forecast { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.dr-fc-btn { padding: 4px 12px; border: 1px solid #059669; border-radius: 5px; background: #ecfdf5; color: #047857; font-size: 12px; cursor: pointer; }
.dr-fc-btn:disabled { opacity: .5; cursor: wait; }
.dr-muted { font-size: 11px; color: var(--el-text-color-secondary, #667); }

/* 漂移横幅与策略速查 */
.dr-drift { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; color: #991b1b; font-size: 12px; line-height: 1.6; }
.dr-strategy { width: 100%; font-size: 11px; color: #075985; }

/* 分布带状图 */
.dr-band-chart { margin-top: 10px; }
.dr-band-chart svg { width: 100%; height: auto; display: block; }
.dr-band-legend { margin: 4px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.dr-band-note { font-size: 11px; color: #92400e; cursor: help; }

/* 套利窗口清单 */
.dr-arb { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--el-border-color, #dcdfe6); }
.dr-arb h4 { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; font-size: 12px; }
.dr-arb-note { margin: 0 0 6px; font-size: 11px; color: #b45309; }
.dr-arb-table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
.dr-arb-table th, .dr-arb-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.dr-arb-table th:first-child, .dr-arb-table td:first-child, .dr-arb-table th:nth-child(2), .dr-arb-table td:nth-child(2) { text-align: left; }
.dr-arb-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.dr-arb-table tr.execute td:last-child { color: #15803d; font-weight: 600; }
.dr-arb-table tr.needs_approval td:last-child { color: #92400e; }
.dr-arb-table tr.skip td:last-child { color: #64748b; }
.dr-arb-verdict { margin: 8px 0 0; padding: 6px 9px; border-radius: 6px; background: #f8fafc; font-size: 11px; line-height: 1.7; color: #475569; }
.dr-arb-verdict.exec { background: #f0fdf4; color: #166534; }
.dr-arb-empty { margin: 6px 0 0; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.dr-dual { margin-top: 12px; padding: 8px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; background: #fff; }
.dr-dual h4 { margin: 0 0 6px; font-size: 12px; }
.dr-dual-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dr-dual-curves { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
.dr-dual-side { display: flex; flex-direction: column; gap: 2px; padding: 6px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; }
.dr-dual-title { font-size: 10px; color: var(--el-text-color-secondary, #667); }
.dr-dual-side strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.dr-dual-unit { font-size: 10px; color: var(--el-text-color-secondary, #889); }
.dr-dual-spark { display: flex; align-items: flex-end; gap: 2px; height: 46px; }
.dr-ms-bar { width: 8px; background: #a78bfa; border-radius: 1px 1px 0 0; }
.dr-dual-verdict { margin: 8px 0 0; padding: 6px 10px; border-radius: 6px; font-size: 11px; line-height: 1.7; background: #f8fafc; }
.dr-dual-verdict.v-prefer_spot { background: #f0fdf4; color: #166534; }
.dr-dual-verdict.v-prefer_mlt { background: #eff6ff; color: #1d4ed8; }
.dr-dual-verdict em { font-style: normal; margin-right: 6px; padding: 1px 8px; border-radius: 8px; font-weight: 600; }
.dr-dual-verdict em.hi { background: #dcfce7; color: #15803d; }
.dr-dual-verdict em.lo { background: #fef3c7; color: #92400e; }
.dr-dual-note { display: block; margin-top: 2px; font-size: 10px; color: var(--el-text-color-secondary, #889); }
.dr-kelly { margin: 8px 0 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11px; line-height: 1.7; }

.dr-ai { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; padding: 8px 12px; }
.dr-ai summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.dr-ai summary em { font-style: normal; font-weight: 400; font-size: 10px; color: var(--el-text-color-secondary, #889); }
.dr-ai[open] summary { margin-bottom: 8px; }

.dr-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dr-actions .primary { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; }
.dr-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.dr-actions .ghost { padding: 5px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.dr-ok { font-size: 12px; color: #15803d; }
.dr-err { font-size: 12px; color: #b91c1c; }
</style>
