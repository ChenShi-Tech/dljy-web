// ============================================================================
// pageHelp.ts — 全站页面核心说明注册表（Issue #848）
// ----------------------------------------------------------------------------
// 以 src/router/index.ts 及各 features/*/routes.ts 的「路由 name」为 key，
// 由 src/components/common/PageHelpTip.vue 在 AppLayout 顶栏按当前路由 name
// 查表渲染「?」悬浮卡。注册表无该 key 时不渲染（渐进覆盖，不硬造）。
//
// 内容撰写纪律（红线，守卫 verify:page-help 不校验语义、人工逐条自查）：
//   1. kind:'forecast' 路由必含「预测数值仅供参考/演示，不作为交易依据」。
//   2. Mock/演示数据页必含「模拟/演示数据」；带 basis 标注页说明真实/合成来源。
//   3. 不得暗示未接真实数据的功能「已接真实」；不写「实时行情」等夸大表述。
//   4. 申报/交易决策页（驾驶舱/申报建议/复盘/模拟器）必含「决策支持，非投资建议；
//      以正式结算口径为准」。
//   5. docPath 只填 docs/ 下真实存在的文档路径（守卫校验文件存在性），没有就不填。
//
// 取材来源：docs/reference/business-logic-inventory.md（逐页业务逻辑清单）
// + 各路由 meta.scope/endpoint/kind/note（self-documenting）。新增页面讲解
// 请先读对应 view 源码与 inventory 条目，不得凭路由名想象。
// ============================================================================

export interface PageHelpEntry {
  /** 悬浮卡标题，一般取路由 meta.title */
  title: string
  /** 正文 80-200 字：该页是什么 / 核心看什么 / 数据从哪来（含红线标注） */
  body: string
  /** 「详细文档」链接，指向 docs/ 下真实存在的 markdown（相对仓库根，可省略） */
  docPath?: string
}

