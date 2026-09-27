// 市场洞察来源语义登记（#2993 任务 3.3，Epic #2989）。
//
// 只登记「洞察要怎么理解这份数据」：业务范围、访问范围、度量种类与单位、原生粒度、时点标注方式、
// 价格对象、版本选择规则。数据归属、物理表、采集通道凭据等一律留在既有权威注册表
// （capture-families / source-registry / serving-route-registry），这里只存引用键，不复制字面值。
//
// 事实依据：docs/data/yunnan-market-insight-data-baseline.md（2026-09-18 本机实例只读核对）。
//   - yn_system_forecast 同一 dataset 混有 region=yn（云南）与 region=all（非云南的整体口径）两种范围，
//     两者单位都是 MW，都不乘 0.1（语义层的相反说明见 #2999）。
//   - 功率序列是区间平均还是时点瞬时，源端没有说明：一律登记为 unknown，禁止积分成电量。
//   - 时点 HH:MM 取值 00:00…23:45（15 分钟）或 00:00…23:00（小时），标注的是区间起点。

/** 度量种类：决定能否求和、能否按时长加权、能否积分成电量。 */
export const MEASURE_KINDS = Object.freeze(['price', 'power', 'energy', 'amount', 'ratio', 'capacity', 'count', 'flag', 'list'])
/** 记录类度量（是否、清单）：不是数值时序，只走「记录」视图，不做规范化、汇总或画曲线（#3022）。 */
export const RECORD_KINDS = Object.freeze(['flag', 'list'])
/** 功率语义：只有 interval-average 可以乘时长变电量；instant 与 unknown 只能取平均或画图。 */
export const POWER_SEMANTICS = Object.freeze(['interval-average', 'instant', 'unknown'])
/** 业务范围：说的是哪一片市场，不是存储隔离地区。 */
export const BUSINESS_SCOPES = Object.freeze(['yunnan', 'csg-aggregate', 'csg-multi-region', 'plant', 'node'])
export const ACCESS_SCOPES = Object.freeze(['public', 'company'])
/**
 * 版本规则：
 *   single       自然键唯一；同键多行即冲突，不按导入先后覆盖
 *   owner-latest 源所有者已按上游修订时间给出唯一有效版本（例如私有库 latest_* 视图），洞察不再二次挑选
 *   status-axis  同一业务键有明确的状态轴（正式/暂结），按请求的状态取，不混算
 */
export const VERSION_POLICIES = Object.freeze(['single', 'owner-latest', 'status-axis'])
/**
 * 供需类别（#3005，SH01）：负荷是需求；水电、新能源按电源类型分；非市场按市场属性分，可能与水电/新能源重叠；
 * 总发电是合计；送受电单列。类别之间不能随意相加，「总发电减水电减新能源」也不是火电。
 */
export const SUPPLY_CATEGORIES = Object.freeze(['load', 'hydro', 'new-energy', 'non-market', 'total-generation', 'transfer'])
/** 新鲜度节奏：历史资料包没有持续供数资格，新鲜度只能是 unknown（D3.1）。 */
export const FRESHNESS_CADENCES = Object.freeze(['daily', 'historical-package', 'monthly-package', 'unregistered'])

/** 厂侧私有通道的归属公司（与 capture-families 的 CGN_YUNNAN_COMPANY_ID 相同，单测核对一致）。 */
const CGN_OWNER = 'comp-cgn-yunnan'

const TIME_15 = Object.freeze({ resolutionMinutes: 15, slotLabel: 'interval-start', dateField: 'operateDate', timeField: 'timePoint' })
const TIME_60 = Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'operateDate', timeField: 'timePoint' })
const POWER_MW = Object.freeze({ kind: 'power', unit: 'MW', inputUnit: 'MW', factor: '1', powerSemantics: 'unknown' })
const PRICE = Object.freeze({ kind: 'price', unit: 'yuan/MWh', inputUnit: 'yuan/MWh', factor: '1' })

function capture(family, datasetKey, rowFilter = null) {
  return Object.freeze({ kind: 'capture', family, datasetKey, ...(rowFilter ? { rowFilter: Object.freeze(rowFilter) } : {}) })
}

function source(definition) {
  return Object.freeze({
    accessNote: null,
    variant: null,
    marketPhase: null,
    priceObject: null,
    knownAt: null,
    dimensions: Object.freeze([]),
    objectDimension: null,
    category: null,
    precision: Object.freeze({ places: 3 }),
    versionPolicy: 'single',
    ...definition,
  })
}

const SYSTEM_SERIES = [
  ['load', '统调负荷'], ['hydro', '水电出力'], ['new-energy', '新能源出力'], ['non-market', '非市场机组出力'], ['total-generation', '总发电出力'],
]
const METRIC_KEY = { load: 'load', hydro: 'hydro', 'new-energy': 'new_energy', 'non-market': 'non_market', 'total-generation': 'total_generation' }

