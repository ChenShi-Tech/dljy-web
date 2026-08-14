/**
 * 报表订阅（定时生成 + 推送）。Phase 3 为前端 localStorage 持久化的演示实现：
 * 配置可创建/启停/删除，但定时调度与推送是 Mock —— 不会实际触发生成或发送。
 * 真实落地需后端 cron 调度 + 邮件/webhook 网关（明确标注，避免误判为已接入）。
 */
export type SubscriptionFrequency = 'daily' | 'weekly' | 'monthly'
export type SubscriptionChannel = 'email' | 'webhook'

export type ReportSubscription = {
  id: string
  templateId: string
  templateName: string
  frequency: SubscriptionFrequency
  regionId: string
  subjectType: string
  recipients: string
  channel: SubscriptionChannel
  enabled: boolean
  createdAt: string
}

const STORAGE_KEY = 'dljy.report.subscriptions'

export const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  daily: '每日', weekly: '每周', monthly: '每月'
}
export const CHANNEL_LABELS: Record<SubscriptionChannel, string> = {
  email: '邮件', webhook: 'Webhook'
}

function read(): ReportSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(list: ReportSubscription[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function listSubscriptions(): ReportSubscription[] {
  return read()
}

export function createSubscription(input: Omit<ReportSubscription, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean }): ReportSubscription {
  const sub: ReportSubscription = {
    ...input,
    id: `SUB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString()
  }
  const all = read()
  all.unshift(sub)
  persist(all)
  return sub
}

export function toggleSubscription(id: string): void {
  const all = read().map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
  persist(all)
}

export function removeSubscription(id: string): void {
  persist(read().filter((s) => s.id !== id))
}
