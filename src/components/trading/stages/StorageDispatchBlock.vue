<script setup lang="ts">
// S4 内的储能充放电计划区块 —— R1 决策单元 / R2 充放选择 / R3 盈亏平衡 / R11 容量折价
//
// v1.0 动线下它不再独占一步：储能立场的交易员在 S4 申报执行时**顺手**做完计划并写回
// （preflight.storagePlan），放行清单的 SOC 两项与安全倍数判据据此自动填充。
//
// 参数模型（2026-08-11 用户拍板）：**档案是资产事实，覆盖是当日决定，两者不混**——
//   · 固定资产/成本参数存企业专有库（market.company_storage_asset，companyId 隔离），
//     申报时「从企业档案载入」而非逐次手填；
//   · 载入后仍可临时改（当日检修降容/政策变化）：改动即视为**当日覆盖**，高亮标出并
//     随 storagePlan 写回申报单留痕，绝不回写档案；
//   · 校验类内容（八项约束）默认收敛为徽章行，有阻断才展开——它是检验不是主角。
//
// 规则推演本身是确定性的（storage-arbitrage.mjs），AI 不重算数字：AI 审查把规则引擎的
// 完整输出作为「工具结果」注入，只做解释、挑风险、反事实追问（见 aiReviewContext 注释）。
//
// 价格序列由使用者给定（可编辑或用预置形态）——本仓无新疆市场数据，不编造价格。
import { computed, onMounted, reactive, ref } from 'vue'
import { CheckCheck, Database, Save, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { listStorageAssets, type StorageAsset } from '@/services/trading/storageAssetsClient'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import { getMarketTiming } from 'shared/trading-rules/market-timing.mjs'
import { currentRegion } from '@/services/region/regionContext'
import {
  ARBITRAGE_VERDICT_LABEL,
  arbitrageVerdict,
  breakevenSpread,
  canDispatch,
  capacityPayment,
  checkDispatchConstraints,
  decisionUnitOf,
  expandToExecutionCurve,
  planDispatch
} from 'shared/trading-rules/storage-arbitrage.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'

const props = defineProps<{ declaration: DeclarationOrder | null }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder] }>()

// ── 价格序列 ────────────────────────────────────────────────────────────────
const PRESETS: Record<string, number[]> = {
  '典型双峰': [
    58, 55, 52, 50, 52, 60, 95, 150, 210, 245, 260, 250,
    230, 218, 225, 240, 275, 330, 420, 445, 390, 300, 180, 96
  ],
  '新能源大发（谷深）': [
    45, 42, 40, 40, 40, 44, 62, 110, 130, 100, 70, 55,
    48, 45, 50, 78, 140, 260, 380, 400, 330, 240, 140, 70
  ],
  '平坦无窗口': new Array(24).fill(205),
  '尖峰在前（先高后低）': [
    430, 425, 410, 400, 380, 350, 300, 260, 220, 190, 170, 150,
    120, 100, 90, 85, 80, 75, 70, 68, 65, 62, 60, 58
  ]
}

const presetName = ref('典型双峰')
const priceText = ref(PRESETS['典型双峰'].join(', '))

function applyPreset(name: string) {
  presetName.value = name
  priceText.value = PRESETS[name].join(', ')
}

