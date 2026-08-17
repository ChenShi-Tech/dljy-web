// 灰度命中查询（#1848 第二部分 · Epic #1843 S3-E）。
//
// 服务端（server/agent-rollout-store.mjs）是**命中判定的唯一权威**：本模块只负责
// 「问一次、缓存一会儿、按结果选底座」，不在前端复刻任何判定逻辑——canary 名单比对
// 若在前端做，用户改 localStorage 就能把自己切进 pi，灰度就成了摆设。
//
// 两条 fail-safe：
//   1. 查询失败/超时/未登录 → 一律按全 off（走旧图）。灰度状态读不到时，「保守」的方向
//      是旧图而不是新底座：把用户送上未验证链路的代价远大于少一次对拍。**前提是旧图那边
//      还认这个场景**——已完成迁移的场景必须出灰度表进 PI_NATIVE_SCENARIOS，否则这条
//      fail-safe 会把用户送去一个不再服务该场景的后端（见下）。
//   2. 缓存键绑当前令牌：换账号（含登出再登录）自动作废，不会把上一个账号的命中结果
//      套在下一个账号头上（canary 是按用户/公司命中的）。

import { AGENT_API_BASE_ROOT, fetchRaw, timeoutSignal } from '@/services/api'

/** 仍在灰度中的生产场景（与 server/agent-rollout-store.mjs::ROLLOUT_SCENARIOS 同表）。 */
export const ROLLOUT_SCENARIOS = ['declaration_prep', 'daily_review', 'morning_brief'] as const
export type RolloutScenario = (typeof ROLLOUT_SCENARIOS)[number]

export type RolloutMode = 'off' | 'shadow' | 'canary' | 'primary'
export type RolloutServes = 'legacy' | 'pi'
export type ScenarioEffective = { mode: RolloutMode; serves: RolloutServes; shadow: boolean }
export type RolloutEffective = Record<RolloutScenario, ScenarioEffective>

/** 旧图（agent-backend / LangGraph）基址；与 agentClient.AGENT_API_BASE 同源派生。 */
export const LEGACY_AGENT_BASE = `${AGENT_API_BASE_ROOT}/agent`
/** pi 底座（pi-poc 编排服务）基址：开发态 vite 代理 /pi-api → 8100，生产 nginx 同源同名。 */
export const PI_AGENT_BASE = '/pi-api/agent'

// 恒定走 pi、不查灰度表的场景。两类来源：
//   · PoC 专属入口（#1526/#1527）：本来就直连 pi，是**并行新入口**而非「替换旧图」。
//   · **已完成迁移**的场景：`chat` 于 #2158 切流完成并删除旧 supervisor 路径，两侧不再并存。
// 后者恒定 pi 而不是「灰度表说 pi」——旧图那边已经不认这个场景，再去查一次表只会新增一个
// 失败点：查询超时时 fail-safe 会把用户送回一个 400。
const PI_NATIVE_SCENARIOS = new Set(['strategic_qa', 'declaration_checkup', 'chat'])

const ROLLOUT_PATH = '/v1/agent/rollout'
const QUERY_TIMEOUT_MS = 4000
const CACHE_TTL_MS = 60_000
const TOKEN_KEY = 'dljy_restore_token'

type CacheEntry = { key: string; at: number; effective: RolloutEffective }
let cache: CacheEntry | null = null
// 在途请求**按令牌分桶**而不是单槽合流：登出换号时若沿用旧账号那条在途请求的结果，
// 新账号会拿着别人的 canary 命中去选底座，而 pi 侧建会话不会再复查灰度名单——
// 一次「未命中账号被送进 pi」就是切流事故。只有同一令牌的并发查询才合流。
const inflightByKey = new Map<string, Promise<RolloutEffective>>()

export function isRolloutScenario(scenario?: string): scenario is RolloutScenario {
  return !!scenario && (ROLLOUT_SCENARIOS as readonly string[]).includes(scenario)
}

