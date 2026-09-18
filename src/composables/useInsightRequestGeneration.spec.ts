// @vitest-environment happy-dom
// 市场洞察请求代次（dljy#2995 阶段 A，spec RW04：迟到响应不得覆盖新上下文状态）
// A→B→A 场景按「请求发起时的代次」比较丢弃，不按地区 id 复活旧响应。

import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { useInsightRequestGeneration } from './useInsightRequestGeneration'
import { selectedRegionId, setCurrentRegionId } from '@/services/region/regionContext'

describe('useInsightRequestGeneration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('上下文不变时 run 正常返回结果', async () => {
    const generation = useInsightRequestGeneration()
    generation.updateContext({ regionId: 'yunnan', businessWindow: { start: '2026-09-01' } })
    const version = generation.contextVersion.value
    await expect(generation.run(async () => 'value')).resolves.toBe('value')
    expect(generation.contextVersion.value).toBe(version)
  })

  it('A→B→A：第一次 A 的迟到响应按代次丢弃，不因地区 id 相同而复活', async () => {
    const generation = useInsightRequestGeneration()
    generation.updateContext({ regionId: 'yunnan' })
    expect(generation.contextVersion.value).toBe(1)

    let resolveA: (value: string) => void = () => {}
    const staleRequest = generation.run(
      () =>
        new Promise<string>((resolve) => {
          resolveA = resolve
        })
    )

    generation.updateContext({ regionId: 'shanxi' })
    expect(generation.contextVersion.value).toBe(2)
    const bRequest = generation.run(async () => 'B')

    generation.updateContext({ regionId: 'yunnan' })
    expect(generation.contextVersion.value).toBe(3)
    const a2Request = generation.run(async () => 'A2')

    // 第一次 A 的响应此时才回来：代次（1）落后于当前（3）→ 必须丢弃
    resolveA('stale-A')
    await expect(staleRequest).resolves.toBeNull()
    // 中途 B 的结果同样作废
    await expect(bRequest).resolves.toBeNull()
    // 新代次的 A 正常返回
    await expect(a2Request).resolves.toBe('A2')
  })

  it('上下文变化中止在途请求（AbortController 生效），取消的请求返回 null', async () => {
    const generation = useInsightRequestGeneration()
    generation.updateContext({ regionId: 'yunnan' })

    let abortedSignal: AbortSignal | undefined
    let rejectAbort: ((reason: unknown) => void) | undefined
    const inFlight = generation.run(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          abortedSignal = signal
          rejectAbort = reject
        })
    )

    generation.updateContext({ regionId: 'shanxi' })
    expect(abortedSignal?.aborted).toBe(true)
    // fetcher 因 abort 抛出 AbortError 场景：作废请求的失败静默为 null，不是页面错误
    rejectAbort?.(new DOMException('aborted', 'AbortError'))
    await expect(inFlight).resolves.toBeNull()
  })

  it('请求自身的失败（非取消）照常抛出，不吞错误', async () => {
    const generation = useInsightRequestGeneration()
    generation.updateContext({ regionId: 'yunnan' })
    await expect(
      generation.run(async () => {
        throw new Error('network down')
      })
    ).rejects.toThrow('network down')
  })

  it('切换地区自动失效：代次 +1', async () => {
    const generation = useInsightRequestGeneration()
    const before = generation.contextVersion.value
    const other = selectedRegionId.value === 'shanxi' ? 'yunnan' : 'shanxi'
    setCurrentRegionId(other)
    await nextTick()
    expect(generation.contextVersion.value).toBeGreaterThan(before)
  })

  it('业务日期窗 / 对象 / 来源变化都构成上下文变化', () => {
    const generation = useInsightRequestGeneration()
    generation.updateContext({ regionId: 'yunnan', businessWindow: { start: '2026-09' }, objects: ['p1'], source: 'a' })
    const version = generation.contextVersion.value

    generation.updateContext({ regionId: 'yunnan', businessWindow: { start: '2026-10' }, objects: ['p1'], source: 'a' })
    expect(generation.contextVersion.value).toBe(version + 1)

    generation.updateContext({ regionId: 'yunnan', businessWindow: { start: '2026-10' }, objects: ['p1', 'p2'], source: 'a' })
    expect(generation.contextVersion.value).toBe(version + 2)

    generation.updateContext({ regionId: 'yunnan', businessWindow: { start: '2026-10' }, objects: ['p1', 'p2'], source: 'b' })
    expect(generation.contextVersion.value).toBe(version + 3)

    // 完全相同的上下文重复声明不失效
    generation.updateContext({ regionId: 'yunnan', businessWindow: { start: '2026-10' }, objects: ['p1', 'p2'], source: 'b' })
    expect(generation.contextVersion.value).toBe(version + 3)
  })
})
