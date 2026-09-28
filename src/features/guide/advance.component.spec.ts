// 导引推进条件（advance）的「元素出现」条件（ChenShi-Tech/dljy#3404）。
// 守什么：visible 推进条件无限期等待用户操作，只在换步（signal 中止）时结束。
// 坏掉的症状：用户读卡片超过 10 秒才去点按钮，对话框打开了导引却停在原步不动（实机走查踩到过）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchAdvance } from './advance'
import { setGuideVisibilityCheck } from './targets'
import type { GuideCtx } from './types'

const ctx: GuideCtx = { runTag: 'GUIDE-TEST', regionId: 'yunnan', practiceCompanyId: 'p', artifacts: {}, go: () => {} }
const hooks = (signal?: AbortSignal) => ({ onRoute: () => () => {}, signal })

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('watchAdvance · visible', () => {
  it('目标晚于 10 秒才出现仍然推进（不因等待超时放弃）', async () => {
    vi.useFakeTimers()
    setGuideVisibilityCheck(() => true)
    const onAdvance = vi.fn()
    const abort = new AbortController()
    const dispose = watchAdvance({ kind: 'visible', target: 'ml-subject-key' }, ctx, hooks(abort.signal), onAdvance)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(onAdvance).not.toHaveBeenCalled()
    const el = document.createElement('div')
    el.dataset.guide = 'ml-subject-key'
    document.body.appendChild(el)
    await vi.advanceTimersByTimeAsync(500)
    expect(onAdvance).toHaveBeenCalledTimes(1)
    dispose()
    abort.abort()
  })

  it('换步中止后目标再出现也不推进', async () => {
    vi.useFakeTimers()
    setGuideVisibilityCheck(() => true)
    const onAdvance = vi.fn()
    const abort = new AbortController()
    watchAdvance({ kind: 'visible', target: 'ml-subject-key' }, ctx, hooks(abort.signal), onAdvance)
    abort.abort()
    const el = document.createElement('div')
    el.dataset.guide = 'ml-subject-key'
    document.body.appendChild(el)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onAdvance).not.toHaveBeenCalled()
  })
})