const systemSources = [
  ...SYSTEM_SERIES.map(([id, label]) => source({
    sourceId: `yn.system.${id}.actual`, title: `云南${label}（实际）`, category: id,
    read: capture('yn_system_forecast', `${METRIC_KEY[id]}_actual`, { region: 'yn' }),
    businessScope: 'yunnan', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    accessNote: '2026-07-02 之后经中广核渠道（feed=cgn-api）写入公开族的行，按 #3066 只对授权集合含中广核的账号可见（洞察按所选公司判定），其余公司只读到公共来源（见数据基线 3.1 节）',
    measure: POWER_MW, time: TIME_15, variant: 'actual', freshness: 'historical-package',
  })),
  ...SYSTEM_SERIES.map(([id, label]) => source({
    sourceId: `csg.system.${id}.actual`, title: `南方电网整体口径${label}（实际，背景）`, category: id,
    read: capture('yn_system_forecast', `${METRIC_KEY[id]}_actual`, { region: 'all' }),
    businessScope: 'csg-aggregate', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    accessNote: '非云南范围；与云南序列不是简单包含关系（水电比值 0.69—2.48），只作单列背景，不计入云南汇总',
    measure: POWER_MW, time: TIME_15, variant: 'actual', freshness: 'historical-package',
  })),
  source({
    sourceId: 'yn.system.load.forecast', category: 'load', title: '云南统调负荷（预测）',
    read: capture('yn_system_forecast', 'load_forecast', { region: 'yn' }),
    businessScope: 'yunnan', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: TIME_15, variant: 'forecast', freshness: 'historical-package',
  }),
  source({
    sourceId: 'yn.system.new-energy.forecast-d1', category: 'new-energy', title: '云南新能源出力（日前预测）',
    read: capture('yn_system_forecast', 'new_energy_forecast_d1', { region: 'yn' }),
    businessScope: 'yunnan', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: Object.freeze({ ...TIME_15, targetDateField: 'targetDate', leadDays: 1 }), variant: 'forecast', freshness: 'historical-package',
  }),
  source({
    sourceId: 'yn.system.non-market.forecast', category: 'non-market', title: '云南非市场机组出力（预测）',
    read: capture('yn_system_forecast', 'non_market_forecast', { region: 'yn' }),
    businessScope: 'yunnan', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: TIME_15, variant: 'forecast', freshness: 'historical-package',
  }),
  source({
    sourceId: 'csg.system.load.forecast', category: 'load', title: '南方电网整体口径统调负荷（预测，背景）',
    read: capture('yn_system_forecast', 'load_forecast', { region: 'all' }),
    businessScope: 'csg-aggregate', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: TIME_15, variant: 'forecast', freshness: 'historical-package',
  }),
  source({
    sourceId: 'csg.system.new-energy.forecast-d1', category: 'new-energy', title: '南方电网整体口径新能源出力（日前预测，背景）',
    read: capture('yn_system_forecast', 'new_energy_forecast_d1', { region: 'all' }),
    businessScope: 'csg-aggregate', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: Object.freeze({ ...TIME_15, targetDateField: 'targetDate', leadDays: 1 }), variant: 'forecast', freshness: 'historical-package',
  }),
  // 只有南方电网整体口径，没有云南总发电预测：不能与云南总发电实际算误差（A05）。
  source({
    sourceId: 'csg.system.total-generation.forecast', category: 'total-generation', title: '南方电网整体口径总发电出力（预测，背景）',
    read: capture('yn_system_forecast', 'total_generation_forecast', { region: 'all' }),
    businessScope: 'csg-aggregate', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: TIME_15, variant: 'forecast', freshness: 'historical-package',
  }),
  // 省间送受：24 点，metric 区分送出/受入，region 字段是明确的通道名称。
  source({
    sourceId: 'csg.transfer.inter-provincial.forecast', title: '省间送受电（预测，按通道）',
    read: capture('yn_system_forecast', 'inter_provincial_forecast'),
    businessScope: 'csg-multi-region', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: POWER_MW, time: TIME_60, variant: 'forecast', freshness: 'historical-package',
    dimensions: Object.freeze(['region', 'metric']), category: 'transfer',
  }),
  // 云南总送出（预测）：同一 dataset 里按通道名筛出云南一条，方向为送出（#3005，剩余需求代理的输入）。
  source({
    sourceId: 'yn.transfer.send-out.forecast', title: '云南总送出（预测）', category: 'transfer',
    read: capture('yn_system_forecast', 'inter_provincial_forecast', { region: '云南总送出', metric: 'inter_provincial_send' }),
    businessScope: 'yunnan', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    accessNote: '只有送出方向；本来源没有云南受入，不能等同于净外送',
    measure: POWER_MW, time: TIME_60, variant: 'forecast', freshness: 'historical-package',
  }),
]

const priceSources = [
  // 用户侧小时价：payload.region 恒为 all，含义是云南市场的用户侧价，不是节点价。
  ...[['day-ahead', 'da_user_price', '日前'], ['real-time', 'rt_user_price', '实时']].map(([phase, key, label]) => source({
    sourceId: `yn.price.user.${phase}`, title: `云南用户侧${label}价格`,
    read: capture('yn_system_forecast', key),
    businessScope: 'yunnan', accessScope: 'public', authority: 'trading-center', ingestChannel: 'bulk-history',
    measure: PRICE, time: TIME_60, marketPhase: phase, priceObject: 'user-price', freshness: 'historical-package',
  })),
  // 公开历史节点价：读路径归 agent-backend（Python）独占，Node 只经 HTTP 读取（serving-route node_price）。
  ...[['day-ahead', '日前'], ['real-time', '实时']].map(([phase, label]) => source({
    sourceId: `yn.price.node.public.${phase}`, title: `云南公开节点${label}价格（历史）`,
    read: Object.freeze({ kind: 'serving', datasetId: 'node_price', region: 'yunnan' }),
    businessScope: 'node', accessScope: 'public', authority: 'trading-center', ingestChannel: 'bulk-history',
    measure: Object.freeze({ ...PRICE, valueField: 'price' }), time: TIME_15, marketPhase: phase, priceObject: 'public-node',
    // 节点名在公开维表里全局唯一，就是对象身份
    freshness: 'historical-package', dimensions: Object.freeze(['nodeName']), objectDimension: 'nodeName',
  })),
  // 厂侧私有节点价：源所有者用 latest_cgn_node_price 视图给出唯一有效版本；失败不回落公开历史（DE07）。
  ...[['day-ahead', '日前'], ['real-time', '实时']].map(([phase, label]) => source({
    sourceId: `cgn.price.node.${phase}`, title: `厂侧节点${label}价格（获权）`,
    read: Object.freeze({ kind: 'private-api', resource: 'cgn-node-price', ownerCompanyId: CGN_OWNER }),
    businessScope: 'node', accessScope: 'company', authority: 'trading-center', ingestChannel: 'cgn-api',
    measure: Object.freeze({ ...PRICE, valueField: 'price' }), time: TIME_15, marketPhase: phase, priceObject: 'company-node',
    // 按节点名选对象，但序列按上游节点 ID 分开：同名不同 ID 的节点不合并成一条（PR05）
    versionPolicy: 'owner-latest', freshness: 'unregistered', dimensions: Object.freeze(['nodeName', 'upstreamNodeId']), objectDimension: 'nodeName',
    accessNote: '经中广核渠道取得，内容虽是市场价格，仍按公司私有授权读取',
  })),
  ...[['day-ahead', '日前'], ['real-time', '实时']].map(([phase, label]) => source({
    sourceId: `cgn.price.plant-node.${phase}`, title: `厂站关联节点${label}价格（获权，小时）`,
    read: Object.freeze({ kind: 'private-api', resource: 'cgn-plant-node-price', ownerCompanyId: CGN_OWNER }),
    businessScope: 'plant', accessScope: 'company', authority: 'trading-center', ingestChannel: 'cgn-api',
    measure: Object.freeze({ ...PRICE, valueField: 'price' }), time: TIME_60, marketPhase: phase, priceObject: 'plant-node',
    // 对象身份是绑定表的标准厂名；一个场站挂多个节点时逐节点分序列，不取首个、不等权平均
    versionPolicy: 'owner-latest', freshness: 'unregistered', dimensions: Object.freeze(['plantName', 'stationId', 'upstreamNodeId', 'nodeName']), objectDimension: 'plantName',
  })),
]

