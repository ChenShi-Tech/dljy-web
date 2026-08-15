import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { finishRouteProgress, startRouteProgress } from '@/services/routeProgress'
import { resetCaptureAccessDenied } from '@/services/api'
import { getCurrentUser, getToken } from '@/services/auth'
import { canAccessPath, firstAccessiblePath, isPathAvailableInRegion } from '@/services/governance'
import { getCurrentRegionSnapshot } from '@/services/region/regionContext'

const YUNNAN_TRADING_FEATURE_ENABLED = import.meta.env.VITE_DISABLE_YUNNAN_TRADING !== '1'
const yunnanTradingRoutes = YUNNAN_TRADING_FEATURE_ENABLED
  ? (await import('../features/yunnanTrading/routes')).yunnanTradingRoutes
  : []
const REPORTS_FEATURE_ENABLED = import.meta.env.VITE_DISABLE_REPORTS !== '1'
const reportsRoutes = REPORTS_FEATURE_ENABLED
  ? (await import('../features/reports/routes')).reportsRoutes
  : []
const GRID_GEO_FEATURE_ENABLED = import.meta.env.VITE_DISABLE_GRID_GEO !== '1'
const gridGeoRoutes = GRID_GEO_FEATURE_ENABLED
  ? (await import('../features/gridGeo/routes')).gridGeoRoutes
  : []
// 冻结下架（简化 IA·PR-A）：/demo/* 展示页整组收 flag、默认关闭（demo-only 不再投开发）；
// 需要演示时置 VITE_ENABLE_DEMO_PAGES=1 恢复，根路径落地页随开关切换（关=/dashboard）。
const DEMO_PAGES_ENABLED = import.meta.env.VITE_ENABLE_DEMO_PAGES === '1'

// Routes rebuilt from the real production menu (getRouters), 6 blocks / 26 pages.
// Each page carries `meta` describing its real endpoint + where the captured
// real data lives + whether values are real/forecast — so the PlaceholderView
// is self-documenting and Codex can build each page from .codex/data-inventory.md.
// `kind`: 'real' | 'mixed' (real+forecast series) | 'forecast' (values unreliable).
const placeholder = () => import('../views/PlaceholderView.vue')
// Real-data views (built from captured data via /api/real). Others still use
// the self-documenting placeholder until Codex builds them.
const dailySystemLoad = () => import('../views/DailySystemLoadView.vue')
const elNinoLaNina = () => import('../views/ElNinoLaNinaView.vue')
const dataAnalysis = () => import('../views/DataAnalysisView.vue')
const clearingSpotAnalysis = () => import('../views/ClearingSpotAnalysisView.vue')
const priceNewEnergyRelation = () => import('../views/PriceNewEnergyRelationView.vue')
const priceLoadRelation = () => import('../views/PriceLoadRelationView.vue')
const marketOperationsAnalysis = () => import('../views/MarketOperationsAnalysisView.vue')
const fshq = () => import('../views/FshqView.vue')
const priceAnalysis = () => import('../views/PriceAnalysisView.vue')
const solarTerms = () => import('../views/SolarTermsView.vue')
const weatherForecast = () => import('../views/WeatherForecastView.vue')
const zfsdjyPosition = () => import('../views/yunnan/ZfsdjyPositionView.vue')
const zfsdjyTrades = () => import('../views/yunnan/ZfsdjyTradesView.vue')
const tradeCalendar = () => import('../views/TradeCalendarView.vue')
const dayAheadReport = () => import('../views/DayAheadReportView.vue')
const dayAheadEnergy = () => import('../views/DayAheadEnergyView.vue')
const interProvincial = () => import('../views/yunnan/InterProvincialView.vue')
const windSolarInvestment = () => import('../views/WindSolarInvestmentView.vue')
const truckChargingInvestment = () => import('../views/TruckChargingInvestmentView.vue')
const retailPriceCalculator = () => import('../views/RetailPriceCalculatorView.vue')
const interprovincialPriceCalculator = () => import('../views/InterprovincialPriceCalculatorView.vue')
const operationsWorkbench = () => import('../views/OperationsWorkbenchView.vue')
const importHub = () => import('../views/ImportHubView.vue')
const dataBrowser = () => import('../views/UniversalCapturedBrowserView.vue')
const dataIngestion = () => import('../views/DataIngestionView.vue')
const dataOnboarding = () => import('../views/DataOnboardingView.vue')
const dataGovernance = () => import('../views/DataGovernanceView.vue')
const regionRules = () => import('../views/RegionRulesView.vue')
const regionalTradingHub = () => import('../views/RegionalTradingHubView.vue')
// 申报工作台（重写原现货决策台：对齐 D-1 真实申报动线，嵌入 declaration_prep 智能体图）
// 交易员一日作业台（v1.0 七步单页承载）：早间分析/晨检/放行清单/储能计划/决策日志五页已并入
// 本台七步面板；原「交易台」（四线并行首页）也已删除——其"我现在该干哪一步"的职责由本台
// 的线性七步 + 步进条完整取代（2026-08-11 用户拍板）。
const tradingDay = () => import('../views/trading/TradingDayView.vue')
// 交易台四条作业线的作业面：不进侧边栏，只从交易台深链进入（避免导航膨胀，
// 且它们本就是动线中的一步、不是独立功能模块）。
const spotDecisionDesk = () => import('../views/DeclarationDeskView.vue')
const approvalQueue = () => import('../views/ApprovalQueueView.vue')
const regionCalibrationDesk = () => import('../views/RegionDecisionDeskView.vue')
const exposureBoard = () => import('../views/ExposureBoardView.vue')
const spotMonitor = () => import('../views/SpotMonitorView.vue')
const reviewCenter = () => import('../views/ReviewCenterView.vue')
const platformDocs = () => import('../views/PlatformDocsView.vue')
// 预测中心把五个既有预测页面挂为一级 tab；原路由改 redirect 保持收藏链接。
const forecastCenter = () => import('../views/forecast/ForecastCenterView.vue')
const dataSourceSettings = () => import('../views/DataSourceSettingsView.vue')
const agentWorkbench = () => import('../views/AgentWorkbenchView.vue')
const strategicQA = () => import('../views/StrategicQAView.vue')
const declarationCheckup = () => import('../views/DeclarationCheckupView.vue')
const morningBrief = () => import('../views/MorningBriefView.vue')
const marketInsightCockpit = () => import('../views/MarketInsightCockpitView.vue')
const reportWorkshop = () => import('../views/strategy/ReportWorkshopView.vue')
const storageCopilot = () => import('../views/StorageCopilotView.vue')
const preSubmitCheck = () => import('../views/PreSubmitCheckView.vue')
const policyIntel = () => import('../views/PolicyIntelView.vue')
// 两个 tab 容器页：各 tab 的子 View 由容器自身 defineAsyncComponent 懒加载，路由层不再单独登记。
const aiStudio = () => import('../views/AiStudioView.vue')
const accounts = () => import('../views/AccountsView.vue')
const companyProfile = () => import('../views/company/CompanyProfileView.vue')
const companyOverview = () => import('../views/company/CompanyOverviewView.vue')
const companyAssets = () => import('../views/company/CompanyAssetsView.vue')
const companyOutput = () => import('../views/company/CompanyOutputView.vue')
const companyTrades = () => import('../views/company/CompanyTradesView.vue')
const companyContracts = () => import('../views/company/CompanyContractsView.vue')
const riskCenter = () => import('../views/RiskCenterView.vue')

