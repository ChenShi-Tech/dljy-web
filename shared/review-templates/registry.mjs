// 复盘模板注册表（Epic #2033 · M1 · #2036）
// ---------------------------------------------------------------------------
// 《电力交易辅助决策系统复盘体系配套模板（合并版）》31 项模板的声明式单源：
// 通用十三项（T01–T13）+ 储能 S1–S5 + 售电 R1–R5 + 新能源 N1–N5 + 储能 24 时段 E1–E3。
// 模板原文见 docs/review-system/复盘配套模板合并版.md；落地设计见
// docs/review-system/review-system-design.md。
//
// 三条设计约束（改字段前先读）：
// 1. **fill:'auto' 的字段必须声明 source，且 source 必须在 SOURCE_CATALOG 登记**——
//    注册表声称「系统自动生成」而实际没有喂数来源，是这张表最容易烂掉的方式；
//    守卫 scripts/verify/verify-review-templates.mjs 机器强制。
// 2. **readiness 是数据可得性台账，不是开发进度**：ready=喂数来源今天就存在；
//    data_gap=有模板无数据（gapNote 必填、注明缺口编号 D1–D6，对照 Epic #2033
//    评论的待梁总提供清单）；deferred=规划性后置。数据到位翻转 readiness 必须
//    在 gapNote/notes 写清依据——不许静默翻 ready。
// 3. **判断栏不给 AI**：fill:'human' 是方案红线「严禁系统代填」的机器表达
//    （决策复盘单的依据/结论/改进措施三类栏位）；AI 可以建议的字段单列
//    fill:'ai_suggest'（走「建议+人点采纳」范式，绝不直写）。
//
// 口径纪律：金额类字段（考核费用/影响金额）一律 caliber:'self-computed'——正式
// 结算细则未核验（山西 shanxi-draft-0.1），自算数字与口径限制必须同存同出。

/** 六维复盘维度（方案 §二（一）） */
export const DIMENSIONS = Object.freeze({
  result: '结果复盘',
  strategy: '策略复盘',
  market: '市场复盘',
  deviation: '偏差复盘',
  risk: '风险复盘',
  decision: '决策复盘',
})

/** 责任主体（#2005 三类身份 + 通用） */
export const SUBJECTS = Object.freeze({
  common: '通用',
  storage: '储能',
  retail: '售电公司',
  renewable: '新能源电厂',
})

/** 触发周期（方案 §二（四）触发表；一项模板可多周期，如「每日跟踪+每月汇总」） */
export const CADENCES = Object.freeze(['event', 'daily', 'weekly', 'monthly', 'quarterly', 'continuous'])

/** 自动化分档：A=系统生成人审签发；B=系统预填事实人补判断；C=纯人工 */
export const AUTOMATION_TIERS = Object.freeze(['A', 'B', 'C'])

/** 就绪度：ready=喂数来源存在；data_gap=有模板无数据；deferred=规划后置 */
export const READINESS_STATES = Object.freeze(['ready', 'data_gap', 'deferred'])

/**
 * 喂数来源目录：auto 字段的 source 只能取这里登记的 id。
 * 每条要求写清「它是什么、真实度边界」——目录本身就是评审对象。
 */
export const SOURCE_CATALOG = Object.freeze([
  { id: 'quant_review', kind: 'endpoint', desc: 'quant /review 偏差考核权威口径（申报 vs 实际，山西 60 天真实覆盖区；caliber_caveats 随响应下发）' },
  { id: 'quant_settlement_review', kind: 'endpoint', desc: 'quant /settlement-review 云南三段式结算（yn_spot_settlement 真实，2026-05 覆盖）' },
  { id: 'quant_backtest', kind: 'endpoint', desc: 'quant backtest_declaration 申报回测（日前收益/均价/日前-实时价差盈亏）' },
  { id: 'quant_risk_engine', kind: 'endpoint', desc: 'quant 蒙特卡洛 VaR/CVaR 与报价优化引擎（决策参考，非结算依据）' },
  { id: 'quant_storage_backtest', kind: 'endpoint', desc: 'quant /backtest 储能峰谷套利回测（quantstats 绩效：胜率/回撤/夏普）' },
  { id: 'declaration_record', kind: 'dataset', desc: '申报单事实（spot-declarations：品种/方向/电量曲线/申报价/状态机/审计）' },
  { id: 'declaration_preflight', kind: 'dataset', desc: 'S1–S7 preflight 作业留痕（morningReview/forecast/storagePlan/dailyClose 等段）' },
  { id: 'clearing_price', kind: 'dataset', desc: '出清价回放（日前/实时，capture 按地区路由；未接入地区诚实 not_onboarded）' },
  { id: 'loss_attribution', kind: 'dataset', desc: 'yn_loss_attribution 三段归因（策略/预测/电网，1101 厂站日 reconcile 闭合，仅云南）' },
  { id: 'trading_memory', kind: 'service', desc: 'Beta-Binomial 后验胜率（verify:trading-memory 口径；服务端化归 #2045）' },
  { id: 'settlement_rules', kind: 'rules', desc: 'SettlementRuleSpec 分省结算规则参数（5 省已沉淀；未参数化省份显式提示不借用）' },
  { id: 'review_pg', kind: 'pg', desc: 'review schema（本单迁移 025：模板实例/决策日志/案例库/风险事件/改进措施/报告索引）' },
  { id: 'investment_runs', kind: 'pg', desc: 'investment_assessment_runs 储能投资评估运行快照（测算侧）' },
  { id: 'storage_dispatch_plan', kind: 'endpoint', desc: '储能事前充放电测算（MILP/阈值兜底；价格默认 illustrative 即 MOCK，须显式接真实价格）' },
  { id: 'forecast_output', kind: 'endpoint', desc: '预测域产出（价格/出力预测；kind=forecast 数值区间口径见 #2006/#1898）' },
  { id: 'cgn_station_rt', kind: 'dataset', desc: '中广核云南场站实际出力/实时数据（公司私有 PG，仅该主体该地区）' },
  { id: 'market_disclosure', kind: 'dataset', desc: '披露库与市场曲线（价格走势/供需数据，按地区采集回放）' },
  { id: 'identity', kind: 'service', desc: '登录身份与公司归属（填表人/审核人留痕）' },
  { id: 'manual_entry', kind: 'manual', desc: '人工录入（带录入人与时间痕，来源可信度按录入声明）' },
])