// 中广核渠道取得的南网披露（#3005 水电事实视角）：经 agent-backend 私有接口读取，按公司私有授权。
// 逐日记录；payloadFields 把上游中文列名映射成洞察字段，未登记的列不读。
const privateDisclosure = (dataset, payloadFields) => Object.freeze({ kind: 'private-api', resource: 'cgn-disclosure', dataset, ownerCompanyId: CGN_OWNER, payloadFields: Object.freeze(payloadFields) })
const TIME_DAY = Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'operateDate' })

// 跨省与电网边界、备用与机组（#3022，设计 D8）：中广核渠道取得的南网披露，经 agent-backend 私有接口读取。
// 分时数据（15 分钟）时点列 time_point 是区间起点；逐日数据按业务日。值在 payload 的文本列里，数值列为空。
// 方向与符号原样保留：通道流量与断面限值可为负，负号就是方向，不取绝对值。
const TIME_15_PRIVATE = Object.freeze({ resolutionMinutes: 15, slotLabel: 'interval-start', dateField: 'operateDate', timeField: 'timePoint' })
const gridPrivate = spec => source({
  accessScope: 'company', authority: 'csg-disclosure', ingestChannel: 'cgn-api', versionPolicy: 'owner-latest', freshness: 'unregistered',
  accessNote: '经中广核渠道取得的南网披露，按公司私有授权读取', ...spec,
})
const MW_SIGNED = Object.freeze({ kind: 'power', unit: 'MW', inputUnit: 'MW', factor: '1', powerSemantics: 'unknown', valueField: 'value' })
const CAPACITY_MW = field => Object.freeze({ kind: 'capacity', unit: 'MW', inputUnit: 'MW', factor: '1', valueField: field })