type PageMeta = {
  block: string
  title: string
  code: string
  endpoint: string
  dataPath: string
  scope?: string
  kind?: 'real' | 'mixed' | 'forecast'
  note?: string
  cfg?: any
  suiteDomain?: string
  regionIds?: string[]
}
const page = (path: string, name: string, meta: PageMeta, component: any = placeholder) => ({
  path,
  name,
  component,
  meta
})

// 历史预测回放页保持 ?tab= 语义，最终由预测中心的官方回放 tab 承载。
const hubRedirect = (path: string, tab: string): RouteRecordRaw => ({
  path,
  redirect: (to) => ({ path: '/ycsj/center', query: { ...to.query, mod: 'replay', tab } })
})

// 被「AI 工作室」/「用户与会话」tab 化收编的旧页面：路径保留为重定向，落到合并页对应 tab。
// 这些条目不进导航、不带 meta，因此不会出现在 feature-map / manifest 的页面清单里。
const aiStudioRedirect = (path: string, tab: string): RouteRecordRaw => ({
  path,
  redirect: (to) => ({ path: '/system/ai-studio', query: { ...to.query, tab } })
})

const accountsRedirect = (path: string, tab: string): RouteRecordRaw => ({
  path,
  redirect: (to) => ({ path: '/system/accounts', query: { ...to.query, tab } })
})

