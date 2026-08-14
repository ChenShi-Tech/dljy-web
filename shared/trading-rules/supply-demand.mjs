// ============================================================================
// R7 · 供需比 → 市场态势 / 边际机组 / 价格中枢映射（S2 早间分析的核心）
// ----------------------------------------------------------------------------
// 交易员早上要回答的第一个业务问题不是「数据齐不齐」，而是「今天这个市场是松还是紧」。
// 供需比把四个基本面量（可调机组、新能源、外送、负荷）压成一个可比较的标量，再映射到
// 边际机组类型与价格中枢区间——这是整条判断链的起点，S3 的方向判断建立在它之上。
//
// 两条容易被忽略的性质：
//
// ① **外送是分母项，不是分子项。** 外送计划曲线是省内出清的硬边界条件而非竞价标的，
//    外送增加等价于省内净负荷增加。外送大省的外送边际变化对供需比的影响，通常远大于
//    省内负荷自身的波动——把外送错放到分子会让判断方向整个反过来。
//
// ② **映射表是经验初值，必须按季度用实测数据重新拟合。** 这里给的分档来自手册的初始
//    经验值；拟合方法是以供需比为自变量、结算价为因变量做分位数回归，取 P10/P50/P90
//    三条曲线。因此本模块把分档表**做成可替换的入参**，而不是写死的常量——换省、换季度
//    都只换数据。
// ============================================================================

/**
 * @typedef {'extreme_surplus'|'surplus'|'balanced'|'tight'|'scarce'} MarketRegime
 */

/** @type {Record<MarketRegime, string>} */
export const REGIME_LABEL = {
  extreme_surplus: '极度宽松',
  surplus: '宽松',
  balanced: '平衡',
  tight: '偏紧',
  scarce: '紧张'
}

/**
 * @typedef {Object} RegimeBand
 * @property {MarketRegime} regime
 * @property {number} minRatio 该档的供需比下界（含）；最低档为 -Infinity
 * @property {string} marginalUnit 边际机组类型
 * @property {[number, number]} priceCenter 价格中枢参考区间 元/MWh
 * @property {string} storageStrategy 储能策略
 * @property {string} retailStrategy 售电策略
 * @property {string} note
 */

/**
 * 默认分档表（手册初始经验值，**待季度分位数回归重新拟合**）。
 * 调用方可传入自己的分档表覆盖——换省或换季度只换数据，判级逻辑不动。
 * @type {RegimeBand[]}
 */
export const DEFAULT_REGIME_BANDS = [
  {
    regime: 'extreme_surplus',
    minRatio: 1.35,
    marginalUnit: '新能源（弃电风险）',
    priceCenter: [40, 90],
    storageStrategy: '充电窗口，可扩大充电深度',
    retailStrategy: '申报可上偏',
    note: '贴申报下限概率高'
  },
  {
    regime: 'surplus',
    minRatio: 1.2,
    marginalUnit: '低效煤电',
    priceCenter: [90, 180],
    storageStrategy: '充电窗口',
    retailStrategy: '申报上偏',
    note: ''
  },
  {
    regime: 'balanced',
    minRatio: 1.1,
    marginalUnit: '高效煤电',
    priceCenter: [180, 280],
    storageStrategy: '观望',
    retailStrategy: '按中枢申报',
    note: ''
  },
  {
    regime: 'tight',
    minRatio: 1.03,
    marginalUnit: '尖峰机组',
    priceCenter: [280, 450],
    storageStrategy: '放电窗口',
    retailStrategy: '申报下偏',
    note: ''
  },
  {
    regime: 'scarce',
    minRatio: Number.NEGATIVE_INFINITY,
    marginalUnit: '稀缺定价',
    priceCenter: [450, 750],
    storageStrategy: '放电窗口，可用最大功率',
    retailStrategy: '下偏并启动可中断负荷',
    note: '触出清上限概率高'
  }
]

/**
 * @typedef {Object} SupplyDemandInput
 * @property {number} dispatchableMaxMw 可调机组最大出力 MW
 * @property {number} renewableForecastMw 新能源预测出力 MW
 * @property {number} netImportMw 净外购 MW（净外送时为负）
 * @property {number} systemLoadMw 统调负荷 MW
 * @property {number} exportPlanMw 外送计划 MW（**分母项**）
 * @property {number} reserveMw 备用需求 MW
 */

/**
 * 计算供需比。
 * `SR = (可调机组最大出力 + 新能源预测 + 净外购) / (统调负荷 + 外送计划 + 备用需求)`
 * @param {SupplyDemandInput} input
 * @returns {number} 分母非正时返回 NaN（调用方须走空态，不得当作 0 或极大值处理）
 */
