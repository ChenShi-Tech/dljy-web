// 智能体编排工作室客户端：对接后端 /api/agent/graphs/* 与 /graph-runs。
// 图 CRUD / 模板 / 校验走普通 JSON；运行走既有 SSE 通道（sendAgentMessage/Approval）。
// 类型镜像后端 packages/agent-runtime/src/agent_runtime/graphs/graph_spec.py 的 GraphSpec。

import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { getStoredUser } from '@/services/auth'

// AGENT_API_BASE 统一为 `${AGENT_API_BASE_ROOT}/agent`（默认 /agent-api/agent）：
// 开发态由 Vite 代理、生产/现场部署由 nginx 同源反代，dev/prod 不切换基址。
const BASE = AGENT_API_BASE
const STUDIO_TIMEOUT_MS = 10_000
const STUDIO_LONG_TIMEOUT_MS = 45_000

// 数据归属：登录态由后端用 Authorization 解析为真实 owner；X-Agent-Owner 仅保留
// 本地演示/旧版兼容提示，不能作为后端权限依据。
function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const owner = getStoredUser()?.username || 'shared'
  return { 'X-Agent-Owner': owner, ...identityHeaders(), ...extra }
}

function studioSignal(timeoutMs = STUDIO_TIMEOUT_MS): AbortSignal | undefined {
  return timeoutSignal(timeoutMs)
}

// GraphSpec 镜像（与后端 graph_spec.py 对齐）
export type NodeType = 'start' | 'end' | 'agent' | 'tool' | 'map' | 'report' | 'condition' | 'approval'

export type GraphNodeSpec = {
  id: string
  type: NodeType
  label?: string
  role?: string | null
  task?: string
  tool?: string | null
  args?: Record<string, unknown>
  position?: { x: number; y: number } | null
  data?: Record<string, unknown>
}

export type GraphEdgeSpec = {
  id?: string
  source: string
  target: string
  label?: string
}

export type GraphConfigSpec = {
  recursion_limit: number
  max_node_visits: number
  max_parallel: number
  retry_attempts: number
}

export type GraphSpec = {
  id?: string
  name: string
  description?: string
  nodes: GraphNodeSpec[]
  edges: GraphEdgeSpec[]
  config: GraphConfigSpec
  version?: number
  builtin?: boolean
}

export type GraphSummary = {
  id: string
  name: string
  description: string
  version: number
  created_at: number
  updated_at: number
}

export type GraphRecord = GraphSummary & { spec: GraphSpec }

export type ValidationResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  has_cycle: boolean
  estimated_max_steps: number
  recommended_recursion_limit: number
}

export type GraphRunResult = {
  id: string // session id，用于后续 /sessions/{id}/messages
  scenario: string
  status: string
  graph_meta?: Record<string, unknown>
  validation: ValidationResult
}

export const DEFAULT_CONFIG: GraphConfigSpec = {
  recursion_limit: 60,
  max_node_visits: 8,
  max_parallel: 8,
  retry_attempts: 1
}

// tool 节点可用的 L0 工具目录项
export type ToolCatalogItem = { name: string; category: string; description: string; args: string[] }

// 运行历史
export type RunSummary = {
  id: string
  graph_id: string | null
  graph_name: string
  task: string
  status: string
  created_at: number
}
export type RunRecord = RunSummary & {
  report: string
  outputs: Record<string, { label: string; role?: string; output: string }>
}

// 可用角色（与后端 VALID_ROLES / ROLE_PROMPTS 对齐）+ 展示元信息
export type RoleMeta = { role: string; char: string; name: string }
export const ROLE_META: RoleMeta[] = [
  { role: 'supervisor', char: '枢', name: '调度中枢' },
  { role: 'market_analyst', char: '析', name: '市场分析' },
  { role: 'price_forecaster', char: '测', name: '价格预测' },
  { role: 'data_collector', char: '采', name: '数据采集' },
  { role: 'declaration_strategist', char: '报', name: '申报策略' },
  { role: 'hedge_strategist', char: '保', name: '中长期套保' },
  { role: 'arbitrage_optimizer', char: '套', name: '套利储能' },
  { role: 'review_reporter', char: '复', name: '复盘报告' },
  { role: 'settlement_auditor', char: '结', name: '结算校核' },
  { role: 'risk_sentinel', char: '控', name: '风控哨兵' },
  // 与后端 VALID_ROLES(12) 对齐：此前漏这两项，致 NL 生成/导入含该角色的图时节点下拉空白、
  // 标题回退裸 key、icon 回退通用符号（STUDIO-4）。补齐后可手动选用（路由已在 model_providers.yaml 补配）。
  { role: 'bidding_game_analyst', char: '博', name: '报价博弈' },
  { role: 'compliance_officer', char: '合', name: '合规规则' }
]
export function roleMeta(role?: string | null): RoleMeta | undefined {
  return ROLE_META.find((r) => r.role === role)
}

