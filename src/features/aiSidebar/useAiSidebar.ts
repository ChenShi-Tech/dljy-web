// 全局 AI 侧边栏状态与业务页调用入口（取代原 composables/useAiPanel）。
//
// 模块级 reactive 单例（不引 pinia）。业务页只通过 `useAiSidebar()` 与侧边栏交互：
// - `interpret()`：按当前页声明发起「解读本页」；页面没有解读能力时只打开侧边栏
// - `ask(question, { context })`：快捷任务、区块解读、选中即问
// 侧边栏壳监听 `request.seq`，把问题送进对话内核；数据切片以「待取」形式保存，
// 内核发送这条问题时经 `takeSliceFor` 取走一次，之后的自由追问不再重复附带。
import { reactive, readonly } from 'vue'
import { PAGE_PROMPT_KEYS, type PagePromptKey } from '@/prompts/pageKeys'
import { activeAiPage, resolveInterpret, type AiContextFactory } from './pageRegistry'

export interface AiAskRequest {
  seq: number
  question: string
  promptKey: PagePromptKey
  label: string
}

interface AiSidebarState {
  open: boolean
  request: AiAskRequest | null
}

const state = reactive<AiSidebarState>({ open: false, request: null })
let seq = 0
let pending: { question: string; slice: Record<string, unknown> | null } | null = null

function evaluate(context: AiContextFactory | Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!context) return null
  return typeof context === 'function' ? context() : context
}

function dispatch(question: string, slice: Record<string, unknown> | null, promptKey: PagePromptKey, label: string): void {
  const text = question.trim()
  if (!text) return
  pending = { question: text, slice }
  seq += 1
  state.request = { seq, question: text, promptKey, label }
  state.open = true
}

/** 内核发送某条问题时取走其数据切片（只取一次；问题文本不匹配则不附带）。 */
export function takeSliceFor(question: string): Record<string, unknown> | null {
  if (!pending || pending.question !== question.trim()) return null
  const { slice } = pending
  pending = null
  return slice
}

/** 测试用：复位模块级状态。 */
export function resetAiSidebarForTest(): void {
  state.open = false
  state.request = null
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
      dispatch(plan.question, evaluate(plan.context), def.promptKey, def.label)
      return true
    },
    /** 带局部数据向侧边栏提问；角色缺省取当前页声明，无声明时用通用对话角色。 */
    ask(
      question: string,
      opts: { context?: AiContextFactory | Record<string, unknown> | null; label?: string; promptKey?: PagePromptKey } = {}
    ): void {
      const def = activeAiPage().value
      dispatch(
        question,
        evaluate(opts.context),
        opts.promptKey ?? def?.promptKey ?? PAGE_PROMPT_KEYS.workbench,
        opts.label ?? def?.label ?? ''
      )
    }
  }
}
