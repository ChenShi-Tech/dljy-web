// lazyStage 组件测试（trading-day-morning-summary-and-lazy-stages 任务 3.2）
// 验收：加载中提示 → 成功渲染；失败 → 错误态可重试 → 重试成功渲染。
import { describe, expect, it } from 'vitest'
import { h, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { lazyStage } from './lazyStage'
import { mount } from '@/test/mount'

async function settle() {
  await flushPromises()
  await nextTick()
  await nextTick()
}

describe('lazyStage（步骤面板异步装配）', () => {
  it('加载中显示提示，成功后渲染面板', async () => {
    let resolve!: (v: { default: ReturnType<typeof h> }) => void
    const gate = new Promise<{ default: ReturnType<typeof h> }>((r) => { resolve = r })
    const Comp = lazyStage(() => gate, 0)
    const wrapper = mount(Comp)
    await settle()
    expect(wrapper.text()).toContain('正在加载该步骤面板…')

    resolve({ default: h('div', 'STAGE-OK') })
    await settle()
    expect(wrapper.text()).toContain('STAGE-OK')
  })

  it('失败显示错误态并可重试，重试成功后渲染面板', async () => {
    let attempts = 0
    const Comp = lazyStage(() => {
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('net'))
      return Promise.resolve({ default: h('div', 'RETRY-OK') })
    }, 0)
    const wrapper = mount(Comp)
    await settle()
    expect(wrapper.text()).toContain('该步骤面板加载失败')
    expect(wrapper.text()).toContain('其余步骤仍可正常切换使用')

    await wrapper.find('.td-stage-error button').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('RETRY-OK')
    expect(attempts).toBe(2)
  })
})
