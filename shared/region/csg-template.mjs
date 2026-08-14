// 南网通用数据模板与五省区域实例映射。
// 模板层只描述 schema/dataNamespace，不包含公司或场站数据；公司/场站实例在
// regionModules.ts 中登记，ETL 只消费这里的 region 参数化信息。

export const CSG_TEMPLATE_ID = 'generic-csg'
export const CSG_RULE_SET_ID = 'generic-csg-spot'
export const CSG_DATA_NAMESPACE = 'csg_common'

export const CSG_TEMPLATE_FAMILIES = [
  'yn_system_forecast',
  'yn_system_supply'
]

export const CSG_REGION_INSTANCES = [
  { regionId: 'guangdong', code: 'gd', column: 'region_gd', shortName: '广东', provinceAlias: '粤' },
  { regionId: 'guangxi', code: 'gx', column: 'region_gx', shortName: '广西', provinceAlias: '桂' },
  { regionId: 'yunnan', code: 'yn', column: 'region_yn', shortName: '云南', provinceAlias: '滇' },
  { regionId: 'guizhou', code: 'gz', column: 'region_gz', shortName: '贵州', provinceAlias: '黔' },
  { regionId: 'hainan', code: 'hn', column: 'region_hn', shortName: '海南', provinceAlias: '琼' }
]

export const CSG_REGION_BY_ID = new Map(CSG_REGION_INSTANCES.map((item) => [item.regionId, item]))
export const CSG_REGION_BY_CODE = new Map(CSG_REGION_INSTANCES.map((item) => [item.code, item]))
export const CSG_REGION_BY_NAME = new Map(CSG_REGION_INSTANCES.map((item) => [item.shortName, item]))

export function getCsgRegionInstance(regionId = 'yunnan') {
  return CSG_REGION_BY_ID.get(regionId) ?? null
}

export function requireCsgRegionInstance(regionId = 'yunnan') {
  const instance = getCsgRegionInstance(regionId)
  if (!instance) {
    const allowed = CSG_REGION_INSTANCES.map((item) => item.regionId).join(', ')
    throw new Error(`不支持的南网区域实例 region=${regionId}，允许值：${allowed}`)
  }
  return instance
}

export function normalizeCsgBusinessRegion(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === '全区域' || trimmed === '南网' || trimmed === 'region_all' || trimmed === 'all') return 'all'
  if (trimmed.startsWith('region_')) return trimmed.slice('region_'.length)
  return CSG_REGION_BY_NAME.get(trimmed)?.code ?? trimmed
}

export function matchesCsgRegion(value, regionId, { includeAll = true } = {}) {
  const instance = requireCsgRegionInstance(regionId)
  const normalized = normalizeCsgBusinessRegion(value)
  return normalized === instance.code || (includeAll && normalized === 'all')
}

export function csgRegionColumn(regionId) {
  return requireCsgRegionInstance(regionId).column
}

export function csgRegionCode(regionId) {
  return requireCsgRegionInstance(regionId).code
}

export function csgRegionShortName(regionId) {
  return requireCsgRegionInstance(regionId).shortName
}
