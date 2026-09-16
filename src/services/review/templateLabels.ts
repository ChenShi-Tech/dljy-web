// 复盘模板注册表（shared/ 契约面，只读）里的来源代号与口径枚举是给代码和门禁用的，
// 说明文字里满是接口名、数据族与迁移编号。页面上一律换成交易员看得懂的业务名称。
import { roleLabels } from '@/services/governance'

/** 数据来源 → 业务名称。注册表每新增一个来源都必须在这里登记，由单测守住。 */
export const SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  quant_review: '偏差考核测算',
  quant_settlement_review: '云南结算核对',
  quant_backtest: '申报回测',
  quant_risk_engine: '风险与报价测算（决策参考）',
  quant_storage_backtest: '储能峰谷套利回测',
  declaration_record: '申报单记录',
  declaration_preflight: '一日作业留痕',
  clearing_price: '出清价格',
  loss_attribution: '云南偏差三段归因',
  trading_memory: '历史交易胜率统计',
  settlement_rules: '分省结算规则',
  review_pg: '复盘台账',
  investment_runs: '储能投资测算记录',
  storage_dispatch_plan: '储能充放电测算',
  forecast_output: '预测结果',
  cgn_station_rt: '场站实际出力',
  market_disclosure: '市场披露数据',
  identity: '填表与审核人记录',
  manual_entry: '人工录入',
})

/** 未登记的来源不回显代号，只说明是系统来源。 */
export function sourceLabel(source: string | undefined): string {
  return (source && SOURCE_LABELS[source]) || '系统来源'
}

/** 口径枚举 → 业务说明。金额类字段是自算口径，必须让读者知道它不是正式结算。 */
export const CALIBER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'self-computed': '系统自算，非正式结算',
})

export function caliberLabel(caliber: string | undefined): string {
  return (caliber && CALIBER_LABELS[caliber]) || '口径待核实'
}

/** 复盘周期代码 → 业务说明。 */
export const CADENCE_LABELS: Readonly<Record<string, string>> = Object.freeze({ daily: '每日', weekly: '每周', monthly: '每月', quarterly: '每季', event: '事件触发', continuous: '持续记录' })
export function cadenceLabel(cadence: string): string { return CADENCE_LABELS[cadence] ?? '按需' }

/** 模板里的岗位代码 → 中文岗位名。优先用平台统一的角色名，模板专用岗位在此补齐。 */
export const TEMPLATE_ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({ RENEWABLE_OPERATOR: '新能源运营', RETAIL: '售电人员', SYSTEM: '系统自动' })
export function roleLabel(role: string): string {
  return TEMPLATE_ROLE_LABELS[role] ?? (roleLabels as Record<string, string>)[role] ?? '指定岗位'
}

/** 来自这些来源的字段是基于演示价格测算的，页面必须点名这些字段并明示为模拟数据。 */
export const MOCK_PRICE_SOURCES: ReadonlySet<string> = new Set(['storage_dispatch_plan'])

/**
 * 模板备注的业务版。注册表 notes 里混着真正的操作规则（给交易员）与议题号、缺口编号、实现说明
 * （给开发与验收）。这里只保留操作规则；注册表每个带 notes 的模板都必须在此登记，由单测守住，
 * 避免规则在页面上被悄悄丢掉。
 */
