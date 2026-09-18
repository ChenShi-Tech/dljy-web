// 发电来源登记表（openspec build-midlong-spot-hedging，HG-02/D6，附录 B.10）。
//
// 只登记云南。取值按「场站 × 时段」依优先级回退，不混合、不平均（HG-02）；
// 省级或系统级曲线不进预测腿（HG-03）。调整顺序改本表并走 PR；准确度对照（HG-08）
// 只用于展示，系统不据准自动切换来源。
// 结构：{ regionId, leg, priority, key, label, sourceKind, family, dataType,
//         granularityMinutes, horizonDays, unitRule, publishRule, admission, staleRule }
// 登记文件的版本（GENERATION_SOURCES_VERSION）就是场站映射的版本，计入缓存键（D6/D8）。

/**
 * 过期规则（staleRule）：
 * - { kind: 'ACTUAL_LAG_DAYS', days }：实际数据截止点落后当前 T 超过 days 天 → STALE；
 * - { kind: 'RUN_AGE_HOURS', hours }：最新运行时刻距 T 超过 hours 小时 → STALE；
 * - { kind: 'DAY_AHEAD_ARRIVAL', byBeijingHour }：目标日前一日该小时（北京时间）预测仍未到达
 *   → 预测未到达（FORECAST_NOT_ARRIVED）。
 */

/** 登记文件版本：任何行变更都递增；作为场站映射与预测来源的缓存键组成。 */
export const GENERATION_SOURCES_VERSION = 1

/** 本变更只开放云南（D15）。 */
export const GENERATION_REGIONS = Object.freeze(['yunnan'])

export const GENERATION_SOURCES = Object.freeze([
  Object.freeze({
    regionId: 'yunnan',
    leg: 'ACTUAL',
    priority: 1,
    key: 'yunnan-actual-power',
    label: '场站实际功率',
    sourceKind: 'MEASURED',
    family: 'yn_plant_output',
    dataType: '实际功率',
    granularityMinutes: 60,
    horizonDays: 0,
    // 24 点值无字段定义：按登记假设把点值视为该小时平均功率折算（HG-04/风险表），页面须标注。
    unitRule: 'HOURLY_POINT_AS_AVG_MW',
    // 实际腿按业务时间截取（入库时刻有记录则一并校验，HG-06）。
    publishRule: 'BUSINESS_TIME',
    admission: 'ALWAYS',
    staleRule: Object.freeze({ kind: 'ACTUAL_LAG_DAYS', days: 2 }),
  }),
  Object.freeze({
    regionId: 'yunnan',
    leg: 'ACTUAL',
    priority: 2,
    key: 'yunnan-substation-actual',
    label: '子站回传',
    sourceKind: 'MEASURED',
    family: 'yn_plant_output',
    dataType: '子站回传',
    granularityMinutes: 60,
    horizonDays: 0,
    unitRule: 'HOURLY_POINT_AS_AVG_MW',
    publishRule: 'BUSINESS_TIME',
    admission: 'ALWAYS',
    staleRule: Object.freeze({ kind: 'ACTUAL_LAG_DAYS', days: 2 }),
  }),
  Object.freeze({
    regionId: 'yunnan',
    leg: 'FORECAST',
    priority: 1,
    key: 'yunnan-infer-plant-generation',
    label: 'dljy-infer 场站发电预测',
    sourceKind: 'MODEL',
    family: 'dljy-infer',
    dataType: 'plant_generation',
    granularityMinutes: 15,
    horizonDays: 1,
    unitRule: 'INTERVAL_MW',
    publishRule: 'RUN_RECORD',
    // 自研模型通过准入（G4/影子晋级）后才参与；未准入回退供应商（HF-06）。
    admission: 'MODEL_PROMOTED',
    staleRule: Object.freeze({ kind: 'RUN_AGE_HOURS', hours: 30 }),
  }),
  Object.freeze({
    regionId: 'yunnan',
    leg: 'FORECAST',
    priority: 2,
    key: 'yunnan-vendor-envision',
    label: '远景集团日前预测',
    sourceKind: 'VENDOR',
    family: 'yn_plant_output',
    dataType: '远景集团预测',
    granularityMinutes: 60,
    horizonDays: 1,
    unitRule: 'HOURLY_POINT_AS_AVG_MW',
    // 源数据不带发布时刻：登记假设「目标日前一日 00:00 起视为已知」；入库时刻有记录取较晚者（HG-02）。
    publishRule: 'DAY_BEFORE_MIDNIGHT',
    publishAssumption: '发布时刻为登记假设（目标日前一日 00:00）',
    admission: 'ALWAYS',
    staleRule: Object.freeze({ kind: 'DAY_AHEAD_ARRIVAL', byBeijingHour: 12 }),
  }),
  Object.freeze({
    regionId: 'yunnan',
    leg: 'FORECAST',
    priority: 3,
    key: 'yunnan-vendor-guoneng',
    label: '国能日新日前预测',
    sourceKind: 'VENDOR',
    family: 'yn_plant_output',
    dataType: '国能日新预测',
    granularityMinutes: 60,
    horizonDays: 1,
    unitRule: 'HOURLY_POINT_AS_AVG_MW',
    publishRule: 'DAY_BEFORE_MIDNIGHT',
    publishAssumption: '发布时刻为登记假设（目标日前一日 00:00）',
    admission: 'ALWAYS',
    staleRule: Object.freeze({ kind: 'DAY_AHEAD_ARRIVAL', byBeijingHour: 12 }),
  }),
])

