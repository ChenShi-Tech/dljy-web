// @vitest-environment happy-dom
// ↑ 勿删：timing.ts 全部走 window.setTimeout/requestAnimationFrame，node project 无 window。
//   不用 vi.useFakeTimers，而是手写受控 timer/rAF 队列挂到 window，时间推进完全同步可控，
//   也不依赖 fake timers 对 happy-dom window 属性的替换细节。
//
// 守的不变量：搜索输入防抖重置计时、resize 帧节流一帧只跑最后一次。
// 坏掉的症状：输入每敲一键打一次接口（防抖失效）、拖动图表 resize 卡成幻灯片（节流失效）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce, rafThrottle } from './timing'

// 受控 setTimeout：advance(ms) 手动推进虚拟时钟
type Timer = { cb: () => void; at: number }
let clock = 0
let seq = 0
let timers: Map<number, Timer>
let realSetTimeout: typeof window.setTimeout
let realClearTimeout: typeof window.clearTimeout

function advance(ms: number) {
  clock += ms
  for (const [id, t] of [...timers]) {
    if (t.at <= clock) {
      timers.delete(id)
      t.cb()
    }
  }
}

// 受控 requestAnimationFrame：flushFrame() 执行当前挂起的一帧
let rafQueue: Array<() => void>
let realRaf: typeof window.requestAnimationFrame
let realCancelRaf: typeof window.cancelAnimationFrame

beforeEach(() => {
  clock = 0
  seq = 0
  timers = new Map()
  rafQueue = []
  realSetTimeout = window.setTimeout
  realClearTimeout = window.clearTimeout
  realRaf = window.requestAnimationFrame
  realCancelRaf = window.cancelAnimationFrame
  window.setTimeout = ((cb: () => void, ms?: number) => {
    timers.set(++seq, { cb, at: clock + (ms ?? 0) })
    return seq
  }) as typeof window.setTimeout
  window.clearTimeout = ((id?: number) => {
    if (id !== undefined) timers.delete(id)
  }) as typeof window.clearTimeout
  window.requestAnimationFrame = ((cb: () => void) => {
    rafQueue.push(cb)
    return rafQueue.length
  }) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((handle: number) => {
    if (handle >= 1) rafQueue.splice(handle - 1, 1)
  }) as typeof window.cancelAnimationFrame
})

afterEach(() => {
  window.setTimeout = realSetTimeout
  window.clearTimeout = realClearTimeout
  window.requestAnimationFrame = realRaf
  window.cancelAnimationFrame = realCancelRaf
})

const flushFrame = () => {
  const q = rafQueue
  rafQueue = []
  for (const cb of q) cb()
}

describe('debounce：等待期内再触发重新计时，只执行最后一次', () => {
  it('等待期到才执行，且只拿到最后一次参数', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('a')
    advance(99)
    expect(fn).not.toHaveBeenCalled()
    d('b') // 第 99ms 再触发 → 重新计时
    advance(99)
    expect(fn).not.toHaveBeenCalled() // 距 'b' 才 99ms
    advance(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b') // 只执行最后一次
  })

  it('连续触发 N 次只执行 1 次（搜索输入场景）', () => {
    const fn = vi.fn()
    const d = debounce(fn, 300)
    for (let i = 0; i < 10; i++) {
      d(i)
      advance(50) // 每 50ms 一击，始终在 300ms 等待期内
    }
    expect(fn).not.toHaveBeenCalled()
    advance(300)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(9)
  })

  it('多参数透传', () => {
    const fn = vi.fn()
    debounce(fn, 10)('x', 1, { deep: true })
    advance(10)
    expect(fn).toHaveBeenCalledWith('x', 1, { deep: true })
  })

  it('wait 缺省 300ms（与页面搜索框默认口径一致）', () => {
    const fn = vi.fn()
    debounce(fn)('q')
    advance(299)
    expect(fn).not.toHaveBeenCalled()
    advance(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel 后不再执行，旧 timer 被清除', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('a')
    d.cancel()
    advance(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel 后可继续使用（重新起计时）', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('a')
    d.cancel()
    d('b')
    advance(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('防抖执行后再触发是新一轮计时（不被旧 timer 影响）', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('a')
    advance(100) // 执行第 1 次
    d('b')
    advance(100) // 执行第 2 次
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 'a')
    expect(fn).toHaveBeenNthCalledWith(2, 'b')
  })
})

describe('rafThrottle：一帧内多次触发只执行最后一次', () => {
  it('一帧内连续 3 次触发 → 只入队 1 帧、只执行最后参数', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t(1)
    t(2)
    t(3)
    expect(rafQueue).toHaveLength(1) // 帧未 flush 前不重复入队
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3) // 一帧内只保最后值（resize 只画最终尺寸）
  })

  it('帧 flush 后恢复：下次触发重新入队', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t(1)
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(1)
    t(2)
    expect(rafQueue).toHaveLength(1) // 上一帧已消费，本帧重新排队
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(2)
  })

  it('cancel 后挂起帧不执行', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t(1)
    t.cancel() // 撤销已排队的帧
    flushFrame()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel 后可恢复，未被消费的旧帧不串场', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t('stale')
    t.cancel()
    t('fresh')
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('fresh')
  })

  it('多参数透传且帧内只保最后一组', () => {
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t(100, 200)
    t(300, 400)
    flushFrame()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(300, 400)
  })

  it('未 cancel 未 flush 前不执行（节流即压帧，不是立即执行）', () => {
    const fn = vi.fn()
    rafThrottle(fn)(1)
    expect(fn).not.toHaveBeenCalled() // 首次触发也要等下一帧
  })
})
