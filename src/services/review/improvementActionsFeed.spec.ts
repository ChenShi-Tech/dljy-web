// 守改进记录清单完整：后端按单一状态查询且缺省只回 open，只取缺省值会让继续跟进与已验证的措施消失。dljy#2877。
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAllImprovementActions } from './reviewStoreClient'

const row = (id: number, status: string) => ({ id, action: `措施 ${id}`, owner: '交易员', dueDate: '2026-05-31', status, updatedAt: '2026-05-01' })
function stub(byStatus: Record<string, { status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const status = new URL(url, 'http://local').searchParams.get('status') ?? 'open'
    const reply = byStatus[status] ?? { status: 200, body: [] }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
afterEach(() => vi.unstubAllGlobals())

describe('全部状态的改进记录', () => {
  it('四种状态分别读取后合并，继续跟进与已验证的措施都在', async () => {
    const fetchMock = stub({ open: { status: 200, body: [row(1, 'open')] }, carried_over: { status: 200, body: [row(2, 'carried_over')] }, done: { status: 200, body: [row(3, 'done')] }, dropped: { status: 200, body: [] } })
    const feed = await fetchAllImprovementActions()
    expect(feed.available).toBe(true)
    expect(feed.available && feed.actions.map(action => action.status).sort()).toEqual(['carried_over', 'done', 'open'])
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string, 'http://local').searchParams.get('status')).sort()).toEqual(['carried_over', 'done', 'dropped', 'open'])
  })
  it('任一状态读不到时整体报不可用，不拿残缺清单冒充完整结果', async () => {
    stub({ open: { status: 200, body: [row(1, 'open')] }, done: { status: 503, body: { msg: '暂不可用' } } })
    expect((await fetchAllImprovementActions()).available).toBe(false)
  })
})