// HTTP 辅助
async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const body = await res.json()
      const d = body?.detail
      if (typeof d === 'string') {
        detail = d
      } else if (d && typeof d === 'object') {
        // 后端图校验失败时 detail={message, validation:{errors,warnings}}（graphs.py create/update/run）。
        // 直接 JSON.stringify 会把整坨原始 JSON 灌进红条（STUDIO-5）；这里抽成可读的「消息 + 错误列表」。
        const msg = typeof d.message === 'string' ? d.message : '请求失败'
        const errs = d.validation?.errors
        detail = Array.isArray(errs) && errs.length
          ? `${msg}：\n- ${errs.map((e: unknown) => String(e)).join('\n- ')}`
          : msg
      } else {
        detail = JSON.stringify(body ?? `${res.status}`)
      }
    } catch {
      /* 非 JSON 响应 */
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
}

// 模板 / 校验
export async function fetchTemplates(): Promise<GraphSpec[]> {
  const data = await jsonOrThrow<{ templates: GraphSpec[] }>(
    await fetch(`${BASE}/graphs/templates`, { headers: ownerHeaders(), signal: studioSignal() })
  )
  return data.templates
}

export async function validateGraph(spec: GraphSpec): Promise<ValidationResult> {
  return jsonOrThrow<ValidationResult>(
    await fetch(`${BASE}/graphs/validate`, {
      method: 'POST',
      headers: ownerHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(spec),
      signal: studioSignal()
    })
  )
}

// 自然语言 → 编排图（后端用 supervisor 模型生成并校验）。缺密钥/生成失败时
// 后端返回 {ok:false, msg}，前端据此提示而非抛错。
export type NlGraphResult = { ok: boolean; spec?: GraphSpec; validation?: ValidationResult; msg?: string }
export async function generateGraphFromNl(description: string, name = ''): Promise<NlGraphResult> {
  const res = await fetch(`${BASE}/graphs/from-nl`, {
    method: 'POST',
    headers: ownerHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ description, name }),
    signal: studioSignal(STUDIO_LONG_TIMEOUT_MS)
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const b = await res.json()
      if (typeof b.detail === 'string') msg = b.detail
    } catch {
      /* 非 JSON */
    }
    return { ok: false, msg }
  }
  return (await res.json()) as NlGraphResult
}

// CRUD
export async function listGraphs(): Promise<GraphSummary[]> {
  const data = await jsonOrThrow<{ graphs: GraphSummary[] }>(
    await fetch(`${BASE}/graphs`, { headers: ownerHeaders(), signal: studioSignal() })
  )
  return data.graphs
}

export async function getGraph(id: string): Promise<GraphRecord> {
  return jsonOrThrow<GraphRecord>(
    await fetch(`${BASE}/graphs/${encodeURIComponent(id)}`, { headers: ownerHeaders(), signal: studioSignal() })
  )
}

export async function createGraph(spec: GraphSpec): Promise<GraphRecord> {
  return jsonOrThrow<GraphRecord>(
    await fetch(`${BASE}/graphs`, {
      method: 'POST',
      headers: ownerHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(spec),
      signal: studioSignal()
    })
  )
}

export async function updateGraph(id: string, spec: GraphSpec): Promise<GraphRecord> {
  return jsonOrThrow<GraphRecord>(
    await fetch(`${BASE}/graphs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: ownerHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(spec),
      signal: studioSignal()
    })
  )
}

export async function deleteGraph(id: string): Promise<void> {
  await jsonOrThrow<{ removed: string }>(
    await fetch(`${BASE}/graphs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: ownerHeaders(),
      signal: studioSignal()
    })
  )
}

// 运行：编译并开会话，返回 session id（运行流走 agentClient 的 SSE）
export async function createGraphRun(
  body: { spec?: GraphSpec; graph_id?: string; title?: string }
): Promise<GraphRunResult> {
  return jsonOrThrow<GraphRunResult>(
    await fetch(`${BASE}/graph-runs`, {
      method: 'POST',
      headers: ownerHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
      signal: studioSignal(STUDIO_LONG_TIMEOUT_MS)
    })
  )
}

// 工具目录（tool 节点用）
export async function fetchToolCatalog(): Promise<ToolCatalogItem[]> {
  const data = await jsonOrThrow<{ tools: ToolCatalogItem[] }>(
    await fetch(`${BASE}/graphs/tool-catalog`, { headers: ownerHeaders(), signal: studioSignal() })
  )
  return data.tools
}

// 运行历史
export async function listRuns(limit = 50): Promise<RunSummary[]> {
  const data = await jsonOrThrow<{ runs: RunSummary[] }>(
    await fetch(`${BASE}/runs?limit=${encodeURIComponent(limit)}`, {
      headers: ownerHeaders(),
      signal: studioSignal()
    })
  )
  return data.runs
}

export async function getRun(id: string): Promise<RunRecord> {
  return jsonOrThrow<RunRecord>(
    await fetch(`${BASE}/runs/${encodeURIComponent(id)}`, { headers: ownerHeaders(), signal: studioSignal() })
  )
}

export async function saveRun(body: {
  graph_id?: string | null
  graph_name: string
  task: string
  status: string
  report: string
  outputs: Record<string, { label: string; role?: string; output: string }>
}): Promise<RunSummary> {
  return jsonOrThrow<RunSummary>(
    await fetch(`${BASE}/runs`, {
      method: 'POST',
      headers: ownerHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
      signal: studioSignal()
    })
  )
}

export async function deleteRun(id: string): Promise<void> {
  await jsonOrThrow<{ removed: string }>(
    await fetch(`${BASE}/runs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: ownerHeaders(),
      signal: studioSignal()
    })
  )
}
