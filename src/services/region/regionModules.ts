import type { GovernanceUser, RoleCode } from '@/services/governance'
import {
  CSG_DATA_NAMESPACE,
  CSG_REGION_INSTANCES,
  CSG_RULE_SET_ID,
  CSG_TEMPLATE_FAMILIES,
  CSG_TEMPLATE_ID
} from 'shared/region/csg-template.mjs'

type UserLike = Pick<GovernanceUser, 'roleCode'> | null | undefined
// not-configured = 能力模块覆盖该路径但该地区未登记状态（ADR serving-route-registry-adr 裁决四：
// 未登记 fail-closed，与 hidden 一样不放行；语义区别，hidden 是有意隐藏，not-configured 是「暂未开通」）。
export type RegionModuleCapabilityStatus = 'available' | 'degraded' | 'hidden' | 'not-configured'
export type RegionModuleCapabilityGroup = 'insight' | 'spot' | 'midlong' | 'forecast'
export type RegionCapabilityDataExpectation = 'real' | 'partial' | 'missing' | 'format-only'
export type RegionCapabilityItemScope = 'route' | 'tab' | 'card' | 'dimension'

export type RegionBusinessModule = {
  id: string
  title: string
  summary: string
  stage: 'active' | 'trial' | 'planned'
  regionIds: string[]
  routePrefix: string
  entryRoutes: Array<{
    title: string
    path: string
    summary: string
  }>
  accessRoutesByRole?: Partial<Record<RoleCode, string[]>>
  roleLandingRoutes?: Partial<Record<RoleCode, string[]>>
}

export type RegionCapabilityDataSupport = {
  label: string
  families?: string[]
  endpoints?: string[]
  expectation: RegionCapabilityDataExpectation
  note: string
}

export type RegionRouteCapability = {
  path: string
  /** 为 true 时同样覆盖 `${path}/…` 子路径（如详情页 /zcqjy/contracts/:id），否则只精确匹配。 */
  includeSubpaths?: boolean
  statusByRegion?: Record<string, RegionModuleCapabilityStatus>
  dataSupportByRegion?: Record<string, RegionCapabilityDataSupport[]>
  note?: string
}

export type RegionSubCapability = {
  id: string
  title: string
  scope: RegionCapabilityItemScope
  statusByRegion: Record<string, RegionModuleCapabilityStatus>
  dataSupportByRegion?: Record<string, RegionCapabilityDataSupport[]>
  note: string
}

export type RegionModuleCapability = {
  id: string
  title: string
  group: RegionModuleCapabilityGroup
  routePrefixes: string[]
  routePaths: string[]
  statusByRegion: Record<string, RegionModuleCapabilityStatus>
  dataSupportByRegion: Record<string, RegionCapabilityDataSupport[]>
  routeCapabilities?: RegionRouteCapability[]
  subCapabilities?: RegionSubCapability[]
}

const yunnanRoleHomeRoute = '/xhjy/yunnan'
const yunnanTradingRoutes = [
  // 真实数据 tab 路径 + node-price 市场洞察独立页（授权保留，工作台 tab/深链需 RBAC 放行）。
  '/xhjy/yunnan/node-price',
  '/xhjy/yunnan/disclosure',
  '/xhjy/yunnan/elasticity',
  '/xhjy/yunnan/spread',
  '/xhjy/yunnan/spot-pnl',
  '/xhjy/yunnan/plant-output',
  '/xhjy/yunnan/price-output-linkage',
  '/xhjy/yunnan/cockpit',
  // 旧文字 tab 子路径（retail/settlement/quant/declaration）UI 已删，但 routes.ts 仍作 alias 兜底落驾驶舱；
  // 授权必须保留，路由守卫 canAccessPath 先于 alias 组件渲染拦截，否则非 ADMIN 角色访问旧收藏深链会被重定向、无法兜底。
  '/xhjy/yunnan/retail',
  '/xhjy/yunnan/settlement',
  '/xhjy/yunnan/quant',
  '/xhjy/yunnan/declaration'
]
const yunnanTradingWorkspaceRoutes = [yunnanRoleHomeRoute, ...yunnanTradingRoutes]

// 南网省份实例的形状。来自 shared/region/csg-template.mjs，那是南网数据模板，
// 与「南网有没有接口」无关：云南真实数据适配器（yn-fact-quickwin / yn-fact-forecast）
// 与两个 ETL 脚本都消费它，故 #1894 删南网披露栈时保留。
type CsgRegionInstance = {
  regionId: string
  code: string
  column: string
  shortName: string
  provinceAlias: string
}

export type CsgCompanyInstanceMapping = {
  companyId: string
  name: string
  regionId: string
  tier: 'GROUP' | 'COMPANY'
  dataScope: 'company'
  dimFamilies: string[]
  captureFamilies: string[]
}

export type CsgRegionInstanceMapping = CsgRegionInstance & {
  templateId: typeof CSG_TEMPLATE_ID
  ruleSetId: typeof CSG_RULE_SET_ID
  dataNamespace: typeof CSG_DATA_NAMESPACE
  includeAllRegion: boolean
  captureRegion: string
  companyInstances: CsgCompanyInstanceMapping[]
}

export type CsgCommonTemplateMapping = {
  template: {
    id: typeof CSG_TEMPLATE_ID
    ruleSetId: typeof CSG_RULE_SET_ID
    dataNamespace: typeof CSG_DATA_NAMESPACE
    schemaFamilies: string[]
    companyBound: false
  }
  regionInstances: CsgRegionInstanceMapping[]
}

const csgRegionInstances = CSG_REGION_INSTANCES as CsgRegionInstance[]

export const csgCommonTemplateMapping: CsgCommonTemplateMapping = {
  template: {
    id: CSG_TEMPLATE_ID,
    ruleSetId: CSG_RULE_SET_ID,
    dataNamespace: CSG_DATA_NAMESPACE,
    schemaFamilies: [...CSG_TEMPLATE_FAMILIES],
    companyBound: false
  },
  regionInstances: csgRegionInstances.map((region) => ({
    ...region,
    templateId: CSG_TEMPLATE_ID,
    ruleSetId: CSG_RULE_SET_ID,
    dataNamespace: CSG_DATA_NAMESPACE,
    includeAllRegion: true,
    captureRegion: region.regionId,
    companyInstances: region.regionId === 'yunnan'
      ? [{
          companyId: 'comp-cgn-yunnan',
          name: '中广核云南新能源有限公司',
          regionId: 'yunnan',
          tier: 'GROUP',
          dataScope: 'company',
          dimFamilies: ['dim_plant', 'dim_plant_node'],
          captureFamilies: ['yn_dim_plant', 'yn_dim_plant_node', 'yn_plant_output']
        }]
      : []
  }))
}