const gridDisclosureSources = [
  gridPrivate({
    sourceId: 'cgn.grid.tie-line.actual', title: '省间联络线实际（总送出/总受入）', category: 'transfer',
    read: privateDisclosure('actual_interprov_tie_line', { region: '区域名称', channel: '通道名称', timePoint: 'time_point', value: 'value' }),
    businessScope: 'csg-multi-region', measure: MW_SIGNED, time: TIME_15_PRIVATE, variant: 'actual',
    dimensions: Object.freeze(['region', 'channel']), objectDimension: 'channel',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.key-channel.actual', title: '重点通道输电实际', category: 'transfer',
    read: privateDisclosure('actual_key_channel_transmission', { channel: '通道名称', timePoint: 'time_point', value: 'value' }),
    businessScope: 'csg-aggregate', measure: MW_SIGNED, time: TIME_15_PRIVATE, variant: 'actual',
    dimensions: Object.freeze(['channel']), objectDimension: 'channel',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.key-line-transformer.actual', title: '重点线路与主变潮流实际', category: 'transfer',
    read: privateDisclosure('actual_key_line_transformer_flow', { channel: '通道名称', timePoint: 'time_point', value: 'value' }),
    businessScope: 'csg-aggregate', measure: MW_SIGNED, time: TIME_15_PRIVATE, variant: 'actual',
    dimensions: Object.freeze(['channel']), objectDimension: 'channel',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.section-constraint.actual', title: '输电断面限值（正向/反向）', category: 'transfer',
    read: privateDisclosure('actual_transmission_section_constraint', { channel: '通道名称', limitType: '数据类型', timePoint: 'time_point', value: 'value' }),
    businessScope: 'csg-aggregate', measure: Object.freeze({ ...MW_SIGNED, kind: 'capacity' }), time: TIME_15_PRIVATE, variant: 'actual',
    dimensions: Object.freeze(['channel', 'limitType']), objectDimension: 'channel',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.external-tie-line.forecast', title: '区外联络线计划', category: 'transfer',
    read: privateDisclosure('forecast_external_tie_line', { tieLine: '区外联络线', timePoint: 'time_point', value: 'value' }),
    businessScope: 'csg-aggregate', measure: MW_SIGNED, time: TIME_15_PRIVATE, variant: 'forecast',
    dimensions: Object.freeze(['tieLine']), objectDimension: 'tieLine',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.priority-limit.forecast', title: '省间优先送电电量下限（日）', category: 'transfer',
    read: privateDisclosure('forecast_interprov_priority_limit', { category: '送电类别名称', lowerLimit: '送端电量下限' }),
    businessScope: 'csg-multi-region', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'lowerLimit' }),
    time: TIME_DAY, variant: 'forecast', dimensions: Object.freeze(['category']), objectDimension: 'category',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.transmission-capacity.forecast', title: '通道最大可用输电能力（日）', category: 'transfer',
    read: privateDisclosure('forecast_transmission_capacity', { channel: '通道名称', capacity: '最大可用容量' }),
    businessScope: 'csg-aggregate', measure: CAPACITY_MW('capacity'), time: TIME_DAY, variant: 'forecast',
    dimensions: Object.freeze(['channel']), objectDimension: 'channel',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.stable-section.actual', title: '稳定断面最大负载率（日，获权）',
    read: privateDisclosure('actual_stable_section', { section: '断面名称', maxLoadRate: '最大负载率' }),
    businessScope: 'csg-multi-region', measure: Object.freeze({ kind: 'ratio', unit: '%', inputUnit: '%', factor: '1', valueField: 'maxLoadRate' }),
    time: TIME_DAY, variant: 'actual', dimensions: Object.freeze(['section']), objectDimension: 'section',
  }),
  gridPrivate({
    sourceId: 'cgn.grid.section-congestion.actual', title: '重载与越限断面数量（日）',
    read: privateDisclosure('actual_section_congestion', { heavy: '重载断面数量', exceeded: '越限断面数量' }),
    businessScope: 'csg-aggregate', time: TIME_DAY, variant: 'actual',
    measure: Object.freeze({
      kind: 'count', unit: 'count', inputUnit: 'count', factor: '1',
      fields: Object.freeze([
        Object.freeze({ id: 'heavySections', valueField: 'heavy', unit: 'count', kind: 'count' }),
        Object.freeze({ id: 'exceededSections', valueField: 'exceeded', unit: 'count', kind: 'count' }),
      ]),
    }),
  }),
  gridPrivate({
    sourceId: 'cgn.grid.load-summary.actual', title: '电网负荷总体情况（日，南网）', category: 'load',
    read: privateDisclosure('actual_grid_load_summary', { region: '区域名称', average: '平均负荷', min: '最低负荷', max: '最高负荷' }),
    businessScope: 'csg-aggregate', time: TIME_DAY, variant: 'actual',
    measure: Object.freeze({
      kind: 'power', unit: 'MW', inputUnit: 'MW', factor: '1', powerSemantics: 'unknown',
      fields: Object.freeze([
        Object.freeze({ id: 'average', valueField: 'average', unit: 'MW', kind: 'power' }),
        Object.freeze({ id: 'min', valueField: 'min', unit: 'MW', kind: 'power' }),
        Object.freeze({ id: 'max', valueField: 'max', unit: 'MW', kind: 'power' }),
      ]),
    }),
    dimensions: Object.freeze(['region']),
  }),
  gridPrivate({
    sourceId: 'cgn.reserve.peak.actual', title: '高峰备用容量实际（日，按区域）',
    read: privateDisclosure('actual_peak_reserve', { region: '所属区域', capacity: '容量' }),
    businessScope: 'csg-multi-region', measure: CAPACITY_MW('capacity'), time: TIME_DAY, variant: 'actual',
    dimensions: Object.freeze(['region']), objectDimension: 'region',
  }),
  gridPrivate({
    sourceId: 'cgn.reserve.forecast', title: '正负备用预测（获权，按区域）',
    read: privateDisclosure('forecast_reserve', { region: '所属区域', reserveType: '类型', timePoint: 'time_point', value: 'value' }),
    businessScope: 'csg-multi-region', measure: Object.freeze({ kind: 'capacity', unit: 'MW', inputUnit: 'MW', factor: '1', valueField: 'value' }),
    time: TIME_15_PRIVATE, variant: 'forecast', dimensions: Object.freeze(['region', 'reserveType']), objectDimension: 'region',
  }),
  gridPrivate({
    sourceId: 'cgn.units.non-da-new-energy-capacity', title: '不参与日前市场的新能源容量（日）',
    read: privateDisclosure('forecast_non_da_new_energy_capacity', { region: '所属区域', capacity: '不参与日前市场的新能源总容量（兆瓦）' }),
    businessScope: 'csg-multi-region', measure: CAPACITY_MW('capacity'), time: TIME_DAY, variant: 'forecast',
    accessNote: '容量不是出力；区域含「全区域」，按区域分列不相加', dimensions: Object.freeze(['region']), objectDimension: 'region',
  }),
  gridPrivate({
    sourceId: 'cgn.units.maintenance-capacity', title: '机组检修容量（日，南方区域总值）',
    read: privateDisclosure('forecast_unit_maintenance_capacity', { capacity: '南方区域总容量（兆瓦）' }),
    businessScope: 'csg-aggregate', measure: CAPACITY_MW('capacity'), time: TIME_DAY, variant: 'forecast',
    accessNote: '南方区域总值，不是云南停机容量，不能作云南备用率分母',
  }),
  gridPrivate({
    sourceId: 'cgn.units.price-weight', title: '机组分段价格权重（日）',
    // 存储日期是发布日，payload 的 operate_date 是适用的运行日：2026-07-18—08-17 的 2,850 行逐行都是发布日 +1。
    read: privateDisclosure('forecast_price_weight', { targetDate: 'operate_date', region: '所属区域', plant: '电厂名称', unit: '机组名称', segment: '段序号', weight: '价格权重', segmentStart: '分段起始容量', segmentEnd: '分段终止容量' }),
    businessScope: 'csg-multi-region', time: Object.freeze({ ...TIME_DAY, targetDateField: 'targetDate', leadDays: 1 }), variant: 'forecast',
    accessNote: '权重与分段容量是规则背景，不是报价或边际成本；分段容量源端未注明单位',
    measure: Object.freeze({
      kind: 'ratio', unit: 'weight', inputUnit: 'weight', factor: '1',
      fields: Object.freeze([
        Object.freeze({ id: 'weight', valueField: 'weight', unit: 'weight', kind: 'ratio' }),
        Object.freeze({ id: 'segmentStart', valueField: 'segmentStart', unit: 'unspecified', kind: 'capacity' }),
        Object.freeze({ id: 'segmentEnd', valueField: 'segmentEnd', unit: 'unspecified', kind: 'capacity' }),
      ]),
    }),
    dimensions: Object.freeze(['region', 'plant', 'unit', 'segment']), objectDimension: 'plant',
  }),
  gridPrivate({
    sourceId: 'cgn.units.group-share', title: '机组群组成与出力占比（必开/最小方式等，按区域）',
    read: privateDisclosure('forecast_unit_group', { region: '所属区域', group: '机组群名称', plant: '电厂名称', unit: '机组名称', share: '机组出力所占比例（百分比）' }),
    businessScope: 'csg-multi-region', measure: Object.freeze({ kind: 'ratio', unit: '%', inputUnit: '%', factor: '1', valueField: 'share' }),
    time: TIME_DAY, variant: 'forecast', dimensions: Object.freeze(['region', 'group', 'plant', 'unit']), objectDimension: 'group',
  }),
  // 以下两类是清单与是否，不是数值时序：只走「记录」视图，不画曲线、不换算出力。
  gridPrivate({
    sourceId: 'cgn.units.peak-regulation', title: '是否开展调峰（日，按区域）',
    read: privateDisclosure('forecast_peak_regulation_demand', { region: '所属区域', flag: '是否开展调峰' }),
    businessScope: 'csg-multi-region', measure: Object.freeze({ kind: 'flag', unit: 'yes-no', inputUnit: 'yes-no', factor: '1', valueField: 'flag' }),
    time: TIME_DAY, variant: 'forecast', dimensions: Object.freeze(['region']), objectDimension: 'region',
    accessNote: '只是是否开展调峰，不是调峰需求的 MW 数',
  }),
  gridPrivate({
    sourceId: 'cgn.units.must-run-stop', title: '必开必停机组清单（日）',
    read: privateDisclosure('forecast_must_run_stop_unit_list', { region: '所属区域', plant: '电厂名称', unit: '机组名称', mode: '必开/必停' }),
    businessScope: 'csg-multi-region', measure: Object.freeze({ kind: 'list', unit: 'list', inputUnit: 'list', factor: '1', valueField: 'mode' }),
    time: TIME_DAY, variant: 'forecast', dimensions: Object.freeze(['region', 'plant', 'unit']), objectDimension: 'plant',
    accessNote: '只有名单，没有分时出力；不按装机容量生成出力曲线',
  }),
]

