import { GRID_GEO_FEATURE_ENABLED } from '@/features/gridGeo/config'
import {
  getRegionModuleAccessRoutes,
  getRegionModuleRoutePrefixes,
  isRegionRouteAvailable
} from '@/services/region/regionModules'

export type RoleCode =
  | 'BOSS'
  | 'TRADE_LEAD'
  | 'TRADER'
  | 'RISK'
  | 'QUANT'
  | 'SETTLEMENT'
  | 'PLANT_OPERATOR'
  | 'RETAIL_MANAGER'
  | 'STORAGE_OPERATOR'
  | 'ADMIN'

export type SubjectType = 'GROUP' | 'GENERATOR' | 'RETAILER' | 'STORAGE' | 'LOAD' | 'TRADER'

/**
 * 作业立场（#2193）：一次会话里「以哪个市场主体身份作业」的完整主体身份三元组。
 * 允许集合只由服务端推导下发（登录/刷新 payload 的 user.stances，规则=
 * 公司注册立场 ∩ 身份，见 server/auth-store.mjs::deriveUserStances）；前端零推导，
 * 只表达切换意图（x-stance-id 头），越权头服务端 403。
 * · home（crossView=false）= 账号自身主体，永远存在；单立场账号只有这一项。
 * · crossView（crossView=true）= TRADER/GROUP 主立场按公司注册立场换类型作业，
 *   subjectId 沿用账号自身主体。
 * 与 allowedSubjectTypes（数据可见范围）正交：扩大那个是扩大越权面，扩大不了这个。
 */
export type Stance = {
  subjectType: SubjectType
  subjectId: string
  subjectName: string
  crossView: boolean
}

export function isStanceShape(value: unknown): value is Stance {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return typeof s.subjectType === 'string' && typeof s.subjectId === 'string'
    && typeof s.subjectName === 'string' && typeof s.crossView === 'boolean'
}

export type DataScope = {
  tenantId: string
  areaCode: string
  areaName: string
  subjectId: string
  subjectName: string
  subjectType: SubjectType
  ownerOrgId: string
  visibility: 'PRIVATE' | 'ORG' | 'AREA' | 'GROUP'
}

export type GovernanceUser = {
  username: string
  displayName: string
  role: string
  roleCode: RoleCode
  roleGroup: '决策层' | '交易层' | '风控层' | '分析层' | '运营层' | '管理层'
  area: string
  areaCode: string
  /** 公司（租户）维度：companyId === dataScopes[0].tenantId。公司专属数据按此隔离。 */
  companyId: string
  companyName?: string
  companyTier?: 'GROUP' | 'COMPANY'
  subjectId: string
  subjectName: string
  subjectType: SubjectType
  permissions: string[]
  allowedAreas: string[]
  allowedSubjectTypes: SubjectType[]
  dataScopes: DataScope[]
  decisionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6
  perspective: string
  /** 立场允许集合（#2193）：服务端推导下发；缺失（旧会话/降级）按单立场 home 处理。 */
  stances?: Stance[]
}

export type DecisionGateHint = {
  level: string
  label: string
  reviewer: string
  note: string
}

export type NavigationLike = {
  path: string
  title: string
  icon: object
  regionIds?: string[]
  children?: NavigationLike[]
  demo?: boolean
  /** 立场亲和（#2193 · #2196）：缺省=共享；语义见 services/stance/stanceNavigation.ts。 */
  stanceAffinity?: SubjectType[]
}

export type AccessRule = {
  defaultRoute: string
  groups?: string[]
  routes?: string[]
  actions: string[]
  gate: DecisionGateHint
}

export type RoleAccessOverride = Partial<Pick<AccessRule, 'defaultRoute' | 'groups' | 'routes' | 'actions'>>

