// 全局 AI 侧边栏状态与业务页调用入口（取代原 composables/useAiPanel）。
//
// 模块级 reactive 单例（不引 pinia）。业务页只通过 `useAiSidebar()` 与侧边栏交互：
// - `interpret()`：按当前页声明发起「解读本页」；页面没有解读能力时只打开侧边栏
// - `ask(question, { context })`：快捷任务、区块解读、选中即问
// 侧边栏壳监听 `request.seq`，按会话规则（sessionPolicy）决定续聊还是新开会话，再把问题送进
// 对话内核；数据切片以「待取」形式保存，内核发送这条问题时经 `takeSliceFor` 取走一次。
//
// 侧边栏自持「当前会话记录」（场景、解读角色、来源页、工作台入口），写入 localStorage 以便刷新恢复；
// 切换会话时 mountKey 自增，侧边栏据此重挂内核（复用工作台已验证的防串流做法）。
import { reactive, readonly } from 'vue'
import { PAGE_PROMPT_KEYS, type PagePromptKey } from '@/prompts/pageKeys'
import { activeAiPage, resolveInterpret, type AiContextFactory } from './pageRegistry'
import type { AiRequestKind, AiSessionRecord } from './sessionPolicy'
import type { ExpertLaunch } from './expertCommands'
import { entryForSession } from '@/services/agent/workbenchEntries'
import type { AgentScenario } from '@/services/agent/agentClient'

export interface AiAskRequest {
  seq: number
  kind: Exclude<AiRequestKind, 'free'>
  question: string
  scenario: string
  promptKey: string
  label: string
  /** 新开会话时的会话标题 */
  title: string
  /** 对应的工作台入口；缺省按场景与角色推断 */
  entryKey?: string
  /** 专家会话的入口输入值（如晨报目标日） */
  meta?: Record<string, string>
}

interface AiSidebarState {
  open: boolean
  request: AiAskRequest | null
  /** 会话记录归属的登录用户；换账号时重新绑定，不继承上一账号的会话（dljy-web#119 审查 P2） */
  owner: string | null
  /** 当前会话记录；null = 从未使用或已新建空白对话 */
  session: AiSessionRecord | null
  /** 切换会话时自增，侧边栏据此重挂对话内核 */
  mountKey: number
}

const STORAGE_KEY_PREFIX = 'dljy.aiSidebar.session:'

function storageKey(owner: string): string {
  return `${STORAGE_KEY_PREFIX}${owner}`
}

function loadSession(owner: string | null): AiSessionRecord | null {
  if (!owner) return null
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(storageKey(owner))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AiSessionRecord>
    if (typeof parsed?.sessionId !== 'string' || typeof parsed.scenario !== 'string') return null
    return {
      sessionId: parsed.sessionId,
      scenario: parsed.scenario,
      promptKey: typeof parsed.promptKey === 'string' ? parsed.promptKey : '',
      sourceRoute: typeof parsed.sourceRoute === 'string' ? parsed.sourceRoute : '',
      entryKey: typeof parsed.entryKey === 'string' ? parsed.entryKey : 'workbench',
      title: typeof parsed.title === 'string' ? parsed.title : '',
      ...(parsed.meta && typeof parsed.meta === 'object' ? { meta: parsed.meta as Record<string, string> } : {})
    }
  } catch {
    return null
  }
}

function saveSession(record: AiSessionRecord | null): void {
  const owner = state.owner
  if (!owner) return
  try {
    if (typeof window === 'undefined') return
    // 只持久化已建成的会话；空白新对话无需恢复
    if (record?.sessionId) window.localStorage.setItem(storageKey(owner), JSON.stringify(record))
    else window.localStorage.removeItem(storageKey(owner))
  } catch {
    // 隐私模式/存储被禁用：刷新后不恢复，但不影响本次使用
  }
}

const state = reactive<AiSidebarState>({ open: false, request: null, owner: null, session: null, mountKey: 0 })
let seq = 0
let pending: { question: string; slice: Record<string, unknown> | null } | null = null
// 最近一次被内核取走的切片：发送若被服务端 409 拒绝、改在新会话重发时需要重新附带（该轮从未被处理）
let lastTaken: { question: string; slice: Record<string, unknown> | null } | null = null

/** 空白新对话使用的会话属性（首次发送时由内核按这些属性建会话）。 */
export const BLANK_SESSION: Readonly<AiSessionRecord> = {
  sessionId: null,
  scenario: 'chat',
  promptKey: PAGE_PROMPT_KEYS.workbench,
  sourceRoute: '',
  entryKey: 'workbench',
  title: ''
}

function evaluate(context: AiContextFactory | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!context) return null
  return typeof context === 'function' ? context() : context
}

function dispatch(request: Omit<AiAskRequest, 'seq'>, slice: Record<string, unknown> | null): void {
  const question = request.question.trim()
  // 页面提问必须有问题；专家会话允许空问题（只开会话、等用户输入，如不带参数的 /战略问答）
  if (!question && request.kind !== 'expert') return
  pending = { question, slice }
  seq += 1
  state.request = { ...request, question, seq }
  state.open = true
}

