// 电厂地理空间资产子系统共享契约（Node API / 独立服务 / 验证脚本单一来源）。
// 第一阶段只描述资产身份、公开位置证据和业务引用，不承载线路、潮流或断面计算属性。

export const GRID_GEO_CONTRACT_VERSION = '1.6.0'
export const GRID_GEO_REGION_ID = 'yunnan'
export const GRID_GEO_COMPANY_ID = 'comp-cgn-yunnan'

export const GRID_GEO_VIEW_MODES = ['2d', '2.5d', '3d']
export const GRID_GEO_TERRAIN_PROVIDERS = ['arcgis-terrain', 'cesium-world-terrain', 'ellipsoid']
export const GRID_GEO_WEATHER_LAYERS = ['none', 'wind', 'temperature', 'precipitation', 'irradiance', 'cloud']
export const GRID_GEO_PLANT_TYPES = ['wind', 'solar', 'hydro', 'thermal', 'storage', 'other']
export const GRID_GEO_ACCURACY_LEVELS = ['site', 'village', 'township', 'county', 'approximate']
export const GRID_GEO_CONFIDENCE_LEVELS = ['verified', 'probable', 'unverified']
export const GRID_GEO_VISIBILITY_LEVELS = ['public', 'company', 'user']
export const GRID_GEO_ALLOWED_ROLES = ['BOSS', 'ADMIN', 'TRADE_LEAD', 'TRADER', 'RISK', 'QUANT', 'PLANT_OPERATOR', 'STORAGE_OPERATOR']
// 公开披露不暴露公司资产，可对全部已登录业务角色开放；个人/公司标注仍在服务端按主体隔离。
export const GRID_GEO_DISCLOSURE_ROLES = [...GRID_GEO_ALLOWED_ROLES, 'SETTLEMENT', 'RETAIL_MANAGER']
// 空间主数据写入沿用公司域的管理边界：平台管理员与本公司 BOSS；显式跨公司授权只放开读，不升级写。
export const GRID_GEO_WRITE_ROLES = ['ADMIN', 'BOSS']
export const GRID_GEO_PUBLIC_GOVERNANCE_ROLES = ['ADMIN']

const ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/

export function validateGridGeoCatalog(plants) {
  const errors = []
  const ids = new Set()
  if (!Array.isArray(plants) || plants.length === 0) return ['catalog 必须包含至少一个电厂']

  for (const [index, plant] of plants.entries()) {
    const at = `plants[${index}]`
    if (!ID_RE.test(String(plant?.plantId ?? ''))) errors.push(`${at}.plantId 非法`)
    if (ids.has(plant?.plantId)) errors.push(`${at}.plantId 重复: ${plant?.plantId}`)
    ids.add(plant?.plantId)
    if (!String(plant?.standardName ?? '').trim()) errors.push(`${at}.standardName 缺失`)
    if (!GRID_GEO_PLANT_TYPES.includes(plant?.plantType)) errors.push(`${at}.plantType 非法`)
    if (plant?.regionId !== GRID_GEO_REGION_ID) errors.push(`${at}.regionId 必须为 ${GRID_GEO_REGION_ID}`)
    if (plant?.ownerCompanyId !== GRID_GEO_COMPANY_ID) errors.push(`${at}.ownerCompanyId 必须为 ${GRID_GEO_COMPANY_ID}`)

    const { longitude, latitude, accuracyLevel, confidence, uncertaintyMeters } = plant?.location ?? {}
    if (!Number.isFinite(longitude) || longitude < 97 || longitude > 107) errors.push(`${at}.location.longitude 不在云南合理范围`)
    if (!Number.isFinite(latitude) || latitude < 21 || latitude > 30) errors.push(`${at}.location.latitude 不在云南合理范围`)
    if (!GRID_GEO_ACCURACY_LEVELS.includes(accuracyLevel)) errors.push(`${at}.location.accuracyLevel 非法`)
    if (!GRID_GEO_CONFIDENCE_LEVELS.includes(confidence)) errors.push(`${at}.location.confidence 非法`)
    if (!Number.isFinite(uncertaintyMeters) || uncertaintyMeters <= 0) errors.push(`${at}.location.uncertaintyMeters 必须为正数`)
    if (!String(plant?.location?.coordinateSource?.url ?? '').startsWith('https://')) errors.push(`${at}.location.coordinateSource.url 必须是 https`)
    if (!Array.isArray(plant?.location?.evidence) || plant.location.evidence.length === 0) errors.push(`${at}.location.evidence 缺失`)

    if (plant?.dataMeta?.sourceType !== 'IMPORT') errors.push(`${at}.dataMeta.sourceType 必须为 IMPORT`)
    if (plant?.dataMeta?.mock !== false) errors.push(`${at}.dataMeta.mock 必须为 false`)
    if (plant?.dataMeta?.productionWrite !== false) errors.push(`${at}.dataMeta.productionWrite 必须为 false`)
    if (plant?.dataMeta?.visibility !== 'company') errors.push(`${at}.dataMeta.visibility 必须为 company`)
  }
  return errors
}

