// 全局统一 AI 面板单例：业务页「✨AI 解读」的宿主。模块级 reactive 单例（不引 pinia）。
//
// **只剩一个模式（2026-08-26）**：原先还有个 `nav` 导航助手模式——前端直连大模型 Key 做页面
// 推荐与跳转，与统一工作台 `/ai-agent` 能力重叠，且走 agent 体系之外的老路（不经 /agent-api、
// 不入审计、不受工具审批约束），已下架进 `src/attic/ai-navigator-panel/`（含恢复步骤）。
// 本面板现在只承载 agent 解读：业务页调 openAgent(ctx) 注入上下文，面板嵌 AgentChatPanel 流式研判。
//
// 专项 AI 工作台页（工作台/储能等整页 AgentChatPanel）不走此面板、保持独立。
import { reactive } from 'vue'
import type { PagePromptKey } from '@/prompts'

export interface AiAgentCtx {
  /** 页面提示白名单 key（src/prompts/pageKeys.ts，前后端对齐；收紧为 PagePromptKey，编译期防自由文本绕过白名单） */
  promptKey?: PagePromptKey
  scenario?: string
  /** 打开即自动发送的首条问题（触发流式解读） */
  initialQuestion?: string
  /** 选中即问上下文（untrusted_external_content 语义，随消息 payload 下发） */
  contextPayload?: Record<string, unknown> | null
  /** 业务上下文（地区等） */
  payload?: Record<string, unknown> | null
  /** 面板标题副文案（可选） */
  label?: string
}

interface AiPanelState {
  open: boolean
  agentCtx: AiAgentCtx | null
  /** 每次 openAgent 自增，作「来了新问题」信号（非 remount：面板保活续聊） */
  agentKey: number
}

const state = reactive<AiPanelState>({
  open: false,
  agentCtx: null,
  agentKey: 0
})

export function useAiPanel() {
  return {
    state,
    /** 打开 agent 解读并注入上下文（业务页「✨AI 解读」/「选中即问」触发） */
    openAgent(ctx: AiAgentCtx) {
      state.agentCtx = ctx
      state.agentKey += 1
      state.open = true
    },
    close() {
      state.open = false
    }
  }
}
