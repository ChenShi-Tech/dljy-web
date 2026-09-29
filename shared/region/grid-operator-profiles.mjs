import { AREA_LABEL_BY_REGION, REGION_GRID_OPERATOR } from './constants.mjs'

export const GRID_OPERATOR_PROFILE_VERSION = '1.0.0'

const PROFILES = {
  csg: {
    id: 'csg', label: '中国南方电网', shortLabel: '南网', operatingArea: '南方区域五省区',
    regionIds: ['guangdong', 'guangxi', 'yunnan', 'guizhou', 'hainan'],
    hierarchy: ['南方区域', '省级市场', '节点 / 场站'],
    terminology: {
      marketArea: '南方区域', provinceMarket: '省级现货市场', pricingNode: '定价节点',
      zonePrice: '省级统一结算参考', unifiedClearing: '区域联合出清', intertie: '省间联络线',
      disclosure: '南网信息披露', systemSupply: '全区域供需',
    },
    visual: {
      accent: '#22d3ee', secondary: '#2dd4bf', warning: '#fbbf24', surface: '#071b29',
      gradient: ['#062b3d', '#0d5561', '#116466'], pattern: 'southern-flow', glyph: 'CSG',
    },
    defaultCamera: { longitude: 105.2, latitude: 24.3, heightM: 2_450_000, headingDeg: 0, pitchDeg: -72 },
    nodeFields: ['节点名称', '所属省区', '日前/实时价格引用', '位置状态'],
    intertieFields: ['联络线/通道', '送受端省份', '计划与实际交换', '约束方向'],
    principles: ['五省节点电价与南网披露优先', '省间联络与区域联合出清并列表达', '缺源不回退国网基线'],
  },
  sgcc: {
    id: 'sgcc', label: '国家电网', shortLabel: '国网', operatingArea: '国家电网经营区',
    regionIds: Object.entries(REGION_GRID_OPERATOR).filter(([, operator]) => operator === 'sgcc').map(([region]) => region),
    hierarchy: ['区域电网 / 分部', '省级市场', '分区 / 节点 / 场站'],
    terminology: {
      marketArea: '省级市场', provinceMarket: '省级现货市场', pricingNode: '节点 / 分区',
      zonePrice: '分区价 / 统一结算点价', unifiedClearing: '省级统一出清', intertie: '省间联络线',
      disclosure: '省级交易中心信息披露', systemSupply: '省级系统供需',
    },
    visual: {
      accent: '#60a5fa', secondary: '#818cf8', warning: '#fb923c', surface: '#0b1730',
      gradient: ['#0b1e41', '#173b72', '#315b93'], pattern: 'state-grid-mesh', glyph: 'SGCC',
    },
    defaultCamera: { longitude: 112.5, latitude: 34.0, heightM: 3_800_000, headingDeg: 0, pitchDeg: -78 },
    nodeFields: ['节点 / 分区名称', '省级市场', '价格口径', '位置状态'],
    intertieFields: ['省间通道', '送受端市场', '计划曲线', '可用输电能力'],
    principles: ['逐省规则和价格口径显式配置', '节点/分区/统一价术语不混用', '缺源不回退南网数据'],
  },
}

function availabilityFor(regionId, operator) {
  if (operator === 'csg') {
    return {
      assets: regionId === 'yunnan' ? { status: 'partial', reason: '已接云南首批有证据电厂；其他省份等待坐标证据库' } : { status: 'missing', reason: '当前省份尚无已核验电厂坐标目录' },
      nodes: { status: 'available', reason: '南网 DA/RT Parquet 已编译省级节点身份；坐标仍按节点逐项治理' },
      topology: { status: 'not-configured', reason: '授权网架 Provider 未接入；不根据公开节点或场站位置生成替代拓扑' },
      disclosure: { status: 'available', reason: '南网公开披露（整年导出 + 2026-07-03 起日文件接续）已编译检修、停运、干预、阻塞与约束事件' },
      weather: regionId === 'yunnan' ? { status: 'partial', reason: '仅对已定位云南电厂按需请求格点天气' } : { status: 'missing', reason: '没有可匹配天气的已定位电厂' },
      marketTimeseries: { status: 'available', reason: '五省节点日前/实时价格身份可用；时序按需加载，不进入空间 manifest' },
    }
  }
  return {
    assets: { status: 'missing', reason: '国网空间资产 Provider 尚未接入，不读取南网目录' },
    nodes: regionId === 'shanxi' ? { status: 'degraded', reason: '山西采集基线存在市场数据，但尚未编译空间节点目录' } : { status: 'missing', reason: '当前省份尚未接入空间节点目录' },
    topology: { status: 'not-configured', reason: '授权网架 Provider 未接入；不回退或读取南网拓扑' },
    disclosure: { status: 'not-configured', reason: 'SGCC 仅注册 Provider 契约，等待具体省级交易中心来源' },
    weather: { status: 'missing', reason: '没有已定位空间资产，不请求天气上游' },
    marketTimeseries: regionId === 'shanxi' ? { status: 'available', reason: '山西真实采集基线；仅限山西自身，不作为其他国网省份回退' } : { status: 'missing', reason: '当前省份真实市场时序未接入' },
  }
}

export function gridOperatorProfile(operator) {
  const profile = PROFILES[operator]
  return profile ? structuredClone(profile) : null
}

export function resolveGridOperatorProfile(regionId) {
  const operator = REGION_GRID_OPERATOR[regionId]
  const profile = gridOperatorProfile(operator)
  if (!profile) return null
  return {
    ...profile,
    profileVersion: GRID_OPERATOR_PROFILE_VERSION,
    region: { id: regionId, label: AREA_LABEL_BY_REGION[regionId] ?? regionId, gridOperator: operator },
    dataAvailability: availabilityFor(regionId, operator),
    dataPolicy: {
      fallback: 'none-across-grid', cacheNamespace: `grid-geo:${operator}:${regionId}`,
      clearOnOperatorChange: true, sourceType: 'CONFIG', mock: false, productionWrite: false,
    },
  }
}

export function validateGridOperatorProfiles() {
  const errors = []
  for (const operator of ['csg', 'sgcc']) {
    const profile = PROFILES[operator]
    if (!profile?.regionIds.length) errors.push(`${operator}.regionIds 不能为空`)
    if (!profile?.terminology?.pricingNode) errors.push(`${operator}.terminology.pricingNode 缺失`)
    if (!profile?.visual?.accent || !profile?.defaultCamera) errors.push(`${operator} 视觉或镜头缺失`)
    for (const regionId of profile?.regionIds ?? []) {
      if (REGION_GRID_OPERATOR[regionId] !== operator) errors.push(`${operator} 错收地区 ${regionId}`)
    }
  }
  const overlap = PROFILES.csg.regionIds.filter((region) => PROFILES.sgcc.regionIds.includes(region))
  if (overlap.length) errors.push(`跨电网地区重叠: ${overlap.join(',')}`)
  return errors
}

export const GRID_OPERATOR_PROFILE_REGION_IDS = Object.freeze([...PROFILES.csg.regionIds, ...PROFILES.sgcc.regionIds])