export function assertGridGeoCatalog(plants) {
  const errors = validateGridGeoCatalog(plants)
  if (errors.length) throw new Error(`grid-geo catalog 校验失败:\n- ${errors.join('\n- ')}`)
  return plants
}

export function validateGridGeoLocationRegistry(registry, plants) {
  const errors = []
  const sourceIds = new Set()
  const names = new Set()
  const aliases = new Map()
  const canonicalOwners = new Map((registry ?? []).map((item) => {
    const name = String(item?.standardName ?? '').trim()
    return [name.toLocaleLowerCase('zh-CN'), name]
  }))
  const plantById = new Map((plants ?? []).map((plant) => [plant.plantId, plant]))
  const coordinates = new Map()
  if (!Array.isArray(registry) || registry.length === 0) return ['location registry 必须包含场站状态']

  for (const [index, item] of registry.entries()) {
    const at = `registry[${index}]`
    if (!String(item?.sourcePlantId ?? '').trim()) errors.push(`${at}.sourcePlantId 缺失`)
    if (sourceIds.has(item?.sourcePlantId)) errors.push(`${at}.sourcePlantId 重复: ${item?.sourcePlantId}`)
    sourceIds.add(item?.sourcePlantId)
    const name = String(item?.standardName ?? '').trim()
    if (!name) errors.push(`${at}.standardName 缺失`)
    if (names.has(name)) errors.push(`${at}.standardName 重复: ${name}`)
    names.add(name)
    if (!['verified', 'approximate', 'unresolved'].includes(item?.verificationStatus)) errors.push(`${at}.verificationStatus 非法`)
    for (const alias of item?.aliases ?? []) {
      const normalized = String(alias).trim().toLocaleLowerCase('zh-CN')
      if (!normalized) continue
      const owner = canonicalOwners.get(normalized) ?? aliases.get(normalized)
      if (owner && owner !== name) errors.push(`${at}.aliases 与 ${owner} 冲突: ${alias}`)
      aliases.set(normalized, name)
    }
    if (item?.verificationStatus === 'unresolved') {
      if (item?.plantId !== null) errors.push(`${at}.plantId unresolved 时必须为 null`)
      if (!String(item?.reason ?? '').trim()) errors.push(`${at}.reason unresolved 时必填`)
      continue
    }
    const plant = plantById.get(item?.plantId)
    if (!plant) {
      errors.push(`${at}.plantId 未命中空间 catalog: ${item?.plantId}`)
      continue
    }
    if (plant.standardName !== name) errors.push(`${at}.standardName 与空间资产不一致`)
    if (!Array.isArray(item?.evidence) || item.evidence.length === 0) errors.push(`${at}.evidence 缺失`)
    const key = `${Number(plant.location?.longitude).toFixed(7)},${Number(plant.location?.latitude).toFixed(7)}`
    const duplicate = coordinates.get(key)
    if (duplicate) errors.push(`${at}.coordinates 与 ${duplicate} 重复: ${key}`)
    coordinates.set(key, name)
  }

  for (const plant of plants ?? []) {
    if (!registry.some((item) => item.plantId === plant.plantId)) errors.push(`空间资产未登记定位状态: ${plant.plantId}`)
  }
  return errors
}

export function assertGridGeoLocationRegistry(registry, plants) {
  const errors = validateGridGeoLocationRegistry(registry, plants)
  if (errors.length) throw new Error(`grid-geo location registry 校验失败:\n- ${errors.join('\n- ')}`)
  return registry
}
