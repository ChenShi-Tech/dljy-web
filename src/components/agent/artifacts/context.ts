// Artifact 上下文：经 provide/inject 把「向智能体回传消息」的能力下放到交互型 artifact
// （如 FormArtifact 提交后把填写结果作为新消息发给 agent）。AgentChatPanel 提供 submit。
import type { InjectionKey } from 'vue'

export type ArtifactContext = {
  /** 把文本作为新用户消息发送给智能体（表单回传等）。 */
  submit?: (text: string) => void
  /** 当前会话 ID（供需要按 data_ref 拉取明细的 artifact，如 AnalysisChartArtifact #59）。 */
  sessionId?: () => string | undefined
}

export const ARTIFACT_CONTEXT: InjectionKey<ArtifactContext> = Symbol('artifact-context')
