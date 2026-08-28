// 智能体 Harness 客户端：对接 agent-backend 的 /api/agent/*（SSE 流式）。
// 开发态经 vite 代理 /agent-api -> http://127.0.0.1:8000/api（见 vite.config.ts）；
// 生产/现场部署经现场 nginx 同源反代 /agent-api -> 中心 agent:8000/api（见 docs/deploy/split-deployment.md）。
// 与 llm.ts 的轻量直连问答并存：复杂任务（工具调用/审批/多智能体）走本客户端。

import { apiGet, apiPost, apiPatch, apiDelete, timeoutSignal, AGENT_API_BASE_ROOT } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'
import { formatCreateSessionError, readErrorDetail } from '@/services/agent/sessionError'

// 统一派生自 AGENT_API_BASE_ROOT（默认 /agent-api）：开发态 vite 代理、生产/现场部署 nginx 同源
// 反代均落到 :8000 的 /api/agent。dev/prod 行为一致，不再按 import.meta.env.DEV 折叠。
export const AGENT_API_BASE = `${AGENT_API_BASE_ROOT}/agent`

const BASE = AGENT_API_BASE

// scenario→base 路由：**所有场景恒走 pi 底座**。灰度表与影子对拍设施随双栈退场删除
// （主仓 #2231），前端不再有可选的第二个 base——旧图那侧的对话编排路径已经不存在，
// 留一张表只剩「有人调回 off 就把主入口路由到不再服务该场景的后端」这一种用法，
// 前端一次查询超时触发 fail-safe 也是同样后果。
// 会话级路由仍在 createAgentSession 时登记（内存 Map + localStorage 双写，刷新后仍可
// 把续聊/回放请求路由到正确后端）；persistHistory 走 #498 默认全开，归属登记由
// pi-poc 服务端回调 Node bind（见 agent-poc-strategic-qa-design.md）。
/** pi 底座（pi-poc 编排服务）基址：开发态 vite 代理 /pi-api → 8100，生产 nginx 同源同名。 */
export const PI_AGENT_BASE = '/pi-api/agent'
const sessionBaseById = new Map<string, string>()
// pi-poc 会话 id 落 localStorage：刷新后内存登记表清空，续聊/回放仍能路由到正确后端
const PI_SESSIONS_KEY = 'dljy.piPocSessionIds'

function rememberPiSession(id: string): void {
  try {
    const ids = new Set<string>(JSON.parse(localStorage.getItem(PI_SESSIONS_KEY) || '[]'))
    ids.add(id)
    localStorage.setItem(PI_SESSIONS_KEY, JSON.stringify([...ids].slice(-50)))
  } catch { /* localStorage 不可用时仅本页内存路由 */ }
}

function isPiSession(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(PI_SESSIONS_KEY) || '[]') as string[]).includes(id)
  } catch {
    return false
  }
}

function baseForSession(sessionId: string): string {
  const remembered = sessionBaseById.get(sessionId)
  if (remembered) return remembered
  return isPiSession(sessionId) ? PI_AGENT_BASE : BASE
}
const AGENT_REQUEST_TIMEOUT_MS = 10000

const TOKEN_KEY = 'dljy_restore_token'
const COMPANY_KEY = 'dljy.currentCompanyId'

// 创建会话时把登录用户身份(令牌+当前公司)透传给 harness，使需公司隔离的预测工具
// 能按账号 RBAC 调 Node /api/company/*（与 api.ts 的 Authorization 头格式一致）。
export function identityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.authorization = `Bearer ${token}`
  const company = localStorage.getItem(COMPANY_KEY)
  if (company) headers['x-company-id'] = company
  // 统一地区下传：与 api.ts requestHeaders()/quantClient 对齐，给所有 agent 请求注入
  // x-region-id。后端会话据此把地区存入 run_context，使图内地区敏感工具默认按所选地区取数。
  const region = currentRegion.value.id
  if (region) headers['x-region-id'] = region
  return headers
}