export function supplyDemandRatio(input) {
  const supply = (input.dispatchableMaxMw || 0) + (input.renewableForecastMw || 0) + (input.netImportMw || 0)
  const demand = (input.systemLoadMw || 0) + (input.exportPlanMw || 0) + (input.reserveMw || 0)
  if (!(demand > 0)) return Number.NaN
  return supply / demand
}

/**
 * 按供需比判档。
 * @param {number} ratio
 * @param {RegimeBand[]} [bands]
 * @returns {RegimeBand|null} ratio 非有限值时返回 null（不猜档）
 */
export function regimeOf(ratio, bands = DEFAULT_REGIME_BANDS) {
  if (!Number.isFinite(ratio)) return null
  for (const band of bands) {
    if (ratio > band.minRatio) return band
  }
  return bands[bands.length - 1] ?? null
}

/**
 * 外送耦合修正：外送每增加 ΔMW，等价于统调负荷增加同量。
 * 返回外送变化后的供需比与位移量，用于回答「外送计划一变，市场松紧怎么动」。
 * @param {SupplyDemandInput} input
 * @param {number} exportDeltaMw 外送增量 MW（减少为负）
 */
export function exportCouplingImpact(input, exportDeltaMw) {
  const before = supplyDemandRatio(input)
  const after = supplyDemandRatio({ ...input, exportPlanMw: (input.exportPlanMw || 0) + exportDeltaMw })
  const bandBefore = regimeOf(before)
  const bandAfter = regimeOf(after)
  return {
    ratioBefore: Number.isFinite(before) ? Math.round(before * 10000) / 10000 : null,
    ratioAfter: Number.isFinite(after) ? Math.round(after * 10000) / 10000 : null,
    delta: Number.isFinite(before) && Number.isFinite(after) ? Math.round((after - before) * 10000) / 10000 : null,
    regimeBefore: bandBefore?.regime ?? null,
    regimeAfter: bandAfter?.regime ?? null,
    /** 档位是否被这次外送变化推翻——这才是需要交易员立刻知道的信号 */
    regimeShifted: Boolean(bandBefore && bandAfter && bandBefore.regime !== bandAfter.regime)
  }
}

/**
 * @typedef {Object} SlotAssessment
 * @property {number} slot 时段序号（0 起）
 * @property {number|null} ratio
 * @property {MarketRegime|null} regime
 * @property {[number,number]|null} priceCenter
 * @property {string} marginalUnit
 */

/**
 * 逐时段评估：给定各时段的基本面输入，输出每段的供需比与档位。
 * 这是 S2「今日市场判断」的数据基础——判断不是一天一个结论，而是逐时段的松紧曲线。
 * @param {SupplyDemandInput[]} slots
 * @param {RegimeBand[]} [bands]
 * @returns {SlotAssessment[]}
 */
export function assessSlots(slots, bands = DEFAULT_REGIME_BANDS) {
  return slots.map((input, i) => {
    const ratio = supplyDemandRatio(input)
    const band = regimeOf(ratio, bands)
    return {
      slot: i,
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 10000) / 10000 : null,
      regime: band?.regime ?? null,
      priceCenter: band?.priceCenter ?? null,
      marginalUnit: band?.marginalUnit ?? '未知'
    }
  })
}

/**
 * 全日市场判断摘要（S2 的输出物）：主导态势、价格中枢区间、最紧/最松时段。
 * 主导态势取**出现时段数最多**的档位，而不是平均供需比对应的档——平均会把
 * 「多数时段宽松 + 少数时段极紧」抹成「平衡」，恰好抹掉当天最该关注的那几个小时。
 * @param {SlotAssessment[]} assessments
 */
export function summarizeDay(assessments) {
  const valid = assessments.filter((a) => a.regime)
  if (!valid.length) {
    return {
      dominantRegime: null,
      coverage: 0,
      priceCenterLow: null,
      priceCenterHigh: null,
      tightestSlot: null,
      loosestSlot: null,
      summary: '基本面输入不足，无法给出市场判断（不猜档）'
    }
  }
  /** @type {Record<string, number>} */
  const counts = {}
  for (const a of valid) counts[a.regime] = (counts[a.regime] ?? 0) + 1
  const dominantRegime = /** @type {MarketRegime} */ (
    Object.keys(counts).reduce((best, k) => (counts[k] > counts[best] ? k : best))
  )
  const lows = valid.map((a) => a.priceCenter[0])
  const highs = valid.map((a) => a.priceCenter[1])
  const sorted = [...valid].sort((a, b) => a.ratio - b.ratio)
  const tightest = sorted[0]
  const loosest = sorted[sorted.length - 1]

  return {
    dominantRegime,
    /** 主导档位覆盖的时段占比 */
    coverage: Math.round((counts[dominantRegime] / valid.length) * 1000) / 1000,
    priceCenterLow: Math.min(...lows),
    priceCenterHigh: Math.max(...highs),
    tightestSlot: { slot: tightest.slot, ratio: tightest.ratio, regime: tightest.regime },
    loosestSlot: { slot: loosest.slot, ratio: loosest.ratio, regime: loosest.regime },
    summary: `全日以${REGIME_LABEL[dominantRegime]}为主（${Math.round((counts[dominantRegime] / valid.length) * 100)}% 时段），价格中枢参考 ${Math.min(...lows)}–${Math.max(...highs)} 元/MWh；最紧在第 ${tightest.slot} 段（SR ${tightest.ratio}），最松在第 ${loosest.slot} 段（SR ${loosest.ratio}）`
  }
}

