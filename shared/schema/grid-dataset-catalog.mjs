// 电网体系数据集目录（层 1）——「逻辑数据集」的语义身份权威源。
//
// 为什么需要这一层：电力市场数据的**类型与格式在电网体系内部是统一的**（南网五省一套口径、
// 国网各省一套口径），但**取得它的通道是公司级的**（某集团向数据提供方申请的专属 API）。
// 这两件事此前被压在 `scripts/etl/lib/cgn-yunnan-market-contract.mjs` 一个文件里，用
// `CGN_YUNNAN_` 前缀命名，导致「南网公开披露的语义」看起来像是某一家公司的私有契约——
// 第二个省或第二家公司接同一批数据时，只能复制粘贴一份，语义随即发散。
//
// 分层边界（本文件的纪律，由 verify-grid-contracts 门禁强制）：
//   本层**拥有**：数据集码、所属电网、业务含义、mode、维度、指标与单位、颗粒度、地域口径种类。
//   本层**禁止**出现：上游字段名映射、响应根键、分页协议、凭据、公司 ID、PG 表名、region 实例值。
//     ——那些属于「通道」，声明在 source-registry 的 source instance 上（层 3）。
//
// 两个必须分清的概念（此前混为一谈，是本层第一版的建模错误）：
//
//   `authority`（本层字段）= 这条数据的**权威来源**。南网区域内，南网官方披露是第一可用
//     信息源；私有通道取得的副本在与官方重叠的部分，一律以官方为准，不得反客为主。
//   `acquisitionConstraint`（本层字段）= 这条数据的**内容**是否公开可得。
//
//   而「经某条通道取回的副本落在哪个隔离域」是**通道属性**，声明在层 3 的 source instance
//     上（中广核用自己的配额取回的数据落其私有 schema），与上面两个字段无关。
//
// 当前 38 条全部 `authority:'csg-official'` + `acquisitionConstraint:'open'`：上游 API 自身把
// 它们的 scope 全部标为 `public:*`（`public:disclosure:read`/`public:market-series:read`/
// `public:node-price:read`），需单独申请的 `plant:*`、`tenant:*` 资源不在本目录内。也就是说
// 这批数据是南网公开披露口径，中广核那条 API 只是取得它的一种通道，不是它的权威出处。

import { REGION_GRID_OPERATOR } from '../region/constants.mjs'

/** 合法电网体系值域——引用 REGION_GRID_OPERATOR 的取值，不另立一套词汇。 */
export const GRID_SCOPES = Object.freeze([...new Set(Object.values(REGION_GRID_OPERATOR))])

/** 地域口径的**种类**（≠ 隔离地域 region_id，后者属于层 3 的通道声明）。 */
export const REGION_SCOPE_KINDS = Object.freeze(['grid-wide', 'province', 'per-row'])

/**
 * 内容取得约束：
 *   open          = 内容属公开披露，任何取得该电网官方渠道的人都能得到（副本落哪由通道决定）
 *   channel-bound = 内容本身就绑定通道（如场站映射价、租户交易结算），无官方公开出处
 */
export const ACQUISITION_CONSTRAINTS = Object.freeze(['open', 'channel-bound'])

/**
 * 权威来源。南网区域内，南网官方披露是**第一可用信息源**；私有通道取回的同一数据集，
 * 在与官方重叠的部分以官方为准（消费侧路由优先级，见 docs/data/grid-dataset-catalog.md）。
 *   csg-official  = 南方电网官方披露口径
 *   sgcc-official = 国家电网官方披露口径（待四川接入时启用）
 *   channel-only  = 无官方公开出处，只能由特定通道提供
 */
export const DATA_AUTHORITIES = Object.freeze(['csg-official', 'sgcc-official', 'channel-only'])

/** intervalLabel → 颗粒度。派生而非存字面值，避免两处漂移。 */
export function granularityOf(intervalLabel) {
  if (intervalLabel === '15m') return Object.freeze({ nativeMinutes: 15, pointsPerDay: 96 })
  if (intervalLabel === '1h') return Object.freeze({ nativeMinutes: 60, pointsPerDay: 24 })
  return Object.freeze({ nativeMinutes: null, pointsPerDay: null })
}

