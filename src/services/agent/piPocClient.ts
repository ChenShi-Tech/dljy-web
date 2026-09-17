// pi-poc 专用端点的服务层收编（#1526/#1527 PoC 页取数出口统一）。
// 页面原先直接 fetch('/pi-api/...')，违反「取数只经 services 层」纪律（DEVELOPMENT.md §3.1），
// 散落的取数无法统一治理，/pi-api 代理在本仓被移除后两个页面静默 404 即其症状。
// 收编后统一：走 agentClient 单一定义的 PI_AGENT_BASE、带 identityHeaders、有 10s 超时
// （与 agentClient 的 AGENT_REQUEST_TIMEOUT_MS 同档）。GET 补身份头为兼容增益，行为不变。
import { identityHeaders, PI_AGENT_BASE } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'

const PI_POC_TIMEOUT_MS = 10000

// 数据缺口清单（#1782）：聚合 Markdown，用户复制转发给后端负责人。
// 服务未启动/失败由调用方（工作台的战略问答入口挂件 StrategicQaGaps）给出友好提示。
export async function fetchDataGaps(): Promise<string> {
  const res = await fetch(`${PI_AGENT_BASE}/data-gaps`, {
    headers: identityHeaders(),
    signal: timeoutSignal(PI_POC_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return ((await res.json()) as { markdown?: string }).markdown || ''
}

// 自动执行授权开关（#1527）：按会话生效、服务重启失效（授权不持久红线）。
// 返回服务端生效后的最终态，开关 UI 以此为准，失败时由调用方回滚显示。
// 每个会话的授权世代：人每成功开启一次就 +1。在途的撤销重试醒来时发现世代变了，说明之后又重新授权，
// 必须放弃——否则旧的撤销会悄悄关掉新的授权，而界面仍显示已开启（dljy-web#121 审查 P2）
const grantGeneration = new Map<string, number>()

export async function setSessionAutoApprove(sessionId: string, enabled: boolean): Promise<boolean> {
  const res = await fetch(`${PI_AGENT_BASE}/sessions/${encodeURIComponent(sessionId)}/auto-approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders() },
    body: JSON.stringify({ enabled }),
    signal: timeoutSignal(PI_POC_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const on = ((await res.json()) as { auto_approve?: boolean }).auto_approve === true
  if (on) grantGeneration.set(sessionId, (grantGeneration.get(sessionId) ?? 0) + 1)
  return on
}

// 撤销自动执行授权并按退避重试（切走会话或卸载面板时调用）。此时发起它的界面往往已经不在了，
// 一次网络抖动就会留下一个开着却看不见的授权，所以不依附组件生命周期、失败自行重试；
// 全部失败时返回 false，用户重新打开该会话仍能从会话详情看到授权开启并手动关闭。
export async function revokeSessionAutoApprove(
  sessionId: string,
  opts: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<boolean> {
  const delays = opts.delaysMs ?? [1000, 3000, 10000]
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const generation = grantGeneration.get(sessionId) ?? 0
  for (let attempt = 0; ; attempt += 1) {
    // 期间用户又重新开启了授权：这次撤销已被取代，不能再发 enabled:false
    if ((grantGeneration.get(sessionId) ?? 0) !== generation) return false
    try {
      if ((await setSessionAutoApprove(sessionId, false)) === false) return true
    } catch (err) {
      if (attempt >= delays.length) {
        console.warn('[pi-poc] 撤销自动执行授权失败，已放弃重试', sessionId, err)
        return false
      }
    }
    if (attempt >= delays.length) return false
    await sleep(delays[attempt])
  }
}

export interface PiSessionMeta {
  /** 建会话时锁定的解读角色（白名单 key）；旧版 pi 没有该字段时为 null */
  promptKey: string | null
  /** 本会话业务写入自动执行授权当前是否开启（服务端为准；旧版 pi 没有该字段时按未开启） */
  autoApprove: boolean
}

// pi 会话详情里前端要用的两项元信息（统一 AI 侧边栏）：
// - 解读角色：重新打开会话时据此找回专家入口——申报前体检与通用对话同为 chat 场景，只看场景找不回；
// - 自动执行授权：重新打开会话时据此显示「已开启」与关闭入口——切走时撤销失败的授权不能变成看不见的开关。
// 显式走 pi 基址：历史列表里的会话多半不是本浏览器建的，不在会话路由登记表里。
// pi 不认识该会话（已过保留期）时返回 null，调用方自行降级。
export async function fetchPiSessionMeta(sessionId: string): Promise<PiSessionMeta | null> {
  const res = await fetch(`${PI_AGENT_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: identityHeaders(),
    signal: timeoutSignal(PI_POC_TIMEOUT_MS)
  })
  if (!res.ok) return null
  const body = (await res.json()) as { prompt_key?: unknown; auto_approve?: unknown }
  return {
    promptKey: typeof body.prompt_key === 'string' ? body.prompt_key : null,
    autoApprove: body.auto_approve === true
  }
}

// 当前主对话模型（主仓 #2658）。auto 档下模型会随自建端点可用性自动切换，而此前
// 这件事只写在服务端日志里——**演示时端点悄悄断掉、答案却照常出来**，屏幕前的人
// 无从察觉。本函数取回这一事实供界面显示。
//
// 服务未启动/旧版后端（无此端点）时抛错，调用方按「不显示标签」降级——宁可不显示，
// 也不能显示一个可能已经不对的模型名。
export interface CurrentModelInfo {
  provider: string
  model: string
  /** 是否跑在自建端点上——演示时最想让人看见的就是这一位。 */
  selfHosted: boolean
  label: string
  /** 'auto' 时模型会自行切换，界面据此提示「自动」。 */
  mode: string
}

export async function fetchCurrentModel(): Promise<CurrentModelInfo> {
  const res = await fetch(`${PI_AGENT_BASE}/model`, {
    headers: identityHeaders(),
    signal: timeoutSignal(PI_POC_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as CurrentModelInfo
}