const S = Object.fromEntries(SOURCE_CATALOG.map((s) => [s.id, s.id]))

// 字段简写构造器：a=自动（必须带 source）、h=人工、ai=AI 建议人采纳
const a = (key, label, source, extra = {}) => ({ key, label, fill: 'auto', source, ...extra })
const h = (key, label, extra = {}) => ({ key, label, fill: 'human', ...extra })
const ai = (key, label, extra = {}) => ({ key, label, fill: 'ai_suggest', ...extra })

/**
 * 31 项模板注册表。字段说明：
 * - id: 稳定标识（通用 T01–T13 对应模板一至十三；主体专属沿用原编号）
 * - dimension/subject/cadences/automation/readiness: 见上方枚举
 * - trigger/deadline: 方案 §二（四）触发表原文口径
 * - roles: 填报/复核责任岗（轻量两态：提交/复核，2026-08-13 拍板）
 * - retentionYears: 统一 5 年（方案 ≥3 年与决策日志 ≥5 年就高，待 C2 终确认）
 * - slots24: 24 时段逐时表格（底层 96 点、24 时段仅展示聚合，2026-08-13 拍板）
 * - fields: 模板表格列（不含逐时段/逐行的重复行，行结构由渲染器按 slots24/rows 展开）
 */
export const REVIEW_TEMPLATES = Object.freeze([
  // ── 通用十三项 ──────────────────────────────────────────────────────────
  Object.freeze({
    id: 'T01', name: '决策复盘单', dimension: 'decision', subject: 'common',
    cadences: ['event'], automation: 'B', readiness: 'ready',
    trigger: '关键交易成交（判据待 C3 确认，先用保守缺省并标注）', deadline: '当日填写',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '判断栏（依据/结论/改进措施）为方案红线「严禁系统代填」，永不给 AI 预填；提交后锁定，更正走追加。',
    fields: [
      a('decisionNo', '决策编号 JC-YYYYMMDD-NNN', S.review_pg),
      a('tradeDate', '交易日期/时段', S.declaration_record),
      a('variety', '交易品种', S.declaration_record),
      a('marketType', '市场类型', S.declaration_record),
      a('direction', '决策方向', S.declaration_record),
      a('quantityMwh', '数量 MWh', S.declaration_record),
      a('avgPriceYuanMwh', '成交均价 元/MWh', S.clearing_price),
      h('basisInfo', '决策依据—信息', { required: true }),
      h('basisLogic', '决策依据—逻辑', { required: true }),
      h('basisEmotion', '决策依据—情绪', { required: true }),
      a('executionFacts', '执行情况（计划 vs 实际事实）', S.declaration_preflight),
      h('adjustReason', '调整原因（有调整时）'),
      h('conclusionInfo', '复盘结论—信息', { required: true }),
      h('conclusionLogic', '复盘结论—逻辑', { required: true }),
      h('conclusionEmotion', '复盘结论—情绪', { required: true }),
      h('improvement', '改进措施（落 improvement_actions 跟踪）', { required: true }),
      a('filedBy', '填表人', S.identity),
      a('reviewedBy', '审核人', S.identity),
    ],
  }),
  Object.freeze({
    id: 'T02', name: '月度收益拆解报告', dimension: 'result', subject: 'common',
    cadences: ['monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '次月 5 个工作日内系统生成', deadline: '次月 5 个工作日',
    roles: { fill: 'SYSTEM', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '分品种维缺中长期品种收益与正式结算单（现货侧可由回测+结算复盘先行）；单笔层缺逐笔成交归集。中长期依赖 S6 线（#1966），结算单缺口见 D6。',
    fields: [
      a('level', '拆解层级（分品种/分时段/单笔）', S.review_pg),
      a('item', '品种/时段/交易', S.declaration_record),
      a('revenueYuan', '本月收益 万元', S.quant_backtest, { caliber: 'self-computed' }),
      a('share', '占比', S.review_pg),
      a('prevRevenueYuan', '上月收益 万元', S.review_pg, { caliber: 'self-computed' }),
      a('momChange', '环比变动', S.review_pg),
      h('attribution', '主要归因（环比超 20% 必填）'),
    ],
  }),
  Object.freeze({
    id: 'T03', name: '典型交易分析表', dimension: 'result', subject: 'common',
    cadences: ['monthly'], automation: 'B', readiness: 'ready',
    trigger: '随模板二同步编制', deadline: '次月 5 个工作日',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: 'Top5 盈亏榜与 T02 同一次聚合产出；「是否入库=是」自动同步 T13 案例库登记。',
    fields: [
      a('type', '类型（盈利/亏损）', S.quant_backtest),
      a('tradeDate', '交易日期', S.declaration_record),
      a('variety', '品种', S.declaration_record),
      a('quantityMwh', '数量 MWh', S.declaration_record),
      a('avgPrice', '成交均价', S.clearing_price),
      a('pnlYuan', '盈亏额 万元', S.quant_backtest, { caliber: 'self-computed' }),
      h('mainCause', '主要成因（市场机会/策略有效/信息优势/执行到位或反向）', { required: true }),
      h('lesson', '可复制经验/改进点', { required: true }),
      h('owner', '责任人'),
      h('toCaseLibrary', '是否入库'),
    ],
  }),
  Object.freeze({
    id: 'T04', name: '策略胜率分析报告', dimension: 'strategy', subject: 'common',
    cadences: ['monthly'], automation: 'A', readiness: 'ready',
    trigger: '次月 5 个工作日内；胜率持续低于阈值时阈值触发预警', deadline: '每月',
    roles: { fill: 'TRADE_LEAD', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '样本 <30 不出胜率结论只标「样本不足」（方案原文规则做成硬校验）；回测/实盘双口径分列；服务端化归 #2045。',
    fields: [
      a('strategyName', '策略名称', S.trading_memory),
      h('logicSummary', '策略逻辑概述'),
      h('applicableEnv', '适用市场环境'),
      a('backtestRange', '回测区间', S.quant_storage_backtest),
      a('sampleCount', '样本数', S.trading_memory),
      a('winRate', '胜率（Beta-Binomial 后验）', S.trading_memory),
      a('avgPnlRatio', '平均盈亏比', S.quant_storage_backtest),
      a('maxDrawdown', '最大回撤', S.quant_storage_backtest),
      h('disposition', '处置结论（保留/优化/停用）', { required: true }),
    ],
  }),
  Object.freeze({
    id: 'T05', name: '执行偏差分析表', dimension: 'strategy', subject: 'common',
    cadences: ['weekly'], automation: 'B', readiness: 'ready',
    trigger: '每周复盘会（建议周五）', deadline: '每周',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '原因归类四类在方案原文自相矛盾（表格「预测偏差/设备故障/人为操作」vs 填写说明「信息支撑/情绪化/误判/其他」），待 C1 确认后定枚举；同一交易员连续两次同类偏差须专项分析。',
    fields: [
      a('tradeDate', '交易日期', S.declaration_record),
      a('variety', '品种', S.declaration_record),
      a('plannedQuote', '计划报价', S.declaration_preflight),
      a('actualQuote', '实际报价', S.declaration_record),
      a('deviationDir', '偏差方向（高报/低报/持平）', S.review_pg),
      a('deviationPct', '偏差幅度 %', S.review_pg),
      a('adjusted', '是否调整', S.declaration_preflight),
      h('causeCategory', '原因归类（枚举待 C1）', { required: true }),
      h('correction', '纠偏措施'),
    ],
  }),
  Object.freeze({
    id: 'T06', name: '月度市场归因报告', dimension: 'market', subject: 'common',
    cadences: ['monthly'], automation: 'B', readiness: 'ready',
    trigger: '次月 5 个工作日内', deadline: '每月',
    roles: { fill: 'TRADE_LEAD', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '价格/供需行自动预填；政策行人工关联 + AI 建议、不做自动因果；「下月关注点」转行动项落 improvement_actions；异常价格事件与风险事件库（#2047）双向引用。',
    fields: [
      a('priceTrend', '价格走势本月情况', S.market_disclosure),
      a('supplyDemand', '供需形势本月情况', S.market_disclosure),
      h('policyChange', '政策变化本月情况'),
      a('abnormalEvents', '异常价格事件（时间/极值/持续时长）', S.review_pg),
      ai('drivers', '主要驱动因素'),
      h('impact', '对交易影响', { required: true }),
      h('nextFocus', '下月关注点（转行动项）', { required: true }),
    ],
  }),
  Object.freeze({
    id: 'T07', name: '偏差归因分析报告', dimension: 'deviation', subject: 'common',
    cadences: ['weekly'], automation: 'B', readiness: 'ready',
    trigger: '每周复盘会前完成；偏差率连续超标时阈值触发预警', deadline: '每周',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '责任归因（预测不准/突发情况/策略失误/操作失误）仅周聚合时人工补填，与 S1 日度业务成因四因子正交不合并（#2042 归因二轴设计）；上期改进措施逐项回查。#2557：云南周复盘走结算三段式口径（settlement_3seg 天），quant_review 偏差字段该期自然删节、settlement 字段顶上，两者不混填。',
    fields: [
      h('causeCategory', '偏差原因类别（责任归因，AI 可按业务成因映射建议）', { required: true }),
      a('deviationMwh', '偏差电量 MWh', S.quant_review),
      a('actualOnGridEnergy', '上网电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('rtDevEnergy', '实时增量电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('share', '占比', S.review_pg),
      h('typicalCase', '典型案例'),
      a('prevActionStatus', '上期改进措施落实情况', S.review_pg),
      h('currentActions', '本期改进措施', { required: true }),
    ],
  }),
  Object.freeze({
    id: 'T08', name: '偏差成本核算表', dimension: 'deviation', subject: 'common',
    cadences: ['daily', 'monthly'], automation: 'A', readiness: 'ready',
    trigger: '每日结算数据出具/次月 5 个工作日内', deadline: '每日/每月',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '考核单价与金额为自算口径（正式细则缺 D6，caliber_caveats 全链路带出）；罚款模型接三部制归 #2041。#2557：云南月复盘走结算三段式口径（settlement_3seg 天）——quant_review 偏差字段该期自然删节、结算三段字段顶上，两者不混填。',
    fields: [
      a('subject', '主体/客户', S.declaration_record),
      a('declaredMwh', '申报电量', S.quant_review),
      a('actualMwh', '实际电量', S.quant_review),
      a('deviationMwh', '偏差量', S.quant_review),
      a('deviationRate', '偏差率', S.quant_review),
      a('assessPrice', '考核单价', S.settlement_rules, { caliber: 'self-computed' }),
      a('ltmEnergy', '中长期电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('daClearedEnergy', '日前出清电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('daDevEnergy', '日前增量电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('rtDevEnergy', '实时增量电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('actualOnGridEnergy', '实际上网电量 MWh（云南结算口径）', S.quant_settlement_review),
      a('daDevFee', '日前增量电费 元（云南南网口径，非偏差考核罚款）', S.quant_settlement_review, { caliber: 'self-computed' }),
      a('rtDevFee', '实时增量电费 元（云南南网口径，非偏差考核罚款）', S.quant_settlement_review, { caliber: 'self-computed' }),
      a('totalFee', '结算总电费 元（直传结算单源值，非三段相加）', S.quant_settlement_review, { caliber: 'self-computed' }),
      a('avgPrice', '结算加权均价 元/MWh（ΣtotalFee/ΣtotalEnergy）', S.quant_settlement_review, { caliber: 'self-computed' }),
      
      h('responsibleDept', '责任部门'),
      h('improveTarget', '改进目标（下月偏差率目标值，目标数值待 P2）'),
    ],
  }),
  Object.freeze({
    id: 'T09', name: '月度风险事件报告', dimension: 'risk', subject: 'common',
    cadences: ['monthly', 'event'], automation: 'B', readiness: 'ready',
    trigger: '每月；极端价格/断面阻塞/平台异常即时报送；止损/仓位越限阈值触发', deadline: '每月/即时',
    roles: { fill: 'RISK', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '「侥幸逃过」独立附记（near_miss），不计损失金额但入案例库；风险事件库落地归 #2047，本模板消费其登记。',
    fields: [
      a('eventTime', '事件时间', S.review_pg),
      h('eventType', '事件类型', { required: true }),
      h('riskLevel', '风险等级（高/中/低）', { required: true }),
      a('impactYuan', '影响金额 万元', S.review_pg, { caliber: 'self-computed' }),
      a('positionAtTime', '当时仓位', S.declaration_record),
      h('disposal', '处置措施', { required: true }),
      h('effective', '措施是否有效'),
      h('lessons', '教训与改进', { required: true }),
    ],
  }),
  Object.freeze({
    id: 'T10', name: '极端情景压力测试报告', dimension: 'risk', subject: 'common',
    cadences: ['quarterly', 'event'], automation: 'C', readiness: 'ready',
    trigger: '每季度；重大交易规则变化/极端行情后临时测试', deadline: '每季度/临时',
    roles: { fill: 'RISK', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '敞口测算包装既有蒙特卡洛 VaR/CVaR 引擎（决策参考非结算依据）；评级「弱」限期整改复测跟踪。',
    fields: [
      h('scenario', '情景假设（极端价格/断面阻塞/平台异常）', { required: true }),
      h('scenarioDesc', '情景描述（参数依据）', { required: true }),
      a('exposureYuan', '敞口测算 万元', S.quant_risk_engine, { caliber: 'self-computed' }),
      h('capacityRating', '承受能力评级（强/中/弱）', { required: true }),
      h('plan', '应对预案'),
      h('drillStatus', '演练情况（已演练/未演练）'),
      h('conclusion', '结论（可承受/需加固）', { required: true }),
    ],
  }),
  Object.freeze({
    id: 'T11', name: '情绪化决策分析报告', dimension: 'decision', subject: 'common',
    cadences: ['quarterly'], automation: 'B', readiness: 'deferred',
    trigger: '每季度', deadline: '每季度',
    roles: { fill: 'TRADE_LEAD', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '数据源=决策复盘单情绪栏与决策日志积累（T01/#2037 落地后才有样本），M4 启动（#2049）；先规则清单后模型，仅学习辅导定位、不做排名与考核。',
    fields: [
      a('trader', '交易员', S.review_pg),
      a('emotionalCount', '情绪化决策次数', S.review_pg),
      ai('typicalBehavior', '典型表现（追涨/杀跌/过度自信/犹豫）'),
      ai('triggerContext', '触发情境'),
      h('intervention', '干预措施', { required: true }),
      h('effectTracking', '效果跟踪（下季度逐人回查）'),
    ],
  }),
  Object.freeze({
    id: 'T12', name: '复盘会议纪要', dimension: 'decision', subject: 'common',
    cadences: ['weekly'], automation: 'C', readiness: 'ready',
    trigger: '每周复盘会（建议周五）', deadline: '会后 1 个工作日',
    roles: { fill: 'TRADE_LEAD', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '「上期改进措施落实情况」自动带入 improvement_actions 未闭环项（#2049）。',
    fields: [
      h('meetingTime', '会议时间/地点', { required: true }),
      h('attendees', '主持人/参会人', { required: true }),
      a('prevActionStatus', '上期改进措施落实情况', S.review_pg),
      a('currentReport', '本期交易情况通报', S.quant_review),
      h('discussions', '分维度复盘讨论'),
      h('problems', '问题清单与根因', { required: true }),
      h('actions', '改进措施与责任分工', { required: true }),
      h('deadline', '完成时限', { required: true }),
      h('nextMeeting', '下次会议时间'),
    ],
  }),
  Object.freeze({
    id: 'T13', name: '复盘案例库登记表', dimension: 'decision', subject: 'common',
    cadences: ['continuous'], automation: 'C', readiness: 'ready',
    trigger: '案例入库（持续登记；T01「是否入库=是」与 T09 near_miss 自动同步）', deadline: '持续',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '案例编号 AL-YYYYMMDD-NNN 服务端生成；涉商业敏感默认不公开（visibility internal）。智能体侧无登记工具：原 L2 审批工具 register_review_case 未绑定任何角色（#2531 起任务书不再点名），工具本体已随 #2541 删除；案例由人工经复盘案例库登记（周/月复盘把典型案例写入报告正文供此用）。',
    fields: [
      a('caseNo', '案例编号 AL-YYYYMMDD-NNN', S.review_pg),
      h('caseType', '案例类型（决策/风险/偏差）', { required: true }),
      h('title', '案例标题', { required: true }),
      h('background', '背景摘要', { required: true }),
      h('conclusion', '复盘结论', { required: true }),
      h('lessons', '提炼经验', { required: true }),
      h('applicableScene', '适用场景'),
      a('registrant', '登记人', S.identity),
      h('visibility', '是否公开（公开/内部）'),
    ],
  }),

  // ── 储能专属 S1–S5 ──────────────────────────────────────────────────────
  Object.freeze({
    id: 'S1', name: '峰谷套利复盘表', dimension: 'result', subject: 'storage',
    cadences: ['daily', 'monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '每日结算数据出具/次月 5 个工作日内；连续三日未达预期价差关联市场归因', deadline: '每日/每月',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '「实际充放电量/套利收益」缺实际执行数据族（D1）；充放电均价的价格侧（clearing_price）今天可用。套利价差须扣往返效率折算。',
    fields: [
      a('date', '日期', S.review_pg),
      a('chargeWindow', '充电时段', S.storage_dispatch_plan),
      a('dischargeWindow', '放电时段', S.storage_dispatch_plan),
      a('chargeAvgPrice', '充电均价 元/MWh', S.clearing_price),
      a('dischargeAvgPrice', '放电均价 元/MWh', S.clearing_price),
      a('spreadYuanMwh', '套利价差（扣往返效率）', S.review_pg),
      a('throughputMwh', '充放电量 MWh', S.manual_entry),
      a('arbitrageYuan', '套利收益 万元', S.review_pg, { caliber: 'self-computed' }),
      h('planDeviation', '较计划偏差（提前/延后/未按计划及原因）'),
    ],
  }),
  Object.freeze({
    id: 'S2', name: '辅助服务收益复盘表', dimension: 'result', subject: 'storage',
    cadences: ['weekly', 'monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '每周复盘会/次月 5 个工作日内', deadline: '每周/每月',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '辅助服务参与与收益数据（品种/时段/中标容量/调用电量/收益成本）全缺（D2），当前只能人工录入。',
    fields: [
      h('serviceType', '辅助服务品种（调频/调峰/备用）', { required: true }),
      a('window', '参与时段', S.manual_entry),
      a('awardedMw', '中标容量 MW', S.manual_entry),
      a('dispatchedMwh', '实际调用电量 MWh', S.manual_entry),
      a('revenueYuan', '收益 万元', S.manual_entry, { caliber: 'self-computed' }),
      a('costYuan', '成本 万元（含损耗与电池衰减折算）', S.manual_entry, { caliber: 'self-computed' }),
      a('netYuan', '净收益 万元', S.review_pg, { caliber: 'self-computed' }),
      h('metExpectation', '是否达到预期（未达须提申报策略调整建议）'),
    ],
  }),
  Object.freeze({
    id: 'S3', name: '充放电计划执行偏差复盘表', dimension: 'deviation', subject: 'storage',
    cadences: ['weekly'], automation: 'B', readiness: 'data_gap',
    trigger: '每周', deadline: '每周',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '计划侧（storage_dispatch_plan）今天可用；实际充放电缺数据族（D1）。设备故障类偏差须同步运维。',
    fields: [
      a('date', '日期', S.review_pg),
      a('plannedChargeMwh', '计划充电量 MWh', S.storage_dispatch_plan),
      a('actualChargeMwh', '实际充电量 MWh', S.manual_entry),
      a('plannedDischargeMwh', '计划放电量 MWh', S.storage_dispatch_plan),
      a('actualDischargeMwh', '实际放电量 MWh', S.manual_entry),
      h('causeCategory', '偏差原因归类（预测偏差/调度指令/设备故障/策略调整/其他）', { required: true }),
      h('correction', '纠偏措施'),
    ],
  }),
  Object.freeze({
    id: 'S4', name: '储能容量利用率与SOC复盘表', dimension: 'risk', subject: 'storage',
    cadences: ['monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '次月 5 个工作日内', deadline: '每月',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '等效满充放/容量利用率/平均SOC区间/循环效率全部依赖实际运行数据（D1）。',
    fields: [
      a('metric', '指标（等效满充放次数/容量利用率/平均SOC区间/充放电循环效率）', S.review_pg),
      a('currentValue', '本月值', S.manual_entry),
      a('prevValue', '上月值', S.review_pg),
      h('targetValue', '目标值'),
      a('met', '是否达标', S.review_pg),
      h('note', '说明（SOC 超设计区间须关注电池健康度）'),
    ],
  }),
  Object.freeze({
    id: 'S5', name: '储能投资决策复盘单', dimension: 'decision', subject: 'storage',
    cadences: ['monthly', 'quarterly'], automation: 'B', readiness: 'data_gap',
    trigger: '次月 5 个工作日内/每季度（投资级复盘，区别于日常交易复盘）', deadline: '每月/每季度',
    roles: { fill: 'TRADE_LEAD', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '投资测算侧（investment_runs）已有；「实际运营」侧的收益/循环次数依赖 D1/D2。偏差超 20% 逐项分析。',
    fields: [
      a('item', '项目（套利收益/辅助服务/容量补偿/循环次数/IRR）', S.investment_runs),
      a('forecast', '投资测算', S.investment_runs, { caliber: 'self-computed' }),
      a('actual', '实际运营', S.manual_entry, { caliber: 'self-computed' }),
      a('deviation', '偏差', S.review_pg),
      h('analysis', '原因分析（偏差超 20% 必填）'),
      h('overallEvaluation', '总体评价（达成/部分达成/未达成）', { required: true }),
      h('investmentAdvice', '投资建议（追加/维持/缩减/退出）', { required: true }),
    ],
  }),

  // ── 售电公司专属 R1–R5 ──────────────────────────────────────────────────
  Object.freeze({
    id: 'R1', name: '代理购电偏差复盘表', dimension: 'deviation', subject: 'retail',
    cadences: ['daily', 'monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '每日结算数据出具/次月 5 个工作日内', deadline: '每日/每月',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '分客户明细缺（D4）；公司级合计行可由 quant /review 先行（山西覆盖区真实可验证）。',
    fields: [
      a('customer', '客户/主体', S.manual_entry),
      a('declaredMwh', '申报电量 MWh', S.quant_review),
      a('actualMwh', '实际用电 MWh', S.quant_review),
      a('deviationMwh', '偏差量 MWh', S.quant_review),
      a('deviationRate', '偏差率', S.quant_review),
      
      h('attribution', '偏差归因（预测不准/客户临时增减/生产波动/操作失误）', { required: true }),
      h('improvement', '改进措施'),
    ],
  }),
  Object.freeze({
    id: 'R2', name: '零售套餐履约复盘表', dimension: 'result', subject: 'retail',
    cadences: ['quarterly'], automation: 'A', readiness: 'data_gap',
    trigger: '每季度', deadline: '每季度',
    roles: { fill: 'RETAIL', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '零售套餐与签约客户档案全缺（D3）；连续两季亏损套餐应评估停售或调价。',
    fields: [
      a('packageName', '套餐名称', S.manual_entry),
      a('customers', '签约客户数', S.manual_entry),
      a('packageMwh', '套餐电量 MWh', S.manual_entry),
      a('actualMwh', '实际用电 MWh', S.manual_entry),
      a('revenueYuan', '套餐结算收益 万元', S.manual_entry, { caliber: 'self-computed' }),
      a('fulfilmentDeviation', '履约偏差率', S.review_pg),
      a('complaints', '客户投诉情况', S.manual_entry),
      h('adjustAdvice', '套餐调整建议'),
    ],
  }),
  Object.freeze({
    id: 'R3', name: '用户用电结构与售电收益拆解表', dimension: 'result', subject: 'retail',
    cadences: ['weekly', 'monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '每周复盘会/次月 5 个工作日内', deadline: '每周/每月',
    roles: { fill: 'RETAIL', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '分客户类型的售电量/购电成本/收入全缺（D3/D4）。高毛利低偏差客户重点维护、低毛利高偏差评估调价退出。',
    fields: [
      a('customerType', '客户类型（大工业/一般工商业/其他）', S.manual_entry),
      a('users', '用户数', S.manual_entry),
      a('soldMwh', '售电量 MWh', S.manual_entry),
      a('purchaseCostYuan', '购电成本 万元', S.manual_entry, { caliber: 'self-computed' }),
      a('revenueYuan', '售电收入 万元', S.manual_entry, { caliber: 'self-computed' }),
      a('grossYuan', '毛利 万元', S.review_pg, { caliber: 'self-computed' }),
      a('grossMargin', '毛利率', S.review_pg),
      a('deviationCostYuan', '偏差成本 万元', S.quant_review, { caliber: 'self-computed' }),
    ],
  }),
  Object.freeze({
    id: 'R4', name: '售电偏差考核成本核算表', dimension: 'deviation', subject: 'retail',
    cadences: ['daily', 'monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '每日结算数据出具/次月 5 个工作日内', deadline: '每日/每月',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '分客户口径缺（D4），公司级可先行；考核单价自算口径（D6），对偏差大户签保底条款属业务动作系统只记录。',
    fields: [
      a('customer', '客户', S.manual_entry),
      a('deviationMwh', '偏差电量 MWh', S.quant_review),
      a('deviationRate', '偏差率', S.quant_review),
      a('assessPrice', '考核单价 元/MWh', S.settlement_rules, { caliber: 'self-computed' }),
      
      h('responsibility', '责任归属（客户原因/预测原因/操作原因）', { required: true }),
      h('nextTarget', '下月改进目标'),
    ],
  }),
  Object.freeze({
    id: 'R5', name: '售电侧月度综合复盘报告', dimension: 'result', subject: 'retail',
    cadences: ['monthly'], automation: 'B', readiness: 'ready',
    trigger: '次月 5 个工作日内', deadline: '每月',
    roles: { fill: 'TRADE_LEAD', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '四板块（电量与偏差/购电策略/售电业务/市场政策）引用各专属模板数据；R1–R4 数据缺口处如实空并标注，不合成；「下月行动」须责任人+时限。',
    fields: [
      a('section', '板块', S.review_pg),
      a('keyPoints', '复盘要点', S.review_pg),
      a('currentStatus', '本月情况（引用专属模板，缺数如实空）', S.quant_review),
      h('risks', '问题与风险', { required: true }),
      h('nextActions', '下月行动（责任人+时限）', { required: true }),
    ],
  }),

  // ── 新能源电厂专属 N1–N5 ────────────────────────────────────────────────
  Object.freeze({
    id: 'N1', name: '出力预测准确率复盘表', dimension: 'deviation', subject: 'renewable',
    cadences: ['daily'], automation: 'A', readiness: 'ready', slots24: true,
    trigger: '每日结算数据出具', deadline: '每日',
    roles: { fill: 'RENEWABLE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '首个真实试点限中广核云南场站（实际出力+预测域产出都有）；其他主体/地区诚实空态。准确率达标标准按当地电网考核口径（P2 待提供，先用 MAPE≤10% 缺省并标注）。24 时段=96 点展示聚合。',
    fields: [
      a('forecastMw', '预测功率 MW', S.forecast_output),
      a('actualMw', '实际出力 MW', S.cgn_station_rt),
      a('deviationMw', '偏差功率 MW', S.review_pg),
      a('deviationRate', '偏差率', S.review_pg),
      a('weatherType', '天气类型', S.manual_entry),
      a('met', '准确率达标', S.review_pg),
      h('cause', '偏差原因（连续低准确率时段关联天气型分析模型短板）'),
    ],
  }),
  Object.freeze({
    id: 'N2', name: '新能源偏差考核复盘表', dimension: 'deviation', subject: 'renewable',
    cadences: ['monthly'], automation: 'A', readiness: 'ready',
    trigger: '次月 5 个工作日内', deadline: '每月',
    roles: { fill: 'RENEWABLE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '申报（declaration_record）vs 实际出力（中广核场站侧）；考核费自算口径；限电致偏差单独统计与调度核实。',
    fields: [
      a('date', '日期', S.declaration_record),
      a('declaredMwh', '申报电量 MWh', S.declaration_record),
      a('actualMwh', '实际出力 MWh', S.cgn_station_rt),
      a('deviationMwh', '偏差量 MWh', S.review_pg),
      a('deviationRate', '偏差率', S.review_pg),
      a('assessFeeYuan', '考核费用 万元', S.settlement_rules, { caliber: 'self-computed' }),
      h('attribution', '偏差归因（预测误差/限电/设备故障/策略调整）', { required: true }),
      h('improvement', '改进措施'),
    ],
  }),
  Object.freeze({
    id: 'N3', name: '弃电率复盘表', dimension: 'result', subject: 'renewable',
    cadences: ['weekly', 'monthly'], automation: 'A', readiness: 'data_gap',
    trigger: '每周复盘会/次月 5 个工作日内', deadline: '每周/每月',
    roles: { fill: 'RENEWABLE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '「理论出力」口径与限电指令记录缺（D5）；实际发电有（中广核场站侧）。弃电率高于区域平均须分析送出通道与签约因素。',
    fields: [
      a('month', '月份', S.review_pg),
      a('theoreticalMwh', '理论出力 MWh', S.manual_entry),
      a('actualMwh', '实际发电 MWh', S.cgn_station_rt),
      a('curtailedMwh', '弃电量 MWh', S.review_pg),
      a('curtailRate', '弃电率', S.review_pg),
      h('cause', '弃电原因（限电/阻塞/检修）', { required: true }),
      h('improvement', '改善措施'),
    ],
  }),
  Object.freeze({
    id: 'N4', name: '中长期签约策略复盘表', dimension: 'strategy', subject: 'renewable',
    cadences: ['quarterly'], automation: 'B', readiness: 'data_gap',
    trigger: '每季度', deadline: '每季度',
    roles: { fill: 'TRADER', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '中长期签约台账（签约电量/均价/结算均价）依赖 S6 合约库线（#1966）；现货价对比侧（clearing_price）已有。',
    fields: [
      a('variety', '签约品种（年度长协/月度竞价/绿电交易）', S.manual_entry),
      a('contractMwh', '签约电量 MWh', S.manual_entry),
      a('contractAvgPrice', '签约均价 元/MWh', S.manual_entry),
      a('settledAvgPrice', '实际结算均价 元/MWh', S.manual_entry, { caliber: 'self-computed' }),
      a('share', '占比（签约电量÷总发电量）', S.review_pg),
      a('spotSpread', '与现货价差', S.clearing_price),
      h('evaluation', '策略评价', { required: true }),
      h('nextAdjust', '下季调整'),
    ],
  }),
  Object.freeze({
    id: 'N5', name: '功率预测模型评估表', dimension: 'strategy', subject: 'renewable',
    cadences: ['quarterly'], automation: 'A', readiness: 'deferred',
    trigger: '每季度', deadline: '每季度',
    roles: { fill: 'RENEWABLE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '模型评估归预测域（#1898 远程推理分离，评估/门禁留平台）；模板侧待预测域评估面稳定后接入，暂 deferred。',
    fields: [
      a('scenario', '评估场景（晴好/多云阴/大风强对流）', S.forecast_output),
      a('samples', '样本数', S.forecast_output),
      a('maeM w', '平均绝对误差 MW', S.forecast_output),
      a('errRate', '误差率', S.forecast_output),
      h('extremePerf', '极端天气表现'),
      h('usable', '模型是否可用', { required: true }),
      h('iterationAdvice', '迭代建议'),
    ],
  }),

  // ── 储能 24 时段 E1–E3 ─────────────────────────────────────────────────
  Object.freeze({
    id: 'E1', name: '24时段充放电策略编排表', dimension: 'strategy', subject: 'storage',
    cadences: ['daily'], automation: 'B', readiness: 'ready', slots24: true,
    trigger: '每日，日前申报截止前完成', deadline: '日前申报前',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    notes: '计划侧接既有事前测算；**价格默认 illustrative 即 MOCK，页面必须明示，接真实价格才可用于实盘编排**；SOC 越限时段不安排充电（约束在测算引擎）。24 时段=96 点展示聚合；峰谷标识读 SettlementRuleSpec、未参数化省份显式提示（P1）。',
    fields: [
      a('daForecastPrice', '日前预测价 元/MWh', S.forecast_output),
      a('peakValleyFlag', '峰谷标识', S.settlement_rules),
      a('decision', '充放电决策（充电/放电/停运/调峰备用）', S.storage_dispatch_plan),
      a('chargeMw', '充电功率 MW', S.storage_dispatch_plan),
      a('dischargeMw', '放电功率 MW', S.storage_dispatch_plan),
      a('expectedYuan', '预期收益 万元（放电量×放电价−充电量×充电价÷循环效率）', S.storage_dispatch_plan, { caliber: 'self-computed' }),
      h('note', '备注'),
    ],
  }),
  Object.freeze({
    id: 'E2', name: '24时段充放电执行与偏差复盘表', dimension: 'deviation', subject: 'storage',
    cadences: ['daily'], automation: 'B', readiness: 'data_gap', slots24: true,
    trigger: '每日结算数据出具后', deadline: '当日结算后',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '计划侧可用；「实际充电/实际放电」逐时段执行数据缺（D1）。设备故障类偏差同步运维并评估当日套利影响。',
    fields: [
      a('plannedChargeMwh', '计划充电 MWh', S.storage_dispatch_plan),
      a('actualChargeMwh', '实际充电 MWh', S.manual_entry),
      a('plannedDischargeMwh', '计划放电 MWh', S.storage_dispatch_plan),
      a('actualDischargeMwh', '实际放电 MWh', S.manual_entry),
      a('deviationMwh', '偏差电量 MWh', S.review_pg),
      h('causeCategory', '偏差原因归类（电价预测偏差/调度指令/设备故障/策略调整/其他）', { required: true }),
    ],
  }),
  Object.freeze({
    id: 'E3', name: '24时段电价与套利复盘表', dimension: 'result', subject: 'storage',
    cadences: ['daily'], automation: 'A', readiness: 'data_gap', slots24: true,
    trigger: '每日；日前实时走势背离计划假设须备注并作次日策略调整依据', deadline: '每日',
    roles: { fill: 'STORAGE_OPERATOR', review: 'TRADE_LEAD' }, retentionYears: 5,
    gapNote: '日前/实时电价两列今天可用（clearing_price 覆盖区）；「套利执行情况/套利收益」依赖实际执行（D1），电价列先行。',
    fields: [
      a('daPrice', '日前出清价 元/MWh', S.clearing_price),
      a('rtPrice', '实时出清价 元/MWh', S.clearing_price),
      a('spread', '价差（实时−日前）', S.review_pg),
      a('peakValleyFlag', '峰谷标识', S.settlement_rules),
      h('arbitrageExec', '套利执行情况（已执行/部分执行/未执行及原因）'),
      a('arbitrageYuan', '套利收益 万元', S.review_pg, { caliber: 'self-computed' }),
    ],
  }),
])

/** 全部模板 id（顺序即注册顺序，守卫快照锁死） */
export const TEMPLATE_IDS = Object.freeze(REVIEW_TEMPLATES.map((t) => t.id))

const BY_ID = new Map(REVIEW_TEMPLATES.map((t) => [t.id, t]))

/** @returns {object | null} 按 id 取模板，不存在返回 null（不抛：调用方决定缺失语义） */
export function templateById(id) {
  return BY_ID.get(id) ?? null
}

/** 按触发周期筛选（'daily' 会命中 cadences 含 daily 的多周期模板） */
export function templatesByCadence(cadence) {
  return REVIEW_TEMPLATES.filter((t) => t.cadences.includes(cadence))
}

/** 按责任主体筛选；common 模板适用全部主体，故 subject 特定值会同时返回 common */
export function templatesBySubject(subject, { includeCommon = true } = {}) {
  return REVIEW_TEMPLATES.filter(
    (t) => t.subject === subject || (includeCommon && t.subject === 'common'),
  )
}

/** 按六维维度筛选 */
export function templatesByDimension(dimension) {
  return REVIEW_TEMPLATES.filter((t) => t.dimension === dimension)
}

/** 就绪度汇总：驾驶舱与验收台账共用的口径 */
export function readinessSummary() {
  const counts = { ready: 0, data_gap: 0, deferred: 0 }
  for (const t of REVIEW_TEMPLATES) counts[t.readiness] += 1
  return Object.freeze({ ...counts, total: REVIEW_TEMPLATES.length })
}
