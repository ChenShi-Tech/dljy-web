// useInsightEntryAnchor 行为单测（dljy#3134，A02 修订）：
// 守什么不变量——
//   ① 无窗口参数进入：对 supply.system-series 发一次 [今日-365, 今日] 覆盖扫描，
//     默认窗锚定到候选最新日（单日窗）并给出提示；
//   ② URL 带过 start/end：不请求不锚定（显式窗口与下钻/刷新恢复语义不变）；
//   ③ 最新有数据日就是今天（或未来）：保持当日默认，不提示；
//   ④ 扫描失败静默：不引入新错误态；
//   ⑤ 会话内同地区只扫一次，页间复用；
//   ⑥ 扫描在途时用户已改窗口：迟到响应不写入（不踩用户选择）；
//   ⑦ 切回今天：窗口回默认日并清提示。
// mock 边界：只打桩 insightClient 的 fetchInsightCoverage；上下文用最小桩（ref + 记录器）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const fetchInsightCoverage = vi.fn()
vi.mock('@/services/insight/insightClient', () => ({
  fetchInsightCoverage: (...args: unknown[]) => fetchInsightCoverage(...args),
}))

type Ctx = Parameters<typeof import('./useInsightEntryAnchor')['useInsightEntryAnchor']>[0]

function makeCtx(hadWindowParam = false): Ctx & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = []
  const businessWindow = ref<{ start: string; end: string }>({ start: '1970-01-01', end: '1970-01-01' })
  const ctx: Ctx = {
    regionId: ref('yunnan'),
    businessWindow,
    hadWindowParam,
    setBusinessWindow: (start, end) => {
      calls.push([start, end])
      businessWindow.value = { start, end }
    },
    toQueryContext: () => ({ regionId: 'yunnan', businessWindow: businessWindow.value }),
  }
  return Object.assign(ctx, { calls })
}

function candidatesPayload(dates: string[]): unknown {
  return {
    schemaVersion: 'insight/v1',
    analysisId: 'supply.system-series',
    regionId: 'yunnan',
    businessWindow: { start: '2000-01-01', end: '2999-01-01' },
    sources: [],
    candidates: { dates, ranges: dates.length ? [{ start: dates[0], end: dates[dates.length - 1] }] : [], discrete: false, perInput: [], reason: null },
    note: '',
    mock: false as const,
    productionWrite: false as const,
  }
}

async function setup(hadWindowParam = false) {
  const mod = await import('./useInsightEntryAnchor')
  const { beijingToday } = await import('shared/midlong/dates.mjs')
  const today = beijingToday()
  const ctx = makeCtx(hadWindowParam)
  ctx.businessWindow.value = { start: today, end: today }
  const anchor = mod.useInsightEntryAnchor(ctx)
  return { anchor, ctx, today }
}

beforeEach(() => {
  vi.resetModules()
  fetchInsightCoverage.mockReset()
})

describe('useInsightEntryAnchor', () => {
  it('无窗口参数：锚定到候选最新日并提示', async () => {
    fetchInsightCoverage.mockResolvedValue(candidatesPayload(['2000-01-01', '2000-01-03']))
    const { anchor, ctx, today } = await setup()
    await vi.waitFor(() => expect(ctx.businessWindow.value).toEqual({ start: '2000-01-03', end: '2000-01-03' }))
    expect(anchor.anchorNotice.value).toMatchObject({ requested: today, anchoredTo: '2000-01-03' })
    // 扫描请求形状：公开分析 + [今日-365, 今日] 窗口
    const request = fetchInsightCoverage.mock.calls[0][0] as { analysisId: string; context: { businessWindow: { start: string; end: string } } }
    expect(request.analysisId).toBe('supply.system-series')
    expect(request.context.businessWindow.end).toBe(today)
    expect(request.context.businessWindow.start < request.context.businessWindow.end).toBe(true)
  })

  it('URL 带过 start/end：不请求不锚定', async () => {
    const { anchor, ctx, today } = await setup(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fetchInsightCoverage).not.toHaveBeenCalled()
    expect(ctx.businessWindow.value).toEqual({ start: today, end: today })
    expect(anchor.anchorNotice.value).toBeNull()
  })

  it('最新有数据日不早于今日：保持当日默认', async () => {
    fetchInsightCoverage.mockResolvedValue(candidatesPayload(['2999-01-01']))
    const { anchor, ctx, today } = await setup()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.businessWindow.value).toEqual({ start: today, end: today })
    expect(anchor.anchorNotice.value).toBeNull()
  })

  it('扫描失败：静默保持当日默认，不抛错', async () => {
    fetchInsightCoverage.mockRejectedValue(new Error('network'))
    const { anchor, ctx, today } = await setup()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.businessWindow.value).toEqual({ start: today, end: today })
    expect(anchor.anchorNotice.value).toBeNull()
  })

  it('会话内同地区复用：第二次进入不再请求', async () => {
    fetchInsightCoverage.mockResolvedValue(candidatesPayload(['2000-05-05']))
    const first = await setup()
    await vi.waitFor(() => expect(first.ctx.businessWindow.value.start).toBe('2000-05-05'))
    const calls = fetchInsightCoverage.mock.calls.length
    const second = await setup()
    expect(fetchInsightCoverage.mock.calls.length).toBe(calls)
    expect(second.ctx.businessWindow.value).toEqual({ start: '2000-05-05', end: '2000-05-05' })
  })

  it('扫描在途时用户已改窗口：迟到响应不写入', async () => {
    const released = { fn: null as ((value: unknown) => void) | null }
    fetchInsightCoverage.mockReturnValue(new Promise((resolve) => { released.fn = resolve }))
    const { ctx, today } = await setup()
    ctx.setBusinessWindow('2000-02-02', '2000-02-02') // 用户先手动选了别的日子
    released.fn?.(candidatesPayload(['2000-01-01']))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.businessWindow.value).toEqual({ start: '2000-02-02', end: '2000-02-02' })
    expect(today).toBeTruthy()
  })

  it('切回今天：窗口回默认日并清提示', async () => {
    fetchInsightCoverage.mockResolvedValue(candidatesPayload(['2000-01-07']))
    const { anchor, ctx, today } = await setup()
    await vi.waitFor(() => expect(anchor.anchorNotice.value).not.toBeNull())
    anchor.backToToday()
    expect(ctx.businessWindow.value).toEqual({ start: today, end: today })
    expect(anchor.anchorNotice.value).toBeNull()
  })
})
