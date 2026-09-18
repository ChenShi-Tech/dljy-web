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
export const MEASURE_KINDS = Object.freeze(['price', 'power', 'energy', 'amount', 'ratio', 'capacity', 'flag', 'list'])
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
    accessNote: '2026-07-02 之后的行经中广核渠道取得后写入公开族，访问范围待确认（见数据基线 3.1 节）',
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
]

export const INSIGHT_SOURCES = Object.freeze([...systemSources, ...priceSources, ...disclosureSources, ...plantSources])
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
    if (entry.measure?.kind === 'price' && !entry.priceObject) errors.push(`${where}: 价格来源必须声明价格对象`)
    if (!['capture', 'serving', 'private-api'].includes(entry.read?.kind)) errors.push(`${where}: 未知读取方式`)
    if (entry.accessScope === 'company' && entry.read?.kind === 'serving') errors.push(`${where}: 公司私有来源不能经公开 serving 路由读取`)
    if (entry.read?.kind === 'private-api' && (entry.accessScope !== 'company' || !entry.read.ownerCompanyId)) errors.push(`${where}: 私有接口来源必须声明公司私有范围与归属公司`)
    for (const field of entry.measure?.fields ?? []) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.valueField ?? '') || !MEASURE_KINDS.includes(field.kind) || typeof field.unit !== 'string') errors.push(`${where}: 字段 ${field.id} 登记不完整`)
    }
    if (entry.objectDimension && !entry.dimensions.includes(entry.objectDimension)) errors.push(`${where}: 对象维度必须是已登记维度之一`)
    if (entry.time?.leadDays !== undefined && (!entry.time.targetDateField || !Number.isInteger(entry.time.leadDays) || entry.time.leadDays < 0)) errors.push(`${where}: 提前天数必须配合目标日字段、且为非负整数`)
    if (entry.category !== null && !SUPPLY_CATEGORIES.includes(entry.category)) errors.push(`${where}: 未知供需类别 ${entry.category}`)
  }
  return errors
}
