// alertClient.listAlerts 失败契约守卫（fix-spot-degradation-honesty）：
// 告警链路不可用必须以异常暴露，不得吞成空列表冒充「无告警」——风控页会把空列表
// 判成绿色「安全」，值守面据此忽略真实告警（本机 2026-10-10 实测：告警端点 500，
// 页面显示「0 条 · 安全」）。需要静默的消费方（顶栏 AlertCenter）自行 catch。
import { afterEach, describe, expect, it, vi } from 'vitest'

const identityHeaders = vi.fn(() => ({ authorization: 'Bearer test' }))
vi.mock('@/services/agent/agentClient', () => ({
  AGENT_API_BASE: '/agent-api/agent',
  identityHeaders: () => identityHeaders(),
}))
vi.mock('@/services/api', () => ({ timeoutSignal: () => undefined }))
vi.mock('@/services/llm', () => ({ getAdminToken: () => null }))

const { listAlerts } = await import('@/services/alertClient')

afterEach(() => {
  vi.unstubAllGlobals()
  identityHeaders.mockClear()
})

describe('listAlerts 失败契约（失败抛错，不冒充空告警）', () => {
  it('HTTP 500 → 抛错并携带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Internal Server Error', { status: 500 })))
    await expect(listAlerts()).rejects.toThrow('HTTP 500')
  })

  it('网络错误 → 抛错（不被吞成空列表）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(listAlerts()).rejects.toThrow('Failed to fetch')
  })

  it('2xx 但响应非 JSON → 抛错（网关 HTML 错误页不算无告警）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>bad gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    ))
    await expect(listAlerts()).rejects.toThrow()
  })

  it('成功 → 返回原形状（成功路径契约不变）', async () => {
    const body = { alerts: [], open_count: 0 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    await expect(listAlerts()).resolves.toEqual(body)
    expect(identityHeaders).toHaveBeenCalled()
  })
})
