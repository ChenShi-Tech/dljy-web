// 声明式 capture 数据质量规则。
//
// 本文件只描述“完整性/连续性/新鲜度”质量口径，不参与 capture.sqlite 的结构校验；
// DB schema 单一来源仍是 shared/schema/entities/capture-families.mjs。
//
// seriesFields（可选，#3177）：多序列族的序列维度声明。长表族同一数据集/同一质量规则
// 下并行着多条序列（如 yn_system_forecast 的 metric×region、yn_plant_output 的
// plant×seriesRole），并集口径下任一序列有值就算覆盖，会掩盖单序列断流。登记后
// 覆盖统计按（日期 × 序列键）分别计数，覆盖率取各序列覆盖率的**最小值**，并在结果里
// 标注最差序列（数据健康 weakestSeries / 质量扫描 pointsCompleteness.weakestSeries）。
// 未登记的族行为不变（并集口径）。
//
// 期望序列集合（#3177 验收返工）：只在「评估窗口 ∪ 窗口起点前一段回看期」内出现过的序列
// 才计入期望——最近还在供数、在评估窗口里断供的序列仍会被抓到，早已下线的序列不再计入，
// 不再在每个窗口恒报覆盖 0（数据健康页长期误红）。回看期由 seriesLookbackDays（可选，天）
// 配置；未配置时默认与评估窗口等长、且不少于 7 天（MIN_SERIES_LOOKBACK_DAYS）。
//
// 序列原生粒度（#3177 审查返工）：seriesExpectedPointsPerDay（可选，按 seriesFields 首字段值
// 映射每日期望点数）——同族序列粒度不同（yn_system_forecast 的 da/rt_user_price 小时级 24 点，
// 其余 15 分钟级 96 点）时，覆盖率按各自分母归一后再取最差，小时级满供不再恒报 25%。

export const QUALITY_CADENCES = new Set(['daily', 'monthly', 'manual'])

/** 期望序列集合回看期的默认下限（天）：未配置 seriesLookbackDays 时回看期不得短于 7 天。 */
export const MIN_SERIES_LOOKBACK_DAYS = 7

/**
 * 期望序列集合的回看期（天）。规则配置 seriesLookbackDays（正整数）优先生效；
 * 未配置用 evaluationWindowDays（评估窗口等长）且不少于 MIN_SERIES_LOOKBACK_DAYS。
 */
export function seriesLookbackDaysOf(rule, evaluationWindowDays = MIN_SERIES_LOOKBACK_DAYS) {
  const configured = Number(rule?.seriesLookbackDays)
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured)
  return Math.max(MIN_SERIES_LOOKBACK_DAYS, Math.floor(Number(evaluationWindowDays) || 0))
}

/**
 * 序列的原生期望点数/日（#3177 审查返工）：质量规则登记 seriesFields 的族里，不同序列的原生
 * 粒度可能不同（如 yn_system_forecast 的 metric=da_user_price/rt_user_price 是小时级 24 点，
 * 其余 metric 是 15 分钟级 96 点）。按 seriesFields 首字段的值（如 metric）声明每日期望点数；
 * 未命中声明或未配置时回落到族级 expectedPointsPerDay。覆盖率按各自分母归一后再取最差序列，
 * 小时级序列满供时不再被 96 点分母恒压成 25% 假告警。
 */
export function seriesExpectedPointsPerDayOf(rule, seriesKey) {
  const fallback = Math.max(1, Math.floor(Number(rule?.expectedPointsPerDay) || 1))
  const declared = rule?.seriesExpectedPointsPerDay
  const first = String(seriesKey ?? '').split('\u0001')[0]?.trim() ?? ''
  if (!declared || typeof declared !== 'object' || !first) return fallback
  const points = Number(declared[first])
  return Number.isFinite(points) && points > 0 ? Math.floor(points) : fallback
}

