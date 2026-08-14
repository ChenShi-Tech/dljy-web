// 影子对拍的**纯观测与比较**（#1848 第二部分 · Epic #1843 S3-E）。
//
// 刻意从 shadow.ts 拆出来：本模块只依赖 AgentEvent 的**类型**（type-only import 编译后
// 不留运行时引用），因此 agentClient 可以直接静态引它来观测用户那一轮，而真正会调
// agentClient 的发起侧（shadow.ts）留给 agentClient 动态 import——否则两个模块在模块
// 求值期互相等对方，是典型的循环依赖崩法。
//
// 对拍口径的两条关键取舍（改之前先读 shadow.ts 顶部的四条设计决定）：
//   · 事件形状比**类型序列**不比工具名。两侧工具面本就不同，带上名字必然 100% 不一致，
//     会把「事件形状差异率 ≤20%」的阈值变成永久假红。
//   · 副作用比**请求过审批的动作集合**。审批门就是「对外真实写入」的权威判据（#1844），
//     用它当口径就不必在前端另维护一份会漂移的写工具清单。

import type { AgentEvent } from '@/services/agent/agentClient'
import { isRolloutScenario } from '@/services/agent/rollout'
import { packageRegionSummary } from '@/services/region/regionContext'

/**
 * 把一轮的 `payload` 拆成「默认地区上下文」与「其余上下文」。
 *
 * `AgentChatPanel` **每条**消息都会带 `packageRegionSummary()`（地区规则画像），所以不能把
 * 「带 payload」直接当成不可对拍——那会让四个生产场景一条影子都跑不起来，开了 shadow 也永远
 * 攒不到证据，闸看到的是空台账。区分标准是**这份上下文影子侧能不能拿到同一份**：
 *
 * - 地区摘要：由 `regionId` 确定性派生的公开地区元数据（不含任何用户/页面数据），影子侧原样
 *   带上即可对等，故**转发**且不影响可对拍性。
 * - 其余键（调用方业务 payload、`untrusted_external_content` 页面切片、申报约束等）：旧图侧
 *   会用它们改写输入，影子侧拿不到同一份，两侧即便都答出非空内容也只是**看起来**一致；这类
 *   轮次判为不可对拍，也顺带避免把页面切片多送一个后端。
 *
 * 默认键集合从 `packageRegionSummary()` 现取而不是手抄一份常量：抄一份就会随字段增删漂移。
 */
export function splitTurnPayload(payload?: Record<string, unknown> | null): {
  shadowPayload: Record<string, unknown> | null
  hasExtraContext: boolean
} {
  if (!payload || typeof payload !== 'object') return { shadowPayload: null, hasExtraContext: false }
  const defaultKeys = new Set(Object.keys(packageRegionSummary()))
  const shadowPayload: Record<string, unknown> = {}
  let hasExtraContext = false
  for (const [key, value] of Object.entries(payload)) {
    if (defaultKeys.has(key)) shadowPayload[key] = value
    else hasExtraContext = true
  }
  return {
    shadowPayload: Object.keys(shadowPayload).length ? shadowPayload : null,
    hasExtraContext,
  }
}

/**
 * 这一轮**够不够格拿去对拍**。五个条件缺一不可，都是「宁可少一条台账，也不要一条不可比的」：
 *
 * - `isFirstTurn`：pi 侧是新会话、没有旧图那边的历史，第二轮起上下文不对等。
 * - `scenarioDeclared`：调用方**显式声明**了场景才算数。`sendAgentMessage` 的 `scenario` 缺省为
 *   `'chat'`（后端契约要求），而工作室的自定义图运行（`AgentOrchestrationStudioView`）就是不传的——
 *   把它按缺省值当 `chat` 影子，等于拿 `node_*` 图事件去污染 chat 的对拍报告和升级闸，还白烧一次模型调用。
 * - `isRolloutScenario`：只有四个生产场景在灰度表里；PoC 场景本来就直连 pi，没有「旧图侧」可比。
 * - `!isShadowSession`：影子跑自己也经同一条发消息路径，不排除就会一路影子影子的影子。
 * - `!hasExtraContext`：本轮带了地区摘要之外的上下文（见 `splitTurnPayload`）。
 */
