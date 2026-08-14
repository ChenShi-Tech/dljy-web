// ============================================================================
// 交易员一日作业链（对照《电力交易员工作场景梳理 v1.0》日常运营 S1–S7）
// ----------------------------------------------------------------------------
// 基线换过一次，这里记下缘由，避免以后有人"改回去"：
//
// 初版按手册 v2.0 的「三线并行 25 场景」建链（预研 D+2 / 申报 D+1 / 执行 D / 清算 D-1）。
// 那套模型对交易主管排班是准确的，但对**单个交易员的一天**过重——他一次只在一条线上
// 作业，四线并行的界面反而让人找不到"我现在该干哪一步"。
//
// 现改用 v1.0 的**线性七步**：一天从复盘昨日开始，到写完今日日志结束，前一步的产出是
// 后一步的输入。这条链的价值在于「顺序本身就是提示」——交易员不需要先想"该做什么"。
//
// 承载形态也换过一次（2026-08-10 用户拍板）：七步不再是七个独立路由页，而是**一个连续
// 作业台页面**（TRADING_DAY_ROUTE）内的七个面板——步骤切换只发生在页内，跨页跳转会把
// 链条切碎（每页各自绑单据、各自加载，交易员在页与页之间当人肉传送带）。因此本文件
// 不再给每步声明 route，深链用 `?stage=<id>` 查询参数表达。
//
// 两条与 v2.0 的差异必须说清：
//   ① **v1.0 的 S2 是「早间分析」（基本面 → 供需比 → 市场判断），不是数据核验。**
//      v2.0 里的八源验签在 v1.0 中只是 S2 的异常分支（"数据缺失→标注低可信并人工补判"），
//      故八源核验收进 S2 面板内的折叠区块，不再独占一步。
//   ② **时刻不取 v1.0 的时间轴。** v1.0 写"10:30–12:00 申报"，而实际申报截止随省而异
//      （新疆 08:45），v2.0 已修正过这点。本链只定义**顺序**，具体时刻一律由
//      `marketTiming`（省域规则包）给出——换省只换数据。
// ============================================================================

import type { DeclarationOrder } from '@/services/declarations'
import type { SubjectType } from '@/services/governance'

/** 单页作业台路由；深链某一步用 `${TRADING_DAY_ROUTE}?stage=<StageId>`。 */
export const TRADING_DAY_ROUTE = '/xhjy/trading-day'

export type StageId =
  | 'morning-review'
  | 'market-analysis'
  | 'direction'
  | 'declare'
  | 'clearing'
  | 'contract'
  | 'daily-close'

export type WorkflowStage = {
  id: StageId
  /** v1.0 场景编号 */
  scenario: string
  title: string
  /** 参考时段（**仅作节奏提示**，硬死线取 marketTiming 的地区时刻） */
  window: string
  /** 一句话说明这一步产出什么 */
  output: string
  /** OODA 环节，用于界面标注这一步在闭环中的位置 */
  ooda: string
}

const STAGES: WorkflowStage[] = [
  {
    id: 'morning-review',
    scenario: 'S1',
    title: '晨会复盘',
    window: '08:00–08:30',
    output: '昨日偏差认知 + 今日不重犯要点',
    ooda: '反馈（昨日循环收口）'
  },
  {
    id: 'market-analysis',
    scenario: 'S2',
    title: '早间分析',
    window: '08:30–09:30',
    output: '今日市场判断（宽松/平衡/偏紧 + 均价指引）',
    ooda: '观察'
  },
  {
    id: 'direction',
    scenario: 'S3',
    title: '方向判断',
    window: '09:30–10:30',
    output: '方向决策（增持/减持/观望）+ 理由 + 置信度 + 申报曲线',
    ooda: '定向'
  },
  {
    id: 'declare',
    scenario: 'S4',
    title: '申报执行',
    window: '申报窗口（时刻取地区规则）',
    output: '放行清单通过 + 已提交申报单',
    ooda: '决策 + 行动'
  },
  {
    id: 'clearing',
    scenario: 'S5',
    title: '出清分析',
    window: '出清结果公布后',
    output: '中标偏差分析 + 实时调整判断',
    ooda: '反馈（当日循环中途）'
  },
  {
    id: 'contract',
    scenario: 'S6',
    title: '中长期补仓',
    window: '15:00–16:30',
    output: '敞口评估 + 补仓决定',
    ooda: '决策 + 行动（低频）'
  },
  {
    id: 'daily-close',
    scenario: 'S7',
    title: '日报收尾',
    window: '16:30–17:30',
    output: '完整日报 + 决策日志（100% 必填）',
    ooda: '反馈（闭环收口）'
  }
]