export const CAPTURE_QUALITY_RULES = {
  sdpt_zptjg: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 1,
    dateField: 'date',
    valueFields: ['jz'],
    zeroRunWarnLength: 24
  },
  sdpt_zptsj: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 1,
    dateField: 'riqi',
    valueFields: ['hjz', 'pjz'],
    zeroRunWarnLength: 24
  },
  sdpt_zxztqa: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 1,
    dateField: 'riqi',
    valueFields: ['jz'],
    zeroRunWarnLength: 24
  },
  sdpt_zgnrx: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 1,
    dateField: 'yxrq',
    valueFields: ['jz'],
    zeroRunWarnLength: 24
  },
  sdpt_zptqx: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 1,
    dateField: 'date',
    valueFields: ['total'],
    zeroRunWarnLength: 24
  },
  sdpt_zfsdjy: {
    cadence: 'daily',
    expectedPointsPerDay: 24,
    minRowsPerDay: 1,
    dateField: 'jyrq',
    valueFields: ['heji'],
    zeroRunWarnLength: 8
  },
  sdpt_zjyap: {
    cadence: 'manual',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'jyrq',
    zeroRunWarnLength: 0
  },
  sdpt_zptwd: {
    cadence: 'manual',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'scrq',
    valueFields: ['wddx'],
    zeroRunWarnLength: 0
  },
  yn_loss_attribution: {
    cadence: 'daily',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'date',
    valueFields: ['totalGenerationMwh', 'strategyLossTotal', 'forecastLossTotal', 'gridLossTotal'],
    zeroRunWarnLength: 7
  },
  yn_spot_settlement: {
    cadence: 'daily',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'date',
    valueFields: ['actualOnGridEnergy', 'totalEnergy', 'totalFee'],
    zeroRunWarnLength: 7
  },
  yn_system_forecast: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 96,
    dateField: 'operateDate',
    pointField: 'timePoint',
    valueFields: ['value'],
    zeroRunWarnLength: 24,
    // 同一数据集含 region=yn|all（南网宽表多列熔化），数据健康按族合并多数据集时
    // metric 再分预测/实际/水电等序列——任一序列断流不应被其它序列掩盖（#3177）。
    seriesFields: ['metric', 'region'],
    // 序列原生粒度（#3177 审查返工）：da_user_price/rt_user_price（meltUserPrice，南网年导出
    // user_price/*.csv）是小时级 24 点/日；其余 10 个 metric（负荷/发电/新能源/水电/省间断面，
    // 15 分钟 time_point）走族级 96 点。按 metric 值声明，分母归一后小时级满供不再恒报 25%。
    seriesExpectedPointsPerDay: { da_user_price: 24, rt_user_price: 24 }
  },
  yn_node_price: {
    cadence: 'daily',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'date',
    valueFields: ['price', 'avgPrice', 'volume', 'clearEnergyMWh'],
    zeroRunWarnLength: 7
  },
  yn_system_supply: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 96,
    dateField: 'date',
    pointField: 'time',
    valueFields: ['loadMWh', 'newEnergyMWh', 'hydropowerMWh', 'noMarketUnitMWh'],
    zeroRunWarnLength: 24,
    pairs: [
      {
        family: 'yn_system_forecast',
        id: 'yn-system-supply-forecast-same-day',
        label: '云南系统供需实际与系统预测同日对齐'
      }
    ]
  },
  yn_meteo: {
    cadence: 'daily',
    expectedPointsPerDay: 24,
    minRowsPerDay: 24,
    dateField: 'date',
    pointField: 'time',
    valueFields: ['temp', 'humidity', 'windSpeed', 'cloudCover', 'precipitation', 'pressure'],
    zeroRunWarnLength: 8
  },
  yn_irradiance: {
    cadence: 'daily',
    expectedPointsPerDay: 24,
    minRowsPerDay: 24,
    dateField: 'date',
    pointField: 'time',
    valueFields: ['ghi', 'dni', 'dhi', 'directRadiation', 'poa'],
    zeroRunWarnLength: 8
  },
  // —— 云南现货 S2/S3 新接入族（issue #384）——
  // 时序族按 15min×24h=96 点期望；pointField=distinct 时段去重计数，
  // 多维度（market/area/dataType/plant）不影响 distinct timePoint 完整率口径。
  yn_user_price: {
    cadence: 'daily',
    expectedPointsPerDay: 96,
    minRowsPerDay: 1,
    dateField: 'operateDate',
    pointField: 'timePoint',
    valueFields: ['price'],
    zeroRunWarnLength: 24
  },
  // #638：源 plant_nodal_price_data.csv 为小时级（hour_slot 0..23），期望 24 点/日（非 96）。
  yn_plant_nodal_price: {
    cadence: 'daily',
    expectedPointsPerDay: 24,
    minRowsPerDay: 1,
    dateField: 'date',
    pointField: 'timePoint',
    valueFields: ['price'],
    zeroRunWarnLength: 24
  },
  // 水电群限额实为「群×机组×日」清单（源表 timePoint 全空、限额为日粒度），
  // 非 96 点时序——#622 对账修正：按日行数口径，不再套 distinct timePoint 完整率（原 96 点期望恒 0% 误报）。
  yn_hydro_group_limit: {
    cadence: 'daily',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'operateDate',
    valueFields: ['value', 'ratio'],
    zeroRunWarnLength: 0
  },
  // 出力长表：date+timePoint 时序，多 dataType/seriesRole 维度并行。
  // #638：源 plant_integrated_power_forecast_actual.csv 为小时级（hour_slot 0..23），期望 24 点/日。
  yn_plant_output: {
    cadence: 'daily',
    expectedPointsPerDay: 24,
    minRowsPerDay: 1,
    dateField: 'date',
    pointField: 'timePoint',
    valueFields: ['valueMw'],
    zeroRunWarnLength: 24,
    // 实际/预测/计划等多类出力并行（seriesRole），且族内合并多厂（plant）——
    // 某厂某类出力断流不应被其它厂/其它类掩盖（#3177）。
    seriesFields: ['plant', 'seriesRole']
  },
  // 月结明细：月度 cadence，按 month 聚合（recordType=summary/charge/project/source
  // 走 datasetKey 区分），不套 96 点时序口径。
  yn_settlement_detail: {
    cadence: 'monthly',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'month',
    valueFields: ['value', 'amount', 'quantity', 'price'],
    zeroRunWarnLength: 0
  },
  // 南网披露表通用长表（issue #2825）：17 个 datasetKey 共享一族，宽表 unpivot 后 96 点/日、
  // 标量表 1-N 行/日不统一，按「有行即可」的日行数口径（同 yn_hydro_group_limit 处置——
  // 不套 distinct timePoint 完整率，避免对宽表以外键恒误报）。
  yn_disclosure_metric: {
    cadence: 'daily',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'operateDate',
    valueFields: ['value'],
    zeroRunWarnLength: 0
  }
}

export function getQualityRule(family, datasetKey = '') {
  const base = CAPTURE_QUALITY_RULES[family]
  if (!base) return null
  const override = base.datasetOverrides?.[datasetKey]
  const merged = override ? { ...base, ...override } : { ...base }
  delete merged.datasetOverrides
  if (merged.skip) return null
  delete merged.skip
  if (!QUALITY_CADENCES.has(merged.cadence)) return null
  return merged
}

export function listQualityFamilies() {
  return Object.keys(CAPTURE_QUALITY_RULES).sort()
}
