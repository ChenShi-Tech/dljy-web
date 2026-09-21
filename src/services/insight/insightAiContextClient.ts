// 洞察 AI 上下文约束客户端（dljy#3100，OpenSpec build-yunnan-regional-market-insight 任务 15.3）
// ----------------------------------------------------------------------------
// 消费 dljy#3097 交付的约束端点 POST /api/v1/insight-ai-context/assemble：把统一 AI 侧栏
// `composeMessageContext` 形状的 {page_context, slice:{blocks[]}} 信封组装为带纪律的 AI 上下文
// （四段输出契约 + 反例纪律 + 证据注册表 + 来源缺失/过期显式传入；tools 恒空——组装只读、
// 不授权任何工具）。协议词表与区块形状由后端机械校验：access granted/denied、availability
// complete/partial/empty/failed（缺数/失败必须带登记原因）、freshness fresh/stale/unknown。
//
// 纪律：
//   - 单次尝试、绝不自动重试：失败原样抛 InsightRequestError，由入口诚实报错（无重试风暴）。
//   - 出参做最小形状自检（schemaVersion / 四段 segments / tools 为空数组 / prompt 为字符串），
//     形状不合规按 422 处理——「拿到了响应」不等于「拿到了受约束的上下文」。
//   - 零缓存：信封对应点击时刻的证据切片，落盘或复用旧信封都会让 AI 引用过期资料。

import { apiPost } from '@/services/api'
import { toInsightError } from './insightClient'
import { INSIGHT_ERRORS, InsightContractError } from 'shared/insight/contract.mjs'

/** 洞察 AI 上下文信封版本（与 dljy#3097 约束层一致）。 */
export const INSIGHT_AI_CONTEXT_SCHEMA_VERSION = 'insight-ai-context/v1'

/** 约束端点路径（dljy 主仓 router_v2 注册；#3097）。 */
export const INSIGHT_AI_CONTEXT_ASSEMBLE_PATH = '/api/v1/insight-ai-context/assemble'

// ── 区块切片（发给 /assemble 的入参形状；与统一侧栏 slice 协议对齐）────────────────────

export type InsightAiAccess = 'granted' | 'denied'
export type InsightAiAvailabilityState = 'complete' | 'partial' | 'empty' | 'failed'
export type InsightAiFreshnessState = 'fresh' | 'stale' | 'unknown'

/** 证据条目：id 须匹配 ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$（事实段只能引用已注册 id）。 */
export type InsightAiEvidenceItem = { id: string; text: string }

/** 一个区块的当前有效证据：只带身份、版本引用与摘要，绝不带原始行数据数组。 */
export type InsightAiEvidenceBlock = {
  blockId: string
  title?: string
  /** 已知对象清单（进 known_objects；「相关对象不得凭空出现」的校验面）。 */
  objects?: string[]
  sourceRefs?: string[]
  evidence?: InsightAiEvidenceItem[]
  runtime: {
    access: InsightAiAccess
    availability: { state: InsightAiAvailabilityState; reason?: string }
    freshness: { state: InsightAiFreshnessState }
  }
}

/** 统一侧栏的消息信封：page_context 与 slice 分键（pageContext.ts 同构）。 */
export type InsightAiSliceMessage = {
  page_context: {
    page_label: string
    route: string
    region: { id: string; name: string }
    company: { id: string; name: string }
  }
  slice: { blocks: InsightAiEvidenceBlock[] }
}

// ── /assemble 出参（前端只消费形状与「是否受约束」，内容原样随轮下发）──────────────────

export type InsightAiContextEnvelope = {
  schemaVersion: string
  page_context: Record<string, unknown>
  evidence_registry: Record<string, Record<string, unknown>>
  known_objects: string[]
  source_missing: Array<Record<string, unknown>>
  freshness_notes: Array<Record<string, unknown>>
  disciplines: Record<string, string>
  output_contract: { segments: string[]; shape: Record<string, unknown> }
  prompt: string
  tools: unknown[]
}

const FOUR_SEGMENTS = ['facts', 'possible_factors', 'confirmed_objects', 'open_questions']

/** 出参最小形状自检：不受约束的信封一律拒绝，不把裸响应发给模型。 */
function assertEnvelope(data: unknown): InsightAiContextEnvelope {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, 'AI 上下文信封格式不正确')
  }
  const envelope = data as Record<string, unknown>
  if (envelope.schemaVersion !== INSIGHT_AI_CONTEXT_SCHEMA_VERSION) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, `不支持的 AI 上下文版本：${String(envelope.schemaVersion)}`)
  }
  const contract = envelope.output_contract as { segments?: unknown } | undefined
  if (
    !Array.isArray(contract?.segments)
    || FOUR_SEGMENTS.some((segment) => !(contract!.segments as unknown[]).includes(segment))
    || !Array.isArray(envelope.tools)
    || envelope.tools.length !== 0
    || typeof envelope.prompt !== 'string'
    || !envelope.prompt
    || !envelope.evidence_registry
    || typeof envelope.evidence_registry !== 'object'
  ) {
    throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, 'AI 上下文信封缺少四段契约或纪律面')
  }
  return envelope as unknown as InsightAiContextEnvelope
}

/**
 * POST /assemble：组装受约束的 AI 上下文信封。单次尝试，失败抛 InsightRequestError
 * （AbortError 原样向上，由调用方决定是否还有意义）。
 */
export async function assembleInsightAiContext(
  message: InsightAiSliceMessage,
  options?: { signal?: AbortSignal }
): Promise<InsightAiContextEnvelope> {
  try {
    const payload = await apiPost<InsightAiContextEnvelope>(INSIGHT_AI_CONTEXT_ASSEMBLE_PATH, { message }, { signal: options?.signal })
    return assertEnvelope(payload.data)
  } catch (error) {
    // AbortError 原样向上；契约错误/信封错误/网络错误统一折叠为 InsightRequestError。
    throw toInsightError(error)
  }
}