export function getCsgRegionInstanceMapping(regionId: string) {
  return csgCommonTemplateMapping.regionInstances.find((item) => item.regionId === regionId) ?? null
}

export function getCsgCompanyInstanceMapping(companyId: string) {
  return csgCommonTemplateMapping.regionInstances
    .flatMap((item) => item.companyInstances)
    .find((item) => item.companyId === companyId) ?? null
}

const shanxiSdptSupport = (label: string, families: string[], note: string): RegionCapabilityDataSupport => ({
  label,
  families,
  expectation: 'real',
  note
})

export const regionModuleCapabilities: RegionModuleCapability[] = [
  {
    id: 'market-insight',
    title: '市场洞察',
    group: 'insight',
    routePrefixes: ['/insight', '/sjfx/fshq', '/sjfx/zrsjg', '/sjfx/zcqxhdl', '/sjfx/zrxgx', '/sjfx/zrxgx2', '/sjfx/actualLoad', '/sjfx/singleZsjfx', '/sjfx/market-ops'],
    routePaths: ['/insight/cockpit', '/sjfx/fshq', '/sjfx/zrsjg', '/sjfx/zcqxhdl', '/sjfx/zrxgx', '/sjfx/zrxgx2', '/sjfx/actualLoad', '/sjfx/singleZsjfx', '/sjfx/market-ops'],
    statusByRegion: {
      shanxi: 'available',
      yunnan: 'degraded',
      // #770 广东第三省声明式接入试点：南网省份（ruleSet=active，已有结算 spec 与现货画像地基），
      // 但未接入 sdpt_* 洞察族专属真实采集 → 诚实标 degraded（market_analysis 公共口径可投递）。
      guangdong: 'degraded',
      // #770 四川第三省声明式接入试点（跨体系·国网）：国网省份（ruleSet=trial），未接入 sdpt_* 洞察族
      // 专属真实采集 → 诚实标 degraded。洞察核心族为省专属（不标 gridScope），四川切到不回退山西，
      // 缺数据只走按地区合成 Mock（mock:true）或空（market_analysis 公共口径可投递）。
      sichuan: 'degraded'
    },
    dataSupportByRegion: {
      shanxi: [
        shanxiSdptSupport('山西市场洞察基线', ['sdpt_console', 'sdpt_zsjfx_idx', 'sdpt_zcqxhdl', 'sdpt_actualLoad', 'sdpt_fshq'], '三德普华/山西采集族为基线，经典洞察页可真实回放。')
      ],
      yunnan: [
        { label: '云南洞察已接真实族', families: ['sdpt_console', 'sdpt_zsjfx_idx', 'sdpt_zcqxhdl', 'sdpt_actualLoad', 'yn_system_forecast'], expectation: 'real', note: '2026-07-06 后 sdpt_console、zsjfx 索引、listrs_full、逐日负荷和关系图输入已有云南真实支撑。' },
        { label: '云南分时行情缺口', families: ['sdpt_fshq'], expectation: 'missing', note: '交易撮合行情 fshq 暂无云南来源，页面后续应显示可解释降级卡。' },
        { label: '市场经营手录口径', families: ['market_analysis'], expectation: 'partial', note: 'market_analysis 是手录/导入公共口径（概览/发电/售电/储能/价格/月度/指标），不等价于完整云南交易中心行情。' },
        { label: '售电套餐经营口径(公司私有)', families: ['market_retail_packages'], expectation: 'partial', note: 'market_retail_packages 为售电套餐公司私有经营口径（#669），仅归属公司 comp-cgn-yunnan 登录可见真实回放；非归属公司走 synthetic 授权态，不泄漏他司经营数据。' }
      ],
      // #770 广东无 sdpt_* 洞察族真实采集（南网无电网基线回退，绝不串读山西/云南），
      // 缺数据只走按地区合成 Mock（mock:true）或空态；market_analysis 公共口径可经 ImportHub 投递。
      guangdong: [
        { label: '广东市场洞察核心族缺口', families: ['sdpt_fshq', 'sdpt_zsjfx_idx', 'sdpt_zcqxhdl', 'sdpt_actualLoad'], expectation: 'missing', note: '广东为第三省声明式接入试点（#770），sdpt_* 洞察族尚未接入专属真实采集；南网地区无电网基线回退（gridBaselineRegion("csg")=null），缺数据只走按地区合成 Mock（mock:true）或空态，绝不串读山西/云南口径。' },
        { label: '广东市场经营公共口径', families: ['market_analysis'], expectation: 'partial', note: 'market_analysis 为公共手录口径，广东可经 ImportHub 投递，但不等价于完整广东交易中心行情自动接入。' }
      ],
      // #770 四川洞察核心族为省专属（不标 gridScope），四川无专属真实采集时不回退山西（region-strict），
      // 缺数据只走按地区合成 Mock（mock:true）或空态；market_analysis 公共口径可经 ImportHub 投递。
      sichuan: [
        { label: '四川市场洞察核心族缺口', families: ['sdpt_fshq', 'sdpt_zsjfx_idx', 'sdpt_zcqxhdl', 'sdpt_actualLoad'], expectation: 'missing', note: '四川为第三省声明式接入试点（#770，跨体系·国网），sdpt_* 洞察族为省专属（不标 gridScope）尚未接入专属真实采集；四川切到不回退山西（region-strict），缺数据只走按地区合成 Mock（mock:true）或空态，绝不串读山西/云南口径。' },
        { label: '四川市场经营公共口径', families: ['market_analysis'], expectation: 'partial', note: 'market_analysis 为公共手录口径，四川可经 ImportHub 投递，但不等价于完整四川交易中心行情自动接入。' }
      ]
    },
    routeCapabilities: [
      { path: '/insight/cockpit', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '市场洞察 bundle 已按地区贯穿，云南真实族缺口由 bundle gaps 标注。' },
      { path: '/sjfx/fshq', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '云南无 fshq 交易撮合行情来源。' },
      { path: '/sjfx/zrsjg', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '云南使用 sdpt_zcqxhdl listrs_full 真实回放。' },
      { path: '/sjfx/zcqxhdl', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '出清曲线类输入已纳入云南真实支撑。' },
      { path: '/sjfx/zrxgx', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '同页关系图可走云南 yn_system_forecast 口径；山西专有维度见 subCapabilities。' },
      { path: '/sjfx/zrxgx2', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '统调负荷关系图可走云南系统预测/实际长表口径。' },
      { path: '/sjfx/actualLoad', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '逐日系统负荷已有云南真实支撑。' },
      { path: '/sjfx/singleZsjfx', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: 'zsjfx 索引已具备云南真实支撑。' },
      { path: '/sjfx/market-ops', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '手录市场经营口径可用但不代表完整云南行情自动接入。' }
    ],
    subCapabilities: [
      { id: 'zrxgx.xnyz', title: '新能源总出力', scope: 'dimension', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '山西/云南均可表达新能源总量关系。' },
      { id: 'zrxgx.xnyzd', title: '新能源最大出力', scope: 'dimension', statusByRegion: { shanxi: 'available', yunnan: 'hidden' }, note: 'xnyzd 是山西 sdpt_zcqxhdl 专有维度，云南同页不应硬造。' },
      { id: 'zrxgx.xnyg', title: '新能源高出力', scope: 'dimension', statusByRegion: { shanxi: 'available', yunnan: 'hidden' }, note: 'xnyg 是山西专有维度。' },
      { id: 'zrxgx.xnygd', title: '新能源高低出力差', scope: 'dimension', statusByRegion: { shanxi: 'available', yunnan: 'hidden' }, note: 'xnygd 是山西专有维度。' }
    ]
  },
  {
    id: 'spot-trading',
    title: '现货交易',
    group: 'spot',
    // /zcqjy/exposure 路径留在 zcqjy 下（深链不断），但它读现货结算口径、产出现货价格风险指标，归现货模块（dljy#2988）。
    routePrefixes: ['/dashboard', '/xhjy/monitor', '/xhjy/zrqsb', '/xhjy/zptqx', '/xhjy/desk', '/xhjy/approvals', '/xhjy/review', '/xhjy/risk-center'],
    routePaths: ['/dashboard', '/xhjy/monitor', '/xhjy/zrqsb', '/xhjy/zptqx', '/xhjy/desk', '/xhjy/approvals', '/xhjy/review', '/xhjy/risk-center', '/zcqjy/exposure'],
    statusByRegion: {
      shanxi: 'available',
      yunnan: 'degraded',
      // #770 广东第三省声明式接入试点：无现货申报/出清/复盘真实采集 → 诚实标 degraded。
      guangdong: 'degraded',
      // #770 四川第三省声明式接入试点（跨体系·国网）：无现货申报/出清/复盘真实采集 → 诚实标 degraded。
      // 现货核心族为省专属（不标 gridScope），四川切到不回退山西（region-strict）。
      sichuan: 'degraded'
    },
    dataSupportByRegion: {
      shanxi: [
        shanxiSdptSupport('山西现货交易基线', ['sdpt_zcqxhdl', 'knn-api_api', 'sdpt_zrqsb', 'sdpt_zptqx'], '山西出清曲线、KNN 预测、日前上报和电量预估均有基线采集。')
      ],
      yunnan: [
        { label: '云南出清曲线与 KNN 预测', families: ['sdpt_zcqxhdl', 'knn-api_api'], expectation: 'real', note: '出清曲线/KNN 预测已具备云南真实回放支撑。' },
        { label: '云南日前上报缺口', families: ['sdpt_zrqsb'], expectation: 'missing', note: 'sdpt_zrqsb 是三德普华私有族，云南暂无对应真实来源。' },
        { label: '云南日前电量预估缺口', families: ['sdpt_zptqx'], expectation: 'missing', note: 'sdpt_zptqx 暂无云南来源，后续页面应降级说明。' }
      ],
      // #770 广东无现货出清/申报真实采集；quant 引擎为地区无关底座可运行，但缺广东真实输入。
      guangdong: [
        { label: '广东现货交易核心族缺口', families: ['sdpt_zcqxhdl', 'sdpt_zrqsb', 'sdpt_zptqx'], expectation: 'missing', note: '广东为声明式接入试点（#770），现货出清曲线/日前上报/日前电量预估族无广东专属真实采集；quant 引擎（exposure/review/monitor）为地区无关执行底座可运行，但缺广东真实申报/出清输入，页面只展示降级说明。' }
      ],
      // #770 四川无现货出清/申报真实采集；核心族为省专属（不标 gridScope），四川切到不回退山西；
      // quant 引擎为地区无关底座可运行，但缺四川真实输入。
      sichuan: [
        { label: '四川现货交易核心族缺口', families: ['sdpt_zcqxhdl', 'sdpt_zrqsb', 'sdpt_zptqx'], expectation: 'missing', note: '四川为声明式接入试点（#770，跨体系·国网），现货出清曲线/日前上报/日前电量预估族为省专属（不标 gridScope）无四川专属真实采集；四川切到不回退山西（region-strict），quant 引擎（exposure/review/monitor）为地区无关执行底座可运行，但缺四川真实申报/出清输入，页面只展示降级说明。' }
      ]
    },
    routeCapabilities: [
      { path: '/dashboard', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '驾驶舱基础现货曲线与云南增强区已由现有页面自行降级。' },
      { path: '/xhjy/monitor', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '准实时/智能体量化口径在云南仍依赖后续真实数据装配。' },
      // sdpt_zrqsb 是三德普华（comp-sande-puhua）公司私有族，非国网/全省公共口径：
      // 其余地区既无自有采集、也不可能跨公司串读，页面永远只能是一张降级卡。
      // 故按「私有族在无源地区不展示」收紧为 hidden，侧边栏摘除 + 路由守卫拦截 + 切地区自动重定向
      // （链路：isRegionRouteAvailable → isPathAvailableInRegion → matchesNavigationRegion / router guard）。
      {
        path: '/xhjy/zrqsb',
        statusByRegion: { shanxi: 'available', yunnan: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: 'sdpt_zrqsb 为三德普华公司私有族，仅山西宿主可读；其余地区不展示该模块。'
      },
      // sdpt_zptqx 同为三德普华私有族（曾误标 public，匿名可读全量，已更正）。
      // 此前这里按 public 处理、非宿主地区留 degraded，理由写的是「缺的是本省采集而非授权」
      // 定级更正后该理由不成立：其它地区既无自有采集、也不可能跨公司串读，入口只会是一张
      // 必然空手而归的降级卡。故与同页兄弟 zrqsb 同口径收紧为 hidden。
      // ⚠ 四地区必须逐个显式声明：漏声明会回落 not-configured 而被当降级卡渲染（等于规则虚设）。
      {
        path: '/xhjy/zptqx',
        statusByRegion: { shanxi: 'available', yunnan: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: 'sdpt_zptqx 为三德普华公司私有族，仅山西宿主可读；其余地区不展示该模块。'
      },
      { path: '/xhjy/desk', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '申报动线可用，云南真实申报数据闭环待接入。' },
      { path: '/xhjy/approvals', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '审批状态机可用，云南真实交易平台提交回执待接入。' },
      // Epic #1485 后据实修正：两地区都不是完全可用，但缺的东西不同
      // 山西：申报量已可读真实回放（#1498），但实际上网电量无任何数据源（sdpt_settlement
      // 从未接入，#1487），不由调用方提供 96 点实际电量就出不了偏差考核。
      // 云南：结算口径三段式复盘已接真实源可用（#1488），但偏差考核那套的申报/实际两侧都无源
      // （sdpt_zrqsb 是山西私有族，严格地区不回退），且结算采集仅覆盖 2026-05。
      { path: '/xhjy/review', statusByRegion: { shanxi: 'degraded', yunnan: 'degraded' }, note: '山西可读真实申报量，但实际上网电量无数据源、须调用方提供；云南结算口径三段式复盘可用（采集仅覆盖 2026-05），偏差考核两侧仍无源。' },
      { path: '/xhjy/risk-center', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '风险聚合可用，云南现货执行源仍不完整。' },
      // 中长期与现货套保（原中长期敞口看板，dljy#2988）：合同分解 vs 预计出力算逐时敞口，并读现货结算口径算套保率与净敞口。
      { path: '/zcqjy/exposure', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '敞口与套保计算可用，云南中长期真实输入（P2 分时分解）与结算口径待接入。' }
    ]
  },
  {
    id: 'midlong-trading',
    title: '中长期交易',
    group: 'midlong',
    routePrefixes: ['/zcqjy', '/sjxh/zjzzt'],
    routePaths: ['/zcqjy/contracts', '/zcqjy/positions', '/zcqjy/positions/intervals', '/zcqjy/positions/stations', '/zcqjy/curves', '/zcqjy/plans', '/zcqjy/execution', '/zcqjy/zccljk', '/zcqjy/zfsdjy', '/zcqjy/zjyap', '/sjxh/zjzzt'],
    statusByRegion: {
      shanxi: 'available',
      yunnan: 'degraded',
      // #770 广东第三省声明式接入试点：无中长期台账真实采集 → 诚实标 degraded。
      guangdong: 'degraded',
      // #770 四川第三省声明式接入试点（跨体系·国网）：无中长期台账真实采集 → 诚实标 degraded。
      // ⚠️ 跨体系差异：sdpt_zjyap（交易月历）标 gridScope=sgcc，四川同属国网 → 经国网基线回退读山西月历
      // （fallback:true，见核心调查项）；sdpt_zfsdjy/sdpt_zptjg 为省专属不回退山西。
      sichuan: 'degraded'
    },
    dataSupportByRegion: {
      shanxi: [
        shanxiSdptSupport('山西中长期基线', ['sdpt_zfsdjy', 'sdpt_zjyap', 'sdpt_zptjg'], '山西分时段交易、交易月历与省间计划均有基线采集。')
      ],
      yunnan: [
        { label: '云南省间计划', families: ['sdpt_zptjg'], expectation: 'real', note: 'tag92 省间中长期电量计划已有云南真实支撑。' },
        { label: '云南分时段交易缺口', families: ['sdpt_zfsdjy'], expectation: 'missing', note: 'zfsdjy 暂无云南来源。' },
        { label: '云南交易月历缺口', families: ['sdpt_zjyap'], expectation: 'missing', note: 'zjyap 为 gridScope=sgcc 国网通用族，云南为南网地区，不跨电网取数。' }
      ],
      // #770 广东无中长期台账真实采集；属南网经营区，不跨电网取国网月历。
      guangdong: [
        { label: '广东中长期交易核心族缺口', families: ['sdpt_zfsdjy', 'sdpt_zjyap', 'sdpt_zptjg'], expectation: 'missing', note: '广东为声明式接入试点（#770），分时段交易/交易月历/省间计划族无广东专属真实采集；广东属南网经营区，不跨电网取国网月历（sdpt_zjyap gridScope=sgcc）。' }
      ],
      // #770 四川中长期：sdpt_zfsdjy/sdpt_zptjg 为省专属（不标 gridScope）不回退山西；
      // ⚠️ sdpt_zjyap 标 gridScope=sgcc，四川同属国网 → capture-replay 经国网基线回退读山西交易月历
      // （fallback:true 诚实标头）。月历为国网统一安排（非省专属市场数据），同电网共享符合 Issue #575
      // 设计；与广东（南网不取国网月历）不同。是否对四川排除此回退属后续用户决策（见报告核心调查项）。
      sichuan: [
        { label: '四川中长期省专属族缺口', families: ['sdpt_zfsdjy', 'sdpt_zptjg'], expectation: 'missing', note: '四川为声明式接入试点（#770，跨体系·国网），分时段交易/省间计划族为省专属（不标 gridScope）无四川专属真实采集；四川切到不回退山西（region-strict）。' },
        { label: '四川交易月历（国网通用·回退山西）', families: ['sdpt_zjyap'], expectation: 'partial', note: 'sdpt_zjyap 标 gridScope=sgcc，四川同属国网 → capture-replay 经国网基线回退读山西交易月历（fallback:true 诚实标头）。月历为国网统一安排（非省专属市场数据），同电网共享符合 Issue #575 设计；与广东（南网不取国网月历）不同。是否对四川排除此回退属后续用户决策（见 sichuan-pilot-report.md 核心调查项）。' }
      ]
    },
    routeCapabilities: [
      // 云南中长期售电 P1（dljy#2939）：试点只开通云南；其他地区不展示入口，也不回退读取任何地区的合同底账。
      {
        path: '/zcqjy/contracts',
        includeSubpaths: true,
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '中长期售电合同底账（company.midlong_*），P1 仅云南试点；后端对其他地区返回未开通。'
      },
      {
        path: '/zcqjy/positions',
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '已确认售电义务月度持仓，只读合同底账，不依赖现货/预测数据；P1 仅云南试点。'
      },
      // 云南中长期售电 P2（dljy#2971）：分时持仓、场站维度持仓与分解集详情，同样只开通云南。
      {
        path: '/zcqjy/positions/intervals',
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '已确认分解集的月/日/时持仓；只有月量的合同在小时粒度显示分时未知，不依赖现货/预测数据；仅云南试点。'
      },
      {
        path: '/zcqjy/positions/stations',
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '交易单元义务的场站分配份额与未分配余额；仅云南试点。'
      },
      {
        path: '/zcqjy/curves',
        includeSubpaths: true,
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '分时分解集详情（/zcqjy/curves/:id），仅云南试点。'
      },
      // 云南中长期售电 P3（dljy#2973）：售电计划与交易执行，同样只开通云南。
      {
        path: '/zcqjy/plans',
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '人工售电目标、完成情况与交易方案占用；目标是经营安排，不依赖现货/预测数据；仅云南试点。'
      },
      {
        path: '/zcqjy/execution',
        statusByRegion: { yunnan: 'available', shanxi: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        note: '交易公告与日历、申报材料导出与外部提交登记；导出不代提交、不对接外部平台；仅云南试点。'
      },
      // sdpt_zfsdjy 是三德普华私有族（曾误标 public，匿名可读该公司中长期合同台账与
      // 逐日持仓电量/持仓均价，#1617 合并后复查发现）。与 /xhjy/zrqsb、/xhjy/zptqx 同口径：
      // 其它地区既无自有采集、也不可能跨公司串读 → hidden，四地区逐个显式声明。
      {
        path: '/zcqjy/zccljk',
        statusByRegion: { shanxi: 'available', yunnan: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西持仓监控', ['sdpt_zfsdjy'], 'ccljkDay/ccljkTime 持仓监控基线真实回放。')]
        },
        note: 'sdpt_zfsdjy 为三德普华公司私有族，仅山西宿主可读；其余地区不展示该模块。'
      },
      {
        path: '/zcqjy/zfsdjy',
        statusByRegion: { shanxi: 'available', yunnan: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西分时段交易台账', ['sdpt_zfsdjy'], 'sdpt_zfsdjy/list 分时段交易基线真实回放。')]
        },
        note: 'sdpt_zfsdjy 为三德普华公司私有族，仅山西宿主可读；其余地区不展示该模块。'
      },
      {
        path: '/zcqjy/zjyap',
        // 云南属南网，不跨电网取国网月历（sdpt_zjyap gridScope=sgcc）：显示空页面反而误导，直接隐藏（dljy#2988）。
        statusByRegion: { shanxi: 'available', yunnan: 'hidden' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西交易月历', ['sdpt_zjyap'], 'sdpt_zjyap/calendar 国网交易安排基线真实回放。')],
          yunnan: [{ label: '南网不取国网月历', families: ['sdpt_zjyap'], expectation: 'missing', note: 'zjyap 为 gridScope=sgcc 国网交易安排，云南属南网经营区，不跨电网取数。' }]
        },
        note: '国网交易月历不跨电网服务云南。'
      },
      {
        path: '/sjxh/zjzzt',
        statusByRegion: { shanxi: 'available', yunnan: 'available' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西 tag92 省间计划', ['sdpt_zptjg'], 'sdpt_zptjg/list_tag92_full 基线真实回放。')],
          yunnan: [{ label: '云南 tag92 省间计划', families: ['sdpt_zptjg'], expectation: 'real', note: 'tag92 省间中长期电量计划已有云南真实支撑。' }]
        },
        note: 'tag92 省间计划已有云南真实支撑。'
      }
    ]
  },
  {
    id: 'forecast-data',
    title: '预测数据',
    group: 'forecast',
    routePrefixes: ['/ycsj'],
    routePaths: ['/ycsj/workbench', '/ycsj/decision-cockpit', '/ycsj/hub', '/ycsj/station-generation'],
    statusByRegion: {
      shanxi: 'available',
      yunnan: 'degraded',
      // #770 广东第三省声明式接入试点：无平台预测族真实采集 → 诚实标 degraded（不展开气象，属另一分支范围）。
      guangdong: 'degraded',
      // #770 四川第三省声明式接入试点（跨体系·国网）：无平台预测族真实采集 → 诚实标 degraded
      // （不展开气象，属另一在途分支，避免跨分支耦合）。
      sichuan: 'degraded'
    },
    dataSupportByRegion: {
      shanxi: [
        shanxiSdptSupport('山西预测数据基线', ['sdpt_zptjg', 'sdpt_zptsj', 'sdpt_zxztqa', 'sdpt_zgnrx', 'knn-api_api'], '山西平台预测族与 KNN 回放均有基线采集；forecast 数值仍按页面既有警示处理。')
      ],
      yunnan: [
        { label: '云南 KNN 与气象', families: ['knn-api_api', 'yn_meteo', 'yn_irradiance'], endpoints: ['POST /agent-api/v1/forecast/station-generation', 'POST /agent-api/v1/forecast/{predict,risk-quantify,optimize-bid}'], expectation: 'real', note: 'KNN 回放、Open-Meteo 气象/辐照与 agent-backend 预测决策端点已可用；结算系数占位仍需页面显著标注。' },
        { label: '云南平台预测族缺口', families: ['sdpt_zptjg'], expectation: 'partial', note: 'sdpt_zptjg 平台族仅部分支撑；kind:forecast 数值本身不可信，不虚标 available。' },
        { label: '山西私有预测族不适用云南', families: ['sdpt_zptsj', 'sdpt_zxztqa', 'sdpt_zgnrx'], expectation: 'missing', note: '这些族为三德普华/山西私有或平台形状，云南暂无对应来源。' }
      ],
      // #770 广东无平台预测族真实采集；KNN/预测决策端点为公共能力可运行，但缺广东真实历史输入。
      // 气象（yn_meteo/yn_irradiance）接入属另一在途分支，本试点不展开，避免跨分支耦合。
      guangdong: [
        { label: '广东预测平台族缺口', families: ['sdpt_zptjg', 'knn-api_api'], expectation: 'missing', note: '广东为声明式接入试点（#770），平台预测族无广东专属真实采集；KNN/agent-backend 预测决策端点为公共能力可运行，但缺广东真实历史输入，输出仅作决策支持、非结算依据。' }
      ],
      // #770 四川无平台预测族真实采集；KNN/预测决策端点为公共能力可运行，但缺四川真实历史输入。
      // 气象接入属另一在途分支，本试点不展开，避免跨分支耦合。
      sichuan: [
        { label: '四川预测平台族缺口', families: ['sdpt_zptjg', 'knn-api_api'], expectation: 'missing', note: '四川为声明式接入试点（#770，跨体系·国网），平台预测族无四川专属真实采集；KNN/agent-backend 预测决策端点为公共能力可运行，但缺四川真实历史输入，输出仅作决策支持、非结算依据。' }
      ]
    },
    routeCapabilities: [
      { path: '/ycsj/workbench', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: 'ML/KNN 工作台可运行，地区数据质量由页面数据可用性说明承接。' },
      {
        path: '/ycsj/decision-cockpit',
        statusByRegion: { shanxi: 'available', yunnan: 'available' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西预测决策端点', ['knn-api_api'], 'agent-backend predict/risk-quantify/optimize-bid 可按山西基线与 KNN 回放运行；kind:forecast 数值仍仅作决策支持。')],
          yunnan: [{ label: '云南预测决策端点', families: ['knn-api_api', 'yn_meteo', 'yn_irradiance'], endpoints: ['POST /agent-api/v1/forecast/{predict,risk-quantify,optimize-bid}'], expectation: 'real', note: '预测、风险量化和报价优化端点可按当前地区运行；云南逐时段结算系数未校准前金额非结算依据。' }]
        },
        note: '预测决策闭环可运行；输出必须显著标注决策支持、非结算依据。'
      },
      { path: '/ycsj/hub', statusByRegion: { shanxi: 'available', yunnan: 'degraded' }, note: '平台预测回放在云南仅部分支撑，数值不作为可信预测结论。' },
      { path: '/ycsj/station-generation', statusByRegion: { shanxi: 'available', yunnan: 'available' }, note: '站级预测可使用真实气象/辐照输入，输出仍按预测置信区间解释。' }
    ],
    subCapabilities: [
      {
        id: 'forecast.tab.pricePrediction',
        title: '日滚动价格预测',
        scope: 'tab',
        statusByRegion: { shanxi: 'available', yunnan: 'available' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西 KNN 回放', ['knn-api_api'], '山西基线 KNN 预测回放可用。')],
          yunnan: [{ label: '云南 KNN 回放', families: ['knn-api_api'], expectation: 'real', note: '云南 KNN 相似日预测已具备真实回放支撑。' }]
        },
        note: 'KNN 日滚动预测为公共地区绑定能力。'
      },
      {
        id: 'forecast.tab.jgyc',
        title: '价格预测',
        scope: 'tab',
        statusByRegion: { shanxi: 'available', yunnan: 'degraded' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西平台价格预测', ['sdpt_zptjg'], '山西 sdpt_zptjg/list_tag61_full 平台预测族可回放。')],
          yunnan: [{ label: '云南平台价格预测缺口', families: ['sdpt_zptjg'], expectation: 'partial', note: '云南 sdpt_zptjg 仅部分中长期/省间计划支撑，list_tag61 平台价格预测不虚标真实。' }]
        },
        note: '云南平台价格预测缺少同形真实数据，保留降级说明，避免串读山西平台族。'
      },
      {
        id: 'forecast.tab.yn-disclosure',
        title: '云南披露对照',
        scope: 'tab',
        // 地区专属 tab（标题即绑死云南）：非云南地区一律 hidden。guangdong/sichuan 此前未登记 →
        // 回落 not-configured → ForecastHubView 当降级卡照常渲染，导致广东/四川能看到「云南披露对照」。
        statusByRegion: { shanxi: 'hidden', yunnan: 'available', guangdong: 'hidden', sichuan: 'hidden' },
        dataSupportByRegion: {
          yunnan: [{ label: '云南南网官方预测 vs 实际', families: ['yn_system_forecast'], expectation: 'real', note: '云南系统预测/实际长表已有真实回放支撑。' }]
        },
        note: '云南官方披露对照是云南专属 tab，其余地区（含同为南网的广东）均不展示。'
      },
      {
        id: 'forecast.tab.gsfhyc',
        title: '负荷预测',
        scope: 'tab',
        statusByRegion: { shanxi: 'available', yunnan: 'degraded' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西公司负荷预测', ['sdpt_zptjg'], '山西平台族与既有公司画像预测路径保持现状。')],
          yunnan: [{ label: '云南厂站负荷预测待接真实源', families: ['sdpt_zptjg'], expectation: 'missing', note: '当前 /api/company/forecast 为按厂站画像生成的 MOCK，云南缺真实预测源时只展示降级卡。' }]
        },
        note: '该 tab 绑定地区·公司·厂站，云南真实厂站预测源未接入前不渲染 MOCK 曲线。'
      },
      {
        id: 'forecast.tab.gscwfh',
        title: '错位负荷',
        scope: 'tab',
        // sdpt_zptsj 为三德普华公司私有族：云南 capture-raw 下虽有同名目录，但只含 yn_system_supply_demand
        // 快照、无 list_tag61_full 切片，错位负荷在云南既无源也不可跨公司串读 → hidden（tab 直接摘除）。
        // guangdong/sichuan 同为无源地区，必须显式声明 hidden，不写会回落 not-configured，
        // 而 ForecastHubView 只过滤 hidden、把 not-configured 当降级卡继续展示，规则就只对云南生效。
        statusByRegion: { shanxi: 'available', yunnan: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西错位负荷预测', ['sdpt_zptsj'], '山西 sdpt_zptsj/list_tag61_full 可回放。')],
          yunnan: [{ label: '云南错位负荷预测缺口', families: ['sdpt_zptsj'], expectation: 'missing', note: 'sdpt_zptsj 为山西三德普华公司私有族，云南暂无对应来源，本 tab 在云南不展示。' }]
        },
        note: 'sdpt_zptsj 为三德普华私有族，云南无同形来源且不跨地区回放，故不展示该 tab。'
      },
      {
        id: 'forecast.tab.renewable-ab',
        title: '新能源出力预测 A/B',
        scope: 'tab',
        // sdpt_zxztqa / sdpt_zgnrx 均为三德普华公司私有族且仅山西有采集 → hidden（tab 直接摘除）。
        // sdpt_zgnrx 的另一切片 qxyc_wide 服务「气象预测」tab，云南走 Open-Meteo 公共族，故那个 tab 仍 available。
        // guangdong/sichuan 同上须显式声明，否则回落 not-configured 仍会渲染降级卡（见 gscwfh 注释）。
        statusByRegion: { shanxi: 'available', yunnan: 'hidden', guangdong: 'hidden', sichuan: 'hidden' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西新能源出力预测 A/B', ['sdpt_zxztqa', 'sdpt_zgnrx'], '山西三德普华私有预测族 A/B 保持现状。')],
          yunnan: [{ label: '云南新能源 A/B 私有族缺口', families: ['sdpt_zxztqa', 'sdpt_zgnrx'], expectation: 'missing', note: 'sdpt_zxztqa/sdpt_zgnrx 为山西三德普华私有族，云南无源且不跨公司串读，本 tab 在云南不展示。' }]
        },
        note: 'A/B 两套来源均为三德普华私有族，云南无真实同形预测源，故不展示该 tab。'
      },
      {
        id: 'forecast.tab.zgnrxqxyc',
        title: '气象预测',
        scope: 'tab',
        statusByRegion: { shanxi: 'available', yunnan: 'available' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西平台气象预测', ['sdpt_zgnrx'], '山西 sdpt_zgnrx/qxyc_wide 平台气象输入保持现状。')],
          yunnan: [{ label: '云南 Open-Meteo 气象/辐照', families: ['yn_meteo', 'yn_irradiance'], expectation: 'real', note: '云南气象与辐照经 Open-Meteo 归一为真实回放族。' }]
        },
        note: '气象 tab 按地区选择山西平台族或云南真实 Open-Meteo 族。'
      },
      {
        id: 'forecast.tab.jjkj',
        title: '日前竞价空间',
        scope: 'tab',
        statusByRegion: { shanxi: 'available', yunnan: 'degraded' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西日前竞价空间预测', ['sdpt_zptjg'], '山西 sdpt_zptjg/list_tag27_full 可回放。')],
          yunnan: [{ label: '云南日前竞价空间平台族缺口', families: ['sdpt_zptjg'], expectation: 'partial', note: '云南真实竞价空间由现货/气象计算链支撑，平台 list_tag27 同形回放未接入。' }]
        },
        note: '云南缺平台 list_tag27 同形预测源。'
      },
      {
        id: 'forecast.tab.rqhdcl',
        title: '日前火电出力',
        scope: 'tab',
        statusByRegion: { shanxi: 'available', yunnan: 'degraded' },
        dataSupportByRegion: {
          shanxi: [shanxiSdptSupport('山西日前火电出力预测', ['sdpt_zptjg'], '山西 sdpt_zptjg/list_tag28_full 可回放。')],
          yunnan: [{ label: '云南日前火电出力平台族缺口', families: ['sdpt_zptjg'], expectation: 'partial', note: '云南平台 list_tag28 同形火电出力预测未接入。' }]
        },
        note: '云南缺平台 list_tag28 同形预测源。'
      }
    ]
  }
]

export const regionBusinessModules: RegionBusinessModule[] = [
  {
    id: 'yunnan-trading',
    title: '云南交易',
    summary: '云南现货交易专区：聚合驾驶舱、价格弹性、价差、损益、电厂出力、电价×出力与披露等真实数据。',
    stage: 'trial',
    regionIds: ['yunnan'],
    routePrefix: '/xhjy/yunnan',
    entryRoutes: [
      // 5 个纯文字 tab（角色首页/售电/结算/量化/申报 copilot）已删（父 Issue #456）；仅留真实数据入口。
      { title: '现货交易驾驶舱', path: '/xhjy/yunnan/cockpit', summary: '价格热力场·负价雷达·损益瀑布·申报偏差·决策清单综合看板（真实现货数据）' },
      { title: '节点电价分析', path: '/xhjy/yunnan/node-price', summary: '节点96点价格曲线、价格热力图和当日节点日聚合明细（现货权威后端）。' },
      { title: '披露明细', path: '/xhjy/yunnan/disclosure', summary: '南网整年官方披露明细浏览（D-1 预测/实际/用户电价/系统供需，13 个数据集，真实回放）。' },
      { title: '价格弹性', path: '/xhjy/yunnan/elasticity', summary: '竞价空间→出清价分段弹性曲线，预判价格水平+陡/平弹性，对照 naive（分析参考·非结算依据）。' },
      { title: '日前-实时价差', path: '/xhjy/yunnan/spread', summary: '日前 vs 实时价差预测(符号+幅度)+驱动储能跨期套利回放（决策支持·非真实成交，上线前人工确认）。' },
      { title: '损益归因', path: '/xhjy/yunnan/spot-pnl', summary: '策略/预测/电网三段损失归因瀑布、日前/实时申报偏差分析与厂站 P&L 排行（真实结算导出）。' },
      { title: '电厂出力分析', path: '/xhjy/yunnan/plant-output', summary: '实际出力 vs 计划/预测出力、完成率、偏差和异常时段（yn_plant_output 真实回放）。' },
      { title: '电价×出力联动', path: '/xhjy/yunnan/price-output-linkage', summary: '节点现货出清价与自有电厂/机组实际、计划出力同轴联动分析（真实出力+真实节点电价）。' }
    ],
    accessRoutesByRole: {
      TRADE_LEAD: yunnanTradingWorkspaceRoutes,
      TRADER: yunnanTradingWorkspaceRoutes,
      RISK: yunnanTradingWorkspaceRoutes,
      QUANT: yunnanTradingWorkspaceRoutes,
      SETTLEMENT: yunnanTradingWorkspaceRoutes,
      RETAIL_MANAGER: yunnanTradingWorkspaceRoutes,
      PLANT_OPERATOR: [yunnanRoleHomeRoute, '/xhjy/yunnan/plant-output'],
      STORAGE_OPERATOR: [yunnanRoleHomeRoute, '/xhjy/yunnan/plant-output']
    },
    roleLandingRoutes: {
      // 父 Issue #456：已删文字 tab 路径（retail/settlement/quant）替换为保留的真实数据 tab 路径，按角色语义择优。
      BOSS: [yunnanRoleHomeRoute, '/sdzl/region-rules', '/xhjy/yunnan/cockpit', '/xhjy/yunnan/spot-pnl'],
      ADMIN: [yunnanRoleHomeRoute, '/sdzl/region-rules', '/xhjy/yunnan/cockpit', '/xhjy/yunnan/spot-pnl'],
      RETAIL_MANAGER: [yunnanRoleHomeRoute, '/xhjy/yunnan/spot-pnl', '/xhjy/yunnan/disclosure', '/sdzl/region-rules'],
      TRADE_LEAD: [yunnanRoleHomeRoute, '/xhjy/yunnan/cockpit', '/xhjy/yunnan/elasticity', '/sdzl/region-rules'],
      TRADER: [yunnanRoleHomeRoute, '/xhjy/yunnan/cockpit', '/xhjy/yunnan/elasticity', '/sdzl/region-rules'],
      QUANT: [yunnanRoleHomeRoute, '/xhjy/yunnan/elasticity', '/xhjy/yunnan/spread', '/sdzl/region-rules'],
      SETTLEMENT: [yunnanRoleHomeRoute, '/xhjy/yunnan/spot-pnl', '/xhjy/yunnan/disclosure', '/sdzl/region-rules'],
      RISK: [yunnanRoleHomeRoute, '/xhjy/yunnan/spot-pnl', '/xhjy/yunnan/plant-output', '/sdzl/region-rules'],
      PLANT_OPERATOR: [yunnanRoleHomeRoute, '/xhjy/yunnan/plant-output', '/sdzl/region-rules'],
      STORAGE_OPERATOR: [yunnanRoleHomeRoute, '/xhjy/yunnan/plant-output', '/sdzl/region-rules']
    }
  }
]

export function isRegionRouteAvailable(path: string, regionId?: string) {
  const module = getRegionModuleForPath(path)
  if (module && !Boolean(regionId && module.regionIds.includes(regionId))) return false
  const capability = getRegionCapabilityForPath(path, regionId)
  // null = 路径不在能力注册表覆盖面内（兼容放行）；覆盖面内 hidden 与 not-configured 都不放行。
  if (capability === null) return true
  return capability.status !== 'hidden' && capability.status !== 'not-configured'
}

/** 契约客户端请求前置门控：hidden 与 not-configured（未登记 fail-closed）都不发请求，返回诚实空态。 */
export function regionCapabilityAllowsRequest(path: string, regionId?: string) {
  const capability = getRegionCapabilityForPath(path, regionId)
  if (capability === null) return true
  return capability.status !== 'hidden' && capability.status !== 'not-configured'
}

export function getRegionModuleRoutePrefixes() {
  return regionBusinessModules.map((module) => normalizePath(module.routePrefix))
}

export function getRegionBusinessModules(regionId: string) {
  return regionBusinessModules.filter((module) => module.regionIds.includes(regionId))
}

export function getRegionModuleAccessRoutes(roleCode: RoleCode) {
  return uniqueRoutes(regionBusinessModules.flatMap((module) => module.accessRoutesByRole?.[roleCode] ?? []))
}

export function getRegionCapabilityForPath(path: string, regionId?: string) {
  const module = getRegionModuleCapabilityForPath(path)
  if (!module || !regionId) return null
  const normalized = normalizePath(path)
  // 精确匹配优先；声明了 includeSubpaths 的能力项再覆盖其子路径，避免详情页回落到模块整体状态而在未开通地区放行。
  const route = module.routeCapabilities?.find((item) => normalizePath(item.path) === normalized)
    ?? module.routeCapabilities?.find((item) => item.includeSubpaths && normalized.startsWith(`${normalizePath(item.path)}/`))
  // 覆盖面内但该地区未登记 → not-configured（fail-closed），不再返回 null 造成上游按「未覆盖」放行。
  const status = route?.statusByRegion?.[regionId] ?? module.statusByRegion[regionId] ?? 'not-configured'
  return { module, route: route ?? null, status }
}

export function getRegionSubCapability(group: RegionModuleCapabilityGroup, id: string, regionId?: string) {
  const module = regionModuleCapabilities.find((item) => item.group === group)
  if (!module || !regionId) return null
  const capability = module.subCapabilities?.find((item) => item.id === id)
  if (!capability) return null
  const status = capability.statusByRegion?.[regionId] ?? 'not-configured'
  return { module, capability, status }
}

export function getRegionModuleCapabilities(regionId: string) {
  return regionModuleCapabilities
    .map((module) => ({ module, status: module.statusByRegion[regionId] }))
    .filter((item): item is { module: RegionModuleCapability; status: RegionModuleCapabilityStatus } => Boolean(item.status))
}

export function getRegionLandingRoutes(regionId: string, user: UserLike) {
  const moduleRoutes = regionBusinessModules
    .filter((module) => module.regionIds.includes(regionId))
    .flatMap((module) => getRoleLandingRoutes(module, user))
  return uniqueRoutes([...moduleRoutes, '/xhjy/region', '/sdzl/region-rules', '/dashboard'])
}

export function getRegionModuleForPath(path: string) {
  const normalized = normalizePath(path)
  return regionBusinessModules.find((module) => {
    const prefix = normalizePath(module.routePrefix)
    return normalized === prefix || normalized.startsWith(`${prefix}/`)
  })
}

export function getRegionModuleCapabilityForPath(path: string) {
  const normalized = normalizePath(path)
  // 先在所有模块里找精确 routePaths，再退回前缀匹配：页面归属与路径前缀不一致时（如 /zcqjy/exposure 归现货组），
  // 结果不能取决于模块在数组里的先后（dljy#2988）。
  const exact = regionModuleCapabilities.find((module) => module.routePaths.some((routePath) => normalizePath(routePath) === normalized))
  if (exact) return exact
  return regionModuleCapabilities.find((module) => module.routePrefixes.some((routePrefix) => {
    const prefix = normalizePath(routePrefix)
    return normalized === prefix || normalized.startsWith(`${prefix}/`)
  })) ?? null
}

function getRoleLandingRoutes(module: RegionBusinessModule, user: UserLike) {
  if (!user?.roleCode) return []
  return module.roleLandingRoutes?.[user.roleCode] ?? []
}

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function uniqueRoutes(paths: string[]) {
  return [...new Set(paths)]
}