// 「数据源接入」tab 化收编的旧页面：路径保留为重定向，落到合并页对应 tab（#1896）。
const dataSourceSettingsRedirect = (path: string, tab: string): RouteRecordRaw => ({
  path,
  redirect: (to) => ({ path: '/data-source-settings', query: { ...to.query, tab } })
})

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: DEMO_PAGES_ENABLED ? '/demo/cgn-new-energy' : '/dashboard' },
    { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue') },

    // ── /demo/* 驾驶舱风格展示页(顶层全屏、隔离、不进侧边栏;守卫已放行)──
    // 冻结下架（简化 IA·PR-A）：整组由 VITE_ENABLE_DEMO_PAGES 门控、默认关闭；代码保留，需要演示时置 1 恢复。
    // 一键切换 6 套风格(暗:霓虹/玻璃/HUD,暖:暖纸/瑞士/柔彩)× 总览/AI 两视图。
    // 支持 ?style=&view= 深链,如 /demo/showcase?style=paper&view=ai
    ...(DEMO_PAGES_ENABLED
      ? [
          { path: '/demo/showcase', name: 'DemoStyleShowcase', component: () => import('../views/demo/showcase/StyleShowcase.vue') },
          // Artifact 渲染样例页（预览 / 回归核对，免登录）
          { path: '/demo/artifacts', name: 'DemoArtifacts', component: () => import('../views/demo/ArtifactShowcaseView.vue') },
          // 「质朴的未来」系列独立展示页:天工(多智能体协作)等 × 总览/协作两视图。
          // 支持 ?style=&view= 深链,如 /demo/atelier?style=tiangong&view=ai
          { path: '/demo/atelier', name: 'DemoAtelier', component: () => import('../views/demo/atelier/AtelierShowcase.vue') },
          // 中广核新能源品牌展示页：公开、隔离，用于公司介绍和视频背景组件验收。
          { path: '/demo/cgn-new-energy', name: 'DemoCgnNewEnergyBrand', component: () => import('../views/demo/company/CgnNewEnergyBrandView.vue') },
          { path: '/demo/cgn-yunnan', name: 'DemoCgnYunnanIntro', component: () => import('../views/demo/company/CgnYunnanIntroView.vue') },
          { path: '/demo/spot-quant-trading', name: 'DemoSpotQuantTradingIntro', component: () => import('../views/demo/company/SpotQuantTradingIntroView.vue') }
        ]
      : []),

    {
      path: '/',
      component: () => import('../layout/AppLayout.vue'),
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('../views/TradingCockpitView.vue'),
          meta: { block: '首页', title: '交易驾驶舱', code: 'cockpit', endpoint: 'local + /api/real + /agent-api/agent', dataPath: 'sdpt_zcqxhdl/knn-api', kind: 'mixed' }
        },
        {
          // 「市场概览」已并入「市场洞察驾驶舱」（embedded HomeConsoleView），独立页改 redirect 保深链/收藏可达。
          path: 'dashboard/classic',
          redirect: '/insight/cockpit'
        },
        accountsRedirect('system/permissions', 'permissions'),
        // AI 工作室：技能/子智能体/Dify 工作流/高级编排/定时任务五页 tab 化合并（ADMIN-only）。
        page('system/ai-studio', 'SystemAiStudio', { block: '系统管理', title: 'AI 工作室', code: 'system-ai-studio', endpoint: '/agent-api/agent/{skills,sub-agents,graphs,schedules}/* + /dify-sso/session + ANY /dify-studio/*', dataPath: 'schedules_sqlite,dify,llm', scope: '技能(SKILL.md 增删改启停)/子智能体(CRUD 导入导出归属绑定)/Dify 原生 Studio 同源嵌入/LangGraph 画布编排/定时任务调度五 tab;任务产出真实落盘报告,画布数据为分析示意', kind: 'mixed' }, aiStudio),
        // 用户与会话：账号目录与登录会话两页 tab 化合并（ADMIN-only，原 /system/sessions 随之收紧）。
        page('system/accounts', 'SystemAccounts', { block: '系统管理', title: '用户与会话', code: 'system-accounts', endpoint: 'GET/POST/PATCH /api/auth/users + GET/DELETE /api/auth/sessions', dataPath: 'auth_sqlite', scope: '账号、角色、状态、数据域和密码重置 + 登录会话、撤销和审计日志两 tab', kind: 'real' }, accounts),
        accountsRedirect('system/users', 'users'),
        accountsRedirect('system/sessions', 'sessions'),
        aiStudioRedirect('system/schedules', 'schedules'),

        // 公司管理（多租户）：公司专属业务数据，按 companyId 隔离，走 /api/company/*（真实录入/导入，非 Mock）。
        page('gsgl/overview', 'CompanyOverview', { block: '公司管理', title: '经营总览大屏', code: 'company-overview', endpoint: 'GET /api/company/dashboard', dataPath: 'company_sqlite', scope: '公司级发电/交易/金融指标全局总览（按 RBAC+subjectType+companyId 过滤）', kind: 'mixed' }, companyOverview),
        page('gsgl/profile', 'CompanyProfile', { block: '公司管理', title: '公司档案', code: 'company-profile', endpoint: 'GET/POST /api/company/profile + /api/company/list', dataPath: 'company_sqlite', scope: '公司档案、当前公司切换、可见公司列表', kind: 'real' }, companyProfile),
        page('gsgl/assets', 'CompanyAssets', { block: '公司管理', title: '场站机组台账', code: 'company-assets', endpoint: 'GET/POST/PATCH/DELETE /api/company/stations|units', dataPath: 'company_sqlite', scope: '本公司场站与机组台账（导入/手动维护）', kind: 'real' }, companyAssets),
        page('gsgl/output', 'CompanyOutput', { block: '公司管理', title: '机组出力', code: 'company-output', endpoint: 'GET/POST /api/company/unit-output', dataPath: 'company_sqlite', scope: '本公司机组出力时序（96点，导入/手动）', kind: 'real' }, companyOutput),
        page('gsgl/trades', 'CompanyTrades', { block: '公司管理', title: '历史交易', code: 'company-trades', endpoint: 'GET/POST/PATCH/DELETE /api/company/trades', dataPath: 'company_sqlite', scope: '本公司历史交易记录（导入/手动维护）', kind: 'real' }, companyTrades),
        page('gsgl/contracts', 'CompanyContracts', { block: '公司管理', title: '合同管理', code: 'company-contracts', endpoint: 'GET/POST/PATCH/DELETE /api/company/contracts', dataPath: 'company_sqlite', scope: '本公司中长期合同全生命周期（含交易明细，导入/手动维护）', kind: 'real' }, companyContracts),

        ...(YUNNAN_TRADING_FEATURE_ENABLED ? yunnanTradingRoutes : []),
        ...(REPORTS_FEATURE_ENABLED ? reportsRoutes : []),
        ...(GRID_GEO_FEATURE_ENABLED ? gridGeoRoutes : []),

        // 现货决策台 + 地区现货概览（原“地区交易”并入现货交易；南网/国网通用底座降为概览页内切换）
        // 原「交易台」四线并行首页已删（一日作业台取代）；深链重定向保留
        { path: '/xhjy/trading-desk', redirect: '/xhjy/trading-day' },
        page('xhjy/trading-day', 'TradingDay', { block: '现货交易', title: '交易员一日作业台', code: 'trading-day', endpoint: 'local trading-rules + GET/POST /api/v1/trading/spot/declarations + POST /:id/preflight', dataPath: 'local_rules/spot_declarations', scope: 'v1.0 日常运营七步单页: S1晨会复盘→S2早间分析(基本面→供需比→市场判断,八源验签折叠块)→S3方向判断(R4偏置→申报曲线)→S4申报执行(放行清单T4+储能计划R1/R2/R3/R11+状态机)→S5出清分析→S6中长期补仓→S7日报收尾(决策日志T7哈希链); 各步产出经 preflight 七段写回串成一条链, 步骤切换只发生在页内; 规则真算, 价格/基本面序列由使用者给定不编造', kind: 'mixed' }, tradingDay),
        // 旧五页已并入交易员一日作业台（trading-day）的对应步：深链保留、内容重定向
        { path: '/xhjy/market-analysis', redirect: '/xhjy/trading-day?stage=market-analysis' },
        { path: '/xhjy/morning-check', redirect: '/xhjy/trading-day?stage=market-analysis' },
        { path: '/xhjy/release-gate', redirect: '/xhjy/trading-day?stage=declare' },
        { path: '/xhjy/storage-plan', redirect: '/xhjy/trading-day?stage=declare' },
        { path: '/xhjy/decision-log', redirect: '/xhjy/trading-day?stage=daily-close' },
        page('xhjy/desk', 'DeclarationDesk', { block: '现货交易', title: '申报工作台', code: 'declaration-desk', endpoint: '/api/v1/trading/spot/declarations + /api/real + /agent-api/agent/*', dataPath: 'spot_declarations/knn-api', scope: 'D-1申报动线: 草稿→风控检查→审批→提交回执→出清跟踪(申报单状态机驱动)', kind: 'mixed' }, spotDecisionDesk),
        page('xhjy/approvals', 'ApprovalQueue', { block: '现货交易', title: '申报审批队列', code: 'approval-queue', endpoint: 'GET/POST /api/v1/trading/spot/declarations*', dataPath: 'spot_declarations', scope: '交易负责人/风控集中审批 PENDING_APPROVAL 申报单, approvalRecord 留痕', kind: 'real' }, approvalQueue),
        page('zcqjy/exposure', 'ExposureBoard', { block: '中长期交易', title: '中长期敞口看板', code: 'exposure-board', endpoint: 'POST /agent-api/agent/quant/exposure', dataPath: 'quant_direct', scope: '合同分解vs预计出力、逐时敞口、套保率、敞口热力、智能体解读', kind: 'mixed' }, exposureBoard),
        page('xhjy/monitor', 'SpotMonitor', { block: '现货交易', title: '实时监盘', code: 'spot-monitor', endpoint: 'POST /agent-api/agent/quant/monitor', dataPath: 'quant_direct', scope: 'D日动线: 实时vs日前价差、异动预警、AI异动解读(准实时/演示)', kind: 'mixed' }, spotMonitor),
        page('xhjy/review', 'ReviewCenter', { block: '现货交易', title: '复盘中心', code: 'review-center', endpoint: 'POST /agent-api/agent/quant/review + /settlement-review + GET /quant/reports(+/content) + GET /agent/review/template-instances 探针(#2039未上线则降级)', dataPath: 'quant_direct', scope: '六维复盘驾驶舱(#2033): 偏差率/风险事件指标卡、六维入口与31项模板注册表渲染、复盘待办箱(触发引擎上线前诚实空态)、偏差考核、申报回测、智能体复盘报告与历史列表', kind: 'mixed' }, reviewCenter),
        page('xhjy/risk-center', 'RiskCenter', { block: '现货交易', title: '风控阈值面板', code: 'risk-center', endpoint: 'POST /agent-api/agent/quant/{exposure,review,monitor} + /agent-api/agent/alerts', dataPath: 'quant_direct', scope: '聚合敞口/偏差/价差/告警四类越限，统一 riskThresholds 红黄绿判级', kind: 'mixed' }, riskCenter),
        // What-If 模拟器(/xhjy/simulator)与批处理任务(/xhjy/jobs)已随 #1799 删除：
        // 前者能力与复盘中心+敞口看板重叠且假设输入为示意；后者后端仅注册 batch_report/test 两个 handler，
        // 「根治 forecast 同步阻塞」的原目标从未落地，页面实为空架子。旧深链由 catchAll 落 /dashboard。
        page('xhjy/region', 'SpotRegionOverview', { block: '现货交易', title: '地区现货概览', code: 'spot-region-overview', endpoint: 'local regional trading registry', dataPath: 'local_region_trading', scope: '当前地区现货机制、价格画像、电源结构和通用底座', kind: 'mixed' }, regionalTradingHub),
        page('xhjy/calibration', 'RegionCalibrationDesk', { block: '智能实验室', title: '地区决策标定', code: 'region-calibration', endpoint: 'local regionStrategyAdvisor', dataPath: 'region_spot_profiles', scope: '策略适配评分、收益风险快测、地区参数校准与一键下发交易策略实验室/日前上报', kind: 'mixed' }, regionCalibrationDesk),

        // 中长期交易 /zcqjy
        page('zcqjy/zccljk', 'PositionMonitor', { block: '中长期交易', title: '持仓量监控', code: 'zccljk', endpoint: 'GET /sdpt/zfsdjy/ccljkDay|ccljkTime|list', dataPath: 'sdpt_zfsdjy', scope: '2026-06，39行', kind: 'real' }, zfsdjyPosition),
        page('zcqjy/zfsdjy', 'PeriodTrading', { block: '中长期交易', title: '分时段交易', code: 'zfsdjy', endpoint: 'GET /sdpt/zfsdjy/list', dataPath: 'sdpt_zfsdjy', kind: 'real' }, zfsdjyTrades),
        page('zcqjy/zjyap', 'TradeCalendar', { block: '中长期交易', title: '交易月历', code: 'zjyap', endpoint: 'GET /sdpt/zjyap/calendar', dataPath: 'sdpt_zjyap', scope: '28行', kind: 'real' }, tradeCalendar),

        // 现货交易 /xhjy
        page('xhjy/zrqsb', 'DayAheadReport', { block: '现货交易', title: '日前上报', code: 'zrqsb', endpoint: 'POST /sdpt/zrqsb/list', dataPath: 'sdpt_zrqsb', scope: '按天 2026-04-01~06-30 (真实 4/1~6/4)', kind: 'real', note: '返回对象 {jgc,jq,dl,cl,jg,xjfw,zcqjj,clqx,zxcl}' }, dayAheadReport),
        page('xhjy/zptqx', 'DayAheadEnergyEstimate', { block: '现货交易', title: '日前电量预估', code: 'zptqx-0', endpoint: 'GET /sdpt/zptqx/list?tag=0', dataPath: 'sdpt_zptqx', scope: 'tag0=65行(另存tag1/2/3)', kind: 'real', note: 'type4=预估电量，每行 total+p1..p96' }, dayAheadEnergy),
        // 交易策略实验室(/xhjy/trading-lab)已随 #1799 删除：页面自述「研究沙盘，输出不构成实盘申报依据」，
        // 实时价为按波动率推演的演示序列；Kelly/风险/敞口能力由风控阈值面板与敞口看板承接。
        // agent-backend 的 /api/v1/trading/{kelly,arbitrage,risk,twap,milp} 端点保留，工具化与可配置见 #1800。
        // 原“智能体编排分析”页仅做 supervisor 派工可视化，已由 /ai-agent 通用工作台承接；保留 redirect 兼容旧收藏。
        { path: 'xhjy/ai-orchestration', redirect: '/ai-agent' },
        // AI 编排三页随「AI 工作室」（/system/ai-studio）tab 化收敛：原「AI工作流中枢」是这几页的
        // 导航壳，tab 栏取代其职责后删除（其 Dify/工具桥状态展示已由各 tab 自身承载）。
        // 旧路径保留重定向落到对应 tab，外部书签与历史深链不失效。
        aiStudioRedirect('xhjy/ai-orchestration-studio', 'dify'),
        aiStudioRedirect('xhjy/dify-studio', 'dify'),
        aiStudioRedirect('xhjy/langgraph-studio', 'orchestration'),
        page('xhjy/morning-brief', 'MorningBrief', { block: '智能实验室', title: '交易晨报', code: 'morning-brief', endpoint: 'POST /agent-api/agent/sessions + /sessions/{id}/messages (SSE)', dataPath: 'llm', scope: '多智能体协同生成今日现货行情研判·交易策略·风险提示晨报;数据为分析示意,合成项显式标注', kind: 'mixed' }, morningBrief),
        page('gsgl/report-workshop', 'ReportWorkshop', { block: '公司管理', title: '报告工坊', code: 'report-workshop', endpoint: 'POST /dify-api/v1/workflows/run (Dify 工作流编排)', dataPath: 'dify', scope: '非技术人员自助构建报告工作流:选择模板→配置参数→生成图表报告;Dify离线自托管,社区100+模板可复用;Dify不可用时回退本地Mock模板', kind: 'mixed' }, reportWorkshop),
        page('xhjy/storage-copilot', 'StorageCopilot', { block: '智能实验室', title: '储能投资收益测算', code: 'storage-copilot', endpoint: 'POST /agent-api/v1/investment-assessment/runs + /intents/parse + /agent-api/agent/sessions + /sessions/{id}/messages (SSE)', dataPath: 'agent_backend', scope: '储能投资收益统一工作台:完整投资公式+套利/MILP调度+运行历史+智能体解释;示意/合成项显式标注', kind: 'mixed' }, storageCopilot),
        page('xhjy/presubmit-check', 'PreSubmitCheck', { block: '智能实验室', title: '申报前体检', code: 'presubmit-check', endpoint: 'POST /agent-api/agent/sessions + /sessions/{id}/messages (SSE)', dataPath: 'llm', scope: '申报前体检评分卡:合规预检+偏差考核风险+出清博弈推演,给 go/no-go 三维评分;数据为分析示意', kind: 'mixed' }, preSubmitCheck),
        page('xhjy/policy-intel', 'PolicyIntel', { block: '智能实验室', title: '政策情报官', code: 'policy-intel', endpoint: 'POST /agent-api/agent/sessions + /sessions/{id}/messages (SSE) + disclosure 工具', dataPath: 'llm', scope: '智能体汇集交易中心/国网/能源局披露与政策,按相关性打分并标注规则变更影响;数据为分析示意', kind: 'mixed' }, policyIntel),

        // 数据分析 /sjfx
        page('insight/cockpit', 'MarketInsightCockpit', { block: '数据分析', title: '市场洞察驾驶舱', code: 'market-insight-cockpit', endpoint: 'GET /agent-api/v1/market-insight/bundle + agent sessions (SSE)', dataPath: 'market_insight', scope: '市场快照/价格弹性/价差套利/节点热力/异动雷达 一屏确定性渲染 + AI 解读(选中即问)', kind: 'mixed' }, marketInsightCockpit),
        page('sjfx/singleZsjfx', 'DataAnalysis', { block: '数据分析', title: '数据分析', code: 'singleZsjfx', endpoint: 'POST /sdpt/zsjfx/singleData', dataPath: 'sdpt_zsjfx', scope: '91天×全63类型，每天 dataMap.series 60×96点', kind: 'mixed', note: '含实际值也含预测序列；63类型见 itemConfig' }, dataAnalysis),
        page('sjfx/zcqxhdl', 'ClearingSpotAnalysis', { block: '数据分析', title: '出清现货电量分析', code: 'zcqxhdl', endpoint: 'POST /sdpt/zcqxhdl/list (宽范围)', dataPath: 'sdpt_zcqxhdl', scope: '10序列×~65天(4/1~6/4)', kind: 'real' }, clearingSpotAnalysis),
        page('sjfx/zrxgx', 'PriceNewEnergyRelation', { block: '数据分析', title: '现货价格与新能源关系', code: 'zrxgx', endpoint: 'POST /sdpt/zcqxhdl/list24 (ts=回溯天数)', dataPath: 'sdpt_zcqxhdl', scope: '373天 2025-05~2026-06', kind: 'real', note: '{rqdj日前电价, xnyz/xnyg/xnyzd/xnygd, xd}' }, priceNewEnergyRelation),
        page('sjfx/zrxgx2', 'PriceSystemLoadRelation', { block: '数据分析', title: '现货价格与统调负荷关系', code: 'zrxgx2', endpoint: 'POST /sdpt/zcqxhdl/fhlist24', dataPath: 'sdpt_zcqxhdl', scope: '373天', kind: 'real' }, priceLoadRelation),
        page('sjfx/market-ops', 'MarketOperationsAnalysis', { block: '数据分析', title: '市场经营分析', code: 'market-analysis', endpoint: 'local marketAnalysis + planned /api/v1/market/* and /api/v1/market-analysis/*', dataPath: 'market_analysis', scope: '市场概览、发电侧、售电公司、独立储能、套餐分析、价格趋势迁移', kind: 'mixed' }, marketOperationsAnalysis),
        page('sjfx/fshq', 'TimeOfUseMarket', { block: '数据分析', title: '分时行情', code: 'fshq', endpoint: 'GET /sdpt/fshq/data?rqlx&bdrq&jyyf', dataPath: 'sdpt_fshq', scope: 'rqlx∈{0运行,1交易}×日期 2022-12~2026-06 (2563文件)', kind: 'real', note: 'jysd 参数后端忽略(无效维度)' }, fshq),
        page('sjfx/actualLoad', 'DailySystemLoad', { block: '数据分析', title: '逐日系统负荷实际值', code: 'actualLoad', endpoint: 'GET /sdpt/actualLoad/query', dataPath: 'sdpt_actualLoad', scope: '一次返回6年(2021-2026)×366天', kind: 'real', note: 'system(日历对齐)+misplace(错位)，pjz/zxz/zdz' }, dailySystemLoad),
        page('sjfx/zrsjg', 'PriceAnalysis', { block: '数据分析', title: '价格分析', code: 'zrsjg', endpoint: 'GET /sdpt/zcqxhdl/listrs?typeList[]&tag=0', dataPath: 'sdpt_zcqxhdl', scope: '1434天×2类型 2022-07~2026-06', kind: 'real', note: '{rjz,rmx,dmx}；数组参数需编码 %5B0%5D' }, priceAnalysis),
        page('sjfx/jieqi', 'SolarTerms', { block: '数据分析', title: '24节气', code: 'actualLoad2', endpoint: 'GET /sdpt/actualLoad/query2?xl', dataPath: 'sdpt_actualLoad', scope: '6年；xl=1节气详细 / xl=0日期汇总', kind: 'real' }, solarTerms),
        page('sjfx/elninolanina', 'ElNinoLaNina', { block: '数据分析', title: '厄尔尼诺拉尼娜', code: 'elninolanina', endpoint: 'GET /sdpt/elninolanina/list', dataPath: 'sdpt_elninolanina', scope: '77行(年)', kind: 'real', note: 'ENSO 指数 djf..ndj 12个滑动季' }, elNinoLaNina),
        page('sjfx/tqyb', 'WeatherForecast', { block: '数据分析', title: '天气预报', code: 'tqyb', endpoint: 'GET /weather/dayData|hourlyData|districtTree', dataPath: 'weather_dayData', scope: '11城市×15天日预报+24h时预报', kind: 'real', note: '气象台预报；11个山西地市 adcode' }, weatherForecast),

        // 预测数据 /ycsj  —— ⚠️ 预测值，数值不可信，仅参考格式
        page('ycsj/center', 'ForecastCenter', { block: '预测数据', title: '预测中心', code: 'forecast-center', endpoint: '聚合五模块同源接口（组件原样挂入，见各模块登记）', dataPath: 'sdpt_* 回放 + forecastProviders + agent_backend forecast 族', scope: '预测五页聚合单页: 官方回放、建模工作台、厂站预测、质量记分牌、申报决策；tab 按原路由权限过滤，?mod= 深链', kind: 'forecast' }, forecastCenter),
        { path: 'ycsj/hub', redirect: (to) => ({ path: '/ycsj/center', query: { ...to.query, mod: 'replay' } }) },
        { path: 'ycsj/workbench', redirect: (to) => ({ path: '/ycsj/center', query: { ...to.query, mod: 'bench' } }) },
        { path: 'ycsj/decision-cockpit', redirect: (to) => ({ path: '/ycsj/center', query: { ...to.query, mod: 'decide' } }) },
        { path: 'ycsj/station-generation', redirect: (to) => ({ path: '/ycsj/center', query: { ...to.query, mod: 'station' } }) },
        { path: 'ycsj/scoreboard', redirect: (to) => ({ path: '/ycsj/center', query: { ...to.query, mod: 'score' } }) },
        // 原「ML 预测实验室」已并入建模工作台，继续保留旧收藏路径。
        { path: 'ycsj/lab', redirect: '/ycsj/workbench' },
        // SP-4a：9 个预测单页收口为「预测数据回放」hub 多 tab，单页从菜单移除但保留 redirect 保深链/收藏可达。
        // pricePrediction/jgyc/gsfhyc/gscwfh/zgnrxqxyc/jjkj/rqhdcl → 对应 tab；zxztqa/zgnrx → hub 合并的「新能源出力预测」tab（预选模型 A/B）。
        hubRedirect('ycsj/pricePrediction', 'pricePrediction'),
        hubRedirect('ycsj/jgyc', 'jgyc'),
        hubRedirect('ycsj/gsfhyc', 'gsfhyc'),
        hubRedirect('ycsj/gscwfh', 'gscwfh'),
        hubRedirect('ycsj/zxztqa', 'zxztqa'),
        hubRedirect('ycsj/zgnrx', 'zgnrx'),
        hubRedirect('ycsj/zgnrxqxyc', 'zgnrxqxyc'),
        hubRedirect('ycsj/jjkj', 'jjkj'),
        hubRedirect('ycsj/rqhdcl', 'rqhdcl'),

        // 省间现货 /sjxh
        page('sjxh/zjzzt', 'InterProvincialPlan', { block: '省间现货', title: '省间中长期交易电量计划', code: 'zptjg-92', endpoint: 'GET /sdpt/zptjg/list?tag=92', dataPath: 'sdpt_zptjg', scope: '699条 type92 2024-08~2026-06', kind: 'real', note: 'zptjg/list 必填 areaId=1' }, interProvincial),

        // 投资测算 /tzcs
        page('tzcs/wind-solar', 'WindSolarInvestment', { block: '投资测算', title: '新能源资产测算', code: 'wind-solar', endpoint: 'local windSolar（legacy /api/v1/investment-calculator/*，新聚合走 /api/v1/investment-assessment/runs）', dataPath: 'wind_solar_calculator', scope: '风电/光伏 LCOE、IRR、融资、折旧、税费、现金流、敏感性分析迁移', kind: 'mixed' }, windSolarInvestment),
        { path: 'tzcs/storage', redirect: '/xhjy/storage-copilot?mode=calculator' },
        page('tzcs/truck-charging', 'TruckChargingInvestment', { block: '投资测算', title: '重卡充换电测算', code: 'truck-charging', endpoint: 'local truckCharging（legacy /api/v1/investment-calculator/truck-sensitivity-analysis，新聚合走 /api/v1/investment-assessment/runs）', dataPath: 'truck_charging_calculator', scope: '重卡运输、充电站、一体化投资、挂靠/外委/混合模式、多段线路和资本金现金流迁移', kind: 'mixed' }, truckChargingInvestment),

        // 电价测算 /djcs
        page('djcs/retail-price', 'RetailPriceCalculator', { block: '电价测算', title: '售电电价测算', code: 'retail-price', endpoint: 'local retailPrice + planned price calculator suite', dataPath: 'pricing_calculators', scope: '省内电价、分时电价、售电套餐、国网代购电价核心逻辑迁移', kind: 'mixed' }, retailPriceCalculator),
        page('djcs/interprovincial-price', 'InterprovincialPriceCalculator', { block: '电价测算', title: '跨省跨区电价', code: 'interprovincial-price', endpoint: 'local interprovincialPrice + planned price calculator suite', dataPath: 'interprovincial_price_calculator', scope: '跨省跨区上网价到落地价、落地价反推上网价核心逻辑迁移', kind: 'mixed' }, interprovincialPriceCalculator),

        // 运营管理 /yygl
        page('yygl/ops', 'OperationsWorkbench', { block: '运营管理', title: '运营中枢', code: 'operations', endpoint: 'local operations + planned /api/v1/stations|contracts|settlements|risks|statistics|retail-settlement-import|model-config|agents', dataPath: 'operations_backend', scope: '电站、合同、结算、风险、统计、数据导入、模型配置、智能体监控运营面迁移', kind: 'mixed' }, operationsWorkbench),
        page('yygl/data-onboarding', 'DataOnboarding', { block: '数据管理', title: '数据接入向导', code: 'data-onboarding', endpoint: 'GET /api/v1/governance/catalog + /api/v1/import-templates/records + POST /api/v1/ingest/:kind', dataPath: 'governance_catalog + import_records + capture_sqlite', scope: '六类数据（现货节点电价T0/系统负荷水电T0T1/交易中心月度导出包/南网披露Cookie/气象全自动/结算零售交易）接入旅程总览：输入→校验→落位→生效→见数一键闭环', kind: 'real' }, dataOnboarding),
        page('yygl/import-hub', 'ImportHub', { block: '数据管理', title: '数据导入融合台', code: 'import-hub', endpoint: 'local importHub + planned /api/v1/power/import|market/packages/retail/import|settlements/import|retail-settlement-import/upload|market/trades/import', dataPath: 'import_workflows', scope: '电量、零售套餐、结算、售电结算、市场交易导入迁移', kind: 'mixed' }, importHub),
        page('yygl/data-browser', 'DataBrowser', { block: '数据管理', title: '通用数据浏览器', code: 'data-browser', endpoint: 'GET /api/real?family=&match=&region=', dataPath: '*', scope: '任意已注册数据族归一化真实回放数据，动态列展示+筛选+CSV导出', kind: 'mixed' }, dataBrowser),
        page('yygl/data-governance', 'DataGovernance', { block: '数据管理', title: '数据治理控制台', code: 'data-governance', endpoint: 'GET /api/v1/governance/{catalog,quality,backup}', dataPath: 'capture_sqlite + data/private/governance/quality-report.json + data/private-backups', scope: '数据资产目录、新鲜度、质量报告和备份 manifest 只读聚合；按 x-region-id 限定地区', kind: 'real' }, dataGovernance),
        page('yygl/ingest', 'DataIngestion', { block: '数据管理', title: '数据摄取管理', code: 'ingest', endpoint: 'POST /api/v1/ingest/:kind', dataPath: 'capture_sqlite', scope: '触发 ETL 摄取(云南现货/气象/市场经营分析) 落 capture-raw+capture.sqlite', kind: 'mixed' }, dataIngestion),

        // 售电资料 /sdzl
        page('sdzl/region-rules', 'RegionRules', { block: '售电资料', title: '地区规则体系', code: 'region-rules', endpoint: 'local region rules', dataPath: 'local_rules', scope: '地区规则画像 + 主体角色关注矩阵', kind: 'real' }, regionRules),
        page('sdzl/zptwd', 'PlatformDocuments', { block: '售电资料', title: '交易平台文档', code: 'zptwd-0', endpoint: 'GET /sdpt/zptwd/list + 文件下载', dataPath: 'sdpt_zptwd', scope: '列表32条(取10) + 10个文件', kind: 'real', note: '下载基址 /prod-api+downloadPath；files/ 有10个文档' }, platformDocs),

        // AI 模型设置（从 AI 导航助手进入，不在左侧菜单）
        aiStudioRedirect('ai-settings', 'models'),
        page('data-source-settings', 'DataSourceSettings', { block: '系统', title: '数据源接入', code: 'data-source-settings', endpoint: 'GET /api/v1/grid-access/points; GET|PUT|DELETE /api/v1/grid-access/points/{id}/credentials + /api/v1/data-sources/cgn-yunnan + /api/v1/sichuan-ingest; POST */test + */trigger; GET */plant-bindings + */health', dataPath: 'data/private/credentials + external_sc.ingest_run + load_forecast + reservoir_plan', scope: '电网官方平台（接入点凭据按账号隔离 + 四川采集运维）+ 企业自建通道（中广核云南）+ 受控 Provider；仅服务端掩码存储，整页 ADMIN/BOSS', kind: 'real' }, dataSourceSettings),
        dataSourceSettingsRedirect('sichuan-access', 'official'),
        // 智能体工作台（交互式 Agent 对话，后端 /api/agent/* SSE）
        page('ai-agent', 'AgentWorkbench', { block: '系统', title: '智能体工作台', code: 'ai-agent', endpoint: '/agent-api/agent/*', dataPath: '', kind: 'real' }, agentWorkbench),
        // 战略问答 PoC（#1526）：pi harness 旗舰切片，后端 integrations/pi-poc（/pi-api → 8100）
        page('strategic-qa', 'StrategicQA', { block: '系统', title: '战略问答', code: 'strategic-qa', endpoint: '/pi-api/agent/*', dataPath: '', scope: 'pi PoC：取数走 /api/v1/spot 只读权威面；查不到的数据如实报缺口', kind: 'real' }, strategicQA),
        // 申报体检 PoC（#1527）：pi 第二切片——沙箱实算体检 + 审批卡落库申报台（submit 永不可执行）
        page('declaration-checkup', 'DeclarationCheckup', { block: '系统', title: '申报体检', code: 'declaration-checkup', endpoint: '/pi-api/agent/*', dataPath: '', scope: 'pi PoC：体检沙箱实算；落库申报台 DRAFT 经人工审批；对外提交硬禁', kind: 'real' }, declarationCheckup),
        // 技能工作室 / 子智能体工作室随「AI 工作室」tab 化收编，旧路径保留重定向。
        aiStudioRedirect('ai-skills', 'skills'),
        aiStudioRedirect('ai-sub-agents', 'sub-agents')
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
  ]
})

