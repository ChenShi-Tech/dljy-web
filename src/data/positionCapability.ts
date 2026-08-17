// ============================================================================
// 立场能力表：市场立场（subjectType）→ 今天要交哪张申报单
// ----------------------------------------------------------------------------
// 「立场」在本仓不是新概念，它就是已有的 `SubjectType`（GROUP/GENERATOR/RETAILER/
// STORAGE/LOAD/TRADER）。它此前只驱动**数据过滤**（按 RBAC+subjectType+companyId），
// 没有驱动**装配**——申报工作台一度把单据类型硬编码成售电侧，储能运营打开它看到的
// 是售电单据。本表把立场提升为装配开关。
//
// 立场的可证伪定义（防止往这个概念里塞不属于它的东西）：
//   **立场 = 你在交易中心注册成什么市场主体 = 决定你每天提交哪张单子。**
//   说不出「换了立场，今天要交的单据有什么不同」，就不是立场问题。
//
// 与省域（region）的关系：**有一个真实交叉格，不是正交。**
//   同一个「独立储能」立场，新疆是强制价格接受者、山东是强制报量报价（充放各 ≤5 段
//   + SOC 参数）、广东可选且调度可临时强制切换。所以「储能怎么报价」既不属于立场
//   也不属于省域，属于两者交叉格 → `quoteMode` 的真值最终应由 rulepack 按立场分支
//   给出，本表提供的是**立场默认形态**（当前以新疆规则实例化）。
//
// 与公司（tenant）的关系：**另一个交叉格。**
//   立场决定「要不要这个能力」，公司资产台账决定「现在能不能用」——持储能立场但
//   场站在建，储能线应为「已装配·无在运资产」，与「未装配」的界面表现不同。
// ============================================================================

import type { SubjectType } from '@/services/governance'

/**
 * 报价模式。三者是结构性不同的申报形态，不是同一张表的不同取值：
 * - `quantity_price`：报量报价（发电侧分段报价、山东用户侧）
 * - `quantity_only`：报量不报价（新疆/山西用户侧 96 点需求曲线）
 * - `price_taker`：价格接受者（新疆独立储能，只报充放曲线）
 */
export type QuoteMode = 'quantity_price' | 'quantity_only' | 'price_taker'

export const QUOTE_MODE_LABEL: Record<QuoteMode, string> = {
  quantity_price: '报量报价',
  quantity_only: '报量不报价',
  price_taker: '价格接受者'
}

/** 手册 S3「方向判断与报价/曲线定稿」的三条并行业务线。 */
export type ScenarioLine = 'A' | 'B' | 'C'

export const SCENARIO_LINE_LABEL: Record<ScenarioLine, string> = {
  A: '线A 储能充放电曲线',
  B: '线B 用户侧需求曲线',
  C: '线C 发电侧分段报价'
}

export type DeclarationLine = {
  id: string
  /** 手册第六章表单编号（T1 分段报价单 / T2 储能计划表 / T3 需求曲线申报单） */
  formCode: 'T1' | 'T2' | 'T3'
  title: string
  quoteMode: QuoteMode
  scenarioLine: ScenarioLine
  /**
   * 阻断式校验要点（界面展示用，供交易员预知会被什么拦住）。
   * **权威校验在服务端申报状态机上**，此处仅为提示，不作为通过依据。
   */
  blockingChecks: string[]
  /** 该线的作业入口（深链回既有页面，不重复实现） */
  route: string
  /** 需要物理资产才可用（对应 Asset 类场景：无在运资产则该线为「无资产」态） */
  requiresAsset?: 'ess'
}

const LINE_STORAGE: DeclarationLine = {
  id: 'ess-curve',
  formCode: 'T2',
  title: '储能日充放电计划',
  quoteMode: 'price_taker',
  scenarioLine: 'A',
  blockingChecks: [
    'SOC 全程在管理带 [10%, 90%]',
    '终止 SOC 达目标值 ±3%',
    '日循环次数 ≤ 2 次',
    '月度累计充电 ≤ 额定充电功率 × 12h × 当月天数',
    '不触碰身份混用红线（充电侧与售电采购须分账户分标的）'
  ],
  // 储能线的作业面是专门的计划页（R1/R2/R3/R11 推演 + 八项约束），不是通用申报台
  route: '/xhjy/storage-plan',
  requiresAsset: 'ess'
}