const hydroDisclosureSources = [
  source({
    sourceId: 'cgn.hydro.weekly-output.forecast', title: '水电周出力预测（逐日平均出力，按区域）', category: 'hydro',
    read: privateDisclosure('forecast_hydro_weekly_output', { region: '所属区域', averageOutput: '平均出力（MW）' }),
    businessScope: 'csg-multi-region', accessScope: 'company', authority: 'csg-disclosure', ingestChannel: 'cgn-api',
    accessNote: '经中广核渠道取得的南网披露，按公司私有授权读取；区域含云南与其他省，按区域分列、不相加',
    // 「平均出力」是逐日平均功率，属于区间平均；只作功率展示，不在本来源内换算电量。
    measure: Object.freeze({ kind: 'power', unit: 'MW', inputUnit: 'MW', factor: '1', powerSemantics: 'interval-average', valueField: 'averageOutput' }),
    time: TIME_DAY, variant: 'forecast', versionPolicy: 'owner-latest', freshness: 'unregistered',
    dimensions: Object.freeze(['region']), objectDimension: 'region',
  }),
  source({
    sourceId: 'cgn.hydro.yn-group-share', title: '云南水电机组群组成与机组出力占比（按日）', category: 'hydro',
    read: privateDisclosure('forecast_yn_hydro_group_energy_limit', { region: '所属区域', group: '机组群名称', plant: '电厂名称', unit: '机组名称', share: '机组出力所占比例（百分比）' }),
    businessScope: 'yunnan', accessScope: 'company', authority: 'csg-disclosure', ingestChannel: 'cgn-api',
    accessNote: '上游数据集名称含「电量上限」，实际只披露机组群组成与占比，没有电量或出力上限值；不据此画上限线',
    measure: Object.freeze({ kind: 'ratio', unit: '%', inputUnit: '%', factor: '1', valueField: 'share' }),
    time: TIME_DAY, variant: 'forecast', versionPolicy: 'owner-latest', freshness: 'unregistered',
    dimensions: Object.freeze(['region', 'group', 'plant', 'unit']), objectDimension: 'group',
  }),
]

const disclosureSources = [
  source({
    sourceId: 'csg.disclosure.stable-section', title: '稳定断面最大负载率（日）',
    read: capture('yn_disclosure_metric', 'actual_stable_section'),
    businessScope: 'csg-multi-region', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: Object.freeze({ kind: 'ratio', unit: '%', inputUnit: '%', factor: '1' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'operateDate' }),
    variant: 'actual', freshness: 'historical-package', dimensions: Object.freeze(['sectionName']),
  }),
  source({
    sourceId: 'csg.disclosure.reserve.forecast', title: '正/负备用（预测，按区域）',
    read: capture('yn_disclosure_metric', 'forecast_reserve'),
    businessScope: 'csg-multi-region', accessScope: 'public', authority: 'csg-disclosure', ingestChannel: 'bulk-history',
    measure: Object.freeze({ kind: 'capacity', unit: 'MW', inputUnit: 'MW', factor: '1' }),
    time: TIME_15, variant: 'forecast', freshness: 'historical-package', dimensions: Object.freeze(['regionName', 'dataType']),
  }),
]