export type AgentScenario = 'chat' | 'declaration_prep' | 'daily_review' | 'morning_brief' | 'strategic_qa' | 'declaration_checkup'
// 「custom_graph」场景已随主仓 #2582 删除（#2540）；别名保留，历史会话元数据里可能仍
// 出现该字符串（Node 侧存量只读回放），展示层自行兜底。
export type AgentRunScenario = AgentScenario

export type AgentSessionInfo = {
  id: string
  scenario: AgentRunScenario
  title: string
  status: 'idle' | 'running' | 'awaiting_approval'
  pending_approval?: unknown
}

// 后端 SSE 事件协议（packages/agent-runtime/src/agent_runtime/api/service.py）
export type AgentEvent =
  | { type: 'token'; content: string }
  // 承载底座（pi-poc，#2213）：已放出的文本被判定为工具调用前的过程叙述 → 撤掉当前正在流式的文本段
  | { type: 'text_retract' }
  | { type: 'tool_call'; node?: string; name: string; args: Record<string, unknown> }
  | {
      type: 'tool_result'
      name: string
      summary: string
      // navigate / create_chart 等工具的结构化产出，前端直接消费
      ui?: { event: 'navigation'; path: string; query?: string; page_name?: string; reason?: string }
        | { event: 'chart'; chart_ref: string; title: string }
        | { event: 'analysis-chart'; chart: Record<string, unknown> }
        | { event: 'analysis-dashboard'; dashboard: Record<string, unknown> }
    }
  | { type: 'approval_request'; payload: Record<string, unknown> }
  | { type: 'todos'; items: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] }
  | { type: 'graph_status'; node: string; status: string }
  // 工作室动态图节点事件（node_status/node_token/node_result，dynamic_graph.py 发）已随主仓 #2582 删除。
  // 子智能体内部工具调用冒泡（深度流式）：role 为子智能体角色 key（如 market_analyst）
  | { type: 'subagent_tool_call'; role: string; name: string; args: Record<string, unknown> }
  | { type: 'subagent_tool_result'; role: string; name: string; summary: string }
  | { type: 'done'; status: string }
  | { type: 'error'; message: string; code?: string }

export type SequencedAgentEvent = AgentEvent & { seq?: number }

export type AgentStreamResult = {
  runId?: string
  cursor: number
  terminal: boolean
}

export type AgentActiveRun = {
  run_id: string
  session_id?: string
  status: 'running' | 'done' | 'error' | 'cancelled' | string
  last_seq?: number
  turn_seq?: number
  error?: string | null
}

export type AgentRunStatus = 'running' | 'done' | 'error' | 'cancelled'

export type AgentRunSummary = {
  run_id: string
  session_id: string
  turn_seq: number
  status: AgentRunStatus | string
  created_at: number
  updated_at: number
  last_seq: number
  error?: string | null
  session_title?: string
  page_key?: string
  scenario?: AgentRunScenario | string
}

export class AgentStreamHttpError extends Error {
  readonly status: number

  constructor(status: number, message?: string) {
    super(message || `智能体请求失败: ${status}`)
    this.name = 'AgentStreamHttpError'
    this.status = status
  }
}

export class AgentStreamDisconnectedError extends Error {
  readonly cursor: number

  constructor(cursor: number, message = '智能体连接中断') {
    super(message)
    this.name = 'AgentStreamDisconnectedError'
    this.cursor = cursor
  }
}

export async function createAgentSession(
  scenario: AgentScenario = 'chat',
  title = '',
  opts?: { persist?: boolean; timeoutMs?: number; promptKey?: string; pageKey?: string }
): Promise<AgentSessionInfo> {
  const createBase = PI_AGENT_BASE
  const res = await fetch(`${createBase}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    // persist=true（全部 AgentChatPanel 接入点默认）时 harness 创建会话后会用服务端凭证回调
    // Node 登记归属，使其进入历史侧栏并支持刷新恢复/重启续聊；page_key 标注来源接入点。
    // prompt_key 为页面提示白名单 key（非自由文本）：服务端按 key 解析固定提示，防止注入绕过安全基线。
    body: JSON.stringify({
      scenario, title,
      persist: opts?.persist ?? false,
      prompt_key: opts?.promptKey ?? '',
      page_key: opts?.pageKey ?? '',
    }),
    signal: timeoutSignal(opts?.timeoutMs ?? AGENT_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) {
    // 服务端结构化 detail（如缺 API Key 的 424，#1631）优先透传；
    // 无 detail 才按状态码落兜底话术（404=依赖组未装、5xx=后端没起/代理连不上）
    throw new Error(formatCreateSessionError(res.status, await readErrorDetail(res)))
  }
  const info = (await res.json()) as AgentSessionInfo
  if (createBase !== BASE) {
    sessionBaseById.set(info.id, createBase)
    rememberPiSession(info.id)
  }
  return info
}

// 探活：申报工作台等页面在挂载智能体面板前先确认 harness 在线
export async function pingAgentService(timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/sessions`, {
      headers: identityHeaders(),
      signal: timeoutSignal(timeoutMs)
    })
    return res.ok
  } catch {
    return false
  }
}