// 原仓仍负责路由实例化；三个业务边界包只提供静态归属与迁移出口，

// 路由切换进度条：懒加载 chunk / 守卫耗时期间给出顶部进度反馈
router.beforeEach((to, from) => {
  if (to.path !== from.path) startRouteProgress()
  return true
})
router.afterEach((to, from) => {
  finishRouteProgress()
  // 无权限记账（capture 私有族 401/403）按页清账：新页面取数会重新记账，
  // 避免上一页的拒绝横幅跨页粘滞（Sub-4 #520，roborev job144/145）。
  if (to.path !== from.path) resetCaptureAccessDenied()
})
router.onError(() => finishRouteProgress())

router.beforeEach((to) => {
  if (to.path.startsWith('/demo')) return true // 驾驶舱风格展示页:公开、隔离
  if (to.path !== '/login' && !getToken()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/login' && getToken()) {
    return '/dashboard'
  }
  if (to.path !== '/login') {
    const user = getCurrentUser()
    const regionId = getCurrentRegionSnapshot().id
    const routeRegionIds = to.matched.flatMap((record) => {
      const ids = record.meta.regionIds
      return Array.isArray(ids) ? ids.map(String) : []
    })
    const routeMatchesRegion = !routeRegionIds.length || routeRegionIds.includes(regionId)
    const pathMatchesRegion = isPathAvailableInRegion(to.path, regionId)

    if (!routeMatchesRegion || !pathMatchesRegion) {
      return canAccessPath('/sdzl/region-rules', user) ? '/sdzl/region-rules' : firstAccessiblePath(user, regionId)
    }
    if (!canAccessPath(to.path, user)) {
      return firstAccessiblePath(user, regionId)
    }
  }
  return true
})

export default router