function allOff(): RolloutEffective {
  const out = {} as RolloutEffective
  for (const id of ROLLOUT_SCENARIOS) out[id] = { mode: 'off', serves: 'legacy', shadow: false }
  return out
}

function currentTokenKey(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return '' // localStorage 不可用（隐私模式/SSR）时按匿名处理，仍会走 fail-safe 全 off
  }
}

// 服务端字段照收但逐项校验：非法 mode/serves 一律降到最保守值，绝不把读不懂的状态当「已切流」
function normalizeRow(raw: unknown): ScenarioEffective {
  const row = (raw ?? {}) as Partial<ScenarioEffective>
  const mode: RolloutMode = row.mode === 'shadow' || row.mode === 'canary' || row.mode === 'primary'
    ? row.mode
    : 'off'
  return { mode, serves: row.serves === 'pi' ? 'pi' : 'legacy', shadow: mode === 'shadow' }
}

function normalizeEffective(raw: unknown): RolloutEffective {
  const src = (raw ?? {}) as Record<string, unknown>
  const out = {} as RolloutEffective
  for (const id of ROLLOUT_SCENARIOS) out[id] = normalizeRow(src[id])
  return out
}

/**
 * 拉「我在各场景命中哪一侧」。同一时刻只发一条请求（inflight 合流），TTL 内复用缓存。
 * 任何失败都不抛：调用点（创建会话）在用户主路径上，灰度查询绝不能成为新的失败源。
 */
export async function loadRolloutEffective(force = false): Promise<RolloutEffective> {
  const key = currentTokenKey()
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.effective
  }
  const shared = inflightByKey.get(key)
  if (shared) return shared
  const pending = (async () => {
    let effective = allOff()
    try {
      // 刻意不用 apiGet：它在 401 时会清登录态并跳转 /login。灰度查询是后台性质的
      // 附带请求，不该由它来决定用户被踢下线（真过期会在下一次业务请求上如实暴露）。
      const res = await fetchRaw(ROLLOUT_PATH, undefined, { signal: timeoutSignal(QUERY_TIMEOUT_MS) })
      if (res.ok) {
        const payload = await res.json() as { data?: { effective?: unknown } }
        effective = normalizeEffective(payload?.data?.effective)
      }
    } catch {
      /* 网络/超时/解析失败：保持全 off */
    }
    // 只有「本次响应仍属于当前令牌」才写缓存：换号后迟到的旧账号响应不得占住缓存槽
    if (currentTokenKey() === key) cache = { key, at: Date.now(), effective }
    return effective
  })()
  inflightByKey.set(key, pending)
  try {
    return await pending
  } finally {
    inflightByKey.delete(key)
  }
}

/** 测试与登出场景用：丢弃缓存，下次查询重新问服务端。 */
export function resetRolloutCache(): void {
  cache = null
  inflightByKey.clear()
}

/**
 * 该场景的请求该发往哪个底座。**服务端权威**：只有 canary 命中或 primary 才返回 pi 基址。
 * PoC 专属场景不查灰度表，恒定 pi（它们本来就是 pi 入口）。
 */
export async function resolveServingBase(scenario?: string): Promise<string> {
  if (scenario && PI_NATIVE_SCENARIOS.has(scenario)) return PI_AGENT_BASE
  if (!isRolloutScenario(scenario)) return LEGACY_AGENT_BASE
  const effective = await loadRolloutEffective()
  return effective[scenario].serves === 'pi' ? PI_AGENT_BASE : LEGACY_AGENT_BASE
}

/** 该场景当前是否处于影子模式（旧图对用户生效、pi 同请求跑一遍只入台账）。 */
export async function isShadowScenario(scenario?: string): Promise<boolean> {
  if (!isRolloutScenario(scenario)) return false
  const effective = await loadRolloutEffective()
  return effective[scenario].shadow
}
