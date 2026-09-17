// 声明式 capture 数据质量规则。
//
// 本文件只描述“完整性/连续性/新鲜度”质量口径，不参与 capture.sqlite 的结构校验；
// DB schema 单一来源仍是 shared/schema/entities/capture-families.mjs。

export const QUALITY_CADENCES = new Set(['daily', 'monthly', 'manual'])

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
    zeroRunWarnLength: 24
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
    zeroRunWarnLength: 24
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
  market_analysis: {
    skip: true,
    cadence: 'manual',
    expectedPointsPerDay: 1,
    minRowsPerDay: 1,
    dateField: 'month',
    valueFields: ['quantity', 'avgPrice', 'value'],
    zeroRunWarnLength: 0,
    datasetOverrides: {
      market_monthly_trend: { skip: false, cadence: 'monthly', dateField: 'month' },
      market_price: { skip: false, cadence: 'monthly', dateField: 'month' }
    }
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