const unitPrices = computed(() => {
  const parsed = priceText.value
    .split(/[,，\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
  return parsed.length ? parsed : PRESETS['典型双峰']
})

// ── 资产与成本参数（档案拉取 + 当日覆盖模型）────────────────────────────────
const powerMw = ref(100)
const capacityMwh = ref(600)
const socStart = ref(0.5)      // 运行态：每天不同，恒手填，不属档案
const socTarget = ref(0.5)
const socTolerance = ref(0.03)
const socMin = ref(0.1)
const socMax = ref(0.9)
const etaRoundTrip = ref(0.87)
const cycleCost = ref(110)
const chargeAdder = ref(71.56)
const maxCycles = ref(2)
const rampLimitMw = ref(200)

// 容量电价（R11）
const inCapacityList = ref(true)
const capacityStandard = ref(165)
const dischargeDurationH = ref(6)
const cyclesPerYear = ref(330)
const operatingDod = ref(0.85)

// 其它约束输入（月度累计/履约率是运行态，恒手填）
const monthlyChargeMwh = ref(12_000)
const monthlyQuotaMwh = ref(37_200)
const complianceRatio = ref(1.0)
const identityMixed = ref(false)

// 档案字段 → 本地 ref 的映射（socStart/Target/月度累计/履约率是运行态，刻意不在此表）
const ASSET_BINDINGS = [
  { key: 'powerMw', ref: powerMw, label: '可用功率' },
  { key: 'capacityMwh', ref: capacityMwh, label: '可用容量' },
  { key: 'socMin', ref: socMin, label: 'SOC 下限' },
  { key: 'socMax', ref: socMax, label: 'SOC 上限' },
  { key: 'etaRoundTrip', ref: etaRoundTrip, label: '往返效率' },
  { key: 'cycleCostYuanPerMwh', ref: cycleCost, label: '循环成本' },
  { key: 'chargeAdderYuanPerMwh', ref: chargeAdder, label: '充电加价' },
  { key: 'maxCyclesPerDay', ref: maxCycles, label: '日循环上限' },
  { key: 'rampLimitMw', ref: rampLimitMw, label: '爬坡能力' },
  { key: 'capacityStandardYuanPerKwYear', ref: capacityStandard, label: '容量电价标准' },
  { key: 'dischargeDurationH', ref: dischargeDurationH, label: '放电时长' },
  { key: 'cyclesPerYear', ref: cyclesPerYear, label: '年循环次数' },
  { key: 'operatingDod', ref: operatingDod, label: '运行 DOD' },
  { key: 'monthlyChargeQuotaMwh', ref: monthlyQuotaMwh, label: '月度限额' }
] as const

const assets = ref<StorageAsset[]>([])
const selectedAssetId = ref('')
const assetError = ref('')
/** 档案基线值（载入时快照），用于判定哪些字段被当日覆盖 */
const baseline = reactive<Record<string, number | null>>({})

const loadedAsset = computed(() => assets.value.find((a) => a.id === selectedAssetId.value) ?? null)

/** 当日覆盖清单：与档案基线不一致的字段（高亮 + 随 storagePlan 写回留痕）。 */
const overrides = computed(() => {
  if (!loadedAsset.value) return []
  return ASSET_BINDINGS
    .filter((b) => baseline[b.key] !== null && baseline[b.key] !== undefined && b.ref.value !== baseline[b.key])
    .map((b) => ({ key: b.key, label: b.label, fileValue: baseline[b.key], todayValue: b.ref.value }))
})

function applyAsset(a: StorageAsset) {
  for (const b of ASSET_BINDINGS) {
    const v = a[b.key as keyof StorageAsset]
    if (typeof v === 'number') {
      b.ref.value = v
      baseline[b.key] = v
    } else {
      baseline[b.key] = null
    }
  }
  inCapacityList.value = a.inCapacityList
}

async function loadAssets() {
  assetError.value = ''
  try {
    assets.value = await listStorageAssets()
    if (assets.value.length === 1) {
      selectedAssetId.value = assets.value[0].id
      applyAsset(assets.value[0])
    }
  } catch (e) {
    assetError.value = e instanceof Error ? e.message : '企业资产档案读取失败'
  }
}
function onSelectAsset() {
  const a = loadedAsset.value
  if (a) applyAsset(a)
}
onMounted(loadAssets)

// ── 规则推演 ────────────────────────────────────────────────────────────────
const timing = computed(() => getMarketTiming(currentRegion.value.id))
const decisionUnit = computed(() => (timing.value ? decisionUnitOf(timing.value) : null))

const cCap = computed(() =>
  capacityPayment({
    ratedPowerKw: powerMw.value * 1000,
    standardYuanPerKwYear: capacityStandard.value,
    dischargeDurationH: dischargeDurationH.value,
    denominatorH: 6,
    cyclesPerYear: cyclesPerYear.value,
    usableCapacityMwh: capacityMwh.value,
    operatingDod: operatingDod.value,
    inCapacityList: inCapacityList.value
  })
)

const singleEta = computed(() => Math.sqrt(Math.max(etaRoundTrip.value, 0.01)))

const breakevenBase = computed(() => ({
  chargePriceYuanPerMwh: 0,
  roundTripEfficiency: etaRoundTrip.value,
  chargeAdderYuanPerMwh: chargeAdder.value,
  cycleCostYuanPerMwh: cycleCost.value,
  cCapYuanPerMwh: cCap.value.cCapYuanPerMwh,
  cAsYuanPerMwh: 0
}))

/** 盈亏平衡速查：几个充电价档位下的要求价差。 */
const breakevenTable = computed(() =>
  [40, 60, 80, 100, 150, 200].map((p) => ({
    chargePrice: p,
    ...breakevenSpread({ ...breakevenBase.value, chargePriceYuanPerMwh: p })
  }))
)

const plan = computed(() =>
  planDispatch({
    unitPrices: unitPrices.value,
    availablePowerMw: powerMw.value,
    capacityMwh: capacityMwh.value,
    socMin: socMin.value,
    socMax: socMax.value,
    socStart: socStart.value,
    socTarget: socTarget.value,
    socTargetTolerance: socTolerance.value,
    chargeEfficiency: singleEta.value,
    dischargeEfficiency: singleEta.value,
    lockedUnits: [],
    maxCyclesPerDay: maxCycles.value,
    breakeven: breakevenBase.value,
    secondCycleRatioThreshold: 1.3
  })
)

const constraints = computed(() =>
  checkDispatchConstraints({
    plan: plan.value,
    availablePowerMw: powerMw.value,
    socMin: socMin.value,
    socMax: socMax.value,
    socTarget: socTarget.value,
    socTargetTolerance: socTolerance.value,
    rampLimitMw: rampLimitMw.value,
    maxCyclesPerDay: maxCycles.value,
    monthlyChargeMwh: monthlyChargeMwh.value,
    monthlyChargeQuotaMwh: monthlyQuotaMwh.value,
    contractComplianceRatio: complianceRatio.value,
    complianceBand: [0.85, 1.15],
    identityMixed: identityMixed.value
  })
)

const dispatchAllowed = computed(() => canDispatch(constraints.value) && !plan.value.noArbitrageWindow)

const executionCurve = computed(() =>
  expandToExecutionCurve(plan.value.unitPowerMw, decisionUnit.value?.clearingPointsPerUnit ?? 1)
)

const socPath = computed(() => plan.value.socTrajectory)
const socMaxSeen = computed(() => (socPath.value.length ? Math.max(...socPath.value) : 0))
const socMinSeen = computed(() => (socPath.value.length ? Math.min(...socPath.value) : 0))

/** 写回判据取约束校验的**逐项结论**，不重复自算——两套口径迟早漂移。 */
const constraintById = computed(() => new Map(constraints.value.map((c) => [c.id, c])))
const minSafetyMultiple = computed(() => {
  const values = plan.value.pairs.map((p) => p.safetyMultiple).filter((v): v is number => Number.isFinite(v))
  return values.length ? Math.min(...values) : null
})

const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')
const written = computed(() => props.declaration?.preflight?.storagePlan ?? null)

/**
 * 下发报文预览（F4.3 下发侧 · 模拟）：场站下发通道未接，报文仅供人工下发参照——
 * 不伪造场站回执、不冒充已下发。mock: true 显式标注。
 */
const dispatchMessagePreview = computed<string | null>(() => {
  if (!written.value || !executionCurve.value.length) return null
  const asset = loadedAsset.value
  return JSON.stringify(
    {
      messageKind: 'storage-dispatch-plan',
      mock: true,
      sourceType: 'MOCK',
      productionWrite: false,
      station: asset?.assetName ?? '（未选档案资产）',
      targetDate: props.declaration?.targetDate ?? null,
      unit: 'MW',
      points: executionCurve.value.map((v) => Math.round(v * 100) / 100),
      note: '模拟报文：下发通道未接，仅供人工下发参照，不代表已下发或场站已确认'
    },
    null,
    2
  )
})

async function writeBack() {
  if (!props.declaration) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const updated = await savePreflight(
      props.declaration.id,
      'storagePlan',
      {
        socTrajectoryOk: constraintById.value.get('soc_band')?.passed === true,
        socEndOk: constraintById.value.get('soc_end')?.passed === true,
        safetyMultiple: minSafetyMultiple.value,
        cycles: plan.value.cycles,
        grossMarginYuan: plan.value.totalGrossMarginYuan,
        // 参数溯源：用了哪份档案、当日覆盖了哪些字段（档案不回写，覆盖只随单据留痕）
        assetName: loadedAsset.value?.assetName ?? null,
        parameterOverrides: overrides.value.map((o) => ({
          field: o.key, label: o.label, fileValue: o.fileValue, todayValue: o.todayValue
        }))
      },
      `储能计划：循环 ${plan.value.cycles} 次，预期毛利 ${plan.value.totalGrossMarginYuan} 元` +
        (overrides.value.length ? `；当日覆盖 ${overrides.value.length} 项参数` : '')
    )
    emit('updated', updated)
    saveMsg.value = '储能计划结论已写回，放行清单的 SOC 判据自动填充'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
}

// ── AI 计划审查（确定性推理链 + 工具结果注入）──────────────────────────────
// 设计红线：**AI 不重算任何数字**。规则引擎（R1/R2/R3/R11 + 八项约束）是确定性权威，
// 其完整输出作为"工具已算好的结果"注入上下文；AI 的职责限定在三件事：
//   ① 解释：把安全倍数/回退对数/约束结论讲成交易员语言；
//   ② 挑风险：哪对充放的安全倍数贴近 1.3 阈值、当日覆盖的参数是否可疑
//      （如临时把效率改高 → 要求价差被低估）；
//   ③ 反事实追问：价格再低 X 元窗口是否消失（用注入的 breakevenTable 查表回答，不新算）。
// 判断链靠数据结构本身闭合：AI 引用的每个数字都能在注入的工具结果里指认出处。
const aiReviewOpen = ref(false)
const aiReviewContext = computed(() => ({
  // 工具结果 ①：R1 决策单元（结算聚合算子推导）
  decisionUnit: decisionUnit.value,
  // 工具结果 ②：R11 容量折价 + R3 要求价差速查表
  capacityPayment: cCap.value,
  breakevenTable: breakevenTable.value,
  // 工具结果 ③：R2 充放安排（含逐对安全倍数与 SOC 回退）
  plan: {
    noArbitrageWindow: plan.value.noArbitrageWindow,
    rejectReason: plan.value.rejectReason,
    pairs: plan.value.pairs,
    rolledBackPairs: plan.value.rolledBackPairs,
    cycles: plan.value.cycles,
    totalGrossMarginYuan: plan.value.totalGrossMarginYuan,
    socTrajectory: plan.value.socTrajectory
  },
  // 工具结果 ④：八项约束逐项结论
  constraints: constraints.value,
  // 参数溯源：档案基线 vs 当日覆盖（AI 审查覆盖合理性的依据）
  assetName: loadedAsset.value?.assetName ?? null,
  parameterOverrides: overrides.value,
  unitPriceCount: unitPrices.value.length
}))
const aiReviewQuestion = computed(() =>
  `请审查这份储能充放电计划。注入的上下文是规则引擎（R1 决策单元/R11 容量折价/R3 要求价差/` +
  `R2 充放安排/八项约束）已算好的**权威结果**——你不得重算或修改任何数字，引用数字必须能在` +
  `上下文中指认出处。只做三件事：` +
  `① 用交易员语言解释本计划（几次循环、哪里赚钱、安全边际多厚）；` +
  `② 挑风险：安全倍数贴近阈值的充放对、被 SOC 回退掉的机会、` +
  (overrides.value.length
    ? `以及**当日覆盖的 ${overrides.value.length} 项参数**（${overrides.value.map((o) => o.label).join('、')}）是否让门槛被低估；`
    : `参数与档案一致（无当日覆盖）；`) +
  `③ 反事实：若尖峰价格下移 50 元，哪些充放对会跌破要求价差（用 breakevenTable 查表回答）。` +
  `不确定的明确说不确定。`
)
</script>

<template>
  <div class="sb">
    <div class="sb-top">
      <div class="sb-verdict" :class="dispatchAllowed ? 'ok' : 'bad'">
        <component :is="dispatchAllowed ? CheckCheck : TriangleAlert" :size="15" />
        <span>{{ dispatchAllowed ? '可下发' : plan.noArbitrageWindow ? '无套利窗口日' : '不可下发' }}</span>
      </div>
      <div class="sb-band" :class="decisionUnit ? '' : 'unreg'">
        <strong>R1 决策单元</strong>
        <template v-if="decisionUnit">
          <span>{{ decisionUnit.intervalMin }} 分钟 × {{ decisionUnit.unitsPerDay }} 个</span>
        </template>
        <span v-else>
          当前地区（{{ currentRegion.shortName || currentRegion.id }}）市场时序未登记，无法推导决策单元
        </span>
      </div>
      <button type="button" class="sb-save" :disabled="!declaration || saving" @click="writeBack">
        <Save :size="12" /> {{ written ? '更新写回' : '写回计划结论' }}
      </button>
      <span v-if="saveMsg" class="sb-ok">{{ saveMsg }}</span>
      <span v-if="saveError" class="sb-err">{{ saveError }}</span>
    </div>

    <!-- 企业资产档案条：固定参数从库拉取，手改即当日覆盖（不回写档案） -->
    <div class="sb-asset">
      <Database :size="13" />
      <template v-if="assets.length">
        <label>
          资产档案
          <select v-model="selectedAssetId" @change="onSelectAsset">
            <option value="">选择…</option>
            <option v-for="a in assets" :key="a.id" :value="a.id">{{ a.assetName }}（{{ a.region }}）</option>
          </select>
        </label>
        <span v-if="loadedAsset" class="sb-asset-ok">已载入档案；下方参数手改即视为**当日覆盖**（随计划写回留痕，不改档案）</span>
      </template>
      <span v-else-if="assetError" class="sb-err">{{ assetError }}</span>
      <span v-else class="sb-muted">本公司暂无储能资产档案——首次填好参数后可由管理员建档，此后申报直接拉取</span>
      <span v-if="overrides.length" class="sb-override-badge">当日覆盖 {{ overrides.length }} 项</span>
    </div>
    <ul v-if="overrides.length" class="sb-override-list">
      <li v-for="o in overrides" :key="o.key">
        <strong>{{ o.label }}</strong>：档案 {{ o.fileValue }} → 今日 {{ o.todayValue }}
      </li>
    </ul>

    <div class="sb-grid">
      <!-- 参数区 -->
      <section class="sb-panel">
        <h4>资产与成本参数</h4>
        <div class="sb-fields">
          <label>可用功率 MW<input v-model.number="powerMw" type="number" /></label>
          <label>可用容量 MWh<input v-model.number="capacityMwh" type="number" /></label>
          <label>起始 SOC<input v-model.number="socStart" type="number" step="0.01" /></label>
          <label>目标 SOC<input v-model.number="socTarget" type="number" step="0.01" /></label>
          <label>终止容差<input v-model.number="socTolerance" type="number" step="0.01" /></label>
          <label>SOC 下限<input v-model.number="socMin" type="number" step="0.01" /></label>
          <label>SOC 上限<input v-model.number="socMax" type="number" step="0.01" /></label>
          <label>往返效率 η<input v-model.number="etaRoundTrip" type="number" step="0.005" /></label>
          <label>循环成本 元/MWh<input v-model.number="cycleCost" type="number" /></label>
          <label>充电加价 元/MWh<input v-model.number="chargeAdder" type="number" step="0.001" /></label>
          <label>日循环上限<input v-model.number="maxCycles" type="number" /></label>
          <label>爬坡能力 MW<input v-model.number="rampLimitMw" type="number" /></label>
        </div>
        <p class="sb-tip">
          充电加价 = 上网环节线损电价 + 系统运行费。储能充电时视同用户，这笔钱必须付；
          漏计会让门槛低估约 {{ (chargeAdder / etaRoundTrip).toFixed(0) }} 元/MWh。
        </p>

        <h4>容量电价（R11）</h4>
        <div class="sb-fields">
          <label class="sb-check">
            <input v-model="inCapacityList" type="checkbox" /> 已纳入清单管理
          </label>
          <label>标准 元/(kW·年)<input v-model.number="capacityStandard" type="number" :disabled="!inCapacityList" /></label>
          <label>放电时长 h<input v-model.number="dischargeDurationH" type="number" :disabled="!inCapacityList" /></label>
          <label>年循环次数<input v-model.number="cyclesPerYear" type="number" :disabled="!inCapacityList" /></label>
          <label>运行 DOD<input v-model.number="operatingDod" type="number" step="0.05" :disabled="!inCapacityList" /></label>
        </div>
        <p class="sb-tip" :class="{ warn: !inCapacityList }">
          c_cap = <strong>{{ cCap.cCapYuanPerMwh }}</strong> 元/MWh。{{ cCap.note }}
        </p>

        <h4>其它约束</h4>
        <div class="sb-fields">
          <label>月度累计充电 MWh<input v-model.number="monthlyChargeMwh" type="number" /></label>
          <label>月度限额 MWh<input v-model.number="monthlyQuotaMwh" type="number" /></label>
          <label>中长期履约率<input v-model.number="complianceRatio" type="number" step="0.01" /></label>
          <label class="sb-check">
            <input v-model="identityMixed" type="checkbox" /> 存在身份混用（同标的两种身份）
          </label>
        </div>
      </section>

      <!-- 结果区 -->
      <section class="sb-panel">
        <h4>价格序列（{{ unitPrices.length }} 个决策单元）</h4>
        <div class="sb-presets">
          <button
            v-for="(_, name) in PRESETS"
            :key="name"
            type="button"
            :class="{ active: presetName === name }"
            @click="applyPreset(String(name))"
          >
            {{ name }}
          </button>
        </div>
        <textarea v-model="priceText" rows="3" class="sb-prices" />

        <h4>R3 要求价差速查</h4>
        <table class="sb-table">
          <thead>
            <tr><th>充电价</th><th>要求价差</th><th>要求放电价</th><th>其中：效率损耗</th><th>充电加价摊入</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in breakevenTable" :key="r.chargePrice">
              <td>{{ r.chargePrice }}</td>
              <td><strong>{{ r.requiredSpreadYuanPerMwh }}</strong></td>
              <td>{{ r.requiredDischargePriceYuanPerMwh }}</td>
              <td>{{ r.efficiencyLossYuanPerMwh }}</td>
              <td>{{ r.chargeAdderLoadedYuanPerMwh }}</td>
            </tr>
          </tbody>
        </table>

        <h4>R2 充放安排</h4>
        <p v-if="plan.noArbitrageWindow" class="sb-empty">
          无套利窗口日——不安排循环，仅下发「维持 SOC 至目标值」的最小动作计划。
          <template v-if="plan.rejectReason">（{{ plan.rejectReason }}）</template>
        </p>
        <table v-else class="sb-table">
          <thead>
            <tr><th>充电单元</th><th>放电单元</th><th>价差</th><th>要求</th><th>安全倍数</th><th>结论</th><th>毛利 元</th></tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in plan.pairs" :key="i">
              <td>{{ p.chargeUnit }}（{{ p.chargePrice }}）</td>
              <td>{{ p.dischargeUnit }}（{{ p.dischargePrice }}）</td>
              <td>{{ p.spread }}</td>
              <td>{{ p.requiredSpread }}</td>
              <td>{{ p.safetyMultiple }}</td>
              <td>{{ ARBITRAGE_VERDICT_LABEL[arbitrageVerdict(p.spread, p.requiredSpread).verdict] }}</td>
              <td>{{ p.grossMarginYuan }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="plan.rolledBackPairs > 0" class="sb-tip warn">
          有 {{ plan.rolledBackPairs }} 对因 SOC 轨迹不可行被回退（R2 步骤 8）——
          充放效率不对称，每多一对循环终止 SOC 就更低一截。放宽终止容差需主管批准。
        </p>
        <p v-if="!plan.noArbitrageWindow" class="sb-total">
          全日预期毛利 <strong>{{ plan.totalGrossMarginYuan }}</strong> 元 · 循环 {{ plan.cycles }} 次 ·
          SOC 区间 {{ (socMinSeen * 100).toFixed(1) }}%–{{ (socMaxSeen * 100).toFixed(1) }}% ·
          执行曲线 {{ executionCurve.length }} 点
        </p>
      </section>
    </div>

    <!-- 八项约束：检验不是主角——默认徽章行，有阻断/告警自动展开 -->
    <details class="sb-checks-fold" :open="constraints.some((c) => !c.passed)">
      <summary>
        八项约束校验
        <span class="sb-fold-badge ok" v-if="constraints.every((c) => c.passed)">
          {{ constraints.length }}/{{ constraints.length }} 全部通过
        </span>
        <template v-else>
          <span v-if="constraints.filter((c) => !c.passed && c.blocking).length" class="sb-fold-badge block">
            {{ constraints.filter((c) => !c.passed && c.blocking).length }} 阻断
          </span>
          <span v-if="constraints.filter((c) => !c.passed && !c.blocking).length" class="sb-fold-badge warn">
            {{ constraints.filter((c) => !c.passed && !c.blocking).length }} 告警
          </span>
        </template>
      </summary>
      <ul class="sb-checks">
        <li v-for="c in constraints" :key="c.id" :class="c.passed ? 'pass' : c.blocking ? 'block' : 'warn'">
          <span class="sb-check-tag">{{ c.passed ? '通过' : c.blocking ? '阻断' : '告警' }}</span>
          <strong>{{ c.label }}</strong>
          <span class="sb-check-detail">{{ c.detail }}</span>
        </li>
      </ul>
    </details>

    <!-- AI 计划审查：规则引擎输出作为工具结果注入，AI 只解释/挑险/反事实，不重算 -->
    <details class="sb-ai" :open="aiReviewOpen" @toggle="aiReviewOpen = ($event.target as HTMLDetailsElement).open">
      <summary>
        <Sparkles :size="13" /> AI 计划审查
        <em>规则引擎结果为权威，AI 不重算数字——只解释计划、挑安全边际风险、审当日覆盖合理性、答反事实</em>
      </summary>
      <AgentChatPanel
        v-if="aiReviewOpen"
        scenario="declaration_prep"
        :initial-question="aiReviewQuestion"
        :context-payload="aiReviewContext"
        history-key="s4_storage_plan_review"
      />
    </details>

    <!-- 下发报文预览（F4.3 下发侧 · 模拟） -->
    <details v-if="dispatchMessagePreview" class="sb-msg">
      <summary>
        下发报文预览（模拟）
        <em>mock: true · sourceType: MOCK——下发通道未接，仅供人工下发参照，不伪造场站回执</em>
      </summary>
      <pre>{{ dispatchMessagePreview }}</pre>
    </details>
  </div>
</template>

<style scoped>
.sb-msg { border: 1px dashed #f59e0b; border-radius: 8px; padding: 6px 10px; background: #fffbeb; }
.sb-msg summary { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; cursor: pointer; flex-wrap: wrap; color: #92400e; }
.sb-msg summary em { font-style: normal; font-weight: 400; font-size: 10px; color: #b45309; }
.sb-msg pre { max-height: 240px; overflow: auto; margin: 6px 0 0; padding: 8px; border-radius: 6px; background: #fff; font-size: 10px; line-height: 1.5; }

.sb { display: flex; flex-direction: column; gap: 10px; }
.sb-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sb-verdict { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; font-weight: 600; font-size: 12px; }
.sb-verdict.ok { background: #f0fdf4; color: #15803d; border: 1px solid #86efac; }
.sb-verdict.bad { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; }
.sb-band { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 5px 10px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 8px; font-size: 11px; }
.sb-band.unreg { border-color: #fcd34d; background: #fffbeb; }
.sb-save { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border: 1px solid #2563eb; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.sb-save:disabled { opacity: .45; cursor: not-allowed; }
.sb-ok { font-size: 12px; color: #15803d; }
.sb-err { font-size: 12px; color: #b91c1c; }

.sb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 10px; }
.sb-panel { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.sb-panel h4 { margin: 10px 0 6px; font-size: 12px; }
.sb-panel h4:first-child { margin-top: 0; }

.sb-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 10px; }
.sb-fields label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--el-text-color-secondary, #667); }
.sb-fields input[type='number'] { width: 100%; padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 12px; }
.sb-check { flex-direction: row !important; align-items: center; gap: 5px !important; }

.sb-tip { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.sb-tip.warn { color: #b45309; }

.sb-presets { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
.sb-presets button { padding: 2px 9px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 11px; background: #fff; font-size: 11px; cursor: pointer; }
.sb-presets button.active { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; }
.sb-prices { width: 100%; font-family: ui-monospace, monospace; font-size: 11px; padding: 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; }

.sb-table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
.sb-table th, .sb-table td { padding: 4px 6px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.sb-table th:first-child, .sb-table td:first-child { text-align: left; }
.sb-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }

.sb-empty { padding: 8px 0; font-size: 12px; color: #b45309; }
.sb-total { margin: 8px 0 0; font-size: 12px; }

.sb-asset { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 7px 10px; border: 1px solid #ddd6fe; border-radius: 8px; background: #faf5ff; font-size: 12px; }
.sb-asset label { display: inline-flex; align-items: center; gap: 5px; }
.sb-asset select { padding: 3px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 12px; }
.sb-asset-ok { font-size: 11px; color: #6d28d9; }
.sb-muted { font-size: 11px; color: var(--el-text-color-secondary, #667); }
.sb-override-badge { margin-left: auto; padding: 2px 9px; border-radius: 9px; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 600; }
.sb-override-list { margin: 0; padding: 6px 12px; border: 1px dashed #fcd34d; border-radius: 8px; background: #fffbeb; font-size: 11px; line-height: 1.8; list-style: none; }
.sb-override-list strong { color: #92400e; }

.sb-checks-fold, .sb-ai { border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; padding: 8px 12px; }
.sb-checks-fold summary, .sb-ai summary { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; flex-wrap: wrap; }
.sb-ai summary em { font-style: normal; font-weight: 400; font-size: 10px; color: var(--el-text-color-secondary, #889); }
.sb-checks-fold[open] summary, .sb-ai[open] summary { margin-bottom: 8px; }
.sb-fold-badge { padding: 1px 9px; border-radius: 9px; font-size: 10px; font-weight: 600; }
.sb-fold-badge.ok { background: #dcfce7; color: #15803d; }
.sb-fold-badge.block { background: #fee2e2; color: #991b1b; }
.sb-fold-badge.warn { background: #fef3c7; color: #92400e; }

.sb-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.sb-checks li { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border-radius: 6px; font-size: 12px; flex-wrap: wrap; }
.sb-checks li.pass { background: #f6fefa; }
.sb-checks li.block { background: #fef2f2; }
.sb-checks li.warn { background: #fffbeb; }
.sb-check-tag { min-width: 34px; padding: 1px 6px; border-radius: 8px; font-size: 10px; text-align: center; }
li.pass .sb-check-tag { background: #dcfce7; color: #15803d; }
li.block .sb-check-tag { background: #fee2e2; color: #991b1b; }
li.warn .sb-check-tag { background: #fef3c7; color: #92400e; }
.sb-check-detail { color: var(--el-text-color-secondary, #667); }
</style>
