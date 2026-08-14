// mapWithConcurrency 并发上限回归：结果保序 + in-flight 峰值 ≤ limit。
// 坏掉的症状（都来自真实场景）：现货面板整月拉取 ~31 个请求同时打后端把 agent 服务
// 打挂（上限失效）；或为了限流改成顺序 await 后结果按完成顺序排列，日期列错位
// （保序失效）——图表不报错，只把周三维的价格画到周四上。
import { describe, expect, it, vi } from 'vitest'
import { mapWithConcurrency } from './concurrency'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('mapWithConcurrency：结果保序', () => {
  it('受控 deferred 乱序 resolve，结果仍按 items 顺序（不按完成顺序）', async () => {
    const ds = Array.from({ length: 5 }, () => deferred<number>())
    const promise = mapWithConcurrency([10, 20, 30, 40, 50], 2, async (item, i) => {
      const d = await ds[i].promise
      return d + item
    })
    // 乱序完成：3 号先完成、0 号最后完成
    ds[3].resolve(1000)
    ds[1].resolve(100)
    ds[0].resolve(0)
    ds[4].resolve(4000)
    ds[2].resolve(200)
    const results = await promise
    // 手算：results[i] = ds[i] + items[i]，与 resolve 顺序无关
    expect(results).toEqual([10, 120, 230, 1040, 4050])
  })

  it('mapper 收到正确的 (item, index)', async () => {
    const seen: Array<[string, number]> = []
    await mapWithConcurrency(['a', 'b', 'c'], 3, async (item, i) => {
      seen.push([item, i])
      return item
    })
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('单 limit 下并发为 1，处理顺序仍按索引推进', async () => {
    const order: number[] = []
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n)
      return n * 10
    })
    expect(order).toEqual([1, 2, 3])
  })
})

describe('mapWithConcurrency：并发上限', () => {
  it('limit=2 时 in-flight 峰值恰为 2、不超过 2', async () => {
    const ds = Array.from({ length: 6 }, () => deferred<number>())
    let inFlight = 0
    let peak = 0
    const promise = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (n, i) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      try {
        return await ds[i].promise
      } finally {
        inFlight--
      }
    })
    // 逐个放行：每放一个，worker 才会取下一个任务
    for (const d of ds) d.resolve(0)
    await promise
    expect(peak).toBe(2)
  })

  it('limit=4 峰值恰为 4（上限真实生效而非装饰参数）', async () => {
    const ds = Array.from({ length: 10 }, () => deferred<number>())
    let inFlight = 0
    let peak = 0
    const promise = mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      4,
      async (_n, i) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        try {
          return await ds[i].promise
        } finally {
          inFlight--
        }
      }
    )
    for (const d of ds) d.resolve(0)
    await promise
    expect(peak).toBe(4)
  })

  it('limit=0 / 负数钳位为 1（防手滑把并发关死或放成无界）', async () => {
    for (const bad of [0, -3]) {
      let inFlight = 0
      let peak = 0
      await mapWithConcurrency([1, 2, 3], bad, async (n) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        inFlight--
        return n
      })
      expect(peak).toBe(1)
    }
  })

  it('limit 超过 items 数时按 items 数开 worker（空转 worker 不创建）', async () => {
    let started = 0
    const results = await mapWithConcurrency(['x', 'y'], 100, async (v) => {
      started++
      await Promise.resolve()
      return v.toUpperCase()
    })
    expect(results).toEqual(['X', 'Y'])
    expect(started).toBe(2) // 只有 2 个任务，最多 2 个 mapper 调用
  })
})

describe('mapWithConcurrency：边界与失败', () => {
  it('空数组 → 立即空结果（不挂起）', async () => {
    const mapper = vi.fn(async (x: number) => x)
    await expect(mapWithConcurrency([], 3, mapper)).resolves.toEqual([])
    expect(mapper).not.toHaveBeenCalled()
  })

  it('单项失败 → 整体 reject 并透传原错误（不让失败静默成 undefined 槽位）', async () => {
    const boom = new Error('day 15 fetch failed')
    const promise = mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw boom
      return n
    })
    await expect(promise).rejects.toBe(boom) // 同一错误对象，不包装
  })

  it('失败后其余任务的结果不冒充成功（整体已 reject）', async () => {
    const seen: number[] = []
    const promise = mapWithConcurrency([1, 2, 3], 1, async (n) => {
      seen.push(n)
      if (n === 1) throw new Error('first fails')
      return n
    })
    await expect(promise).rejects.toThrow('first fails')
    // limit=1 顺序执行：第 1 个失败后 worker 抛出，后续不再被取
    expect(seen).toEqual([1])
  })
})
