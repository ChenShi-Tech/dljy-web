export type GridOperatorId =
  | 'state-grid'
  | 'china-southern-grid'
  | 'inner-mongolia-grid'
  | 'special-region'
  | 'taiwan-grid'

export type RegionProfileKind = 'template' | 'province'

export type RegionRuleSet = {
  id: string
  label: string
  marketScope: string
  spotRuleStatus: 'generic' | 'draft' | 'trial' | 'active' | 'to-be-customized'
  dataNamespace: string
  settlementModel: string
  tradingModes: string[]
  customizationNotes: string[]
}

export type RegionProfile = {
  id: string
  name: string
  shortName: string
  kind: RegionProfileKind
  gridOperator: GridOperatorId
  gridLabel: string
  regionGroup: string
  provincialLevel: boolean
  ruleSet: RegionRuleSet
}

export const requiredProvincialRegionIds = [
  'beijing',
  'tianjin',
  'hebei',
  'shanxi',
  'inner-mongolia',
  'liaoning',
  'jilin',
  'heilongjiang',
  'shanghai',
  'jiangsu',
  'zhejiang',
  'anhui',
  'fujian',
  'jiangxi',
  'shandong',
  'henan',
  'hubei',
  'hunan',
  'guangdong',
  'guangxi',
  'hainan',
  'chongqing',
  'sichuan',
  'guizhou',
  'yunnan',
  'tibet',
  'shaanxi',
  'gansu',
  'qinghai',
  'ningxia',
  'xinjiang',
  'hong-kong',
  'macau',
  'taiwan'
] as const

export type RequiredProvincialRegionId = typeof requiredProvincialRegionIds[number]

const stateGridRuleSet: RegionRuleSet = {
  id: 'generic-sgcc-spot',
  label: '国网通用现货规则底座',
  marketScope: '国网经营区通用模板',
  spotRuleStatus: 'generic',
  dataNamespace: 'sgcc_common',
  settlementModel: '中长期合约 + 日前/实时偏差 + 分摊返还',
  tradingModes: ['中长期交易', '日前现货', '实时现货', '辅助服务', '零售套餐'],
  customizationNotes: ['按省级现货细则替换报价、出清、结算和披露参数', '保留国网经营区通用数据字段和业务流程']
}

const southernGridRuleSet: RegionRuleSet = {
  id: 'generic-csg-spot',
  label: '南网通用现货规则底座',
  marketScope: '南方区域/南网经营区通用模板',
  spotRuleStatus: 'generic',
  dataNamespace: 'csg_common',
  settlementModel: '区域联合出清 + 省内结算 + 跨省衔接',
  tradingModes: ['南方区域中长期', '省内中长期', '日前现货', '实时现货', '跨省结算'],
  customizationNotes: ['适配广东、广西、云南、贵州、海南差异化省内细则', '保留南方区域联合出清和两级协同运作语义']
}

function provinceRuleSet(id: string, name: string, grid: GridOperatorId, status: RegionRuleSet['spotRuleStatus'] = 'to-be-customized'): RegionRuleSet {
  const gridPrefix = grid === 'china-southern-grid' ? 'csg' : grid === 'state-grid' ? 'sgcc' : 'local'
  return {
    id: `${id}-spot-rules`,
    label: `${name}电力交易规则体系`,
    marketScope: `${name}省级/区域电力市场`,
    spotRuleStatus: status,
    dataNamespace: `${gridPrefix}_${id.replaceAll('-', '_')}`,
    settlementModel: status === 'trial' ? '按试运行方案配置结算科目' : '待按地区细则配置',
    tradingModes: ['中长期交易', '现货交易', '结算管理', '信息披露'],
    customizationNotes: ['后续按该地区正式规则补充报价方式、出清粒度、节点/统一结算价、偏差处理', '可接入地区专属数据源、交易日历和风险参数']
  }
}

export const genericRegionProfiles: RegionProfile[] = [
  {
    id: 'generic-sgcc',
    name: '国网通用版',
    shortName: '国网',
    kind: 'template',
    gridOperator: 'state-grid',
    gridLabel: '国家电网',
    regionGroup: '通用规则',
    provincialLevel: false,
    ruleSet: stateGridRuleSet
  },
  {
    id: 'generic-csg',
    name: '南网通用版',
    shortName: '南网',
    kind: 'template',
    gridOperator: 'china-southern-grid',
    gridLabel: '南方电网',
    regionGroup: '通用规则',
    provincialLevel: false,
    ruleSet: southernGridRuleSet
  }
]

