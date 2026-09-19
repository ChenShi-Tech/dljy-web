// 套保接口的缓存键（openspec build-midlong-spot-hedging，D8/HW-08）。
//
// 缓存是进程内 LRU（上限 200 项、TTL 10 分钟、不做主动失效）。任何维护写入或台账写入
// 都会改变对应版本号，从而自然让缓存失效——键必须把 D8 列出的全部输入纳入，
// 漏一项就会出现「改了配置还读旧结果」。本模块零依赖、前后端同构，键为确定性字符串。
//
// 键的组成（D8）：
// - 请求维度：端点、公司、地区、解析后的窗口起止日期、粒度、scope/stationId/subjectId/dimension；
// - 认知时点：历史视图用 asOf 原值；当前视图用「当前时刻按 15 分钟网格向下取整」；
// - 权限维度：请求者是否具备中长期读权限（同一范围不同权限的结果不同，绝不共用键）；
// - 版本/水位：台账指纹、分类标注、机制参数、发电基准、生效方案、核定上限、实际数据、
//   所用预测运行、供应商数据、价格运行、登记文件版本（构建号）。

/** 15 分钟缓存网格（毫秒）。当前视图的“当前时刻”按北京时间所在网格向下取整。 */
export const CACHE_GRID_MS = 15 * 60 * 1000

/** 当前视图的时刻取整：按 15 分钟网格向下取整（跨过网格或午夜都会改变键）。 */
export function floorToCacheGrid(nowMs) {
  return Math.floor(Number(nowMs) / CACHE_GRID_MS) * CACHE_GRID_MS
}

function stringifyValue(value) {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stringifyValue).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${k}:${stringifyValue(value[k])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

/**
 * 生成套保缓存键。所有字段都参与键；未提供的可选维度记为 null（显式参与，不省略）。
 * watermarks / registryVersions 的每个键都是 D8 列出的版本或水位，逐项纳入。
 */
export function hedgeCacheKey({
  endpoint,
  companyId,
  regionId,
  windowFrom,
  windowTo,
  granularity = null,
  scope = null,
  stationId = null,
  subjectId = null,
  dimension = null,
  asOf = null,
  nowMs = null,
  hasMidlongRead = false,
  watermarks = {},
  registryVersions = {},
}) {
  const asOfPart = asOf !== null && asOf !== undefined
    ? `asof:${asOf}`
    : `grid:${nowMs === null || nowMs === undefined ? null : floorToCacheGrid(nowMs)}`
  const parts = {
    endpoint,
    companyId,
    regionId,
    from: windowFrom,
    to: windowTo,
    granularity,
    scope,
    stationId,
    subjectId,
    dimension,
    hasMidlongRead: hasMidlongRead ? 1 : 0,
    asOfPart,
    watermarks,
    registries: registryVersions,
  }
  return stringifyValue(parts)
}