function dataset({
  grid = 'csg',
  resourceKind,
  label,
  mode,
  dimensions = [],
  valueFields = {},
  textFields = [],
  dateFields = [],
  passthroughFields = [],
  unit = null,
  intervalLabel = null,
  regionScope = null,
  regionScopeKind,
  // 默认 open + csg-official：本目录当前收录的都是上游标 `public:*` scope 的南网公开披露口径。
  // 将来接入 plant:*/tenant:* 这类无官方出处的资源时，须显式改为 channel-bound + channel-only。
  acquisitionConstraint = 'open',
  authority = 'csg-official',
  // 维度名当前沿用上游中文表头。改为语义码需业务逐条确认 26 类披露的中文→码映射，
  // 未完成前标记 pending，门禁只警告不拦；补齐后本标记必须移除。
  semanticKeyPending = true,
}) {
  return Object.freeze({
    grid,
    resourceKind,
    label,
    mode,
    dimensions: Object.freeze([...dimensions]),
    valueFields: Object.freeze({ ...valueFields }),
    textFields: Object.freeze([...textFields]),
    dateFields: Object.freeze([...dateFields]),
    passthroughFields: Object.freeze([...passthroughFields]),
    unit,
    intervalLabel,
    regionScope,
    regionScopeKind,
    acquisitionConstraint,
    authority,
    semanticKeyPending,
  })
}

const series = (label, unit, intervalLabel, regionScope, regionScopeKind) => dataset({
  resourceKind: 'market_series',
  label,
  mode: 'timeseries',
  unit,
  intervalLabel,
  regionScope,
  regionScopeKind,
  semanticKeyPending: false, // 市场曲线无维度字段，不存在中文维度名待迁移问题
})

/**
 * 南网（csg）电网体系数据集目录。
 * datasetCode 与上游/存量契约保持一致，作为迁移期的兼容锚点。
 */
