// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；
// 用例依赖 localStorage（identityHeaders 的 token/company 读取），靠此 pragma 切环境。
//
// quantClient 产物读取契约（守什么不变量 / 坏掉的症状 / issue 号）：
// 守：fetchArtifactContent 按会话号取产出物正文，URL 必须以 AGENT_API_BASE
//（/agent-api/agent，agent-runtime）开头——artifacts 端点由 agent-runtime 提供，
// pi-poc 没有该路由（未匹配一律 404），即便会话是 createAgentSession 建在 pi 上的
// 也必须落 agent-backend（对 pi 会话走历史库 owner 校验放行）。
// 坏掉的症状：曾误改走 PI_AGENT_BASE（#2958 首轮 PR），产物正文恒 404 → 复盘产出物
// 打不开；本文件锁住该回归。issue：ChenShi-Tech/dljy#2958。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const regionState = vi.hoisted(() => ({ id: 'yunnan' }))
const timeoutSignalState = vi.hoisted(() => ({ signal: new AbortController().signal }))

vi.mock('@/services/api', () => ({
  AGENT_API_BASE_ROOT: '/agent-api',
  timeoutSignal: () => timeoutSignalState.signal,
  applyRegionHeaders: vi.fn(),
}))
vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: regionState.id } } },
}))
vi.mock('@/services/market/cgnYunnanLivePrice', () => ({
  fetchCgnYunnanPriceBundle: vi.fn(),
  hasCgnYunnanPriceEntitlement: vi.fn(() => false),
}))

import { fetchArtifactContent } from '@/services/quant/quantClient'
import { AGENT_API_BASE, PI_AGENT_BASE } from '@/services/agent/agentClient'

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

beforeEach(() => {
  localStorage.clear()
  regionState.id = 'yunnan'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchArtifactContent 产物正文路由（#2958 返工）', () => {
  it('URL 以 AGENT_API_BASE 开头、路径段逐段编码，不以 pi 基址开头', async () => {
    const spy = vi.fn(async () => jsonRes({ path: 'reports/day.csv', content: 'a,b\n1,2' }))
    vi.stubGlobal('fetch', spy)
    const text = await fetchArtifactContent('sess-q', 'reports/day.csv')
    expect(text).toBe('a,b\n1,2')
    const [url] = spy.mock.calls[0] as unknown as [string]
    expect(url).toBe(`${AGENT_API_BASE}/sessions/sess-q/artifacts/reports/day.csv`)
    expect(url.startsWith(AGENT_API_BASE)).toBe(true)
    expect(url.startsWith(PI_AGENT_BASE)).toBe(false)
  })

  it('路径含空格/斜杠时逐段 encode（encodeAgentPath 语义），会话 id 仍是 pi 会话号', async () => {
    const spy = vi.fn(async () => jsonRes('plain text'))
    vi.stubGlobal('fetch', spy)
    await fetchArtifactContent('sess-中文', 'sub dir/file name.json')
    const [url] = spy.mock.calls[0] as unknown as [string]
    expect(url).toBe(`${AGENT_API_BASE}/sessions/sess-${encodeURIComponent('中文')}/artifacts/sub%20dir/file%20name.json`)
  })

  it('响应体为字符串原样返回；对象取 content 字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes('raw-string-body')))
    await expect(fetchArtifactContent('s', 'p.txt')).resolves.toBe('raw-string-body')
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ content: 'from-field' })))
    await expect(fetchArtifactContent('s', 'p.txt')).resolves.toBe('from-field')
  })

  it('非 2xx → throw（产物读取失败必须可见，不静默空串）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })))
    await expect(fetchArtifactContent('s', 'p.txt')).rejects.toThrow('读取失败: 404')
  })
})
