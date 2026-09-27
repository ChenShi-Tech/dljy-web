// 动作能力发现、adapter 与版本化接收反馈类型（#3099，任务 15.7 dljy，CH06—CH07）。
import type { InsightAction, InsightHandoff, InsightReceipt } from './handoff.mjs'

/** 目标模块登记（adapter）：entry 是稳定入口标识，由前端映射到既有页面/组件。 */
export type InsightActionTarget = {
  readonly module: string
  readonly ready: boolean
  readonly entry: string | null
  readonly note: string
}

/** 目标探活结果：不 ready 时 reason 说明原因（目标离线只挡该动作，不挡洞察读取）。 */
export type TargetStatus = { ready: boolean; entry: string | null; reason: string | null }

/** 目录条目 = 动作能力（handoff.mjs）+ 目录元数据（标题、地区、目标不消费字段）。 */
export type InsightActionEntry = InsightAction & {
  readonly title: string
  readonly regionIds: readonly string[]
  /** 顶层交接字段中目标不消费的部分：出现即逐项 dropped（partial），不静默跳过。 */
  readonly ignoredInputs: readonly string[]
  readonly target: InsightActionTarget
}

export type ActionResolveRequest = { actionId: string; handoff: unknown }

export type ActionResolveResult = {
  actionId: string
  action: InsightActionEntry
  receipt: InsightReceipt
}

export declare const INSIGHT_ACTION_TARGETS: Readonly<Record<string, InsightActionTarget>>
export declare const INSIGHT_ACTIONS: readonly InsightActionEntry[]
export declare function defaultTargetStatus(targetModule: string): TargetStatus
/** 未知 actionId 返回 null，由调用方转 404（NOT_REGISTERED）。 */
export declare function getInsightAction(actionId: string): InsightActionEntry | null
/** 能力发现：只列当前地区已登记的动作；未登记地区返回空列表。 */
export declare function listInsightActions(input?: { regionId?: string | null }): InsightActionEntry[]
export declare function describeAction(action: InsightActionEntry): {
  actionId: string
  title: string
  targetModule: string
  target: InsightActionTarget
  acceptedSchemas: string[]
  requiredInputs: string[]
  ignoredInputs: string[]
  intent: string
  available: boolean
  unavailableReason: string | null
  regionIds: string[]
}
export declare function parseActionResolveRequest(body: unknown): { actionId: string; handoff: unknown }
export declare function resolveInsightAction(input: {
  actionId: string
  handoff: unknown
  /** 当前地区（来自 x-region-id）；交接范围地区不一致按 BAD_REQUEST 拒绝。 */
  regionId?: string | null
  /** 目标探活：默认按登记表；路由可注入探活依赖。 */
  isTargetReady?: (targetModule: string) => TargetStatus
}): ActionResolveResult
