import { describe, it, expect } from 'vitest'
import { runSerially } from './serialRun'

describe('runSerially', () => {
  it('严格串行：前一个结束后才开始下一个，且按输入顺序返回', async () => {
    const events: string[] = []
    let running = 0
    let maxRunning = 0
    const out = await runSerially(['a', 'b', 'c'], async (id) => {
      running++; maxRunning = Math.max(maxRunning, running)
      events.push(`start:${id}`)
      await new Promise((r) => setTimeout(r, id === 'a' ? 15 : 1))
      events.push(`end:${id}`)
      running--
      return id.toUpperCase()
    })
    expect(maxRunning).toBe(1)
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
    expect(out.map((o) => (o.ok ? o.value : null))).toEqual(['A', 'B', 'C'])
  })

  it('单个失败不中断后续，失败原因原样保留', async () => {
    const seen: string[] = []
    const out = await runSerially(['a', 'b', 'c'], async (id) => {
      seen.push(id)
      if (id === 'b') throw new Error('b 没有基本面数据')
      return id
    })
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(out.map((o) => o.ok)).toEqual([true, false, true])
    const failed = out[1]
    expect(failed && !failed.ok && (failed.error as Error).message).toBe('b 没有基本面数据')
  })

  it('每完成一项（含失败）回显一次进度 done/total', async () => {
    const progress: Array<[number, number]> = []
    await runSerially([1, 2, 3], async (n) => { if (n === 2) throw new Error('x'); return n },
      { onProgress: (done, total) => progress.push([done, total]) })
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('shouldContinue 返回 false 后停止发起后续请求', async () => {
    let cancelled = false
    const seen: number[] = []
    const out = await runSerially([1, 2, 3, 4], async (n) => { seen.push(n); if (n === 2) cancelled = true; return n },
      { shouldContinue: () => !cancelled })
    expect(seen).toEqual([1, 2])
    expect(out).toHaveLength(2)
  })

  it('空列表返回空数组且不回调进度', async () => {
    let called = false
    const out = await runSerially([], async () => 1, { onProgress: () => { called = true } })
    expect(out).toEqual([])
    expect(called).toBe(false)
  })
})