// 客户端主动取消（停止按钮 / 组件卸载 / 切换任务时 resetRun）触发的 abort：
// fetch 与 ReadableStream reader 都会抛 AbortError。这属于「正常结束」而非请求失败，
// 不能向上抛，否则 AgentChatPanel 会弹「⚠️ aborted」错误气泡。
function isAbortError(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
  )
}

// SSE 帧分隔：sse-starlette 默认 CRLF（\r\n\r\n），同时兼容 LF（\n\n）
function nextFrameSep(buffer: string): { index: number; length: number } | null {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf < 0 && lf < 0) return null
  if (crlf < 0) return { index: lf, length: 2 }
  if (lf < 0 || crlf < lf) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

// 解析单个 SSE 帧块（取 data: 行 → JSON.parse）。心跳(':' 注释行)/非 JSON 行静默跳过。
function parseFrameBlock(block: string): SequencedAgentEvent | null {
  const dataLine = block.split(/\r?\n/).find((l) => l.startsWith('data:'))
  if (!dataLine) return null
  try {
    return JSON.parse(dataLine.slice(5).trim()) as SequencedAgentEvent
  } catch {
    /* 跳过心跳/非 JSON 行 */
    return null
  }
}

// 解析 sse-starlette 输出（event: xxx\r\ndata: {...}\r\n\r\n），逐事件回调
async function consumeSse(
  res: Response,
  onEvent: (e: AgentEvent) => void,
  opts?: { signal?: AbortSignal; cursor?: number; onCursor?: (cursor: number) => void }
): Promise<AgentStreamResult> {
  if (!res.ok) throw new AgentStreamHttpError(res.status)
  if (!res.body) throw new AgentStreamHttpError(res.status, '智能体响应缺少 SSE body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let cursor = opts?.cursor ?? -1
  let terminal = false
  const handleEvent = (event: SequencedAgentEvent | null) => {
    if (!event) return
    if (typeof event.seq === 'number' && Number.isFinite(event.seq)) {
      cursor = Math.max(cursor, event.seq)
      opts?.onCursor?.(cursor)
    }
    if (event.type === 'done' || event.type === 'error') terminal = true
    onEvent(event)
  }
  const drainFrames = () => {
    let sep: { index: number; length: number } | null
    while ((sep = nextFrameSep(buffer)) !== null) {
      const block = buffer.slice(0, sep.index)
      buffer = buffer.slice(sep.index + sep.length)
      handleEvent(parseFrameBlock(block))
    }
  }
  try {
    for (;;) {
      if (opts?.signal?.aborted) {
        await reader.cancel()
        return { cursor, terminal }
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      drainFrames()
    }
    // 流正常结束：flush TextDecoder 内部多字节残留，并解析 buffer 里「没有尾随分隔符」的最后一帧。
    // 后端正常每帧带 \r\n\r\n，但流提前关闭 / 代理合并或截断尾分隔符时，最后一帧（常是 done 或
    // 最后一段 token）会滞留 buffer 永不消费 → done 丢失致调用方状态机悬挂（STREAM-5/10）。
    buffer += decoder.decode()
    drainFrames()
    if (buffer.trim()) handleEvent(parseFrameBlock(buffer))
  } catch (err) {
    // 主动取消：正常结束，吞掉 reader.read() 抛出的 AbortError
    if (opts?.signal?.aborted || isAbortError(err)) return { cursor, terminal }
    throw new AgentStreamDisconnectedError(cursor)
  }
  if (!terminal && !opts?.signal?.aborted) throw new AgentStreamDisconnectedError(cursor)
  return { cursor, terminal }
}

export async function attachRunStream(
  sessionId: string,
  runId: string,
  cursor: number,
  onEvent: (e: AgentEvent) => void,
  opts?: { signal?: AbortSignal; onCursor?: (cursor: number) => void }
): Promise<AgentStreamResult> {
  let res: Response
  try {
    const params = new URLSearchParams({ run_id: runId, cursor: String(cursor) })
    res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}/stream?${params.toString()}`, {
      headers: identityHeaders(),
      signal: opts?.signal
    })
  } catch (err) {
    if (opts?.signal?.aborted || isAbortError(err)) return { runId, cursor, terminal: false }
    throw new AgentStreamDisconnectedError(cursor)
  }
  const result = await consumeSse(res, onEvent, {
    signal: opts?.signal,
    cursor,
    onCursor: opts?.onCursor
  })
  return { ...result, runId }
}

export async function getActiveRun(sessionId: string): Promise<AgentActiveRun | null> {
  const res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}/active-run`, {
    headers: identityHeaders(),
    signal: timeoutSignal(AGENT_REQUEST_TIMEOUT_MS)
  })
  if (res.status === 404) return null
  if (!res.ok) throw new AgentStreamHttpError(res.status)
  return (await res.json()) as AgentActiveRun | null
}

export async function listRuns(status: AgentRunStatus = 'running'): Promise<AgentRunSummary[]> {
  const params = new URLSearchParams({ status })
  const res = await fetch(`${BASE}/runs?${params.toString()}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(AGENT_REQUEST_TIMEOUT_MS)
  })
  if (res.status === 401 || res.status === 403 || res.status === 404) return []
  if (!res.ok) throw new AgentStreamHttpError(res.status)
  return (await res.json()) as AgentRunSummary[]
}

export async function getAgentSession(sessionId: string): Promise<AgentSessionInfo | null> {
  const res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(AGENT_REQUEST_TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) throw new AgentStreamHttpError(res.status)
  return (await res.json()) as AgentSessionInfo
}

export async function stopAgentRun(sessionId: string, runId: string): Promise<boolean> {
  const res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ run_id: runId }),
    signal: timeoutSignal(AGENT_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) return false
  const data = await res.json()
  return data?.stopped === true
}

export async function sendAgentMessage(
  sessionId: string,
  content: string,
  onEvent: (e: AgentEvent) => void,
  opts?: {
    payload?: Record<string, unknown>
    signal?: AbortSignal
    scenario?: AgentRunScenario
    promptKey?: string
    onRunId?: (runId: string) => void
    onCursor?: (cursor: number) => void
  }
): Promise<AgentStreamResult> {
  try {
    const res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      // 必须带登录身份(Authorization + x-company-id)：续聊时若 harness 已重启、该会话不在内存，
      // ensure_session 会用这些头重建会话(owner 校验 + 公司隔离工具的登录上下文)。
      // 缺头会导致重建会话 auth_token/company_id 为空 → 公司隔离的预测/场站工具失去上下文。
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      // scenario 透传给 harness：续聊时若该会话不在内存，按场景懒重建（thread_id=sessionId，
      // checkpointer 自动带回历史记忆）。新会话已在内存则后端忽略此值。
      // prompt_key（页面提示白名单 key）同样在续聊重传：服务端不持久化页面提示，重建时缺它会丢角色。
      body: JSON.stringify({
        content,
        payload: opts?.payload ?? null,
        scenario: opts?.scenario ?? 'chat',
        prompt_key: opts?.promptKey ?? '',
      }),
      signal: opts?.signal
    })
    if (!res.ok) throw new AgentStreamHttpError(res.status)
    const runId = res.headers.get('x-run-id') || ''
    let result: AgentStreamResult
    if (runId) {
      opts?.onRunId?.(runId)
      try { await res.body?.cancel() } catch { /* ignore POST attach reader cancellation */ }
      result = await attachRunStream(sessionId, runId, -1, onEvent, {
        signal: opts?.signal,
        onCursor: opts?.onCursor
      })
    } else {
      result = await consumeSse(res, onEvent, {
        signal: opts?.signal,
        cursor: -1,
        onCursor: opts?.onCursor
      })
    }
    return result
  } catch (err) {
    if (opts?.signal?.aborted || isAbortError(err)) return { cursor: -1, terminal: false } // 主动取消：静默结束
    throw err
  }
}

// 审批回执（approval_request 事件后由审批卡片调用），返回的也是 SSE 续流
export async function sendAgentApproval(
  sessionId: string,
  action: 'approve' | 'reject',
  onEvent: (e: AgentEvent) => void,
  opts?: {
    note?: string
    by?: string
    signal?: AbortSignal
    onRunId?: (runId: string) => void
    onCursor?: (cursor: number) => void
  }
): Promise<AgentStreamResult> {
  try {
    const res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}/approvals`, {
      method: 'POST',
      // 同 sendAgentMessage：带登录身份，保证续聊/重建会话时公司隔离工具有上下文
      headers: { 'content-type': 'application/json', ...identityHeaders() },
      body: JSON.stringify({ action, note: opts?.note ?? '', by: opts?.by ?? 'operator' }),
      signal: opts?.signal
    })
    if (!res.ok) throw new AgentStreamHttpError(res.status)
    const runId = res.headers.get('x-run-id') || ''
    if (runId) {
      opts?.onRunId?.(runId)
      try { await res.body?.cancel() } catch { /* ignore POST attach reader cancellation */ }
      return await attachRunStream(sessionId, runId, -1, onEvent, {
        signal: opts?.signal,
        onCursor: opts?.onCursor
      })
    }
    return await consumeSse(res, onEvent, {
      signal: opts?.signal,
      cursor: -1,
      onCursor: opts?.onCursor
    })
  } catch (err) {
    if (opts?.signal?.aborted || isAbortError(err)) return { cursor: -1, terminal: false } // 主动取消：静默结束
    throw err
  }
}