/** 不作为预测/实际腿使用的数据类型（HG-02/D6），写明原因供页面与缺口引用。 */
export const EXCLUDED_OUTPUT_DATA_TYPES = Object.freeze([
  Object.freeze({ dataType: '超短期预测', reason: '日内滚动预测的发布时刻不可知，不可按认知时点复现' }),
  Object.freeze({ dataType: '最终下发', reason: '调度计划口径，不是预测' }),
  Object.freeze({ dataType: '可用功率', reason: '能力口径，不是预计发电' }),
  Object.freeze({ dataType: '理论功率', reason: '理论口径，不是预计发电' }),
  Object.freeze({ dataType: '省级曲线', reason: '省级/系统级曲线不按装机折算，只在市场背景区展示（HG-03）' }),
])

/** 按地区与腿取登记来源（priority 升序）。未登记地区返回空数组——不回退、不串读。 */
export function generationSourcesFor({ regionId, leg = null }) {
  return GENERATION_SOURCES.filter((row) => row.regionId === regionId && (leg === null || row.leg === leg))
    .sort((a, b) => a.priority - b.priority)
}

// ── 场站映射（HG-05）：不猜测。一对多拆分按登记比例执行；未映射列缺口。 ──────────

/**
 * 构建映射索引。mappings: [{ sourceName, stationId, stationName, share? }]；
 * sourceName 是数据源里的对象名（如主数据标准名与四路别名，company-cgn-seed 播种的对账结果）。
 * 同名多个目标表示一对多拆分，share 之和必须为 1。
 */
export function buildStationMapIndex(mappings) {
  const byName = new Map()
  for (const mapping of mappings ?? []) {
    const key = String(mapping.sourceName ?? '').trim()
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push({ stationId: mapping.stationId, stationName: mapping.stationName ?? mapping.stationId, share: mapping.share ?? '1' })
  }
  return byName
}

/**
 * 解析数据源对象名 → 公司场站。没有映射 → { mapped: false, reason: 'UNMAPPED' }，
 * MUST NOT 按名称相似度自动归属（HG-05）。
 */
export function resolveStationMapping(index, sourceName) {
  const key = String(sourceName ?? '').trim()
  const hits = index.get(key)
  if (!hits || !hits.length) return { mapped: false, reason: 'UNMAPPED' }
  if (hits.length === 1) return { mapped: true, targets: hits }
  return { mapped: true, targets: hits, split: true }
}
