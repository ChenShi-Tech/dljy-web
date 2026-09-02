/**
 * 当前模型标签（主仓 #2658）。
 *
 * 这几条锁的都是「可信」而非「好看」——标签的全部价值在于它说的是真的：
 * 取不到宁可不显示，也不能显示一个可能已经不对的模型名。
 */
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchCurrentModel } from '@/services/agent/piPocClient'

import { __resetCurrentModel, useCurrentModel } from './useCurrentModel'

vi.mock('@/services/agent/piPocClient', () => ({
  fetchCurrentModel: vi.fn()
}))

const mockFetch = vi.mocked(fetchCurrentModel)

/** 挂一个只读该 composable 的壳组件。 */
const Host = defineComponent({
  setup() {
    const { model } = useCurrentModel()
    return () => h('div', model.value ? `${model.value.label}|${model.value.model}` : 'none')
  }
})

beforeEach(() => {
  __resetCurrentModel()
  mockFetch.mockReset()
})

afterEach(() => {
  __resetCurrentModel()
  vi.useRealTimers()
})

describe('useCurrentModel', () => {
  it('拉到就暴露给界面', async () => {
    mockFetch.mockResolvedValue({
      provider: 'vllm', model: 'runtime-a', selfHosted: true, label: '自建 vLLM', mode: 'auto'
    })
    const w = mount(Host)
    await nextTick(); await nextTick()
    expect(w.text()).toBe('自建 vLLM|runtime-a')
    w.unmount()
  })

  it('后端未启动 / 旧版无此端点：降级为不显示，而不是显示错的', async () => {
    mockFetch.mockRejectedValue(new Error('HTTP 404'))
    const w = mount(Host)
    await nextTick(); await nextTick()
    expect(w.text()).toBe('none')
    w.unmount()
  })

  it('一度可用后转为失败，立刻不再显示旧值', async () => {
    // 端点断掉后还挂着「自建 vLLM」是最坏的情形——正是这个标签要防的事
    mockFetch.mockResolvedValueOnce({
      provider: 'vllm', model: 'runtime-a', selfHosted: true, label: '自建 vLLM', mode: 'auto'
    })
    vi.useFakeTimers()
    const w = mount(Host)
    await vi.advanceTimersByTimeAsync(0)
    expect(w.text()).toBe('自建 vLLM|runtime-a')

    mockFetch.mockRejectedValue(new Error('fetch failed'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(w.text()).toBe('none')
    w.unmount()
  })

  it('多个面板共用一份状态与一个定时器，不各问各的', async () => {
    mockFetch.mockResolvedValue({
      provider: 'cloud-a', model: 'cloud-model-x', selfHosted: false, label: '云端模型', mode: 'auto'
    })
    vi.useFakeTimers()
    const a = mount(Host)
    const b = mount(Host)
    await vi.advanceTimersByTimeAsync(0)
    const afterMount = mockFetch.mock.calls.length

    await vi.advanceTimersByTimeAsync(60_000)
    // 两个实例共享一个定时器：一个周期只应多出一次请求，而不是两次
    expect(mockFetch.mock.calls.length - afterMount).toBe(1)
    a.unmount(); b.unmount()
  })

  it('最后一个面板卸载后停表，不在后台空转', async () => {
    mockFetch.mockResolvedValue({
      provider: 'cloud-a', model: 'cloud-model-x', selfHosted: false, label: '云端模型', mode: 'cloud-a'
    })
    vi.useFakeTimers()
    const w = mount(Host)
    await vi.advanceTimersByTimeAsync(0)
    w.unmount()
    const afterUnmount = mockFetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(180_000)
    expect(mockFetch.mock.calls.length).toBe(afterUnmount)
  })
})
