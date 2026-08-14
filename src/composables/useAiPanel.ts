// 全局统一 AI 面板单例：合并「右上角导航助手」与「业务页右栏 agent 解读」为一处加宽面板。
// 模块级 reactive 单例（不引 pinia）。两模式：
//   - nav   ：AiAssistant 原导航助手（LLM 导航建议 + 多会话 + 语音 + 斜杠）
//   - agent ：嵌入 AgentChatPanel，按调用页注入的 agentCtx（promptKey/scenario/上下文）做解读
// 业务页（如市场洞察驾驶舱）去掉自带右栏，改调 openAgent(ctx) 触发本面板的 agent 模式。
// 专项 AI 工作台页（晨报/储能/申报等整页 AgentChatPanel）不走此面板、保持独立。
import { reactive } from 'vue'
import type { PagePromptKey } from '@/prompts'

export type AiPanelMode = 'nav' | 'agent'

export interface AiAgentCtx {
  /** 页面提示白名单 key（src/prompts/pageKeys.ts，前后端对齐；收紧为 PagePromptKey，编译期防自由文本绕过白名单） */
  promptKey?: PagePromptKey
  scenario?: string
  /** 打开即自动发送的首条问题（remount 触发流式解读） */
  initialQuestion?: string
  /** 选中即问上下文（untrusted_external_content 语义，随消息 payload 下发） */
  contextPayload?: Record<string, unknown> | null
  /** 业务上下文（地区等） */
  payload?: Record<string, unknown> | null
  /** 面板 agent 模式下的标题副文案（可选） */
  label?: string
}

interface AiPanelState {
  open: boolean
  mode: AiPanelMode
  agentCtx: AiAgentCtx | null
  /** 每次 openAgent 自增，作 AgentChatPanel 的 :key 强制 remount → 触发新解读 */
  agentKey: number
}

const state = reactive<AiPanelState>({
  open: false,
  mode: 'nav',
  agentCtx: null,
  agentKey: 0
})

export function useAiPanel() {
  return {
    state,
    /** 打开导航助手模式（右上角「AI 导航」按钮、斜杠等） */
    openNav() {
      state.mode = 'nav'
      state.open = true
    },
    /** 打开 agent 解读模式并注入上下文（业务页「✨AI 解读」触发） */
    openAgent(ctx: AiAgentCtx) {
      state.agentCtx = ctx
      state.mode = 'agent'
      state.agentKey += 1
      state.open = true
    },
    setMode(mode: AiPanelMode) {
      state.mode = mode
    },
    close() {
      state.open = false
    }
  }
}