export async function listAgentArtifacts(sessionId: string): Promise<{ path: string; bytes: number }[]> {
  const res = await fetch(`${baseForSession(sessionId)}/sessions/${encodeURIComponent(sessionId)}/artifacts`, {
    headers: identityHeaders(),
    signal: timeoutSignal(AGENT_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.files ?? []
}

export function encodeAgentPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

// 取 data_ref 明细（如 chart 事件的 ECharts option）
export async function fetchAgentRef<T = unknown>(sessionId: string, refId: string): Promise<T> {
  const res = await fetch(`${baseForSession(sessionId)}/refs/${encodeURIComponent(sessionId)}/${encodeURIComponent(refId)}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(AGENT_REQUEST_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`data_ref 获取失败: ${res.status}`)
  return (await res.json()).data as T
}

// 后端技能 L1 索引（渐进式披露 Skills，见 packages/agent-runtime/src/agent_runtime/skills/loader.py）
// 只取启用技能的名称+描述，供斜杠菜单/助手提示；全文由 agent 在会话内 load_skill 读取。
export type AgentSkillMeta = {
  name: string
  description: string
  source: 'builtin' | 'user'
  enabled: boolean
}

export async function fetchAgentSkills(timeoutMs = 4000): Promise<AgentSkillMeta[]> {
  const res = await fetch(`${BASE}/skills`, { headers: identityHeaders(), signal: timeoutSignal(timeoutMs) })
  if (!res.ok) throw new Error(`后端技能列表获取失败: ${res.status}`)
  const list = ((await res.json()).skills ?? []) as AgentSkillMeta[]
  return list.filter((s) => s.enabled !== false) // 停用技能不进斜杠菜单（与 skills_index 一致）
}

// 聊天历史（走 Node /api，非 /agent-api；经 api.ts 自动带登录 token，按用户隔离）
// 后端：server/chat-store.mjs + server/index.mjs routeAgentHistory。
// 与 harness checkpointer 解耦：此处存「给 UI 看/回放的逐轮消息段」，刷新恢复 + 历史侧栏用。

// 持久化的「段」是 AgentChatPanel Seg 的稳定子集（去掉 html 等可重算字段）。
// 按 kind 判别联合：值字段统一用 unknown（后端 shape 演进时前端宽松容忍），面板还原（restoreSeg）
// 时按 kind 分支 as 断言到精确类型。subagent-group 容器自 #641 起原样落库（不再展平成顶层 tool 段），
// 故这里为其单列一个成员，让 restoreSeg 的 kind === 'subagent-group' 分支可被静态识别。
export type HistorySeg =
  | { kind: 'text'; chunks?: unknown[]; text?: unknown }
  | {
      kind: 'tool'
      name?: unknown
      args?: unknown
      status?: unknown
      summary?: unknown
      subRole?: unknown
      basis?: unknown
    }
  | { kind: 'chart'; title?: unknown; option?: unknown }
  | { kind: 'analysis-chart'; spec?: unknown }
  | { kind: 'analysis-dashboard'; dashboard?: unknown }
  | { kind: 'approval'; payload?: unknown; resolved?: unknown; note?: unknown }
  | {
      kind: 'subagent-group'
      role?: unknown
      collapsed?: unknown
      tools?: unknown
      delegateArgs?: unknown
      delegateSummary?: unknown
      delegateStatus?: unknown
      delegateBasis?: unknown
    }

export type HistorySessionMeta = {
  session_id: string
  scenario: AgentRunScenario
  // 会话来源接入点 key（AgentChatPanel 的 historyKey，bind 时落库）；'' = 旧数据/未标注
  page_key?: string
  title: string
  created_at: number
  updated_at: number
  archived: boolean
  preview: string
}

export type HistoryTurn = {
  seq: number
  role: 'user' | 'assistant'
  segs: HistorySeg[]
  text: string
}

export type HistoryTranscript = {
  session_id: string
  scenario: AgentRunScenario
  title: string
  archived: boolean
  messages: HistoryTurn[]
}

const HISTORY_BASE = '/agent-history/sessions'
const enc = encodeURIComponent

// 会话「归属登记」不再由前端自助调用（防认领他人 session_id），改由 agent-backend 创建
// 会话时（createAgentSession persist=true）用服务端凭证回调 Node 登记 owner。见 routes.py / chat-store.mjs。

// 列出「我的」会话（倒序）。
export async function listHistorySessions(opts?: {
  limit?: number
  offset?: number
  archived?: boolean
  pageKey?: string
}): Promise<HistorySessionMeta[]> {
  const res = await apiGet<HistorySessionMeta[]>(HISTORY_BASE, {
    limit: opts?.limit ?? 50,
    offset: opts?.offset ?? 0,
    archived: opts?.archived ? 1 : 0,
    // 传 pageKey → 仅列该接入点会话（历史侧栏「只看本页」）；空/未传 → buildUrl 丢弃 = 全局，向后兼容。
    page_key: opts?.pageKey
  })
  return (res.data as HistorySessionMeta[]) ?? []
}

// 拉某会话完整 transcript（用于回放）。
export async function fetchHistoryTranscript(sessionId: string): Promise<HistoryTranscript | null> {
  const res = await apiGet<HistoryTranscript>(`${HISTORY_BASE}/${enc(sessionId)}`)
  return (res.data as HistoryTranscript) ?? null
}

// 追加一轮（user/assistant）。
export async function appendHistoryTurn(
  sessionId: string,
  role: 'user' | 'assistant',
  segs: HistorySeg[],
  text = ''
): Promise<void> {
  await apiPost(`${HISTORY_BASE}/${enc(sessionId)}/turns`, { role, segs, text })
}

export async function renameHistorySession(sessionId: string, title: string): Promise<void> {
  await apiPatch(`${HISTORY_BASE}/${enc(sessionId)}`, { title })
}

export async function archiveHistorySession(sessionId: string, archived = true): Promise<void> {
  await apiPatch(`${HISTORY_BASE}/${enc(sessionId)}`, { archived })
}

export async function deleteHistorySession(sessionId: string): Promise<void> {
  await apiDelete(`${HISTORY_BASE}/${enc(sessionId)}`)
}