export function isComparableTurn(input: {
  isFirstTurn: boolean
  scenario?: string
  scenarioDeclared: boolean
  isShadowSession: boolean
  hasExtraContext: boolean
}): boolean {
  return input.isFirstTurn
    && input.scenarioDeclared
    && isRolloutScenario(input.scenario)
    && !input.isShadowSession
    && !input.hasExtraContext
}

/** 一轮对话的可对拍观测量。刻意不含正文——台账不做第二份对话副本（与审计摘要同口径）。 */
export type TurnObservation = {
  /** 归一化事件类型序列（合并连续同类，不含工具名与正文） */
  shape: string[]
  /** 本轮请求过审批的写动作（能力 id，去重排序） */
  effects: string[]
  /** 终态是否为正常完成（done 且无 error、无中断） */
  ok: boolean
  /** 产出文本字符数：只用于判断「有没有答出东西」，不上报内容 */
  textLength: number
}

// 两侧同一能力异名时在此登记（如某天旧图叫 submit_spot_declaration、pi 叫 submit_declaration）。
// 当前两侧写动作同名，故为空表——留空比预填猜测的名字诚实：猜错会把不同能力归成同一个。
const EFFECT_ALIASES: Record<string, string> = {}

function canonicalEffect(name: string): string {
  const key = name.trim()
  return EFFECT_ALIASES[key] ?? key
}

// approval_request 的 payload 形状两侧不同：pi 是 {type:'tool_approval', action_requests:[{name,…}]}，
// 旧图是 HITL/图 interrupt 的业务语义卡（declaration_approval 等）。逐个候选键取名，
// 都取不到才回落 payload.type——宁可记一个粗粒度的动作名，也不要把一次写动作记成空。
export function effectIdsFromApproval(payload: unknown): string[] {
  const p = (payload ?? {}) as Record<string, unknown>
  const out: string[] = []
  const requests = Array.isArray(p.action_requests) ? p.action_requests : []
  for (const raw of requests) {
    const req = (raw ?? {}) as Record<string, unknown>
    const name = req.name ?? req.action ?? req.tool ?? req.tool_name
    if (typeof name === 'string' && name.trim()) out.push(canonicalEffect(name))
  }
  if (!out.length) {
    const name = p.tool ?? p.tool_name ?? p.name ?? p.type
    if (typeof name === 'string' && name.trim()) out.push(canonicalEffect(name))
  }
  return out
}

export type TurnObserver = {
  /** 影子跑据此决定「停跑」：请求了审批就不可能在无人值守下走完 */
  readonly approvalRequested: boolean
  observe(event: AgentEvent): void
  result(): TurnObservation
}

/**
 * 事件观察器：边转发边攒观测量。
 * 旧图侧由 agentClient 包住用户那一轮；pi 侧由 shadow.ts 包住影子那一轮。
 */
export function createTurnObserver(): TurnObserver {
  const shape: string[] = []
  const effects = new Set<string>()
  let ok = false
  let textLength = 0
  let approvalRequested = false

  return {
    get approvalRequested() {
      return approvalRequested
    },
    observe(event: AgentEvent): void {
      // 形状只记类型并合并连续同类：流式 token 分片数量在两侧本就不同，逐片计入等于比抖动
      if (shape[shape.length - 1] !== event.type) shape.push(event.type)
      if (event.type === 'token') textLength += String(event.content ?? '').length
      if (event.type === 'approval_request') {
        approvalRequested = true
        for (const id of effectIdsFromApproval(event.payload)) effects.add(id)
      }
      if (event.type === 'done') ok = true
      if (event.type === 'error') ok = false
    },
    result(): TurnObservation {
      return { shape, effects: [...effects].sort(), ok, textLength }
    },
  }
}

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** 三维度对拍。落库内容零容忍，另两维的容差在服务端按**跨轮次差异率**判，这里只出单轮布尔。 */
export function compareObservations(legacy: TurnObservation, pi: TurnObservation) {
  return {
    eventShapeMatch: sameSequence(legacy.shape, pi.shape),
    effectsMatch: sameSequence(legacy.effects, pi.effects),
    // 「产出可用性」= 都正常收尾且都答出了非空内容。一侧能答一侧报错/空，是用户直接感知的退化
    availabilityMatch: legacy.ok === pi.ok && (legacy.textLength > 0) === (pi.textLength > 0),
  }
}