export const provinceRegionProfiles: RegionProfile[] = [
  { id: 'beijing', name: '北京市', shortName: '北京', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华北', provincialLevel: true, ruleSet: provinceRuleSet('beijing', '北京', 'state-grid') },
  { id: 'tianjin', name: '天津市', shortName: '天津', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华北', provincialLevel: true, ruleSet: provinceRuleSet('tianjin', '天津', 'state-grid') },
  { id: 'hebei', name: '河北省', shortName: '河北', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华北', provincialLevel: true, ruleSet: provinceRuleSet('hebei', '河北', 'state-grid') },
  { id: 'shanxi', name: '山西省', shortName: '山西', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华北', provincialLevel: true, ruleSet: provinceRuleSet('shanxi', '山西', 'state-grid', 'trial') },
  { id: 'inner-mongolia', name: '内蒙古自治区', shortName: '内蒙古', kind: 'province', gridOperator: 'inner-mongolia-grid', gridLabel: '蒙西地方电网/国网蒙东', regionGroup: '华北/东北', provincialLevel: true, ruleSet: provinceRuleSet('inner-mongolia', '内蒙古', 'inner-mongolia-grid') },
  { id: 'liaoning', name: '辽宁省', shortName: '辽宁', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '东北', provincialLevel: true, ruleSet: provinceRuleSet('liaoning', '辽宁', 'state-grid') },
  { id: 'jilin', name: '吉林省', shortName: '吉林', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '东北', provincialLevel: true, ruleSet: provinceRuleSet('jilin', '吉林', 'state-grid') },
  { id: 'heilongjiang', name: '黑龙江省', shortName: '黑龙江', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '东北', provincialLevel: true, ruleSet: provinceRuleSet('heilongjiang', '黑龙江', 'state-grid') },
  { id: 'shanghai', name: '上海市', shortName: '上海', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华东', provincialLevel: true, ruleSet: provinceRuleSet('shanghai', '上海', 'state-grid') },
  { id: 'jiangsu', name: '江苏省', shortName: '江苏', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华东', provincialLevel: true, ruleSet: provinceRuleSet('jiangsu', '江苏', 'state-grid') },
  { id: 'zhejiang', name: '浙江省', shortName: '浙江', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华东', provincialLevel: true, ruleSet: provinceRuleSet('zhejiang', '浙江', 'state-grid') },
  { id: 'anhui', name: '安徽省', shortName: '安徽', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华东', provincialLevel: true, ruleSet: provinceRuleSet('anhui', '安徽', 'state-grid') },
  { id: 'fujian', name: '福建省', shortName: '福建', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华东', provincialLevel: true, ruleSet: provinceRuleSet('fujian', '福建', 'state-grid') },
  { id: 'jiangxi', name: '江西省', shortName: '江西', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华中', provincialLevel: true, ruleSet: provinceRuleSet('jiangxi', '江西', 'state-grid') },
  { id: 'shandong', name: '山东省', shortName: '山东', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华北', provincialLevel: true, ruleSet: provinceRuleSet('shandong', '山东', 'state-grid', 'active') },
  { id: 'henan', name: '河南省', shortName: '河南', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华中', provincialLevel: true, ruleSet: provinceRuleSet('henan', '河南', 'state-grid') },
  { id: 'hubei', name: '湖北省', shortName: '湖北', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华中', provincialLevel: true, ruleSet: provinceRuleSet('hubei', '湖北', 'state-grid') },
  { id: 'hunan', name: '湖南省', shortName: '湖南', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '华中', provincialLevel: true, ruleSet: provinceRuleSet('hunan', '湖南', 'state-grid') },
  { id: 'guangdong', name: '广东省', shortName: '广东', kind: 'province', gridOperator: 'china-southern-grid', gridLabel: '南方电网', regionGroup: '南方区域', provincialLevel: true, ruleSet: provinceRuleSet('guangdong', '广东', 'china-southern-grid', 'active') },
  { id: 'guangxi', name: '广西壮族自治区', shortName: '广西', kind: 'province', gridOperator: 'china-southern-grid', gridLabel: '南方电网', regionGroup: '南方区域', provincialLevel: true, ruleSet: provinceRuleSet('guangxi', '广西', 'china-southern-grid') },
  { id: 'hainan', name: '海南省', shortName: '海南', kind: 'province', gridOperator: 'china-southern-grid', gridLabel: '南方电网', regionGroup: '南方区域', provincialLevel: true, ruleSet: provinceRuleSet('hainan', '海南', 'china-southern-grid') },
  { id: 'chongqing', name: '重庆市', shortName: '重庆', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西南', provincialLevel: true, ruleSet: provinceRuleSet('chongqing', '重庆', 'state-grid') },
  { id: 'sichuan', name: '四川省', shortName: '四川', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西南', provincialLevel: true, ruleSet: provinceRuleSet('sichuan', '四川', 'state-grid', 'trial') },
  { id: 'guizhou', name: '贵州省', shortName: '贵州', kind: 'province', gridOperator: 'china-southern-grid', gridLabel: '南方电网', regionGroup: '南方区域', provincialLevel: true, ruleSet: provinceRuleSet('guizhou', '贵州', 'china-southern-grid') },
  { id: 'yunnan', name: '云南省', shortName: '云南', kind: 'province', gridOperator: 'china-southern-grid', gridLabel: '南方电网', regionGroup: '南方区域', provincialLevel: true, ruleSet: { ...provinceRuleSet('yunnan', '云南', 'china-southern-grid', 'trial'), settlementModel: '南方区域联合出清 + 云南省内结算 + 中长期/现货偏差结算', customizationNotes: ['云南现货按跨省与省内联合出清、两级协同运作建模', '后续接入云南现货电能量、结算、信息披露和中长期衔接细则'] } },
  { id: 'tibet', name: '西藏自治区', shortName: '西藏', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西南', provincialLevel: true, ruleSet: provinceRuleSet('tibet', '西藏', 'state-grid') },
  { id: 'shaanxi', name: '陕西省', shortName: '陕西', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西北', provincialLevel: true, ruleSet: provinceRuleSet('shaanxi', '陕西', 'state-grid') },
  { id: 'gansu', name: '甘肃省', shortName: '甘肃', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西北', provincialLevel: true, ruleSet: provinceRuleSet('gansu', '甘肃', 'state-grid', 'active') },
  { id: 'qinghai', name: '青海省', shortName: '青海', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西北', provincialLevel: true, ruleSet: provinceRuleSet('qinghai', '青海', 'state-grid') },
  { id: 'ningxia', name: '宁夏回族自治区', shortName: '宁夏', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西北', provincialLevel: true, ruleSet: provinceRuleSet('ningxia', '宁夏', 'state-grid') },
  { id: 'xinjiang', name: '新疆维吾尔自治区', shortName: '新疆', kind: 'province', gridOperator: 'state-grid', gridLabel: '国家电网', regionGroup: '西北', provincialLevel: true, ruleSet: provinceRuleSet('xinjiang', '新疆', 'state-grid', 'trial') },
  { id: 'hong-kong', name: '香港特别行政区', shortName: '香港', kind: 'province', gridOperator: 'special-region', gridLabel: '特别行政区电力体系', regionGroup: '港澳台', provincialLevel: true, ruleSet: provinceRuleSet('hong-kong', '香港', 'special-region') },
  { id: 'macau', name: '澳门特别行政区', shortName: '澳门', kind: 'province', gridOperator: 'special-region', gridLabel: '特别行政区电力体系', regionGroup: '港澳台', provincialLevel: true, ruleSet: provinceRuleSet('macau', '澳门', 'special-region') },
  { id: 'taiwan', name: '台湾省', shortName: '台湾', kind: 'province', gridOperator: 'taiwan-grid', gridLabel: '台湾电力体系', regionGroup: '港澳台', provincialLevel: true, ruleSet: provinceRuleSet('taiwan', '台湾', 'taiwan-grid') }
]

export const regionProfiles: RegionProfile[] = [...genericRegionProfiles, ...provinceRegionProfiles]

export const defaultRegionId = 'yunnan'

export function getRegionCoverageSummary() {
  const activeCount = provinceRegionProfiles.filter((region) => region.ruleSet.spotRuleStatus === 'active').length
  const trialCount = provinceRegionProfiles.filter((region) => region.ruleSet.spotRuleStatus === 'trial').length
  const draftCount = provinceRegionProfiles.filter((region) => region.ruleSet.spotRuleStatus === 'draft').length
  const pendingCount = provinceRegionProfiles.filter((region) => region.ruleSet.spotRuleStatus === 'to-be-customized').length

  return {
    requiredCount: requiredProvincialRegionIds.length,
    provinceCount: provinceRegionProfiles.length,
    coveredRequiredCount: requiredProvincialRegionIds.filter((id) => provinceRegionProfiles.some((region) => region.id === id)).length,
    activeCount,
    trialCount,
    draftCount,
    pendingCount,
    customizedCount: activeCount + trialCount + draftCount,
    southernGridCount: provinceRegionProfiles.filter((region) => region.gridOperator === 'china-southern-grid').length,
    stateGridCount: provinceRegionProfiles.filter((region) => region.gridOperator === 'state-grid').length,
    templateCount: genericRegionProfiles.length
  }
}

export function getRegionById(id: string): RegionProfile {
  return regionProfiles.find((region) => region.id === id) ?? regionProfiles.find((region) => region.id === defaultRegionId) ?? regionProfiles[0]
}

export function getRegionsByOperator(operator: GridOperatorId): RegionProfile[] {
  return regionProfiles.filter((region) => region.gridOperator === operator)
}

export function getRegionStatusLabel(status: RegionRuleSet['spotRuleStatus']) {
  const labels: Record<RegionRuleSet['spotRuleStatus'], string> = {
    generic: '通用模板',
    draft: '草案',
    trial: '试运行',
    active: '运行中',
    'to-be-customized': '待定制'
  }
  return labels[status]
}

// ── 地区数据真实度分级（真实 / 演示开通 / 未开通）──────────────────────────────
// 三态模型（前端 UI 驱动，与后端数据策略解耦）：
//   ①「真实数据地区」REAL_DATA_REGION_IDS：已接入专属真实采集/导出数据。
//      当前：云南（capture-raw/yunnan/ 真实现货采集）+ 山西（capture-raw 扁平目录即山西现货采集）。
//   ②「演示开通地区」OPENED_DEMO_REGION_IDS：无专属真实市场数据采集，但已配置演示公司、
//      在切换面板可切换进入；切进去后市场数据按严格地区策略为空（不回退山西），图表走空态，
//      由 RegionDataBanner 标注「演示地区」。当前：四川（comp-sichuan-a 演示公司 + 披露接入在建）。
//   ③ 其余省份：未开通，切换面板禁用灰显，待接入数据或开通后加入上述集合即自动可切。
//
// 职责（与后端解耦）：本集合驱动**前端 UI**——切换器可切范围 + 真实/演示/禁用标注 + 横幅。
// 后端 `shared/region/constants.mjs::isRegionStrictRealData` 独立管「真实或空、不回退」的
// 数据策略（所有非基线地区都不回退山西）。两者不再简单镜像：前端管「可切换」，后端管「不回退」，
// 各司其职共同达成严格地区隔离。
export const REAL_DATA_REGION_IDS = new Set<string>(['yunnan', 'shanxi'])

// 已开通可切换、但仅有演示数据（无专属真实市场数据采集）的地区。
// 与 REAL_DATA_REGION_IDS 区分：这里可切换、标「演示」（非「真实」），切进去有演示公司、
// 市场数据为空时图表走空态。严格地区策略同样适用（不回退山西），只是 UI 允许进入。
export const OPENED_DEMO_REGION_IDS = new Set<string>(['sichuan'])

export type RegionDataMaturity = 'real' | 'demo-opened' | 'demo-disabled'

// 判断某地区是否为「真实数据地区」（有专属真实数据接入）。
export function isRealDataRegion(regionId: string): boolean {
  return REAL_DATA_REGION_IDS.has(regionId)
}

// 判断某地区是否为「演示开通地区」（已开通可切、仅有演示数据、无真实市场采集）。
export function isOpenedDemoRegion(regionId: string): boolean {
  return OPENED_DEMO_REGION_IDS.has(regionId)
}

// 判断某地区是否为「已开通可进入」地区：真实 ∪ 演示开通。用于切换器可点判定与地区守卫。
export function isOpenRegion(regionId: string): boolean {
  return isRealDataRegion(regionId) || isOpenedDemoRegion(regionId)
}

// 判断某地区在切换面板里是否**可切换**：已开通地区（真实 ∪ 演示开通）∪ 通用版模板
// （跨地区入口，不绑定具体省份数据，始终可选）。未开通省份禁用不可切（灰显），避免用户切到
// 只会看到空/合成的地区。前端守卫（RegionSwitcher/regionContext）统一走本谓词。
export function isSelectableRegion(regionId: string): boolean {
  return isOpenRegion(regionId) || genericRegionProfiles.some((region) => region.id === regionId)
}

// 返回地区数据成熟度三态：
//  'real'=真实数据地区；'demo-opened'=演示开通地区（可切、仅有演示数据）；
//  'demo-disabled'=未开通（禁用灰显）。
export function getRegionDataMaturity(regionId: string): RegionDataMaturity {
  if (isRealDataRegion(regionId)) return 'real'
  if (isOpenedDemoRegion(regionId)) return 'demo-opened'
  return 'demo-disabled'
}

// —— 账号属地 → 前端地区（Sub-4 #520：登录默认地区随账号归属） ——
// 只登记已开通可切换的属地（真实 ∪ 演示开通）；GROUP（集团账号）与未登记属地不联动
// （保持用户偏好/默认）。areaCode 口径与 auth-store 用户表一致（YN/SX/SC/GROUP…）。
const AREA_CODE_REGION_IDS: Record<string, string> = {
  YN: 'yunnan',
  SX: 'shanxi',
  SC: 'sichuan'
}

// 账号属地映射为可切换的前端地区 id；无映射（GROUP/未登记/非法）返回 null 表示不联动。
export function regionIdForAreaCode(areaCode: string | null | undefined): string | null {
  if (!areaCode) return null
  const regionId = AREA_CODE_REGION_IDS[String(areaCode).trim().toUpperCase()]
  return regionId && isSelectableRegion(regionId) ? regionId : null
}