const LINE_DEMAND: DeclarationLine = {
  id: 'demand-curve',
  formCode: 'T3',
  title: '用户侧 96 点需求曲线',
  quoteMode: 'quantity_only',
  scenarioLine: 'B',
  blockingChecks: [
    '申报偏置任一小时 ≤ ±20%（管理带，法定带 ±30%）',
    '中长期履约率落在 [85%, 115%]（法定带 [80%, 120%]）',
    '负荷预测已做线损还原'
  ],
  route: '/xhjy/desk'
}

const LINE_GENERATION: DeclarationLine = {
  id: 'gen-segments',
  formCode: 'T1',
  title: '发电侧分段报价',
  quoteMode: 'quantity_price',
  scenarioLine: 'C',
  blockingChecks: [
    '分段数 ≤ 10 段',
    '逐段单调非递减',
    '每段长度 ≥ (Pmax − Pmin) × 10%',
    '报价为整数元/MWh 且在申报限价内',
    '市场力合规自检（集中报价群组隔离要求）'
  ],
  route: '/xhjy/desk'
}

/**
 * 立场 → 申报线装配表。
 *
 * `TRADER`（交易组合）是组合管理视角，本身不对应单一单据，装配全部三条线——
 * 它的持有者通常需要在各立场视角间切换（见 stanceContext 的作业立场切换）。
 * `GROUP`（集团）是管理层只读视角，不申报，故为空数组：交易台对它显示
 * 「当前立场无申报作业」而不是一张空单。
 */
export const POSITION_DECLARATION_LINES: Record<SubjectType, DeclarationLine[]> = {
  RETAILER: [LINE_DEMAND],
  STORAGE: [LINE_STORAGE],
  GENERATOR: [LINE_GENERATION],
  LOAD: [LINE_DEMAND],
  TRADER: [LINE_STORAGE, LINE_DEMAND, LINE_GENERATION],
  GROUP: []
}

/** 取某立场的申报线；未知立场返回空数组（诚实空态，不猜测）。 */
export function declarationLinesOf(position: SubjectType | null | undefined): DeclarationLine[] {
  if (!position) return []
  return POSITION_DECLARATION_LINES[position] ?? []
}

/** 该立场是否有申报作业（GROUP 等管理视角为 false）。 */
export function hasDeclarationWork(position: SubjectType | null | undefined): boolean {
  return declarationLinesOf(position).length > 0
}

/**
 * 立场 → 该立场下有意义的系统角色。
 *
 * 用途是**收窄角色可分配范围**（纯售电租户不该能把人设成「电厂运营」），不是
 * 重定义角色权限——10 个系统角色的权限内容一个不动。一期刻意用静态映射表而非
 * 装配器：只有一种真实租户形态时，配置化的灵活性无人消费。
 */
export const POSITION_ROLE_HINTS: Record<SubjectType, string[]> = {
  RETAILER: ['RETAIL_MANAGER', 'TRADER', 'TRADE_LEAD', 'RISK', 'SETTLEMENT', 'QUANT', 'BOSS'],
  STORAGE: ['STORAGE_OPERATOR', 'TRADER', 'TRADE_LEAD', 'RISK', 'SETTLEMENT', 'QUANT', 'BOSS'],
  GENERATOR: ['PLANT_OPERATOR', 'TRADER', 'TRADE_LEAD', 'RISK', 'SETTLEMENT', 'QUANT', 'BOSS'],
  LOAD: ['RETAIL_MANAGER', 'TRADER', 'TRADE_LEAD', 'RISK', 'SETTLEMENT', 'BOSS'],
  TRADER: ['TRADER', 'TRADE_LEAD', 'RISK', 'SETTLEMENT', 'QUANT', 'BOSS'],
  GROUP: ['BOSS', 'ADMIN', 'RISK', 'QUANT']
}