const monthPackage = { accessScope: 'company', authority: 'company-monthly-package', ingestChannel: 'monthly-export', freshness: 'monthly-package' }
const plantSources = [
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.output', title: '场站出力八类曲线（五月月包）',
    read: capture('yn_plant_output', 'yn_plant_output'),
    businessScope: 'plant', measure: Object.freeze({ ...POWER_MW, valueField: 'valueMw' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'timePoint' }),
    dimensions: Object.freeze(['plant', 'unitName', 'dataType']), objectDimension: 'plant',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.nodal-price', title: '场站节点结算电价（五月月包，小时）',
    read: capture('yn_plant_nodal_price', 'plant_nodal_price'),
    businessScope: 'plant', measure: Object.freeze({ ...PRICE, valueField: 'price' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'timePoint' }),
    priceObject: 'plant-node', dimensions: Object.freeze(['plant', 'nodeName', 'dataType']), objectDimension: 'plant',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.settlement-daily', title: '场站日结算（正式，五月月包）',
    read: capture('yn_spot_settlement', 'yn_settlement_daily'),
    businessScope: 'plant',
    measure: Object.freeze({
      kind: 'amount', unit: 'yuan', inputUnit: 'yuan', factor: '1',
      // 日结一行同时有电量与电费：按字段拆成两条序列，均价只由量费加权内核计算，不在读取层派生。
      fields: Object.freeze([
        Object.freeze({ id: 'totalEnergy', valueField: 'totalEnergy', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'totalFee', valueField: 'totalFee', unit: 'yuan', kind: 'amount' }),
      ]),
    }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'date' }),
    priceObject: 'settlement-price', versionPolicy: 'status-axis', precision: Object.freeze({ places: 2 }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '现有读模型只含正式日结；暂结需经结算原件通道单独读取（设计 D7），不得混进正式口径',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.loss-daily', title: '场站日损失归因（源系统披露，五月月包）',
    read: capture('yn_loss_attribution', 'yn_loss_daily'),
    businessScope: 'plant',
    measure: Object.freeze({
      kind: 'amount', unit: 'yuan', inputUnit: 'yuan', factor: '1',
      fields: Object.freeze([
        Object.freeze({ id: 'strategyLossTotal', valueField: 'strategyLossTotal', unit: 'yuan', kind: 'amount' }),
        Object.freeze({ id: 'forecastLossTotal', valueField: 'forecastLossTotal', unit: 'yuan', kind: 'amount' }),
        Object.freeze({ id: 'gridLossTotal', valueField: 'gridLossTotal', unit: 'yuan', kind: 'amount' }),
      ]),
    }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'date' }),
    precision: Object.freeze({ places: 2 }), dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '电网损失字段在已核验月包中全部为空：保持未提供，不补零、不用残差填充（ST04）',
  }),
  // ── 五月月包余量数据集（#3026 预检后接入通道；数据落库前查询诚实缺数，目标库写入见 issue #3027）──
  // 槽位口径：长表 hour 是 0-23 数值槽位（24 小时，不扩成 96 点），读取层按「序号 × 60 分钟」换算。
  // 价格不双计：场站节点价仍以 cgn.plant.nodal-price 为唯一价格来源；plant_spot_summary_data /
  // plant_spot_business_summary 里的「日前/实时结算电价」行不注册成来源（对拍记录见预检文档）。
  // 合同唯一事实源：yn_contracts 仅作上传保真，洞察不建第二合同账（任务 9.6 的明确未接入决定）。
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.spot-clearing-day-ahead', title: '日前出清电量（申报出清，获权）',
    read: capture('yn_plant_timeseries', 'plant_spot_summary_data', { dataType: '日前出清电量' }),
    businessScope: 'plant', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '出清电量是市场出清口径，与实际上网电量、集控实发分开呈现，不相加不互换（PP06）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.spot-clearing-real-time', title: '实时出清电量（申报出清，获权）',
    read: capture('yn_plant_timeseries', 'plant_spot_summary_data', { dataType: '实时出清电量' }),
    businessScope: 'plant', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.business-declared', title: '日前申报电量（经营汇总，获权）',
    read: capture('yn_plant_timeseries', 'plant_spot_business_summary', { dataType: '日前申报电量' }),
    businessScope: 'plant', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '申报口径来自经营汇总表；与出清电量（plant_spot_summary_data）按语义分开，不双计',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.business-actual', title: '实际上网电量（经营汇总，获权）',
    read: capture('yn_plant_timeseries', 'plant_spot_business_summary', { dataType: '实际上网电量' }),
    businessScope: 'plant', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.business-integrated-forecast', title: '一体化预测出力（经营汇总，获权）',
    read: capture('yn_plant_timeseries', 'plant_spot_business_summary', { dataType: '一体化预测' }),
    businessScope: 'plant', measure: Object.freeze({ ...POWER_MW, valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant', variant: 'forecast',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.control-generation', title: '集控实发电量（获权）',
    read: capture('yn_plant_timeseries', 'plant_control_center_generation'),
    businessScope: 'plant', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '集控口径发电量，与结算/市场电量并列对照，不互换（D7）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.midlong-energy', title: '中长期电量（历史曲线引用，获权）',
    read: capture('yn_plant_timeseries', 'plant_mid_long_term_data', { dataType: '中长期电量' }),
    businessScope: 'plant', measure: Object.freeze({ kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '历史中长期曲线只读引用；不是合同持仓账，24 买方点不称 96 点，合同现状见中长期模块（CH04）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.midlong-price', title: '中长期电价（历史曲线引用，获权）',
    read: capture('yn_plant_timeseries', 'plant_mid_long_term_data', { dataType: '中长期电价' }),
    businessScope: 'plant', measure: Object.freeze({ kind: 'price', unit: 'yuan/MWh', inputUnit: 'yuan/MWh', factor: '1', valueField: 'value' }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'date', timeField: 'hour' }),
    priceObject: 'settlement-price', dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '合同约定价格的月包历史记录，非现货节点价',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.daily-metrics', title: '场站日报指标（获权）',
    read: capture('yn_plant_daily_metrics', 'plant_daily_report_metrics'),
    businessScope: 'plant',
    measure: Object.freeze({
      kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'totalGenerationMWh',
      fields: Object.freeze([
        Object.freeze({ id: 'totalGeneration', valueField: 'totalGenerationMWh', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'marketGeneration', valueField: 'marketGenerationMWh', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'dayAheadDeclared', valueField: 'dayAheadDeclaredMwh', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'integratedForecast', valueField: 'integratedForecastMwh', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'settlementRevenue', valueField: 'settlementRevenueYuan', unit: 'yuan', kind: 'amount' }),
        Object.freeze({ id: 'marketPrice', valueField: 'marketPriceYuanPerMwh', unit: 'yuan/MWh', kind: 'price' }),
      ]),
    }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'date' }),
    priceObject: 'settlement-price', precision: Object.freeze({ places: 2 }),
    dimensions: Object.freeze(['plant']), objectDimension: 'plant',
    accessNote: '日报宽表；缺测说明（missingDataJson）随行保留，参与质量过滤，不静默剔除（PP06）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.settlement-interval-formal', title: '分时结算电量电费（正式，获权）',
    read: capture('yn_settlement_docs', 'plant_spot_settle_data', { result_type: 'formal' }),
    businessScope: 'plant',
    measure: Object.freeze({
      kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'totalload',
      fields: Object.freeze([
        Object.freeze({ id: 'totalLoad', valueField: 'totalload', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'totalFee', valueField: 'totalfee', unit: 'yuan', kind: 'amount' }),
        Object.freeze({ id: 'averagePrice', valueField: 'averageprice', unit: 'yuan/MWh', kind: 'price' }),
        Object.freeze({ id: 'finalPrice', valueField: 'final_price', unit: 'yuan/MWh', kind: 'price' }),
      ]),
    }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'data_date', timeField: 'timestamps' }),
    priceObject: 'settlement-price', versionPolicy: 'status-axis', precision: Object.freeze({ places: 2 }),
    dimensions: Object.freeze(['name']), objectDimension: 'name',
    accessNote: '正式结算分时；暂结（temp）走单独来源，两者不混算不相加（ST01）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.plant.settlement-interval-temp', title: '分时结算电量电费（暂结，获权）',
    read: capture('yn_settlement_docs', 'plant_spot_settle_data', { result_type: 'temp' }),
    businessScope: 'plant',
    measure: Object.freeze({
      kind: 'energy', unit: 'MWh', inputUnit: 'MWh', factor: '1', valueField: 'totalload',
      fields: Object.freeze([
        Object.freeze({ id: 'totalLoad', valueField: 'totalload', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'totalFee', valueField: 'totalfee', unit: 'yuan', kind: 'amount' }),
        Object.freeze({ id: 'averagePrice', valueField: 'averageprice', unit: 'yuan/MWh', kind: 'price' }),
        Object.freeze({ id: 'finalPrice', valueField: 'final_price', unit: 'yuan/MWh', kind: 'price' }),
      ]),
    }),
    time: Object.freeze({ resolutionMinutes: 60, slotLabel: 'interval-start', dateField: 'data_date', timeField: 'timestamps' }),
    priceObject: 'settlement-price', versionPolicy: 'status-axis', precision: Object.freeze({ places: 2 }),
    dimensions: Object.freeze(['name']), objectDimension: 'name',
    accessNote: '暂结视角单独读取，只作与正式的差异对照；经营合计仍以正式为准',
  }),
  // ── 结算表现（#3081，OpenSpec 任务 12.1—12.4，ST01—ST06）───────────────────────
  // 暂结日结：yn_settlement_docs 的 plant_daily_settlement_raw 保真行（48 列中文表头，
  // payload 键=原始列名），状态列 result_type=formal/temp（2026-05 月包各 992 行，逐行核验）。
  // 正式经营合计仍由 cgn.plant.settlement-daily（正式读模型）提供，两态不混算不相加（D7、ST01）。
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.daily-settlement-temp', title: '场站日结算（暂结，原始证据提取，获权）',
    read: capture('yn_settlement_docs', 'plant_daily_settlement_raw', { result_type: 'temp' }),
    businessScope: 'plant',
    measure: Object.freeze({
      kind: 'amount', unit: 'yuan', inputUnit: 'yuan', factor: '1',
      fields: Object.freeze([
        Object.freeze({ id: 'totalEnergy', valueField: '总电量', unit: 'MWh', kind: 'energy' }),
        Object.freeze({ id: 'totalFee', valueField: '总电费', unit: 'yuan', kind: 'amount' }),
      ]),
    }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: '日期' }),
    priceObject: 'settlement-price', versionPolicy: 'status-axis', precision: Object.freeze({ places: 2 }),
    dimensions: Object.freeze(['电厂名']), objectDimension: '电厂名',
    accessNote: '暂结日结按原始证据提取：行 schema 无结构化状态列之外的状态机，按 result_type=temp 行过滤；'
      + '正式视角默认读正式读模型，本来源只作与正式的同键差异对照，绝不并入正式合计（ST01、A08）',
  }),
  // 月结汇总（月周期资料）：plant_monthly_settlement_raw 保真载荷里按明确定义抽取白名单字段
  // 「批发购电月费用合计_总电费」（原始行文本，如 2228725.86 元）。businessPeriod: month——
  // 行的日期是月份标记（settlemonth=2026-05），按月落窗与计覆盖，不冒充某一天。
  // 只抽电费不抽电量：月包电量表头口径未经核实（unit-semantics 台账：月表电量疑为 kWh），
  // 不确定单位前不登记、不与日结算电量相加（D5 第 3 条）。
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.monthly-total', title: '月结汇总电费（月结载荷白名单字段，获权）',
    read: capture('yn_settlement_docs', 'plant_monthly_settlement_raw'),
    businessScope: 'plant',
    measure: Object.freeze({ kind: 'amount', unit: 'yuan', inputUnit: 'yuan', factor: '1', valueField: '批发购电月费用合计_总电费' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'settlemonth', businessPeriod: 'month' }),
    priceObject: 'settlement-price', precision: Object.freeze({ places: 2 }),
    dimensions: Object.freeze(['电厂名', 'settlemonth']), objectDimension: '电厂名',
    accessNote: '月结是月周期：只与同对象同月份核对展示，不与日报（日）/日结（日）相加或互比（ST05）；'
      + '总电费是月结载荷的既有事实，不倒推未舍入金额',
  }),
  // 以下五类是单据/审批/原件引用（记录，不是数值时序）：只走「记录」视图，不汇总不画曲线
  // （参照 cgn.units.must-run-stop 的登记方式；ST06 源行及权属可追溯，审批仍归结算业务模块）。
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.bill-records', title: '账单索引记录（获权）',
    read: capture('yn_settlement_docs', 'settlement_bill_records_raw'),
    businessScope: 'plant', measure: Object.freeze({ kind: 'list', unit: 'list', inputUnit: 'list', factor: '1', valueField: 'id' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'billmonth', businessPeriod: 'month' }),
    dimensions: Object.freeze(['plant_name', 'bill_type', 'settle_month', 'company_name']), objectDimension: 'plant_name',
    accessNote: '账单索引≠账单原件：只有索引记录不代表文件可下载、更不代表已核对原件（ST06）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.bill-downloads', title: '账单文件下载记录（获权）',
    read: capture('yn_settlement_docs', 'settlement_bill_file_downloads'),
    businessScope: 'plant', measure: Object.freeze({ kind: 'list', unit: 'list', inputUnit: 'list', factor: '1', valueField: 'download_status' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'settle_month', businessPeriod: 'month' }),
    dimensions: Object.freeze(['plant_name', 'bill_type', 'settle_month', 'file_name', 'file_ext']), objectDimension: 'plant_name',
    accessNote: '有索引不等于文件可下载：download_status 是历史下载记录，不生成当前可下载承诺（ST06）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.bill-cells', title: '账单单元格转录（获权）',
    read: capture('yn_settlement_docs', 'settlement_bill_excel_cells'),
    businessScope: 'plant', measure: Object.freeze({ kind: 'list', unit: 'list', inputUnit: 'list', factor: '1', valueField: 'cell_value' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'settle_month', businessPeriod: 'month' }),
    dimensions: Object.freeze(['plant_name', 'bill_type', 'file_name', 'sheet_name', 'row_index', 'col_index']), objectDimension: 'plant_name',
    accessNote: '无模板/单元格语义不得计算合计：单元格只是原件转录，行间没有可加性（ST06、D7）',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.monthly-doc', title: '月结原始载荷（获权）',
    read: capture('yn_settlement_docs', 'plant_monthly_settlement_raw'),
    businessScope: 'plant', measure: Object.freeze({ kind: 'list', unit: 'list', inputUnit: 'list', factor: '1', valueField: '交易编号' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'settlemonth', businessPeriod: 'month' }),
    dimensions: Object.freeze(['电厂名', 'settlemonth', 'company_name']), objectDimension: '电厂名',
    accessNote: '月结原始载荷记录：记录值是交易编号，raw_json 载荷随保真行原样落库可溯源；数值口径看 cgn.settlement.monthly-total，不在这里求和',
  }),
  source({
    ...monthPackage,
    sourceId: 'cgn.settlement.daily-split', title: '拆分日结审批记录（获权）',
    read: capture('yn_settlement_docs', 'plant_daily_split_settlement_raw'),
    businessScope: 'plant', measure: Object.freeze({ kind: 'list', unit: 'list', inputUnit: 'list', factor: '1', valueField: 'billstatus' }),
    time: Object.freeze({ resolutionMinutes: 1440, slotLabel: 'business-day', dateField: 'data_date' }),
    dimensions: Object.freeze(['name', 'type', 'result_type', 'pdfstatus']), objectDimension: 'name',
    accessNote: '拆分结算的审批/单据状态记录；审批与对账处置归结算业务模块，洞察只读不改（ST06）',
  }),
]

