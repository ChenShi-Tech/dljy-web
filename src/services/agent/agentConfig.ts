// 运行期 Agent/LLM 配置：采样参数 / 角色路由 / 全局工作流。
// 对接 agent-backend 的 /api/agent/llm/{params,routing,workflow}（与 llm.ts 的密钥端点同源）。
// 写操作复用 llm.ts 的管理令牌（x-admin-token，仅当服务端配了 HARNESS_ADMIN_TOKEN 时校验）。
//
// #538 阶段 1：改用 agent/httpClient 工厂，删本地 adminHeaders/jsonHeaders/readHeaders/errDetail/put
// 样板（这些原语现在单点维护在 httpClient.ts，15 个 agent/* 客户端共享）。
import { createAgentClient, type SaveResult } from '@/services/agent/httpClient'

const http = createAgentClient('/llm', { timeoutMs: 10_000 })

// 采样参数（temperature/max_tokens/top_p）
export type SamplingParams = { temperature?: number; max_tokens?: number; top_p?: number }
export type ParamsConfig = {
  fields: string[]
  default: SamplingParams
  models: Record<string, SamplingParams>
}

export async function getParams(): Promise<ParamsConfig> {
  return http.get<ParamsConfig>('/params')
}
// ref="_default" 设全局默认；空 params 清除该 ref 的覆盖
export function putParams(ref: string, params: SamplingParams): Promise<SaveResult> {
  return http.tryPut('/params', { ref, params })
}

// 角色→模型路由
export type RoutingModel = { ref: string; tool_call: boolean; vision: boolean; tier: string }
export type RoutingRole = {
  role: string
  default_ref: string
  override_ref: string | null
  effective_ref: string
  requires: string[]
}
export type RoutingConfig = { models: RoutingModel[]; roles: RoutingRole[] }

export async function getRouting(): Promise<RoutingConfig> {
  return http.get<RoutingConfig>('/routing')
}
// modelRef=null 恢复 YAML 默认
export function putRouting(role: string, modelRef: string | null): Promise<SaveResult> {
  return http.tryPut('/routing', { role, model_ref: modelRef })
}

// 全局工作流参数
export type WorkflowParam = { value: number; default: number; overridden: boolean }
export type WorkflowConfig = { params: Record<string, WorkflowParam> }

export async function getWorkflow(): Promise<WorkflowConfig> {
  return http.get<WorkflowConfig>('/workflow')
}
export function putWorkflow(params: Record<string, number>): Promise<SaveResult> {
  return http.tryPut('/workflow', { params })
}

// 角色中文名（与 AgentChatPanel 同源的 11 个 supervisor 子智能体角色 + supervisor）
export const ROLE_LABELS: Record<string, string> = {
  supervisor: '调度中枢',
  market_analyst: '市场分析师',
  data_collector: '数据采集员',
  prediction_assistant: '预测助手',
  declaration_strategist: '申报策略师',
  review_reporter: '复盘报告员',
  risk_sentinel: '风控哨兵',
  price_forecaster: '价格预测专员',
  hedge_strategist: '中长期套保专员',
  arbitrage_optimizer: '套利储能专员',
  settlement_auditor: '结算校核专员',
  bidding_game_analyst: '报价博弈分析师',
  data_analyst: '数据分析师',
  compliance_officer: '合规规则专员',
  browser_operator: '浏览器操作员'
}

// 工作流参数中文标签与说明
export const WORKFLOW_LABELS: Record<string, { label: string; help: string }> = {
  max_model_calls_per_run: { label: '单次运行·最大模型调用数', help: '失控保护：一次智能体运行内 LLM 调用上限，达上限即结束本轮' },
  max_tool_calls_per_run: { label: '单次运行·最大工具调用数', help: '失控保护：一次运行内工具调用上限，超出后该工具被拦截但智能体可继续' },
  summarize_after_tokens: { label: '历史压缩·触发 token 阈值', help: '对话历史超过该 token 数后自动压缩为摘要，控制上下文长度与成本' },
  chat_rate_limit_per_min: { label: '轻量对话·每分钟限流', help: '/llm/chat 每 IP 每分钟调用上限，0 = 不限流' }
}