export const TEMPLATE_NOTES: Readonly<Record<string, string>> = Object.freeze({
  T01: '依据、结论、改进措施三栏只能由交易员填写，系统与智能体不代填；提交后锁定，如需更正请追加记录。',
  T03: '盈亏排名与月度收益拆解来自同一次计算；标记为纳入案例库的交易会同步登记到复盘案例库。',
  T04: '样本不足 30 笔时不下胜率结论，只标「样本不足」；回测与实盘两种口径分列展示。',
  T05: '同一交易员连续两次出现同类偏差时，须做专项分析。',
  T06: '价格与供需行由系统预填；政策影响由人工关联，智能体只提供建议，不做自动因果判断；「下月关注点」会转为改进措施跟进；异常价格事件与风险事件记录互相引用。',
  T07: '责任归因（预测不准、突发情况、策略失误、操作失误）仅在周度汇总时由人工补填，与日度业务成因分开记录；上期改进措施需逐项回查。云南按结算三段式口径复盘，偏差测算字段与结算字段不混填。',
  T08: '考核单价与金额为系统自算口径，正式结算细则尚未核验。云南按结算三段式口径核算，偏差测算字段与结算字段不混填。',
  T09: '侥幸逃过的险情单独附记，不计损失金额，但须登记到复盘案例库。',
  T10: '敞口测算为决策参考，不作为结算依据；评级为「弱」的须限期整改并复测跟踪。',
  T12: '「上期改进措施落实情况」自动带入尚未闭环的改进措施。',
  T13: '案例编号由系统生成；涉及商业敏感的案例默认不公开。案例由人工登记，周、月复盘可把典型案例写入报告正文。',
  R5: '四个板块（电量与偏差、购电策略、售电业务、市场政策）引用各专项复盘表的数据；暂缺资料处如实留空并标注，不做推算；「下月行动」必须写明责任人和时限。',
  N1: '目前仅本公司云南场站具备实际出力与预测数据，其他主体或地区如实留空。准确率达标标准按当地电网考核口径，未提供前暂按平均绝对百分比误差不超过 10% 并标注。按 24 个时段展示（底层 96 点按小时聚合）。',
  N2: '申报电量对比场站实际出力；考核费为系统自算口径；因限电造成的偏差单独统计，并与调度核实。',
  E1: '充放电计划基于事前测算，荷电状态越限的时段不安排充电。按 24 个时段展示（底层 96 点按小时聚合）；未配置峰谷时段的省份会明确提示，不借用其他省份的划分。',
})

/**
 * 资料缺口说明的业务版。注册表 gapNote 同样混着缺口编号、议题号与接口名，但也写着交易员要遵守的规则
 * （扣往返效率、连续亏损评估停售、偏差超 20% 逐项分析等），不能整段换成通用提示。
 * 注册表每个带 gapNote 的模板都必须在此登记，由单测守住。
 */
export const TEMPLATE_GAP_NOTES: Readonly<Record<string, string>> = Object.freeze({
  T02: '中长期品种收益、正式结算单与逐笔成交归集尚未接入；现货部分可先依据申报回测与结算核对复盘。',
  T11: '需要决策复盘单的情绪记录与决策日志积累足够样本后才能分析；先按规则清单辅导，只用于学习改进，不做排名与考核。',
  S1: '实际充放电量与套利收益所需的执行数据尚未接入；充放电均价的价格部分已可用。套利价差须扣除往返效率折算。',
  S2: '辅助服务的参与与收益数据（品种、时段、中标容量、调用电量、收益成本）尚未接入，目前只能人工录入。',
  S3: '计划充放电已可用，实际充放电数据尚未接入。设备故障类偏差须同步运维。',
  S4: '等效满充放、容量利用率、平均荷电状态区间与循环效率都依赖实际运行数据，尚未接入。',
  S5: '投资测算部分已可用；实际运营的收益与循环次数依赖运行与辅助服务数据，尚未接入。实际与测算偏差超过 20% 须逐项分析。',
  R1: '分客户明细尚未接入；公司级合计可先行复盘。',
  R2: '零售套餐与签约客户档案尚未接入；连续两个季度亏损的套餐应评估停售或调价。',
  R3: '分客户类型的售电量、购电成本与收入尚未接入。高毛利低偏差客户重点维护，低毛利高偏差客户评估调价或退出。',
  R4: '分客户口径尚未接入，公司级可先行；考核单价为系统自算口径。对偏差大户签订保底条款属于业务动作，系统只做记录。',
  N3: '理论出力口径与限电指令记录尚未接入，实际发电数据已有。弃电率高于区域平均时须分析送出通道与签约因素。',
  N4: '中长期签约台账（签约电量、均价、结算均价）尚未接入；现货价格对比部分已可用。',
  N5: '模型评估需接入预测服务的评估结果后提供，目前暂缓。',
  E2: '计划充放电已可用，逐时段实际充放电执行数据尚未接入。设备故障类偏差须同步运维，并评估对当日套利的影响。',
  E3: '日前、实时电价两列已可用；套利执行情况与收益依赖实际执行数据，尚未接入。',
})