export const GRID_DATASET_CATALOG = Object.freeze({
  csg: Object.freeze({
    // ——— 标准市场曲线（11 条）———
    load_forecast: series('云南负荷预测', 'MW', '15m', '云南', 'province'),
    load_actual: series('云南实际负荷', 'MW', '15m', '云南', 'province'),
    new_energy_forecast: series('云南新能源预测', 'MW', '15m', '云南', 'province'),
    new_energy_actual: series('云南新能源实际', 'MW', '15m', '云南', 'province'),
    non_market_forecast: series('云南非市场化电源预测', 'MW', '15m', '云南', 'province'),
    non_market_actual: series('云南非市场化电源实际', 'MW', '15m', '云南', 'province'),
    // 口径陷阱：预测是南网整体、实际是云南，两者不可直接当同口径预测/实际对比。
    total_generation_forecast: series('总出力预测', 'MW', '15m', '南方电网整体', 'grid-wide'),
    total_generation_actual: series('云南总出力实际', 'MW', '15m', '云南', 'province'),
    hydro_generation_actual: series('云南水电实际出力', 'MW', '15m', '云南', 'province'),
    user_price_day_ahead: series('日前用户侧统一结算价', 'CNY/MWh', '1h', '云南', 'province'),
    user_price_real_time: series('实时用户侧统一结算价', 'CNY/MWh', '1h', '云南', 'province'),

    // 公开年包的小时送受电预测；目录登记不表示某家公司 API 已支持该数据集。
    inter_provincial_forecast: dataset({
      resourceKind: 'market_series', label: '省间送受电预测',
      mode: 'timeseries', dimensions: ['断面名称', '送受方向'],
      unit: 'MW', intervalLabel: '1h', regionScopeKind: 'per-row',
    }),

    // ——— 公共信息披露·实际类（10 条）———
    actual_grid_load_summary: dataset({
      resourceKind: 'disclosure', label: '实际电网负荷汇总',
      mode: 'scalar', dimensions: ['区域名称', '数据项名称'],
      valueFields: { 最高负荷: 'max_load', 最低负荷: 'min_load', 平均负荷: 'average_load' },
      unit: 'MW', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_interprov_tie_line: dataset({
      resourceKind: 'disclosure', label: '省间联络线实际曲线',
      mode: 'timeseries', dimensions: ['通道名称', '区域名称'],
      unit: 'MW', intervalLabel: '15m', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_key_channel_transmission: dataset({
      resourceKind: 'disclosure', label: '关键通道实际输电曲线',
      mode: 'timeseries', dimensions: ['通道名称', '区域名称'],
      unit: 'MW', intervalLabel: '15m', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_key_line_transformer_flow: dataset({
      resourceKind: 'disclosure', label: '关键线路/变压器实际潮流',
      mode: 'timeseries', dimensions: ['通道名称', '区域名称'],
      unit: 'MW', intervalLabel: '15m', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_manual_intervention: dataset({
      resourceKind: 'disclosure', label: '市场/调度人工干预记录',
      mode: 'event', dimensions: ['区域名称', '名称'], textFields: ['干预原因'],
      dateFields: ['干预开始时间', '干预结束时间'],
      passthroughFields: ['干预前最大值', '干预前最小值', '干预后最大值', '干预后最小值'],
      regionScopeKind: 'per-row',
    }),
    actual_peak_reserve: dataset({
      resourceKind: 'disclosure', label: '实际高峰备用容量',
      mode: 'scalar', dimensions: ['所属区域'], dateFields: ['日期'],
      valueFields: { 容量: 'reserve_capacity' },
      unit: 'MW', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_section_congestion: dataset({
      resourceKind: 'disclosure', label: '越限、重载断面数量',
      mode: 'scalar',
      valueFields: { 越限断面数量: 'limit_exceeded_section_count', 重载断面数量: 'heavy_load_section_count' },
      unit: 'count', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_stable_section: dataset({
      resourceKind: 'disclosure', label: '稳定断面最大负载率',
      mode: 'scalar', dimensions: ['断面名称'], valueFields: { 最大负载率: 'max_load_rate' },
      unit: '%', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_transmission_section_constraint: dataset({
      resourceKind: 'disclosure', label: '输电断面实际约束曲线',
      mode: 'timeseries', dimensions: ['通道名称', '数据类型', '区域名称'],
      unit: 'MW', intervalLabel: '15m', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    actual_unplanned_unit_outage: dataset({
      resourceKind: 'disclosure', label: '机组非计划停运/干预记录',
      mode: 'event', dimensions: ['所属区域', '调管机构', '电厂名称', '机组名称', '数据类型'],
      textFields: ['干预数值', '干预原因'], dateFields: ['干预时刻', '干预时间'],
      passthroughFields: ['干预人'], regionScopeKind: 'per-row',
    }),

    // ——— 公共信息披露·预测类（16 条）———
    forecast_external_tie_line: dataset({
      resourceKind: 'disclosure', label: '区外联络线计划/预测曲线',
      mode: 'timeseries', dimensions: ['区外联络线'],
      unit: 'MW', intervalLabel: '15m', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    forecast_grid_maintenance: dataset({
      resourceKind: 'disclosure', label: '电网设备检修信息',
      mode: 'event', dimensions: ['设备名称', '电压等级（千伏）'], dateFields: ['日期'],
      regionScopeKind: 'per-row',
    }),
    forecast_hydro_weekly_output: dataset({
      resourceKind: 'disclosure', label: '水电周平均出力',
      mode: 'scalar', dimensions: ['所属区域'], dateFields: ['日期'],
      valueFields: { '平均出力（MW）': 'average_output' }, unit: 'MW', regionScopeKind: 'per-row',
    }),
    forecast_interprov_priority_limit: dataset({
      resourceKind: 'disclosure', label: '省间优先送电下限',
      mode: 'scalar', dimensions: ['送电类别名称'], textFields: ['限值原因'],
      valueFields: { 送端电量下限: 'sending_energy_lower_limit' },
      unit: 'MWh', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    forecast_maintenance_plan: dataset({
      resourceKind: 'disclosure', label: '设备检修计划',
      mode: 'event', dimensions: ['区域名称', '电压等级', '设备名称', '设备类型'],
      dateFields: ['计划停电日期', '计划复电时间', '实际停电日期', '实际复电时间'],
      regionScopeKind: 'per-row',
    }),
    forecast_must_run_stop_unit_info: dataset({
      resourceKind: 'disclosure', label: '必开/必停机组分时信息',
      mode: 'timeseries', dimensions: ['所属区域', '电厂名称', '机组名称', '标签'],
      intervalLabel: '15m', regionScopeKind: 'per-row',
    }),
    forecast_must_run_stop_unit_list: dataset({
      resourceKind: 'disclosure', label: '必开/必停机组清单',
      mode: 'event', dimensions: ['所属区域', '电厂名称', '机组名称'], textFields: ['必开/必停'],
      regionScopeKind: 'per-row',
    }),
    forecast_non_da_new_energy_capacity: dataset({
      resourceKind: 'disclosure', label: '不参与日前市场的新能源容量',
      mode: 'scalar', dimensions: ['所属区域'], dateFields: ['日期'],
      valueFields: { '不参与日前市场的新能源总容量（兆瓦）': 'non_da_new_energy_capacity' },
      unit: 'MW', regionScopeKind: 'per-row',
    }),
    forecast_peak_regulation_demand: dataset({
      resourceKind: 'disclosure', label: '调峰需求',
      mode: 'event', dimensions: ['所属区域'], textFields: ['是否开展调峰'], regionScopeKind: 'per-row',
    }),
    forecast_price_weight: dataset({
      resourceKind: 'disclosure', label: '机组分段价格权重',
      mode: 'scalar', dimensions: ['所属区域', '电厂名称', '机组名称', '段序号'], dateFields: ['时间'],
      valueFields: {
        分段起始容量: 'segment_start_capacity',
        分段终止容量: 'segment_end_capacity',
        价格权重: 'price_weight',
      },
      regionScopeKind: 'per-row',
    }),
    forecast_reserve: dataset({
      resourceKind: 'disclosure', label: '备用容量曲线',
      mode: 'timeseries', dimensions: ['所属区域', '类型'], dateFields: ['日期'],
      passthroughFields: ['容量'], unit: 'MW', intervalLabel: '15m', regionScopeKind: 'per-row',
    }),
    forecast_transmission_capacity: dataset({
      resourceKind: 'disclosure', label: '通道最大可用容量',
      mode: 'scalar', dimensions: ['通道名称'], valueFields: { 最大可用容量: 'max_available_capacity' },
      unit: 'MW', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    forecast_unit_group: dataset({
      resourceKind: 'disclosure', label: '机组群及出力占比',
      mode: 'scalar', dimensions: ['所属区域', '机组群名称', '电厂名称', '机组名称'],
      valueFields: { '机组出力所占比例（百分比）': 'unit_output_share' }, unit: '%',
      regionScopeKind: 'per-row',
    }),
    forecast_unit_maintenance_capacity: dataset({
      resourceKind: 'disclosure', label: '南方区域机组检修总容量',
      mode: 'scalar', dateFields: ['日期'],
      valueFields: { '南方区域总容量（兆瓦）': 'southern_unit_maintenance_capacity' },
      unit: 'MW', regionScope: '南方电网整体', regionScopeKind: 'grid-wide',
    }),
    forecast_unit_output_constraint: dataset({
      resourceKind: 'disclosure', label: '机组出力约束分时信息',
      mode: 'timeseries', dimensions: ['所属区域', '调度电厂名称', '调度机组名称', '限值类型'],
      unit: 'MW', intervalLabel: '15m', regionScopeKind: 'per-row',
    }),
    forecast_yn_hydro_group_energy_limit: dataset({
      resourceKind: 'disclosure', label: '云南水电机组群限制信息',
      mode: 'scalar', dimensions: ['所属区域', '机组群名称', '电厂名称', '机组名称'],
      valueFields: { '机组出力所占比例（百分比）': 'unit_output_share' }, unit: '%',
      regionScope: '云南', regionScopeKind: 'province',
    }),

    // ——— 节点电价（1 条）———
    // 原生 15 分钟；上游另提供 1h 聚合，实测为同小时 4 点算术平均（差值仅 float32 精度噪声），
    // 属通道侧的可选聚合参数，不是独立数据集，故不在此另立一条。
    node_prices: dataset({
      resourceKind: 'node_price', label: '全网日前/实时节点价格',
      mode: 'timeseries', dimensions: ['region', 'node_name', 'market'],
      valueFields: { price: 'node_price' },
      unit: 'CNY/MWh', intervalLabel: '15m', regionScope: '云南', regionScopeKind: 'province',
      semanticKeyPending: false, // 上游此资源字段名本就是英文
    }),
  }),

  // 国网体系：本轮不接入，留空壳而非写投机实现。四川接入（Epic #1618）落地时在此登记。
  sgcc: Object.freeze({}),
})

/** 取某电网下某数据集的语义声明；不存在返回 null（诚实缺席，不猜） */
export function getGridDataset(grid, datasetCode) {
  return GRID_DATASET_CATALOG[grid]?.[datasetCode] ?? null
}

/** 列出某电网下某类资源的全部数据集码 */
export function listGridDatasetCodes(grid, resourceKind = null) {
  const entries = Object.entries(GRID_DATASET_CATALOG[grid] ?? {})
  return Object.freeze(
    entries
      .filter(([, spec]) => resourceKind === null || spec.resourceKind === resourceKind)
      .map(([code]) => code)
  )
}