/**
 * 一日作业链。
 *
 * v1.0 的七步对所有立场都一样——它描述的是交易员的作息，不是主体的业务范围。
 * 立场差异体现在**每步内部**（如 S4 申报执行时储能立场多一张充放电计划单），
 * 而不是增删步骤：给纯售电租户去掉一步会让链条在不同租户间长短不一，
 * 交易员之间没法用同一套"第几步"沟通。
 */
export function stagesForPosition(_position?: SubjectType | null): WorkflowStage[] {
  return STAGES
}

/** 全部阶段（不依赖立场时的直接入口）。 */
export const ALL_STAGES = STAGES

export type StageState = 'done' | 'current' | 'pending' | 'locked'

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  done: '已完成',
  current: '进行中',
  pending: '待办',
  locked: '待前置'
}

/**
 * 单个阶段是否已完成——**只看单据事实**，不另存进度字段。
 * 独立存储的进度一旦与单据漂移，比没有进度条更误导人。
 *
 * 七步全部有落点（契约 v5）：S1/S2/S3/S5/S6/S7 看各自 preflight 段是否写回，
 * S4 申报执行、S5 出清登记看状态机——申报单出没出门、出清结果来没来，状态机是唯一事实。
 */
export function isStageDone(stage: StageId, declaration: DeclarationOrder | null): boolean {
  if (!declaration) return false
  const pf = declaration.preflight ?? {}
  switch (stage) {
    case 'morning-review':
      return Boolean(pf.morningReview)
    case 'market-analysis':
      // 早间分析的产出（市场判断与基本面门禁）写在 dataGate 段
      return Boolean(pf.dataGate)
    case 'direction':
      // 方向判断的产出（方向、置信度、申报曲线）写在 forecast 段
      return Boolean(pf.forecast)
    case 'declare':
      return ['SUBMITTED', 'ACKNOWLEDGED', 'CLEARED', 'DEVIATION_TRACKING', 'SETTLED', 'REVIEWED'].includes(
        declaration.status
      )
    case 'clearing':
      // 出清分析完成 = 出清结果已登记（状态机）**且**偏差结论已写回——只登记不分析不算完
      return (
        ['CLEARED', 'DEVIATION_TRACKING', 'SETTLED', 'REVIEWED'].includes(declaration.status) &&
        Boolean(pf.clearingReview)
      )
    case 'contract':
      return Boolean(pf.contract)
    case 'daily-close':
      return Boolean(pf.dailyClose)
    default:
      return false
  }
}

/**
 * 阶段状态：第一个未完成的阶段是「进行中」，其后按前置是否完成分「待办 / 待前置」。
 * 跳步完成不虚报前序阶段——前面没做就是没做。
 */
export function stageStates(
  stages: WorkflowStage[],
  declaration: DeclarationOrder | null
): Record<StageId, StageState> {
  const out = {} as Record<StageId, StageState>
  let foundCurrent = false
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i]
    if (isStageDone(stage.id, declaration)) {
      out[stage.id] = 'done'
      continue
    }
    if (!foundCurrent) {
      out[stage.id] = 'current'
      foundCurrent = true
      continue
    }
    const prev = stages[i - 1]
    out[stage.id] = prev && !isStageDone(prev.id, declaration) ? 'locked' : 'pending'
  }
  return out
}

/** 链路完成度（已完成阶段数 / 总阶段数）。 */
export function chainProgress(stages: WorkflowStage[], declaration: DeclarationOrder | null) {
  const done = stages.filter((s) => isStageDone(s.id, declaration)).length
  return { done, total: stages.length, rate: stages.length ? done / stages.length : 0 }
}