// ============================================================================
// 煤价维度（手册 S2 基本面四项之一 · 2026-08-13 会议重申）
// ----------------------------------------------------------------------------
// 煤价是火电边际成本的锚：供需比判断「今天谁在边际」，煤价换算的火电边际成本
// 决定「边际机组大概报什么价」。二者对照可以校验经验分档表的价格中枢是否已与
// 燃料市场脱节——分档表是季度拟合的经验值，煤价是逐日变的。
//
// 换算口径（可解释、每一步可复核）：
//   标煤单价（元/吨标煤） = 到厂煤价（元/吨） × 7000 / 收到基热值（kcal/kg）
//   燃料成本（元/MWh）  = 标煤单价（元/kg） × 供电煤耗（g/kWh）
//                        = 标煤单价（元/吨）/1000 × 煤耗(g/kWh)
//   火电边际成本 ≈ 燃料成本 + 其它变动成本（元/MWh）
// ============================================================================

/**
 * @typedef {Object} CoalCostOptions
 * @property {number} [calorificKcalPerKg] 到厂煤收到基热值，默认 5500（市场煤主流）
 * @property {number} [consumptionGramsPerKwh] 供电煤耗 g/kWh，默认 300（现役主流机组区间 270–320）
 * @property {number} [otherVariableYuanPerMwh] 燃料外的变动成本（运维/辅机等），默认 30
 */

/**
 * 煤价 → 火电边际成本锚。
 * @param {number|null} coalPriceYuanPerTon 到厂煤价 元/吨；null/非有限值返回 null（不猜）
 * @param {CoalCostOptions} [opts]
 * @returns {{standardCoalYuanPerTon:number, fuelYuanPerMwh:number, totalYuanPerMwh:number, assumptions:string}|null}
 */
export function coalPriceToThermalAnchor(coalPriceYuanPerTon, opts = {}) {
  const p = Number(coalPriceYuanPerTon)
  if (!Number.isFinite(p) || p <= 0) return null
  const rawCalorific = Number(opts.calorificKcalPerKg)
  const rawConsumption = Number(opts.consumptionGramsPerKwh)
  const rawOtherVar = Number(opts.otherVariableYuanPerMwh)
  const calorific = Number.isFinite(rawCalorific) && rawCalorific > 0 ? rawCalorific : 5500
  const consumption = Number.isFinite(rawConsumption) && rawConsumption > 0 ? rawConsumption : 300
  const otherVar = Number.isFinite(rawOtherVar) ? rawOtherVar : 30
  const standardCoalYuanPerTon = Math.round(p * (7000 / calorific))
  const fuelYuanPerMwh = Math.round((standardCoalYuanPerTon / 1000) * consumption * 10) / 10
  return {
    standardCoalYuanPerTon,
    fuelYuanPerMwh,
    totalYuanPerMwh: Math.round((fuelYuanPerMwh + otherVar) * 10) / 10,
    assumptions: `热值 ${calorific} kcal/kg · 供电煤耗 ${consumption} g/kWh · 其它变动 ${otherVar} 元/MWh`
  }
}

/** @typedef {'anchor_above_center'|'anchor_within'|'anchor_below_center'} AnchorVerdict */

/**
 * 煤价锚与分档价格中枢的对照：中枢是经验拟合值，锚是当日燃料换算值——
 * 锚高于中枢区间说明分档表低估了火电成本（价格中枢该上修），反之亦然。
 * @param {number|null} anchorYuanPerMwh
 * @param {[number,number]|null} priceCenter
 * @param {number} [tolerancePct] 区间边界容差（%），默认 5——贴边不算脱节
 * @returns {{verdict:AnchorVerdict, hint:string}|null} 任一输入缺失返回 null（不硬比）
 */
