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
}

interface AiSidebarState {
  open: boolean
  request: AiAskRequest | null
  /** 当前会话记录；null = 从未使用或已新建空白对话 */
  session: AiSessionRecord | null
  /** 切换会话时自增，侧边栏据此重挂对话内核 */
  mountKey: number
}

const STORAGE_KEY = 'dljy.aiSidebar.session'

function loadSession(): AiSessionRecord | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AiSessionRecord>
    if (typeof parsed?.sessionId !== 'string' || typeof parsed.scenario !== 'string') return null
    return {
      sessionId: parsed.sessionId,
      scenario: parsed.scenario,
      promptKey: typeof parsed.promptKey === 'string' ? parsed.promptKey : '',
      sourceRoute: typeof parsed.sourceRoute === 'string' ? parsed.sourceRoute : '',
      entryKey: typeof parsed.entryKey === 'string' ? parsed.entryKey : 'workbench',
      title: typeof parsed.title === 'string' ? parsed.title : ''
    }
  } catch {
    return null
  }
}

function saveSession(record: AiSessionRecord | null): void {
  try {
    if (typeof window === 'undefined') return
    // 只持久化已建成的会话；空白新对话无需恢复
    if (record?.sessionId) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 隐私模式/存储被禁用：刷新后不恢复，但不影响本次使用
  }
}

const state = reactive<AiSidebarState>({ open: false, request: null, session: loadSession(), mountKey: 0 })
let seq = 0
let pending: { question: string; slice: Record<string, unknown> | null } | null = null

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
  if (!question) return
  pending = { question, slice }
  seq += 1
  state.request = { ...request, question, seq }
  state.open = true
}

/** 内核发送某条问题时取走其数据切片（只取一次；问题文本不匹配则不附带）。 */
export function takeSliceFor(question: string): Record<string, unknown> | null {
  if (!pending || pending.question !== question.trim()) return null
  const { slice } = pending
  pending = null
  return slice
}

/** 切换到指定会话（null = 空白新对话）并重挂内核。 */
export function switchSession(record: AiSessionRecord | null): void {
  state.session = record ? { ...record } : null
  state.mountKey += 1
  saveSession(state.session)
}

/** 内核建好会话后回填 id（不重挂内核）。 */
export function adoptSessionId(sessionId: string): void {
  state.session = state.session ? { ...state.session, sessionId } : { ...BLANK_SESSION, sessionId }
  saveSession(state.session)
}

/** 测试用：复位模块级状态（可选择重新从存储读取会话记录，模拟刷新）。 */
export function resetAiSidebarForTest(opts: { reloadFromStorage?: boolean } = {}): void {
  state.open = false
  state.request = null
  state.session = opts.reloadFromStorage ? loadSession() : null
  state.mountKey = 0
  seq = 0
  pending = null
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