export const INSIGHT_SOURCES = Object.freeze([...systemSources, ...hydroDisclosureSources, ...gridDisclosureSources, ...priceSources, ...disclosureSources, ...plantSources])
const BY_ID = new Map(INSIGHT_SOURCES.map(entry => [entry.sourceId, entry]))

/**
 * 来源的数值字段：多数来源只有一个数值（value 或 measure.valueField）；日结、损失这类宽行按字段拆成多条序列。
 * @returns {Array<{ id: string, valueField: string, unit: string, kind: string }>}
 */
export function sourceFields(source) {
  if (source.measure.fields?.length) return source.measure.fields.map(field => ({ ...field }))
  return [{ id: 'value', valueField: source.measure.valueField ?? 'value', unit: source.measure.unit, kind: source.measure.kind }]
}

export function getInsightSource(sourceId) {
  return BY_ID.get(sourceId) ?? null
}

export function listInsightSources(filter = {}) {
  return INSIGHT_SOURCES.filter(entry => Object.entries(filter).every(([key, value]) => entry[key] === value))
}

/** 登记自检：词汇、粒度、唯一性与「功率不可积分」约束。门禁与单测调用。 */
export function validateInsightSources(sources = INSIGHT_SOURCES) {
  const errors = []
  const seen = new Set()
  for (const entry of sources) {
    const where = entry.sourceId ?? '(缺 sourceId)'
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(entry.sourceId ?? '')) errors.push(`${where}: sourceId 格式不正确`)
    if (seen.has(entry.sourceId)) errors.push(`${where}: 重复登记`)
    seen.add(entry.sourceId)
    if (!BUSINESS_SCOPES.includes(entry.businessScope)) errors.push(`${where}: 未知业务范围 ${entry.businessScope}`)
    if (!ACCESS_SCOPES.includes(entry.accessScope)) errors.push(`${where}: 未知访问范围 ${entry.accessScope}`)
    if (!VERSION_POLICIES.includes(entry.versionPolicy)) errors.push(`${where}: 未知版本规则 ${entry.versionPolicy}`)
    if (!FRESHNESS_CADENCES.includes(entry.freshness)) errors.push(`${where}: 未知新鲜度节奏 ${entry.freshness}`)
    if (!MEASURE_KINDS.includes(entry.measure?.kind)) errors.push(`${where}: 未知度量种类`)
    if (entry.measure?.kind === 'power' && !POWER_SEMANTICS.includes(entry.measure.powerSemantics)) errors.push(`${where}: 功率必须声明区间平均/瞬时/未知`)
    if (typeof entry.measure?.factor !== 'string' || !/^\d+(?:\.\d+)?$/.test(entry.measure.factor)) errors.push(`${where}: 单位换算系数必须是十进制字符串`)
    if (![15, 60, 1440].includes(entry.time?.resolutionMinutes)) errors.push(`${where}: 原生粒度只登记 15/60/1440 分钟`)
    if (entry.time?.businessPeriod !== undefined && entry.time.businessPeriod !== 'month') errors.push(`${where}: businessPeriod 只支持 month（月结等月周期资料）`)
    if (entry.measure?.kind === 'price' && !entry.priceObject) errors.push(`${where}: 价格来源必须声明价格对象`)
    if (!['capture', 'serving', 'private-api'].includes(entry.read?.kind)) errors.push(`${where}: 未知读取方式`)
    if (entry.accessScope === 'company' && entry.read?.kind === 'serving') errors.push(`${where}: 公司私有来源不能经公开 serving 路由读取`)
    if (entry.read?.kind === 'private-api' && (entry.accessScope !== 'company' || !entry.read.ownerCompanyId)) errors.push(`${where}: 私有接口来源必须声明公司私有范围与归属公司`)
    if (entry.read?.resource === 'cgn-disclosure') {
      const mapped = Object.keys(entry.read.payloadFields ?? {})
      const needed = [...entry.dimensions, ...sourceFields(entry).map(field => field.valueField), ...(entry.time?.targetDateField ? [entry.time.targetDateField] : [])]
      if (!entry.read.dataset || needed.some(name => !mapped.includes(name))) errors.push(`${where}: 私有披露来源必须声明数据集，并为全部维度与取值字段登记列名映射`)
    }
    for (const field of entry.measure?.fields ?? []) {
      // valueField 是 capture payload 里的取值键：归一化行族是驼峰英文字段，保真行族
      // （如 plant_daily_settlement_raw 的 总电量/总电费）按设计保留原始中文列名（D7 保真）。
      if (!/^[A-Za-z\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]{0,63}$/.test(field.valueField ?? '') || !MEASURE_KINDS.includes(field.kind) || typeof field.unit !== 'string') errors.push(`${where}: 字段 ${field.id} 登记不完整`)
    }
    if (entry.objectDimension && !entry.dimensions.includes(entry.objectDimension)) errors.push(`${where}: 对象维度必须是已登记维度之一`)
    if (entry.time?.leadDays !== undefined && (!entry.time.targetDateField || !Number.isInteger(entry.time.leadDays) || entry.time.leadDays < 0)) errors.push(`${where}: 提前天数必须配合目标日字段、且为非负整数`)
    if (entry.category !== null && !SUPPLY_CATEGORIES.includes(entry.category)) errors.push(`${where}: 未知供需类别 ${entry.category}`)
  }
  return errors
}
