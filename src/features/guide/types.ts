// 操作导引引擎的类型面（dljy#3404）。
// 引擎通用：中长期导引内容在 ./midlong/，本文件不 import 任何业务模块，
// bridge / runner / advance 共用这里的形状；改字段名会级联到内容层，慎重。

/** 锚点查找范围：页面内容区 / 对话框 / 抽屉（后两者只在最上层遮罩内找）。 */
export type GuideWithin = 'page' | 'dialog' | 'drawer'

/** 卡片相对目标元素的方向；center 表示无目标的居中卡片。 */
export type GuidePlacement = 'top' | 'bottom' | 'left' | 'right' | 'center'

/** 传给步骤文案 / 完成判定 / 示例值的运行上下文（artifacts 可被 capture / recover 写入）。 */
export type GuideCtx = {
  runTag: string
  regionId: string
  practiceCompanyId: string
  artifacts: Record<string, unknown>
  /** 导航回调（runner 注入 router 实现）；内容层用它做刷新恢复时的跳转。 */
  go: (to: string | { path: string; query?: Record<string, string> }) => void
}

/** 步骤推进条件：满足即自动进下一步；manual 只能点「下一步」。 */
export type AdvanceCondition =
  | { kind: 'manual' }
  | { kind: 'visible'; target: string; within?: GuideWithin }
  | { kind: 'hidden'; target: string; within?: GuideWithin }
  | {
      kind: 'form'
      form: string
      done: (values: Record<string, unknown>, ctx: GuideCtx) => boolean
      /** 实时「还差：xx」的缺项清单；缺省时用通用文案。 */
      missing?: (values: Record<string, unknown>, ctx: GuideCtx) => string[]
      /** 条件满足后需持续稳定的毫秒数（文本输入防抖默认 800，下拉 0）。 */
      settleMs?: number
    }
  | { kind: 'state'; state: string; done: (snapshot: object | null, ctx: GuideCtx) => boolean }
  | { kind: 'signal'; name: string; match?: (payload: unknown, ctx: GuideCtx) => boolean }
  | { kind: 'route'; match: (route: { path: string }, ctx: GuideCtx) => boolean }
  | { kind: 'any'; of: AdvanceCondition[] }

/** 「帮我填 / 帮我点 / 带我去」兜底动作；action 是自由回调（如进入练习空间）。 */
export type AssistSpec =
  | {
      kind: 'fill'
      form: string
      /** current 是填之前的表单现值：用于 409 编码冲突后换个随机后缀重试这类决策。 */
      values: (ctx: GuideCtx, current?: Record<string, unknown>) => Record<string, unknown>
      /** fill 前置条件（如框架协议候选已加载），不满足时等待而不是写脏数据。 */
      ready?: (merged: Record<string, unknown>) => boolean
    }
  | { kind: 'click' }
  | { kind: 'navigate'; to: (ctx: GuideCtx) => { path: string; query?: Record<string, string> } }
  | { kind: 'action'; label: string; run: (ctx: GuideCtx) => Promise<void> | void }

export type GuideStep = {
  /** 章内序号，如 '2-5'；持久化与 resumeTo 引用它。 */
  id: string
  /** 章号（0 进练习空间 / 1 主体 / 2 框架 / 3 电量合同 / 4 核验与持仓），进度按章节叙事。 */
  chapter: number
  /** 激活时若当前路由不在此前缀下则自动跳转（详情页这类带 :id 的路由不设）。 */
  route?: string
  /** data-guide 锚点名；缺省渲染居中卡片。 */
  target?: string
  within?: GuideWithin
  title: string
  body: string | ((ctx: GuideCtx) => string)
  placement?: GuidePlacement
  advance: AdvanceCondition
  assist?: AssistSpec
  /** 推进信号到达时从 payload 里记下产物（如 subjectId / frameworkId）。 */
  capture?: (payload: unknown, ctx: GuideCtx) => void
  /** 刷新恢复时按服务端真实状态找回：返回 true 表示这步已完成、直接进下一步。 */
  recover?: (ctx: GuideCtx) => Promise<boolean> | boolean
  /** 可跳过的步骤才显示「跳过」。 */
  optional?: boolean
  /** 总结步：卡片渲染「退出并回原公司 / 留在练习空间」，两者都记完成。 */
  finishing?: boolean
  /** 目标在恢复宽限期内没出现时退回的步骤（通常是「打开对话框」那步）。 */
  resumeTo?: string
  /** 等目标元素出现的上限毫秒数（默认 10s；刷新恢复走 1.5s 宽限）。 */
  timeoutMs?: number
}

export type GuideDefinition = {
  id: string
  group: 'midlong'
  title: string
  summary: string
  status: 'ready' | 'planned'
  /** 运行标签生成（如 GUIDE-MMddHHmm）；缺省用时间戳，内容层按域注入自己的格式。 */
  makeRunTag?: () => string
  /** 会话开始时写入的初始产物（如本次导引固定使用的交割月份）；整次导引读同一份，不随时间漂移。 */
  initArtifacts?: () => Record<string, unknown>
  /** 依赖的页面能力锚点名（规划中的导引先登记 plannedAnchors，ready 时逐步落实）。 */
  requires: string[]
  /** 导引会在练习空间写数据，只对有公司写权限的角色开放。 */
  needsWrite: true
  steps: GuideStep[]
  /** 规划中导引涉及的锚点，仅作文档索引，锚点守卫不检查。 */
  plannedAnchors?: string[]
}

export type GuideSessionStatus = 'running' | 'paused' | 'target-missing' | 'done'

/** 持久化的会话：只存界面进度与已建记录 id，不存业务数据。 */
export type GuideSession = {
  v: 1
  guideId: string
  stepId: string
  runTag: string
  artifacts: Record<string, unknown>
  originCompanyId: string
  /** 进入练习空间前为空串；0-0 的「进入练习空间并开始」执行后写入。 */
  practiceCompanyId: string
  regionId: string
  status: GuideSessionStatus
  pauseReason?: 'company' | 'region'
  startedAt: number
  updatedAt: number
}