export function thermalAnchorVsPriceCenter(anchorYuanPerMwh, priceCenter, tolerancePct = 5) {
  // 先验原始值再转数：Number(null) === 0，先转会把「没给」伪装成「锚为 0」
  if (!Number.isFinite(anchorYuanPerMwh) || !priceCenter) return null
  const a = Number(anchorYuanPerMwh)
  const [low, high] = priceCenter
  const tol = tolerancePct / 100
  if (a > high * (1 + tol)) {
    return {
      verdict: 'anchor_above_center',
      hint: `煤价锚 ${a} 元/MWh 高于中枢上界 ${high}（超 ${(tolerancePct)}% 容差）——分档表可能低估火电成本，价格中枢与申报价位宜上修`
    }
  }
  if (a < low * (1 - tol)) {
    return {
      verdict: 'anchor_below_center',
      hint: `煤价锚 ${a} 元/MWh 低于中枢下界 ${low}（超 ${tolerancePct}% 容差）——分档表可能高估火电成本，价格中枢与申报价位宜下修`
    }
  }
  return { verdict: 'anchor_within', hint: `煤价锚 ${a} 元/MWh 落在中枢区间 ${low}–${high} 内（±${tolerancePct}% 容差）——分档表与当日燃料市场未脱节` }
}

/**
 * 省内 vs 省外比价（会议 §4：判断「先做省内还是省外」）。
 * 售电买电：哪边便宜先做哪边；发电卖电方向相反——direction 由调用方传入语义，
 * 本函数只做价比与差异度判级，不绑定立场。
 * @param {number|null} domesticYuanPerMwh 省内日前参考价（元/MWh）
 * @param {number|null} externalYuanPerMwh 省外/省间参考价（元/MWh）
 * @param {number} [thresholdPct] 显著性阈值（%），默认 3——低于它算无显著差异
 * @returns {{diffPct:number, side:'domestic'|'external'|'comparable', hint:string}|null}
 */
export function provincePriceCompare(domesticYuanPerMwh, externalYuanPerMwh, thresholdPct = 3) {
  if (!Number.isFinite(domesticYuanPerMwh) || !Number.isFinite(externalYuanPerMwh)) return null
  const d = Number(domesticYuanPerMwh)
  const e = Number(externalYuanPerMwh)
  if (d <= 0 || e <= 0) return null
  const diffPct = Math.round(((e - d) / d) * 1000) / 10
  if (Math.abs(diffPct) < thresholdPct) {
    return { diffPct, side: 'comparable', hint: `省外较省内 ${diffPct > 0 ? '高' : '低'} ${Math.abs(diffPct)}%（< ${thresholdPct}% 阈值）——两边无显著差异，按通道容量与执行风险取便` }
  }
  return diffPct > 0
    ? { diffPct, side: 'domestic', hint: `省外较省内高 ${diffPct}%——买电先省内（更便宜）、卖电先省外（更贵），按自身立场取方向` }
    : { diffPct, side: 'external', hint: `省外较省内低 ${Math.abs(diffPct)}%——买电先省外（更便宜）、卖电先省内（更贵），按自身立场取方向` }
}

/**
 * 供需比 → 历史价格区间映射（会议 §4：给定预测供需比，调出历史上相同供需比
 * 时段的价格范围做参考）。
 *
 * 纯函数：历史配对数据（ratio × price）由调用方给——本函数不存历史、不造历史。
 * 数据活源（#1968）接通前，UI 应走「历史映射未接数据」空态而不是喂样本编数字。
 * @param {number|null} ratio 预测供需比
 * @param {Array<{ratio:number, priceYuanPerMwh:number}>} history 历史配对样本
 * @param {number} [bandWidth] 供需比邻域半宽，默认 0.05
 * @param {number} [minSamples] 邻域内最少样本数，低于它返回 insufficient（不硬给区间）
 * @returns {{status:'ok', count:number, p10:number, p50:number, p90:number}|{status:'insufficient', count:number}|{status:'no_input'}}
 */
export function historicalPriceBand(ratio, history, bandWidth = 0.05, minSamples = 8) {
  if (!Number.isFinite(ratio) || !Array.isArray(history) || !history.length) return { status: 'no_input' }
  const r = Number(ratio)
  const prices = history
    .filter((h) => Number.isFinite(Number(h?.ratio)) && Number.isFinite(Number(h?.priceYuanPerMwh)))
    .filter((h) => Math.abs(Number(h.ratio) - r) <= bandWidth)
    .map((h) => Number(h.priceYuanPerMwh))
    .sort((a, b) => a - b)
  if (prices.length < minSamples) return { status: 'insufficient', count: prices.length }
  const q = (p) => prices[Math.min(prices.length - 1, Math.round(p * (prices.length - 1)))]
  return { status: 'ok', count: prices.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) }
}
