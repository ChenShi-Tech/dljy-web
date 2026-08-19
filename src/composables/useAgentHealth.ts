// 智能体服务探活 composable：把 pingAgentService 封装为响应式健康状态。
// 供 AgentChatPanel（被 8 个接入点复用）在「后端未起」时优雅提示「智能体服务未就绪」，
// 而非挂载即发首条消息、直到 SSE 失败才报错（阶段 A G2）。
//
// 设计：探活走 GET /api/agent/sessions（pingAgentService，2.5s 超时），不触发鉴权门
// （/schedules、/alerts 才需 token；sessions 列表为开放读）。每个接入点挂载时调一次 check()。

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { pingAgentService } from '@/services/agent/agentClient'

export type AgentHealth = 'unknown' | 'online' | 'offline'

export interface UseAgentHealthReturn {
  /** 健康状态：unknown（未探活）/ online / offline */
  health: Ref<AgentHealth>
  /** 是否在线（health === 'online'），通过探活确认后端已起 */
  ready: ComputedRef<boolean>
  /** 是否离线（health === 'offline'），后端未起，应提示而非发首条 */
  offline: ComputedRef<boolean>
  /** 触发一次探活（默认沿用 pingAgentService 的 2.5s 超时） */
  check: (timeoutMs?: number) => Promise<void>
}

export function useAgentHealth(): UseAgentHealthReturn {
  const health = ref<AgentHealth>('unknown')
  const check = async (timeoutMs?: number) => {
    health.value = (await pingAgentService(timeoutMs)) ? 'online' : 'offline'
  }
  return {
    health,
    ready: computed(() => health.value === 'online'),
    offline: computed(() => health.value === 'offline'),
    check,
  }
}