/** key = 路由 name（RouteRecordRaw['name']） */
export const pageHelpRegistry: Record<string, PageHelpEntry> = {
  // ── 首页 ──────────────────────────────────────────────────────────────────
  Dashboard: {
    title: '交易驾驶舱',
    body: '登录后默认首页。中广核云南集团账号的实时价格主图与节点价模块固定读取厂侧私有 PostgreSQL 日前/实时数据，60s 自动刷新，页面标注非电网官方接口、完整性与新鲜度；公司/地区不匹配或 PG 异常时诚实报错，不回落公共行情或演示价。结算、损益、预测与智能体区块仍按各自来源单独标注。属决策支持视图，非投资建议；数值以正式结算口径为准。',
    docPath: 'docs/data/spot-cockpit.md'
  },

  // ── 公司管理（多租户公司专属业务数据，按 companyId 隔离） ──────────────────
  CompanyOverview: {
    title: '经营总览大屏',
    body: '公司级发电/交易/金融指标全局总览大屏。控制条支持公司切换、5 档时间尺度与日期范围，KPI 行展示总装机/累计发电/新能源占比/利用小时/累计交易量/成交额及 VaR，配发电趋势、装机结构、交易量价、成交额四图。数据按 RBAC+subjectType+companyId 过滤，来自 /api/company/dashboard；当前为演示数据（结构化合成种子，页面标注 source 徽章），非市场回放。可导出 Excel。',
    docPath: 'docs/data/region-company-structure.md'
  },
  CompanyProfile: {
    title: '公司档案',
    body: '维护本公司档案信息（联系人/办公地址/经营范围）并查看可见公司列表（区分集团与公司层级）。数据经 /api/company/profile 读写，落 company_sqlite；按授权公司集合隔离。仅公司管理员（hasCompanyAdmin）可编辑，其余只读。为真实录入数据（导入/手动维护），非 Mock。',
    docPath: 'docs/data/region-company-structure.md'
  },
  CompanyAssets: {
    title: '场站机组台账',
    body: '本公司场站与机组台账（导入/手动维护）：场站类型×装机、省份装机、类型容量三图 + 场站台账/机组台账两个 tab 表格（含容量汇总、来源 IMPORT/MANUAL 标注）。数据经 /api/company/stations|units CRUD，落 company_sqlite，按公司隔离。为真实录入数据，支持导入与增删改（需管理员权限）。'
  },
  CompanyOutput: {
    title: '机组出力',
    body: '本公司机组出力时序（96 点/15 分钟）：选机组+日期加载日内出力曲线（峰平谷标区、额定线/日均线、峰谷标记），支持批量粘贴 96 值录入与 CSV 导出，并可作为导入基线。数据经 /api/company/unit-output 读写，落 company_sqlite。为真实录入数据（手动/导入），非市场回放。',
    docPath: 'docs/data/plant-export-derived-families.md'
  },
  CompanyTrades: {
    title: '历史交易',
    body: '本公司历史交易记录（导入/手动维护）：价格走势多折线、买卖净仓位按月双向柱两图 + 交易明细表（日期/合同/对手方/方向/量价/状态/来源，含买卖量与均价汇总）。数据经 /api/company/trades CRUD，落 company_sqlite，按公司隔离。为真实录入数据，支持 CSV 批量导入与导出（可往返）。'
  },
  CompanyContracts: {
    title: '合同管理',
    body: '本公司中长期合同全生命周期：5 统计卡（总数/执行中/即将到期/已逾期/合同电量）+ 到期预警 + 合同明细表（含已执行进度与偏差、结算预览、关联交易）+ 交易明细动态行。已执行量/成交笔数为后端按合同号关联交易聚合的只读派生字段。数据经 /api/company/contracts CRUD，落 company_sqlite。为真实录入数据，支持 CSV 导入导出。'
  },

  // ── 现货交易 ────────────────────────────────────────────────────────────
  DeclarationDesk: {
    title: '申报工作台',
    body: 'D-1 申报动线主工作台：顶部 4 步步骤条（草稿与策略→风控与审批→提交与回执→出清跟踪，由申报单状态机驱动）+ 10:30 截止倒计时；主区左侧情报区（目标日价格预测曲线+申报前情报+智能体起草），右侧申报单工作流（24h 功率编辑柱、批量段、风控检查、送审/审批/提交/回执/出清跟踪按状态条件渲染）。价格预测经 /api/real 回放、申报单状态机经 /api/v1/trading/spot/declarations。回执为 MOCK 网关标注、非真实申报。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/agent-harness/declaration-prep-performance.md'
  },
  ApprovalQueue: {
    title: '申报审批队列',
    body: '交易负责人/风控集中审批 PENDING_APPROVAL 申报单：待审批卡片区（申报单 id/状态/决策门档位/目标日/截止倒计时/申报总量/风控检查列表 PASS/FAIL/UNAVAILABLE + 批准/驳回/去申报台）+ 近期审批记录表。审批意见经 approvalRecord 留痕，30s 轮询刷新，驳回二次确认不可逆。数据经 /api/v1/trading/spot/declarations，落 spot_declarations，为真实状态机数据。'
  },
  SpotMonitor: {
    title: '实时监盘',
    body: 'D 日动线监盘：日前/实时折线 + 价差柱 + 异动列表 + 峰谷统计 + 智能体解读，支持立即刷新和 60s 自动刷新。云南固定读取中广核云南厂侧私有 PostgreSQL（优先原生 15m，非电网官方接口），仅 comp-cgn-yunnan 集团账号在 yunnan 地区可用；查询主体固定为 GENERATOR-YN-CGN，失败不回落公共或演示电价。其他地区继续按各自数据路由。',
    docPath: 'docs/guide/how-to/monitor.md'
  },
  ReviewCenter: {
    title: '复盘中心',
    body: 'D+1 动线复盘：96 点偏差图（申报/实际折线+受考核电量柱）+ 偏差考核/申报回测/结算对账三数字卡 + 智能体复盘一键生成 daily_review 报告与历史列表。可从申报台④步深链带入申报单作回测基准。容差/考核价取当前地区结算规则 SettlementRuleSpec，结算对账按月拉 /api/v1/settlements。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/agent-harness/market-tools-and-agent-dispatch.md'
  },
  RiskCenter: {
    title: '风控阈值面板',
    body: '聚合敞口/偏差/价差/告警四类越限，统一 riskThresholds 红黄绿判级的一站式风控视图。数据来自 /agent-api/agent/quant/{exposure,review,monitor} 与 /agent-api/agent/alerts。用于跨维度快速识别当前风险敞口与越限项。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/features/risk-center-and-simulator.md'
  },
  SpotRegionOverview: {
    title: '地区现货概览',
    body: '当前地区现货机制总览：Hero 区标签（通用交易版/当前地区、规则状态、当前角色）+ 三切换卡（当前地区现货档案 / 南网通用 / 国网通用）+ 现货档案（市场机制条+价格行为+电源结构）+ 当前地区专属模块卡 + 全国覆盖概览 + 规则交易底座 + 当前身份关注。纯本地读 regions/regionSpotProfiles/rules/regionModules，按 region+RBAC 过滤。',
    docPath: 'docs/region/region-binding-architecture.md'
  },
  DayAheadReport: {
    title: '日前上报',
    body: '日前上报数据回放：按天查看日前上报序列（结算/均价/电量/出力/价格/细节等 8 类对象），表格 + 96 点曲线。数据来自 POST /sdpt/zrqsb/list，回放 sdpt_zrqsb，覆盖 2026-04-01~06-30。为真实采集回放数据。⚠️ 采集快照拍于 2026-06-03，故 2026-06-05~06-30 共 26 天在平台侧仍属「未来日」、无申报电量（下拉已标注）。sdpt_zrqsb 是三德普华公司私有族，仅山西可用。',
    docPath: 'docs/data/family-visibility-inventory.md'
  },
  DayAheadEnergyEstimate: {
    title: '日前电量预估',
    body: '日前电量预估回放：type4=预估电量，每行含 total + p1..p96 共 96 个 15 分钟点。数据来自 GET /sdpt/zptqx/list?tag=0，回放 sdpt_zptqx（tag0=65 行，另存 tag1/2/3）。为真实采集回放数据，属本公司私有数据（需归属公司账号或管理员）。',
    docPath: 'docs/data/yunnan-parquet-derive.md'
  },

  // ── 中长期交易 ──────────────────────────────────────────────────────────
  ExposureBoard: {
    title: '中长期敞口看板',
    body: '合同分解 vs 预计出力的逐时敞口看板：4 KPI（套保率/净卖出敞口/净买入敞口/日均合同电量）+ 主图（合同分解 vs 预计出力双线 + gap 柱正负着色）+ 日×小时敞口热力图 + 智能体解读。支持三种分解模式（峰谷结构/均匀/光伏镜像）与两种对比口径。数据来自 /agent-api/agent/quant/exposure 确定性引擎，合成项显式标注。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/features/exposure-board.md'
  },
  PositionMonitor: {
    title: '持仓量监控',
    body: '中长期持仓量监控回放：序列分类展示（均价/合计/预估等按名归类折线/堆叠柱），日维度序列名去日期前缀。数据来自 /sdpt/zfsdjy/ccljkDay|ccljkTime，回放 sdpt_zfsdjy（2026-06，39 行）。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-actualload-derive.md'
  },
  PeriodTrading: {
    title: '分时段交易',
    body: '分时段交易回放：分时段成交数据表格与图表。数据来自 GET /sdpt/zfsdjy/list，回放 sdpt_zfsdjy。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-actualload-derive.md'
  },
  TradeCalendar: {
    title: '交易月历',
    body: '交易月历回放：按日历查看交易日历安排。数据来自 GET /sdpt/zjyap/calendar，回放 sdpt_zjyap（28 行）。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-actualload-derive.md'
  },

  // ── 智能实验室（决策标定 + 智能体策略） ──────────────────────────────────
  RegionCalibrationDesk: {
    title: '地区决策标定',
    body: '基于地区现货画像的策略标定台：三面板——策略适配评分（按主体类型 trader/容量/合约覆盖/有无储能）、收益/风险快测、地区参数校准，可一键下发到日前上报或申报工作台。数据来自本地 regionSpotProfiles 与 regionStrategyAdvisor。市场未启动地区显空态引导。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/agent-harness/lab-quant-correctness.md'
  },
  MorningBrief: {
    title: '交易晨报',
    body: '多智能体协同生成的今日现货行情研判·交易策略·风险提示晨报：选日期→生成晨报→AgentChatPanel 流式输出三段式（行情研判/交易策略/风险提示）+ 子智能体冒泡 + 数据口径角标。经白名单 prompt key 走服务端固定 supervisor 提示，后端零改动。数据为分析示意，合成项显式标注。',
    docPath: 'docs/agent-harness/morning-brief-deterministic-redesign.md'
  },
  ReportWorkshop: {
    title: '报告工坊',
    body: '非技术人员自助构建报告工作流：选择模板→配置参数→生成图表报告。经 Dify 工作流编排（POST /dify-api/v1/workflows/run），Dify 离线自托管、社区 100+ 模板可复用；Dify 不可用时回退本地 Mock 模板。当前为混合口径：模板区块基于合成场景，Dify 状态决定真实/Mock。',
    docPath: 'docs/dify/dify-end-to-end-runbook.md'
  },
  StorageCopilot: {
    title: '储能投资收益测算',
    body: '储能投资收益统一工作台：完整投资公式 + 套利/MILP 调度 + 运行历史 + 智能体解释。改参数本地公式即时预览，自然语言填参，后端测算并解释（完整公式/价格/套利/MILP/敏感性保存快照）。经 /agent-api/v1/investment-assessment/runs。缺真实价格曲线时 basis=illustrative、mock=true。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/agent-harness/storage-copilot-runtime.md'
  },
  PreSubmitCheck: {
    title: '申报前体检',
    body: '申报前体检评分卡：合规预检 + 偏差考核风险 + 出清博弈推演，给 go/no-go 三维（合规/风险/收益）0-100 评分卡。填目标日+拟申报概述→开始体检→AgentChatPanel 跑四步 prompt。经白名单 prompt key，supervisor 派 compliance_officer/risk_sentinel/bidding_game_analyst 子智能体。数据为分析示意。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/agent-harness/market-tools-and-agent-dispatch.md'
  },
  PolicyIntel: {
    title: '政策情报官',
    body: '智能体汇集交易中心/国网/能源局披露与政策：按相关性高/中/低打分并标注限价/结算/偏差/新能源申报规则变更影响，汇总需调整的工作台。填关注关键词（可选）→汇集情报→AgentChatPanel 跑四步 prompt，产出情报清单表（来源/标题/相关性/影响）。经白名单 prompt key + disclosure 工具。数据为分析示意。',
    docPath: 'docs/agent-harness/market-tools-and-agent-dispatch.md'
  },

  // ── 数据分析 ────────────────────────────────────────────────────────────
  MarketInsightCockpit: {
    title: '市场洞察驾驶舱',
    body: '一屏确定性渲染的市场洞察：市场快照/价格弹性/价差套利/节点热力/异动雷达五区块 + AI 解读（选中即问）。数据来自 /agent-api/v1/market-insight/bundle + agent sessions(SSE)。用于快速把握市场结构与套利机会。属决策支持，非投资建议；以正式结算口径为准。',
    docPath: 'docs/data/market-insight-price-client.md'
  },
  DataAnalysis: {
    title: '数据分析',
    body: '综合数据分析：91 天×全 63 类型，每天 dataMap.series 60×96 点。双月日历选日（含「当天有数据过滤」）、Y 轴按类型分配、持仓比例 markLine、day 文件懒加载缓存。数据来自 POST /sdpt/zsjfx/singleData，回放 sdpt_zsjfx。混合口径：含实际值也含预测序列；63 类型见 itemConfig。',
    docPath: 'docs/data/yunnan-zsjfx-derive.md'
  },
  ClearingSpotAnalysis: {
    title: '出清现货电量分析',
    body: '出清现货电量分析回放：10 序列约 65 天（4/1~6/4）的出清电量时序，nameList 为约 6528 个连续 15min 时点。数据来自 POST /sdpt/zcqxhdl/list（宽范围），回放 sdpt_zcqxhdl。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-parquet-derive.md'
  },
  PriceNewEnergyRelation: {
    title: '现货价格与新能源关系',
    body: '现货价格与新能源出力关系回放：日前电价与新能源总/供/总电/供电、系统负荷的关系序列，覆盖 373 天（2025-05~2026-06）。数据来自 POST /sdpt/zcqxhdl/list24（ts=回溯天数），回放 sdpt_zcqxhdl。为真实采集回放数据（日前/实时切换为 UI 预留字段，未接入数据逻辑）。',
    docPath: 'docs/data/yunnan-parquet-derive.md'
  },
  PriceSystemLoadRelation: {
    title: '现货价格与统调负荷关系',
    body: '现货价格与统调负荷关系回放：日前电价与系统负荷的关系序列，覆盖 373 天。数据来自 POST /sdpt/zcqxhdl/fhlist24，回放 sdpt_zcqxhdl。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-parquet-derive.md'
  },
  MarketOperationsAnalysis: {
    title: '市场经营分析',
    body: '市场经营分析：metric 卡行 + 6 radio tab（市场概览/发电侧/售电公司/独立储能/套餐/价格趋势）+ 结构分布饼图 + 月度趋势/价格曲线双图 + 明细表，支持年份切换与 CSV 导出。数据来自本地 marketAnalysis（计划后端 /api/v1/market/*）。price tab 前端算现货/中长期均价与价差、零售均价。当前为混合口径、结构化合成。',
    docPath: 'docs/data/market-ops-data-spec.md'
  },
  TimeOfUseMarket: {
    title: '分时行情',
    body: '分时行情回放：按运行/交易类型×日期的分时行情数据，覆盖 2022-12~2026-06（2563 文件）。数据来自 GET /sdpt/fshq/data?rqlx&bdrq&jyyf，回放 sdpt_fshq。为真实采集回放数据（jysd 参数后端忽略，为无效维度）。'
  },
  DailySystemLoad: {
    title: '逐日系统负荷实际值',
    body: '逐日系统负荷实际值回放：一次返回 6 年（2021-2026）×366 天的统调负荷，含 system（日历对齐）与 misplace（错位对齐）两套，各含均/最小/最大值。数据来自 GET /sdpt/actualLoad/query，回放 sdpt_actualLoad。为真实实况采集回放数据。',
    docPath: 'docs/data/yunnan-actualload-derive.md'
  },
  PriceAnalysis: {
    title: '价格分析',
    body: '价格分析回放：1434 天×2 类型（2022-07~2026-06）的电价序列（日均值/日最大/日最小），含 3D 电价图（时间×日期×价格）+ 时点切面 + 日期切面。数据来自 GET /sdpt/zcqxhdl/listrs?typeList[]&tag=0，回放 sdpt_zcqxhdl（数组参数需编码 %5B0%5D）。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-parquet-derive.md'
  },
  SolarTerms: {
    title: '24 节气',
    body: '24 节气负荷回放：6 年节气详细与日期汇总两种模式（前端本地切换），节气定位对齐 nameList，各年 legendList 独立、缺失指标跳过，双轴绑定。数据来自 GET /sdpt/actualLoad/query2?xl，回放 sdpt_actualLoad。为真实实况采集回放数据。',
    docPath: 'docs/data/yunnan-actualload-derive.md'
  },
  ElNinoLaNina: {
    title: '厄尔尼诺拉尼娜',
    body: 'ENSO 指数回放：77 行（按年）的厄尔尼诺/拉尼娜指数，含 djf..ndj 12 个滑动季，±0.5 为 ONI 厄/拉阈值。数据来自 GET /sdpt/elninolanina/list，回放 sdpt_elninolanina。为真实采集回放数据，用于气候周期与负荷/新能源出力的长周期关联参考。'
  },
  WeatherForecast: {
    title: '天气预报',
    body: '11 个山西地市 15 天日预报 + 24h 时预报。注意：实际实现改用 Open-Meteo 实时公开 API（非 router meta 登记的 weather/dayData 捕获数据），11 城市经纬度硬编码。为公开气象预报数据，按城市与日期切换。',
    docPath: 'docs/data/weather-ingestion.md'
  },

  // ── 预测数据（kind:'forecast'，数值仅供参考/演示，不作为交易依据） ────────
  ForecastCenter: {
    title: '预测中心',
    body: '预测五页聚合单页：一级 tab 按工作流排序——官方回放、建模工作台、厂站预测、质量记分牌、申报决策。tab 复用原路由的角色权限和地区能力，支持 ?mod= 深链；预测数值仅供参考，非结算依据。',
    docPath: 'docs/forecast/forecast-system-implementation.md'
  },
  // 注：#1374 预测中心单页化后，原 ForecastWorkbench/ForecastDecisionCockpit/ForecastHub/
  // StationGeneration/ForecastScoreboard 五个独立路由已改 redirect 到 /ycsj/center（?mod= 深链），
  // 对应说明并入上方 ForecastCenter（#1668）；各模块细节文档仍可经 docPath 单独查阅。

  // ── 省间现货 ────────────────────────────────────────────────────────────
  InterProvincialPlan: {
    title: '省间中长期交易电量计划',
    body: '省间中长期交易电量计划回放：699 条 type92（2024-08~2026-06），独立实现的图表卡（支持 24/96 点切换——这是与 ForecastDailyCurve 的关键区别）。数据来自 GET /sdpt/zptjg/list?tag=92（生产端必填 areaId=1），回放 sdpt_zptjg。为真实采集回放数据。',
    docPath: 'docs/data/yunnan-parquet-derive.md'
  },

  // ── 投资测算（参数驱动，算法真实可验证） ──────────────────────────────────
  WindSolarInvestment: {
    title: '新能源资产测算',
    body: '风电/光伏投资测算：4 指标卡（总投资/资本金、LCOE、资本金 IRR、年发电量）+ 光伏/风电切换 + 计算模式（目标 IRR 反算 LCOE / 指定 LCOE 算 IRR）+ 三免三减半 + 参数 4 节 + 现金流曲线 + 敏感性分析。纯前端 windSolar 算法（legacy /api/v1/investment-calculator/*，新聚合走 /api/v1/investment-assessment/runs）。参数为用户填表默认值（demo），非市场回放。属决策支持，非投资建议。',
    docPath: 'docs/data/sim-calibration.md'
  },
  TruckChargingInvestment: {
    title: '重卡充换电测算',
    body: '重卡充换电投资测算：4 指标卡（总投资、年均收入/年利润、资本金 IRR、回收期/NPV）+ 项目类型/运营模式/线路模式 + 参数 5 tab + 收入构成饼图 + 资本金现金流 + 明细 4 tab + 敏感性。纯前端 truckCharging 算法（计划后端）。支持挂靠/外委/混合、多段线路、目标 IRR 反算。参数为用户填表默认值。属决策支持，非投资建议。',
    docPath: 'docs/data/sim-calibration.md'
  },

  // ── 电价测算 ────────────────────────────────────────────────────────────
  RetailPriceCalculator: {
    title: '售电电价测算',
    body: '售电电价测算：4 指标卡（到户综合价、总电费、售电利润、加权购电价）+ 工商业/国网代购模式 + 单一制/两部制 + 电压等级 + 分时/售电套餐/已知加权价 + 反推分时价。纯前端 retailPrice 算法（计划 price calculator suite）。核心：省内电价、分时电价、售电套餐、国网代购电价。参数为用户填表。属决策支持，非投资建议。',
    docPath: 'docs/region/region-settlement-rules.md'
  },
  InterprovincialPriceCalculator: {
    title: '跨省跨区电价',
    body: '跨省跨区电价测算：4 指标卡（送端上网价、落地电价、年费用、综合线损）+ toEndUser（上网价算落地价）/toSource（落地价反推上网价）两模式 + 价格路径图 + 年度费用分布。纯前端 interprovincialPrice 算法（计划 price calculator suite），路由 query 同步计算模式。核心：跨省跨区上网价到落地价互推。参数为用户填表。属决策支持，非投资建议。',
    docPath: 'docs/region/region-settlement-rules.md'
  },

  // ── 运营管理 / 数据管理 ──────────────────────────────────────────────────
  OperationsWorkbench: {
    title: '运营中枢',
    body: '多 tab 综合运营面：电站/合同/结算/风险/统计/导入任务/模型版本/智能体监控，每 tab 含指标卡 + 行表。数据来自本地 operations（计划后端 /api/v1/{stations,contracts,settlements,risks,statistics,...}），智能体监控来自 agentMonitor。当前为混合口径、结构化合成（计划后端未接时本地优先）。'
  },
  ImportHub: {
    title: '数据导入融合台',
    body: '多源导入融合台：电量/零售套餐/结算/售电结算/市场交易多源导入 tab + 导入历史 + 任务状态。文件上传/参数配置→触发导入→查看任务状态与历史、失败重试。数据来自本地 importHub（计划后端 /api/v1/{power/import,market/...}）。当前为混合口径、结构化合成。',
    docPath: 'docs/data/import-hub-capture-bridge.md'
  },
  DataBrowser: {
    title: '通用数据浏览器',
    body: '任意已注册数据族的归一化真实回放数据浏览器：族/region 选择器 + 动态列表格（列由归一化 schema 动态生成）+ 筛选 + CSV 导出，region 数据状态经 RegionDataBanner 提示。数据来自 GET /api/real?family=&match=&region=（region-aware）。用于跨族核查已采集归一化数据，列结构由各 family normalizer 产物决定。',
    docPath: 'docs/data/universal-data-browser.md'
  },
  DataGovernance: {
    title: '数据治理控制台',
    body: '数据治理只读聚合：数据资产目录（含数据归属列，company 私有族标归属公司/public 标公共）+ 新鲜度 + 质量报告（G1 quality-report.json 告警）+ 备份 manifest，按 x-region-id 限定地区。数据来自 GET /api/v1/governance/{catalog,quality,backup}（capture.sqlite + quality-report.json + data/private-backups）。为真实治理元数据。',
    docPath: 'docs/data/data-governance-console.md'
  },
  DataIngestion: {
    title: '数据摄取管理',
    body: '触发 ETL 摄取：云南现货/气象/市场经营分析等数据落 capture-raw + capture.sqlite。数据来自 POST /api/v1/ingest/:kind（capture.sqlite）。用于手动触发或查看数据摄取任务，当前为混合口径（真实摄取与演示并存）。',
    docPath: 'docs/data/data-ingestion-spec.md'
  },
  DataOnboarding: {
    title: '数据接入向导',
    body: '按「你手里有什么数据」组织的数据接入旅程总览：现货节点电价(T0)/系统负荷水电(T0T1)/交易中心月度导出包/气象全自动/结算零售交易。每张卡片五步线（输入→校验→落位→生效→见数）按真实状态点亮，上传投递后可「一键生效」直接跑 ETL 不必切命令行。状态来自 GET /api/v1/governance/catalog 新鲜度 + /api/v1/import-templates/records 台账两路只读信号；生效复用 POST /api/v1/ingest/:kind（spot-ingest/forecast-etl 写用户数据目录，非生产写入）。向导不产数据，状态如实透传：未落 capture 显示「未知」，未生效不标「已可见」。',
    docPath: 'docs/data/data-onboarding-journey.md'
  },

  // ── 售电资料 ────────────────────────────────────────────────────────────
  RegionRules: {
    title: '地区规则体系',
    body: '地区规则画像 + 主体角色关注矩阵：Hero（市场阶段/规则状态/结算模式标签 + 3 指标）+ 地区业务模块卡 + 当前角色·主体重点关注/风险提示/推荐入口三栏 + 4 tab（交易组织/价格结算/风控披露/资料来源）+ 规则依据。纯本地读 rules/ + regionModules + governance，按 region+RBAC 过滤。为本地规则画像数据。',
    docPath: 'docs/region/region-binding-architecture.md'
  },
  PlatformDocuments: {
    title: '交易平台文档',
    body: '交易平台文档回放：列表（32 条取 10）+ 10 个本地文件（7 PDF 可预览 + 2 DOCX + 1 XLSX + 1 PPTX 触发下载）。支持上传日期/文档名/级别筛选，PDF 经 /api/realfile inline 内嵌 iframe 预览、其余触发下载。数据来自 GET /sdpt/zptwd/list + 文件下载，回放 sdpt_zptwd。为真实采集回放文档。'
  },

  // ── 系统管理 ────────────────────────────────────────────────────────────
  SystemAccounts: {
    title: '用户与权限',
    body: '账号、会话与权限三 tab（仅系统管理员可见）。用户管理：账号 CRUD + 角色/数据域 + 密码重置 + 启用停用，经 GET/POST/PATCH /api/auth/users。会话管理：会话列表 + 审计日志 + 撤销下线，经 GET/DELETE /api/auth/sessions。两者落 auth_sqlite，为真实数据。权限矩阵：角色 × 菜单路径 × 操作的授权维护，页内再分角色权限/地区入口/认证目录三段，路由开关按 block 折叠并支持筛选；读前端权限模型 services/governance.ts（local_governance，非后端库）。',
    docPath: 'docs/architecture/company-data-governance.md'
  },

  // ── 系统（AI 设置 / 技能 / 智能体工作台） ──────────────────────────────
  AiSettings: {
    title: 'AI 模型设置',
    body: '配置 LLM 厂商/Key/baseURL/model + 管理令牌 + 采样参数 + 角色→模型路由 + Agent 工作流参数，支持测试连接。经 /api/agent/llm/* 读服务端 model_providers.yaml + KeyStore。API Key 保存在服务端（不入库、不入 git），前端不持密钥。从 AI 导航助手进入，不在主菜单。为真实配置数据。',
    docPath: 'docs/agent-harness/agent-config-and-memory.md'
  },
  AgentWorkbench: {
    title: '智能体工作台',
    body: '智能体对话工作台：左历史侧栏（按登录用户隔离、Node SQLite 持久化）+ 右 AgentChatPanel（/agent-api/agent/* SSE 流式）。支持深链 ?q= 与 ?scenario=chat|declaration_prep|daily_review，历史回放续聊。persist-history 默认开启。对话走 agent-backend、历史走 Node SQLite，为真实会话数据。',
    docPath: 'docs/agent-harness/agent-chat-history.md'
  },
  SystemAiStudio: {
    title: 'AI 工作室',
    body: 'AI 编排与配置五 tab（仅系统管理员可见）。技能工作室：SKILL.md 技能网格 + 编辑抽屉 + 导入导出，启停/编辑对新建会话生效。子智能体工作室：角色与工具集 CRUD、归属绑定，供 supervisor 派发（写操作共用 HARNESS_ADMIN_TOKEN）。Dify 工作流工作室：经服务端 SSO 同源嵌入 Dify 原生画布，取数走 /api/dify-tools/* 工具桥，前端不持密钥。高级智能体编排：LangGraph 画布（8 类节点 + 并行/分支/审批/循环 + 递归护栏），SSE 流式运行，数据为分析示意。定时任务调度：任务 CRUD/启停/立即执行/执行历史/结果中心，落 schedules_sqlite，产出真实落盘报告。整体为混合口径。',
    docPath: 'docs/agent-harness/sub-agent-studio.md'
  },

  // ── 活跃 feature 路由（features/*/routes.ts） ───────────────────────────
  YunnanNodePrice: {
    title: '节点电价分析',
    body: '中广核云南厂侧节点价格曲线、热力图和当日节点日聚合明细，按上游原生 15m/1h 展示。数据来自 GET /agent-api/v1/spot/cgn-yunnan/node-price/*，只允许 comp-cgn-yunnan 集团账号 + yunnan；查询主体固定为 GENERATOR-YN-CGN，非电网官方接口，失败不回落公共价格或回放。',
    docPath: 'docs/data/yn-node-price-page.md'
  },
  YunnanSettlementPrice: {
    title: '结算价分析',
    body: '云南现货结算价分析：结算三价/中长期参照来自 yn_spot_settlement 真实回放；节点峰谷水位与统计来自中广核云南厂侧私有 PostgreSQL GET /agent-api/v1/spot/cgn-yunnan/node-price/daily。节点价只允许中广核云南 home company 与 yunnan 地区，查询主体服务端固定；非电网官方接口且不回落公共价格。',
    docPath: 'docs/data/yn-settlement-price-page.md'
  },
  ReportCenter: {
    title: '报表中心',
    body: '报表模板库 + 参数化生成（时间/地区/主体/市场）+ 区块渲染 + 导出归档。数据经 GET /api/v1/reports/* + local reportEngine，口径来自 settlementFormula。当前区块基于合成场景（sourceType=MOCK）；结算/偏差/收益口径公式真实可验证（verify:report-formulas）。',
    docPath: 'docs/features/report-engine.md'
  },
  GridGeoAssets: {
    title: '电厂地理空间',
    body: '云南电厂物理位置、位置精度、公开证据与未来业务属性引用（不含潮流计算）。数据来自 GET /api/v1/grid/geo-assets/{manifest,plants,plants/:id,weather/current}（yn_dim_plant + yn_dim_plant_node + 公开位置证据）。村镇/县域坐标以不确定性光圈显示，不代表精确厂址；未定位不伪造坐标。为真实主数据 + 公开位置证据。',
    docPath: 'docs/product/grid-geo-assets.md'
  },
  GridSpatialCommand: {
    title: '电力空间联动驾驶舱',
    body: '在同一 Cesium 地形场景按需联动授权电厂、已定位节点、当前格点天气、历史市场回放、公开披露时间轴和网架 Provider 状态。页面复用登录、公司、地区、电网与 DataScope；只绘制权威 WGS84 点位，Mock/缺测不补值，披露无坐标不落点，未授权网架不请求快照或推测连线。',
    docPath: 'docs/product/grid-spatial-command.md'
  },
  GridGeoNodes: {
    title: '节点空间资产台',
    body: '节点身份、位置状态、WGS84 坐标、版本历史与市场数据接口（不含敏感网架拓扑）。数据来自 GET|POST|PATCH /api/v1/grid/geo-assets/nodes（versioned grid_geo_assets + 节点价格族引用）。未定位节点不伪造坐标；人工变更写入受管 SQLite 并形成审计版本。为真实空间资产台账。',
    docPath: 'docs/data/csg-node-catalog.md'
  },
  GridTopologyProvider: {
    title: '授权网架接入舱',
    body: '按当前登录用户、公司、地区和电网运营商读取授权拓扑 Provider 契约。Provider 未配置或无权时保持受控空态，不请求敏感 snapshot，不从电厂或定价节点推测线路；当前不执行潮流、断面或 N-1 计算。',
    docPath: 'docs/product/grid-topology-provider.md'
  },
  GridMarketSpatial: {
    title: '电力市场空间态势',
    body: '在 Cesium 地形上按稳定电厂/节点引用展示实时-日前价差、真实出力偏差和描述性综合关注指数。节点价格与出力批量按需加载，Mock 与缺测不会生成替代指标；视觉信号不代表潮流、阻塞或因果归因。',
    docPath: 'docs/product/grid-market-spatial.md'
  },
  GridWeatherImpact: {
    title: '气象交易影响时序',
    body: '将历史天气实况、精确场站出力和定价节点价格按同小时对齐，展示回顾性相关和极端天气关注窗口。当前历史实况不是 D-1 当时预报，不能用于宣称生产回测精度、因果影响或结算结果。',
    docPath: 'docs/product/grid-weather-impact.md'
  },
  GridDisclosureSpatial: {
    title: '公开披露空间层',
    body: '南网五省检修、停运、干预、阻塞与约束等公开披露事件的时间轴与空间层，支持个人/公司收藏、笔记和标签协作。数据来自 GET /api/v1/grid/geo-assets/disclosures/{providers,events}（授权导出编译入受管 SQLite）。国网地区 Provider 未配置时保持诚实空态；事件无坐标不落点、不推测位置。为真实公开披露数据。',
    docPath: 'docs/product/grid-geo-assets.md'
  },
  GridOperatorProfile: {
    title: '南网国网展示画像',
    body: '对比南方电网与国家电网的术语、字段、视觉主题、默认镜头与各数据层可用状态。数据来自 GET /api/v1/grid/geo-assets/operator-profile（shared/region/grid-operator-profiles.mjs 静态画像，sourceType CONFIG）。画像只描述展示口径与数据可用性，不代表出清机制或市场规则事实；缺源地区如实显示 missing/not-configured，不跨电网回退。',
    docPath: 'docs/product/grid-operator-profiles.md'
  }
}

/**
 * 按路由 name 查询页面帮助条目；无注册则返回 undefined（调用方据此不渲染按钮）。
 * 供 PageHelpTip.vue 在 AppLayout 顶栏按当前路由统一消费。
 */
export function getPageHelp(routeName: unknown): PageHelpEntry | undefined {
  if (typeof routeName !== 'string') return undefined
  return pageHelpRegistry[routeName]
}