/**
 * 内核发送某条问题时取走其数据切片（只取一次；问题文本不匹配则不附带）。
 * 这次发送没有取到切片时，同时忘掉上一次取走的：409 重发只能恢复真正撞上 409 的那条请求的切片，
 * 否则在输入框里重打同样的文字撞 409，会把早先别的页面的数据带进新会话（dljy-web#119 审查 P2）。
 */
export function takeSliceFor(question: string): Record<string, unknown> | null {
  if (!pending || pending.question !== question.trim()) {
    lastTaken = null
    return null
  }
  const { slice } = pending
  lastTaken = pending
  pending = null
  return slice
}

/** 409 重发前恢复该问题的切片（仅当它就是最近一次被取走的那条），供新会话首轮再次附带。 */
export function restoreSliceFor(question: string): void {
  if (lastTaken && lastTaken.question === question.trim()) pending = lastTaken
}

/**
 * 绑定当前登录用户（侧边栏挂载时调用）：换了账号就丢弃内存中的会话记录与待发请求，
 * 改读该账号自己的存储记录——同一浏览器换账号登录不继承上一账号的会话、标题与解读角色。
 */
export function bindUser(username: string): void {
  const owner = username || null
  if (state.owner === owner) return
  state.owner = owner
  state.session = loadSession(owner)
  state.request = null
  pending = null
  lastTaken = null
  state.mountKey += 1
}

/** 切换到指定会话（null = 空白新对话）并重挂内核。 */
export function switchSession(record: AiSessionRecord | null): void {
  state.session = record ? { ...record } : null
  state.mountKey += 1
  saveSession(state.session)
}

/**
 * 内核建好/恢复会话后回填 id（不重挂内核）。标题只在记录还没有时采用服务端的：空白对话首问建会话、
 * 从历史打开时记录里没有标题（dljy-web#119 审查 P2）；页面请求自带的标题不被覆盖。
 */
export function adoptSessionId(sessionId: string, title = ''): void {
  const base = state.session ?? BLANK_SESSION
  state.session = { ...base, sessionId, title: base.title || title.trim() }
  saveSession(state.session)
}

/**
 * 给当前会话补全入口与解读角色（不重挂内核）：只在记录仍是该会话时生效。
 * 重新打开会话时入口要靠一次查询才能确定，先按已知信息切过去、查回来再补——不能让查询挡在切换前面。
 */
export function refineSessionEntry(sessionId: string, entryKey: string, promptKey: string): void {
  if (!state.session || state.session.sessionId !== sessionId) return
  state.session = { ...state.session, entryKey, promptKey }
  saveSession(state.session)
}

/** 测试用：复位模块级状态（模拟整页刷新：内存清空，挂载时由 bindUser 从存储读回）。 */
export function resetAiSidebarForTest(): void {
  state.open = false
  state.request = null
  state.owner = null
  state.session = null
  state.mountKey = 0
  seq = 0
  pending = null
  lastTaken = null
}

export function useAiSidebar() {
  return {
    state: readonly(state),
    open() {
      state.open = true
    },
    close() {
      state.open = false
    },
    /** 按当前页声明发起「解读本页」；返回是否发出了解读（无解读能力时仅打开侧边栏）。 */
    interpret(): boolean {
      const def = activeAiPage().value
      const plan = def ? resolveInterpret(def) : null
      if (!def || !plan) {
        state.open = true
        return false
      }
      dispatch(
        { kind: 'page', question: plan.question, scenario: 'chat', promptKey: def.promptKey, label: def.label, title: `${def.label} · 解读` },
        evaluate(plan.context)
      )
      return true
    },
    /** 专家命令：在侧边栏内新开对应入口的会话（场景、角色、首问与工作台同名入口一致）。 */
    startExpert(launch: ExpertLaunch): void {
      const { entry, question, values } = launch
      dispatch(
        {
          kind: 'expert',
          question,
          scenario: entry.scenario,
          promptKey: entry.promptKey ?? '',
          label: entry.title,
          title: values.date ? `${entry.title} · ${values.date}` : entry.title,
          entryKey: entry.key,
          meta: values
        },
        null
      )
    },
    /** 跨场景的技能/移交：在侧边栏内新开目标场景会话（不跳转工作台）。 */
    openScenario(question: string, scenario: AgentScenario): void {
      const promptKey = scenario === 'chat' ? PAGE_PROMPT_KEYS.workbench : ''
      dispatch(
        {
          kind: 'expert',
          question,
          scenario,
          promptKey,
          label: '',
          title: question.slice(0, 24),
          entryKey: entryForSession(scenario, promptKey).key
        },
        null
      )
    },
    /** 带局部数据向侧边栏提问；角色缺省取当前页声明，无声明时用通用对话角色。 */
    ask(
      question: string,
      opts: { context?: AiContextFactory | Record<string, unknown> | null; label?: string; promptKey?: PagePromptKey } = {}
    ): void {
      const def = activeAiPage().value
      const label = opts.label ?? def?.label ?? ''
      dispatch(
        {
          kind: 'page',
          question,
          scenario: 'chat',
          promptKey: opts.promptKey ?? def?.promptKey ?? PAGE_PROMPT_KEYS.workbench,
          label,
          title: label || question.slice(0, 24)
        },
        evaluate(opts.context)
      )
    }
  }
}