const enabledRegionGroups = getRegionModuleRoutePrefixes()
// "地区交易"已并入现货交易：原 /regional-trading 块授权迁为对合并入口页的细粒度授权
// （作为 group 前缀按 === / startsWith 匹配，恰好授权这些页，不会过度授予整个 /xhjy 块）。
// /xhjy/calibration 为地区决策标定页（原 RegionDecisionDeskView 重新挂载），与 desk 同口径授权。
const regionalTradingGroups = ['/xhjy/region', '/xhjy/desk', '/xhjy/calibration']
// 报表中心：全主体通用入口，所有业务角色可见；具体报表数据按 DataScope/subjectType 在数据层隔离。
const reportsGroups = ['/report']
// 电厂空间资产是 grid 只读域；仅给后端同样具备 grid 域的角色开放，售电/结算角色不进入。
const gridGeoGroups = GRID_GEO_FEATURE_ENABLED ? ['/grid-assets'] : []

export const allGroups = [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/system', ...enabledRegionGroups, '/gsgl', '/ai-agent', '/strategic-qa', '/declaration-checkup', '/zcqjy', '/xhjy', '/sjfx', '/insight', '/ycsj', '/sjxh', '/tzcs', '/djcs', '/yygl', '/data-ops', '/sdzl']
export const adminLevelRoleCodes: RoleCode[] = ['BOSS', 'ADMIN']
// /system/ai-studio 与 /system/accounts 是五页/两页 tab 合并后的新入口，权限口径统一收紧为 ADMIN-only：
// - 原 /ai-skills、/ai-sub-agents、/system/schedules、/system/users 本就在本清单，口径不变；
// - 原 /system/sessions 与 /xhjy/{dify-studio,langgraph-studio} 未列入、非管理员经 /system 与 /xhjy
// 组可见，合并后随宿主页收紧。方向是收紧不是放开，无越权风险。
// 旧路径已改为 redirect（不再是页面），故从本清单移除，重定向目标会再过一次本判定。
// /data-ops/upload（#2169 P1 数据上传中心）：数据管理员操作面，收 ADMIN-only
// 交易/分析角色不承载数据管理（与 /yygl/ingest、/data-source-settings 同口径）；
// P2 data-service 独立运维台落地后再按数据运维岗另设角色。
// #2169 P2-2a：三个数据管理页（导入融合台/接入向导/治理控制台）同口径收紧
// 「用户前端不再管理数据」：TRADE_LEAD/SETTLEMENT 等业务角色的界面不再出现数据管理入口；
// 结算专员的导入动线在 P2-2b 数据运维台独立前端恢复。
export const adminOnlyRoutes = ['/system/ai-studio', '/system/accounts', '/data-ops/console']

const regionalRoutesForRole = (roleCode: RoleCode) => getRegionModuleAccessRoutes(roleCode)
const adminActions = ['system.admin', 'menu.admin', 'role.admin', 'dataScope.admin', 'dashboard.view', 'trade.view', 'approval.final', 'risk.limit.view', 'settlement.view']
const ACCESS_OVERRIDE_KEY = 'dljy_governance_access_overrides'

export const roleLabels: Record<RoleCode, string> = {
  BOSS: '老板',
  TRADE_LEAD: '交易负责人',
  TRADER: '交易员',
  RISK: '风控负责人',
  QUANT: '量化分析师',
  SETTLEMENT: '结算专员',
  PLANT_OPERATOR: '电厂运营',
  RETAIL_MANAGER: '售电经理',
  STORAGE_OPERATOR: '储能运营',
  ADMIN: '系统管理员'
}

export const subjectTypeLabels: Record<SubjectType, string> = {
  GROUP: '集团',
  GENERATOR: '电厂',
  RETAILER: '售电公司',
  STORAGE: '独立储能',
  LOAD: '负荷主体',
  TRADER: '交易组合'
}

export const demoProfiles: GovernanceUser[] = [
  makeUser({
    username: 'boss',
    displayName: '老板',
    roleCode: 'BOSS',
    roleGroup: '决策层',
    areaName: '全局',
    areaCode: 'GROUP',
    subjectName: '能源集团',
    subjectType: 'GROUP',
    decisionLevel: 5,
    perspective: '经营总览、重大审批、区域与主体收益排行'
  }),
  makeUser({
    username: 'lead',
    displayName: '交易负责人',
    roleCode: 'TRADE_LEAD',
    roleGroup: '交易层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    subjectName: '交易管理组',
    subjectType: 'TRADER',
    decisionLevel: 4,
    perspective: '交易计划、策略审批、执行进度和风险限额'
  }),
  makeUser({
    username: 'trader',
    displayName: '交易员',
    roleCode: 'TRADER',
    roleGroup: '交易层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    subjectName: '现货交易组合',
    subjectType: 'TRADER',
    decisionLevel: 3,
    perspective: '日前申报、OODA建议、交易策略和执行回填'
  }),
  makeUser({
    username: 'risk',
    displayName: '风控负责人',
    roleCode: 'RISK',
    roleGroup: '风控层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    subjectName: '风险中台',
    subjectType: 'GROUP',
    decisionLevel: 4,
    perspective: 'CVaR、仓位敞口、超限拦截和审批复核'
  }),
  makeUser({
    username: 'quant',
    displayName: '量化分析师',
    roleCode: 'QUANT',
    roleGroup: '分析层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    subjectName: '量化策略组',
    subjectType: 'TRADER',
    decisionLevel: 2,
    perspective: '预测模型、因子、策略草稿和回测评估'
  }),
  makeUser({
    username: 'settlement',
    displayName: '结算专员',
    roleCode: 'SETTLEMENT',
    roleGroup: '运营层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    subjectName: '结算运营组',
    subjectType: 'GROUP',
    decisionLevel: 2,
    perspective: '结算导入、偏差考核、对账和月度复盘'
  }),
  makeUser({
    username: 'plant',
    displayName: '电厂运营',
    roleCode: 'PLANT_OPERATOR',
    roleGroup: '运营层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    companyId: 'comp-shanxi',
    companyName: '山西发电有限公司',
    subjectName: '发电运营主体',
    subjectType: 'GENERATOR',
    decisionLevel: 3,
    perspective: '机组出力、发电侧报价、现货收益和合同敞口'
  }),
  makeUser({
    // 云南地区订正（Issue #569）：云南仅中广核云南一家主体，原冗余 comp-yunnan（云南售电）已合并，
    // retail 改隶属 comp-cgn-yunnan（中广核云南新能源内部的售电经理视角，锁定 YN 地区）。
    username: 'retail',
    displayName: '售电经理',
    roleCode: 'RETAIL_MANAGER',
    roleGroup: '运营层',
    areaName: '云南',
    areaCode: 'YN',
    companyId: 'comp-cgn-yunnan',
    companyName: '中广核云南新能源有限公司',
    subjectName: '售电公司',
    subjectType: 'RETAILER',
    decisionLevel: 3,
    perspective: '客户负荷、购售电价差、套餐利润和零售结算'
  }),
  makeUser({
    username: 'storage',
    displayName: '储能运营',
    roleCode: 'STORAGE_OPERATOR',
    roleGroup: '交易层',
    areaName: '当前地区',
    areaCode: 'CURRENT',
    companyId: 'comp-shanxi',
    companyName: '山西发电有限公司',
    subjectName: '储能运营组合',
    subjectType: 'STORAGE',
    decisionLevel: 3,
    perspective: '价差套利、SOC、执行切片和储能收益'
  }),
  makeUser({
    username: 'demo',
    displayName: '演示管理员',
    roleCode: 'ADMIN',
    roleGroup: '管理层',
    areaName: '集团',
    areaCode: 'GROUP',
    subjectName: '演示系统管理',
    subjectType: 'GROUP',
    decisionLevel: 6,
    perspective: '演示环境管理员账号，可维护用户、角色、数据域、菜单和权限矩阵'
  }),
  makeUser({
    username: 'admin',
    displayName: '系统管理员',
    roleCode: 'ADMIN',
    roleGroup: '管理层',
    areaName: '集团',
    areaCode: 'GROUP',
    subjectName: '系统管理',
    subjectType: 'GROUP',
    decisionLevel: 6,
    perspective: '用户、角色、数据域、菜单和系统配置'
  })
]

export const accessRules: Record<RoleCode, AccessRule> = {
  BOSS: {
    defaultRoute: '/dashboard',
    groups: allGroups,
    actions: adminActions,
    gate: { level: 'L6', label: '老板全局权限', reviewer: '老板最终确认', note: '可查看全部模块并进行重大经营审批，同时具备管理员层级配置入口。' }
  },
  TRADE_LEAD: {
    // 原 defaultRoute 为 /xhjy/trading-lab，该页随 #1799 删除，改落现货交易驾驶舱。
    defaultRoute: '/dashboard',
    routes: [
      ...regionalRoutesForRole('TRADE_LEAD')
    ],
    groups: [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/ai-agent', '/strategic-qa', '/declaration-checkup', '/zcqjy', '/xhjy', '/sjfx', '/insight', '/ycsj', '/sjxh', '/yygl', '/sdzl'],
    actions: ['trade.plan', 'trade.submit', 'trade.approve', 'risk.view', 'settlement.view'],
    gate: { level: 'L4', label: '交易负责人审批', reviewer: '交易负责人', note: '可审批限额内策略，超限交易进入风控或老板审批。' }
  },
  TRADER: {
    defaultRoute: '/xhjy/zptqx',
    routes: [
      '/dashboard',
      '/ai-agent',
      ...regionalRoutesForRole('TRADER'),
      '/xhjy/trading-day',
      '/zcqjy/zccljk',
      '/zcqjy/zfsdjy',
      '/zcqjy/zjyap',
      '/zcqjy/exposure',
      '/xhjy/zrqsb',
      '/xhjy/zptqx',
      '/xhjy/monitor',
      '/xhjy/review',
      '/sjfx/fshq',
      '/sjfx/zrsjg',
      '/sjfx/zcqxhdl',
      '/sjfx/market-ops',
      '/ycsj/center', '/ycsj/hub',
      '/ycsj/decision-cockpit',
      '/ycsj/scoreboard',
      '/ycsj/pricePrediction',
      '/ycsj/jgyc',
      '/ycsj/jjkj',
      '/sjxh/zjzzt',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['trade.draft', 'trade.submit.withinLimit', 'strategy.run', 'execution.feedback'],
    gate: { level: 'L3', label: '限额内提交', reviewer: '交易负责人', note: '可生成申报草稿和限额内提交，超限自动进入审批。' }
  },
  RISK: {
    // 原 defaultRoute 为 /xhjy/trading-lab，该页随 #1799 删除，改落现货交易驾驶舱。
    defaultRoute: '/dashboard',
    routes: [
      '/dashboard',
      ...regionalRoutesForRole('RISK'),
      '/xhjy/trading-day',
      '/xhjy/approvals',
      '/sjfx/singleZsjfx',
      '/sjfx/zcqxhdl',
      '/sjfx/zrxgx',
      '/sjfx/zrxgx2',
      '/sjfx/market-ops',
      '/sjfx/fshq',
      '/sjfx/zrsjg',
      '/ycsj/center', '/ycsj/hub',
      '/ycsj/workbench',
      '/ycsj/decision-cockpit',
      '/ycsj/scoreboard',
      '/ycsj/lab',
      '/yygl/ops',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['risk.review', 'risk.block', 'risk.limit.edit', 'trade.view'],
    gate: { level: 'L4', label: '风控硬拦截', reviewer: '风控负责人', note: '可拦截超限交易和调整风险阈值，不直接发起交易。' }
  },
  QUANT: {
    defaultRoute: '/ycsj/lab',
    routes: [
      '/dashboard',
      ...regionalRoutesForRole('QUANT'),
      '/sjfx/singleZsjfx',
      '/sjfx/zcqxhdl',
      '/sjfx/zrxgx',
      '/sjfx/zrxgx2',
      '/sjfx/market-ops',
      '/sjfx/fshq',
      '/sjfx/actualLoad',
      '/sjfx/zrsjg',
      '/sjfx/jieqi',
      '/sjfx/elninolanina',
      '/sjfx/tqyb',
      '/ycsj/center', '/ycsj/hub',
      '/ycsj/workbench',
      '/ycsj/decision-cockpit',
      '/ycsj/scoreboard',
      '/ycsj/lab',
      '/ycsj/pricePrediction',
      '/ycsj/jgyc',
      '/ycsj/gsfhyc',
      '/ycsj/gscwfh',
      '/ycsj/zxztqa',
      '/ycsj/zgnrx',
      '/ycsj/zgnrxqxyc',
      '/ycsj/jjkj',
      '/ycsj/rqhdcl',
      '/ycsj/station-generation',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['model.train', 'strategy.draft', 'analysis.run', 'trade.view'],
    gate: { level: 'L2', label: '策略草稿', reviewer: '交易员确认', note: '可生成策略建议和模型方案，不直接提交申报。' }
  },
  SETTLEMENT: {
    defaultRoute: '/yygl/import-hub',
    routes: [
      '/dashboard',
      ...regionalRoutesForRole('SETTLEMENT'),
      '/xhjy/trading-day',
      '/zcqjy/zccljk',
      '/xhjy/zrqsb',
      '/sjfx/market-ops',
      '/djcs/retail-price',
      '/djcs/interprovincial-price',
      '/yygl/ops',
      '/yygl/import-hub',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['settlement.import', 'settlement.calculate', 'settlement.reconcile', 'trade.view'],
    gate: { level: 'L2', label: '结算复核', reviewer: '结算专员', note: '可导入和复核结算，不修改交易策略与执行记录。' }
  },
  PLANT_OPERATOR: {
    defaultRoute: '/sjfx/market-ops',
    routes: [
      '/dashboard',
      // 父 Issue #456：展开云南区域模块授权（[yunnanRoleHomeRoute, plant-output]），
      // 让电厂角色能进云南工作台看电厂出力 tab（PR 评论：regionModules 加授权不够，
      // canAccessPath 读 accessRules.routes，须在此展开才能生效）。
      ...regionalRoutesForRole('PLANT_OPERATOR'),
      '/xhjy/trading-day',
      '/zcqjy/zccljk',
      '/zcqjy/zfsdjy',
      '/zcqjy/zjyap',
      '/xhjy/zrqsb',
      '/sjfx/zcqxhdl',
      '/sjfx/zrxgx',
      '/sjfx/zrxgx2',
      '/sjfx/market-ops',
      '/sjfx/fshq',
      '/sjfx/zrsjg',
      '/sjfx/tqyb',
      '/ycsj/center', '/ycsj/hub',
      '/ycsj/decision-cockpit',
      '/ycsj/scoreboard',
      '/ycsj/zxztqa',
      '/ycsj/zgnrx',
      '/ycsj/zgnrxqxyc',
      '/ycsj/rqhdcl',
      '/ycsj/station-generation',
      '/sjxh/zjzzt',
      '/tzcs/wind-solar',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['generation.view', 'trade.draft', 'strategy.run', 'settlement.view'],
    gate: { level: 'L3', label: '发电侧交易确认', reviewer: '交易负责人', note: '聚焦发电侧报价、出力和结算，不展示售电客户明细。' }
  },
  RETAIL_MANAGER: {
    defaultRoute: '/djcs/retail-price',
    routes: [
      '/dashboard',
      ...regionalRoutesForRole('RETAIL_MANAGER'),
      '/xhjy/trading-day',
      '/zcqjy/zccljk',
      '/zcqjy/zfsdjy',
      '/zcqjy/zjyap',
      '/xhjy/zptqx',
      '/sjfx/zrxgx2',
      '/sjfx/market-ops',
      '/sjfx/fshq',
      '/sjfx/zrsjg',
      '/ycsj/center', '/ycsj/hub',
      '/ycsj/decision-cockpit',
      '/ycsj/scoreboard',
      '/ycsj/pricePrediction',
      '/ycsj/jgyc',
      '/ycsj/gsfhyc',
      '/ycsj/gscwfh',
      '/ycsj/jjkj',
      '/djcs/retail-price',
      '/djcs/interprovincial-price',
      '/yygl/ops',
      '/yygl/import-hub',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['retail.price.calculate', 'trade.draft', 'settlement.import', 'customer.view'],
    gate: { level: 'L3', label: '售电侧采购确认', reviewer: '交易负责人', note: '聚焦客户负荷、购售价差和套餐收益，不展示电厂机组底层策略。' }
  },
  STORAGE_OPERATOR: {
    // 原 defaultRoute 为 /xhjy/trading-lab，该页随 #1799 删除，改落现货交易驾驶舱。
    defaultRoute: '/dashboard',
    routes: [
      '/dashboard',
      // 父 Issue #456：同 PLANT_OPERATOR，展开云南区域模块授权以进工作台看出力 tab。
      ...regionalRoutesForRole('STORAGE_OPERATOR'),
      '/xhjy/trading-day',
      '/sjfx/market-ops',
      '/sjfx/fshq',
      '/sjfx/zrsjg',
      '/tzcs/storage',
      '/yygl/ops',
      '/sdzl/region-rules',
      '/sdzl/zptwd'
    ],
    groups: [...gridGeoGroups, ...regionalTradingGroups, ...reportsGroups, '/insight'],
    actions: ['storage.arbitrage', 'strategy.run', 'trade.draft', 'risk.view'],
    gate: { level: 'L3', label: '储能执行确认', reviewer: '交易负责人', note: '聚焦价差套利、SOC、执行切片和循环收益。' }
  },
  ADMIN: {
    defaultRoute: '/dashboard',
    groups: allGroups,
    actions: adminActions,
    gate: { level: 'L6', label: '系统管理', reviewer: '系统管理员', note: '管理账号、角色、数据域和菜单，不参与业务审批。' }
  }
}

export function isAdminLevelRole(roleCode: RoleCode | null | undefined) {
  return Boolean(roleCode && adminLevelRoleCodes.includes(roleCode))
}

// 公司专属数据写权限：平台管理员(ADMIN)或老板(BOSS)可写，其余运营/分析角色只读。
// 仅用于前端按钮显隐；后端 /api/company/* 的写闸门（含集团汇总只读态）才是最终权威。
export function hasCompanyAdmin(user: Pick<GovernanceUser, 'roleCode'> | null | undefined): boolean {
  return isAdminLevelRole(user?.roleCode)
}

export function getAccessOverrides(): Partial<Record<RoleCode, RoleAccessOverride>> {
  if (typeof localStorage === 'undefined') return {}
  const raw = localStorage.getItem(ACCESS_OVERRIDE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Partial<Record<RoleCode, RoleAccessOverride>>
  } catch {
    return {}
  }
}

// 预测中心收敛前的角色覆写可能只保存了任一旧页面。补入口只保证可进入中心，
// tab 仍严格依赖原路由授权，因而不会扩大数据或操作权限。
const FORECAST_CENTER_PATH = '/ycsj/center'
const FORECAST_CENTER_SOURCES = ['/ycsj/hub', '/ycsj/workbench', '/ycsj/decision-cockpit', '/ycsj/station-generation', '/ycsj/scoreboard']
function normalizeOverrideRoutes(routes: string[] | undefined): string[] | undefined {
  if (!routes || routes.includes(FORECAST_CENTER_PATH)) return routes
  return FORECAST_CENTER_SOURCES.some((path) => routes.includes(path))
    ? [...routes, FORECAST_CENTER_PATH]
    : routes
}

export function getEffectiveAccessRule(roleCode: RoleCode): AccessRule {
  const base = accessRules[roleCode]
  if (isAdminLevelRole(roleCode)) return base
  const override = getAccessOverrides()[roleCode]
  if (!override) return base
  return {
    ...base,
    defaultRoute: override.defaultRoute ?? base.defaultRoute,
    groups: override.groups ?? base.groups,
    routes: normalizeOverrideRoutes(override.routes) ?? base.routes,
    actions: override.actions ?? base.actions
  }
}

export function getEffectiveAccessRules(): Record<RoleCode, AccessRule> {
  return (Object.keys(roleLabels) as RoleCode[]).reduce((rules, roleCode) => {
    rules[roleCode] = getEffectiveAccessRule(roleCode)
    return rules
  }, {} as Record<RoleCode, AccessRule>)
}

export function saveRoleAccessOverride(roleCode: RoleCode, override: RoleAccessOverride) {
  if (isAdminLevelRole(roleCode)) return
  if (typeof localStorage === 'undefined') return
  const overrides = getAccessOverrides()
  overrides[roleCode] = override
  localStorage.setItem(ACCESS_OVERRIDE_KEY, JSON.stringify(overrides))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('governance-access-changed', { detail: { roleCode, override } }))
  }
}

export function replaceAccessOverrides(overrides: Partial<Record<RoleCode, RoleAccessOverride>>) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(ACCESS_OVERRIDE_KEY, JSON.stringify(overrides ?? {}))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('governance-access-changed', { detail: { roleCode: 'ALL' } }))
  }
}

export function resetRoleAccessOverride(roleCode?: RoleCode) {
  if (typeof localStorage === 'undefined') return
  const overrides = getAccessOverrides()
  if (roleCode) {
    delete overrides[roleCode]
  } else {
    for (const code of Object.keys(overrides)) {
      delete overrides[code as RoleCode]
    }
  }
  localStorage.setItem(ACCESS_OVERRIDE_KEY, JSON.stringify(overrides))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('governance-access-changed', { detail: { roleCode: roleCode ?? 'ALL' } }))
  }
}

export function getDefaultGovernanceUser() {
  // demo / 未指定角色 → 默认全权限（admin），保证演示账号能看到并访问全部页面；
  // 顶栏切换到 boss/trader 等具体角色时仍各自受限，用于演示权限差异。
  return withRulePermissions(demoProfiles.find((profile) => profile.username === 'admin')!)
}

export function resolveGovernanceUser(username?: string, base?: Partial<GovernanceUser>): GovernanceUser {
  const normalized = String(username || base?.username || 'trader').trim().toLowerCase()
  const profile = demoProfiles.find((item) => item.username === normalized)
    ?? demoProfiles.find((item) => item.roleCode === base?.roleCode)
    ?? getDefaultGovernanceUser()
  const roleCode = (base?.roleCode ?? profile.roleCode) as RoleCode
  const rulePermissions = getEffectiveAccessRule(roleCode)?.actions ?? profile.permissions

  return {
    ...profile,
    ...base,
    username: base?.username ?? profile.username,
    displayName: base?.displayName ?? profile.displayName,
    role: base?.role ?? roleLabels[roleCode],
    roleCode,
    // 显式带出公司字段：后端登录回传的 companyId 在 base 里，优先用之，回退本地 profile，防 TS 收窄丢字段。
    companyId: base?.companyId ?? profile.companyId,
    companyName: base?.companyName ?? profile.companyName,
    companyTier: base?.companyTier ?? profile.companyTier,
    permissions: base?.permissions?.length ? [...base.permissions] : [...rulePermissions]
  }
}

export function canAccessPath(path: string, user: Pick<GovernanceUser, 'roleCode'> | null | undefined) {
  if (!path || path === '/login') return true
  const normalized = normalizePath(path)
  const roleCode = user?.roleCode ?? getDefaultGovernanceUser().roleCode
  if (isAdminLevelRole(roleCode)) return true
  if (adminOnlyRoutes.includes(normalized)) return false
  // 原此处放行 /system/sessions（非管理员可看自己的会话）。该页已并入 ADMIN-only 的
  // /system/accounts，旧路径只是重定向壳，放行它等于放行一个必被目标页拦下的空跳转，故移除。
  if (normalized === '/dashboard' || normalized.startsWith('/dashboard/')) return true
  // 公司管理入口对所有登录用户开放：每人看到的是自身公司（后端 companyId 隔离），
  // 写操作由后端 company 写权限闸门控制。故前端不按角色限制 /gsgl 菜单可见性。
  if (normalized === '/gsgl' || normalized.startsWith('/gsgl/')) return true

  const rule = getEffectiveAccessRule(roleCode)
  if (rule.routes?.includes(normalized)) return true
  return Boolean(rule.groups?.some((group) => normalized === group || normalized.startsWith(`${group}/`)))
}

export function isPathAvailableInRegion(path: string, regionId?: string) {
  return isRegionRouteAvailable(path, regionId)
}

export function firstAccessiblePath(user: Pick<GovernanceUser, 'roleCode'> | null | undefined, regionId?: string) {
  const roleCode = user?.roleCode ?? getDefaultGovernanceUser().roleCode
  const defaultRoute = getEffectiveAccessRule(roleCode)?.defaultRoute ?? '/dashboard'
  // 同时校验地区可用性与角色可访问性：若 defaultRoute 被 adminOnlyRoutes 收紧后
  // 当前角色无权访问（如旧 override 把非管理员 defaultRoute 存成了 /ai-settings），
  // 必须回退 /dashboard，否则路由守卫会重定向回同一个禁入页 → 死循环。
  if (isPathAvailableInRegion(defaultRoute, regionId) && canAccessPath(defaultRoute, user)) {
    return defaultRoute
  }
  return '/dashboard'
}

export function filterNavigationForUser(items: NavigationLike[], user: Pick<GovernanceUser, 'roleCode'> | null | undefined, regionId?: string): NavigationLike[] {
  const filtered: NavigationLike[] = []

  for (const item of items) {
    if (!matchesNavigationRegion(item, regionId)) continue
    const children = item.children ? filterNavigationForUser(item.children, user, regionId) : undefined
    if (children?.length) {
      filtered.push({ ...item, children })
      continue
    }
    if (canAccessPath(item.path, user)) {
      filtered.push({ ...item, children: undefined })
    }
  }

  return filtered
}

function matchesNavigationRegion(item: NavigationLike, regionId?: string) {
  const matchesDeclaredRegion = !item.regionIds?.length || Boolean(regionId && item.regionIds.includes(regionId))
  return matchesDeclaredRegion && isPathAvailableInRegion(item.path, regionId)
}

export function getDecisionGateHint(path: string, user: Pick<GovernanceUser, 'roleCode'> | null | undefined) {
  const roleCode = user?.roleCode ?? getDefaultGovernanceUser().roleCode
  const rule = getEffectiveAccessRule(roleCode)
  const normalized = normalizePath(path)
  if (normalized.startsWith('/xhjy') || normalized.startsWith('/sjxh')) return rule.gate
  if (normalized.startsWith('/yygl/import-hub')) {
    return {
      level: 'L2',
      label: '导入预览后提交',
      reviewer: roleLabels[roleCode],
      note: '导入必须先上传、预览、校验，再提交入库并留痕。'
    }
  }
  return rule.gate
}

export function hasAction(user: Pick<GovernanceUser, 'roleCode'> | null | undefined, action: string) {
  const roleCode = user?.roleCode ?? getDefaultGovernanceUser().roleCode
  return getEffectiveAccessRule(roleCode)?.actions.includes(action) ?? false
}

function makeUser(input: {
  username: string
  displayName: string
  roleCode: RoleCode
  roleGroup: GovernanceUser['roleGroup']
  areaName: string
  areaCode: string
  companyId?: string
  companyName?: string
  subjectName: string
  subjectType: SubjectType
  decisionLevel: GovernanceUser['decisionLevel']
  perspective: string
}): GovernanceUser {
  const subjectId = `${input.subjectType}-${input.areaCode}-${input.username}`.toUpperCase()
  const companyId = input.companyId ?? 'dljy-demo'
  const dataScope: DataScope = {
    tenantId: companyId,
    areaCode: input.areaCode,
    areaName: input.areaName,
    subjectId,
    subjectName: input.subjectName,
    subjectType: input.subjectType,
    ownerOrgId: input.areaCode === 'GROUP' ? 'ORG-GROUP' : `ORG-${input.areaCode}`,
    visibility: input.subjectType === 'GROUP' ? 'GROUP' : 'ORG'
  }

  return {
    username: input.username,
    displayName: input.displayName,
    role: roleLabels[input.roleCode],
    roleCode: input.roleCode,
    roleGroup: input.roleGroup,
    area: input.areaName,
    areaCode: input.areaCode,
    companyId,
    companyName: input.companyName,
    companyTier: input.areaCode === 'GROUP' ? 'GROUP' : 'COMPANY',
    subjectId,
    subjectName: input.subjectName,
    subjectType: input.subjectType,
    permissions: [],
    allowedAreas: input.areaCode === 'GROUP' ? ['GROUP', 'SX', 'HB', 'HD', 'XB', 'NW'] : [input.areaCode],
    allowedSubjectTypes: input.subjectType === 'GROUP' ? ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER'] : [input.subjectType],
    dataScopes: [dataScope],
    decisionLevel: input.decisionLevel,
    perspective: input.perspective
  }
}

function normalizePath(path: string) {
  if (!path.startsWith('/')) return `/${path}`
  return path
}

function withRulePermissions(profile: GovernanceUser): GovernanceUser {
  return {
    ...profile,
    permissions: [...(getEffectiveAccessRule(profile.roleCode)?.actions ?? profile.permissions)]
  }
}
