// 影子流量发起侧（#1848 第二部分 · Epic #1843 S3-E）。
//
// 职责：某场景处于 shadow 模式时，把同一条用户消息也送给 pi 底座跑一遍，两侧结果
// 摘要入对拍台账（`POST /api/v1/agent/rollout/:scenario/shadow-runs`）。旧图的结果照常
// 对用户生效，pi 侧对用户完全不可见。
//
// 本模块由 agentClient 在用户那一轮结束之后动态 import 并 fire-and-forget 调用
// （动态是为了打破与 agentClient 的循环依赖，同时让 shadow 关闭时这段代码根本不进包）。
//
// 四条设计决定（都会影响对拍数字的可信度，改之前先看这里）：
//
// 1. 只影子首轮消息。pi 侧是新建会话、没有旧图那边的历史，第二轮起两侧上下文根本
// 不对等，继续对拍会产出「看起来能比、实际不可比」的数字，比没有数字更危险。要影子
// 整段会话，得先做历史回放（把旧图的对话灌进 pi 会话），本期不做。
// 2. 影子跑绝不批准任何审批。遇到 approval_request 立即停跑并记为「未完成」。自动批准
// 等于在用户不知情的情况下让影子链路产生真实副作用（还绕开了 #1844 的审批红线）。
// 反过来说：pi 侧的写动作全部落在审批门后（L0 直通工具按定义只读，装配期守卫保证红线
// 工具不能被标成 L0），因此「影子不批准」= 「影子无副作用」，这是机制保证不是约定。
// 3. 对拍只比跨底座真正可比的东西（口径见 shadowCompare.ts）。
// 4. 只记不抛，且永不阻塞用户。任何失败（pi 没起、超时、上报失败）都只是少一条台账，
// 绝不冒泡到聊天面板。
//
// 两项代价要说清楚：① shadow 模式下每条首轮消息会额外产生一次模型调用（pi 侧真实计费）；
// ② 影子会话不落历史（persist=false），其上下文档由 pi-poc 的空闲淘汰与保留期清理回收（#1846）。

import {
  createAgentSession,
  identityFingerprint,
  sendAgentMessage,
  stopAgentRun,
  type AgentScenario,
} from '@/services/agent/agentClient'
import { apiPost } from '@/services/api'
import { PI_AGENT_BASE, isShadowScenario } from '@/services/agent/rollout'
import { compareObservations, createTurnObserver, type TurnObservation } from '@/services/agent/shadowCompare'

const SHADOW_TIMEOUT_MS = 120_000
// 已影子过的会话（只影子首轮）。会话 id 是 uuid，集合随页面生命周期存活即可。
const shadowedSessions = new Set<string>()

function noteFor(pi: TurnObservation, approvalRequested: boolean): string {
  if (approvalRequested) return '影子跑请求了人工审批，按纪律不批准并即时停跑（副作用未执行）'
  if (!pi.ok) return '影子跑未正常收尾（超时/中断/后端报错）'
  return ''
}

// 走 apiPost 而不手拼 fetch：`/api/v1` 的写入请求强制要求 Idempotency-Key（缺了直接 428），
// 而这个头连同鉴权/公司/租户/地区头都由 apiPost 统一注入。手写一份必然漏，本单实测就是先漏了它。
async function postShadowRun(scenario: string, body: Record<string, unknown>): Promise<void> {
  await apiPost(`/v1/agent/rollout/${encodeURIComponent(scenario)}/shadow-runs`, body)
}

/**
 * 起一次影子跑并上报。只由 agentClient 在用户那一轮结束后 fire-and-forget 调用，
 * 内部吞掉全部异常：影子失败只是少一条台账，不该让用户看到任何东西。
 */
export async function maybeRunShadow(args: {
  scenario: string
  sessionId: string
  content: string
  /** 旧图那一轮的默认地区上下文（`splitTurnPayload` 拆出），影子侧必须带同一份才对等 */
  payload?: Record<string, unknown> | null
  legacy: TurnObservation
  /** 用户那一轮开始时的身份指纹（令牌+公司+地区），影子起跑前必须仍然一致 */
  identityAtTurn: string
}): Promise<'skipped' | 'recorded' | 'failed'> {
  const { scenario, sessionId, content, payload, legacy, identityAtTurn } = args
  if (shadowedSessions.has(sessionId)) return 'skipped' // 只影子首轮
  // 身份在这一轮里变过（退出换号 / 换公司 / 换地区）：影子会拿新身份去发旧问题、
  // 把台账写进别人的租户，属数据隔离回归。整轮不跑，宁可少一条台账。
  if (identityFingerprint() !== identityAtTurn) return 'skipped'
  if (!(await isShadowScenario(scenario))) return 'skipped'
  shadowedSessions.add(sessionId)

  const observer = createTurnObserver()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SHADOW_TIMEOUT_MS)
  let shadowSessionId = ''
  let runId = ''
  try {
    const session = await createAgentSession(scenario as AgentScenario, '影子对拍', {
      persist: false, // 影子会话不进历史侧栏：它不是用户的对话
      baseOverride: PI_AGENT_BASE,
    })
    shadowSessionId = session.id
    await sendAgentMessage(shadowSessionId, content, (event) => {
      observer.observe(event)
      // 审批请求即停：无人值守下不批准（#1844 红线），也不留一个挂起的 run 空耗
      if (event.type === 'approval_request') controller.abort()
    }, {
      scenario: scenario as AgentScenario,
      payload: payload ?? undefined,
      signal: controller.signal,
      onRunId: (id) => { runId = id },
    })
  } catch {
    /* pi 没起 / 网络失败 / 超时：仍然上报一条「影子侧不可用」，这本身就是对拍结论的一部分 */
  } finally {
    clearTimeout(timer)
  }
  // 停跑要单独尽力做一次：abort 只断了本地流，服务端那个 run 还在跑
  if (shadowSessionId && runId && (observer.approvalRequested || controller.signal.aborted)) {
    try { await stopAgentRun(shadowSessionId, runId) } catch { /* 尽力而为 */ }
  }

  const pi = observer.result()
  // 影子跑本身要几十秒，期间同样可能换号/换公司/换地区：此时上报会把这条记进新身份的租户
  if (identityFingerprint() !== identityAtTurn) return 'skipped'
  try {
    await postShadowRun(scenario, {
      sessionId, // 用户侧会话 id：台账要能追回是哪一轮的对拍，影子会话 id 无追溯价值
      ...compareObservations(legacy, pi),
      note: noteFor(pi, observer.approvalRequested),
    })
    return 'recorded'
  } catch {
    return 'failed'
  }
}
