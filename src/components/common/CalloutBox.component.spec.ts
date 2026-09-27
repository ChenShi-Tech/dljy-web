// 守公共说明框（#2954）：四档 tone 的类名与 role 契约（info=note，其余=status）；
// mock 固定带「模拟数据」标题不能省——dljy#2875 红线随实现上移到公共组件，不能在合并两套口径时丢掉。
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CalloutBox from './CalloutBox.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
const create = (props: Record<string, unknown>, text = '说明正文') => {
  const wrapper = mount(CalloutBox, { props, slots: { default: text } })
  wrappers.push(wrapper)
  return wrapper
}

describe('公共说明框', () => {
  it('模拟数据固定带「模拟数据」标题并使用提醒样式，不能省略', () => {
    const wrapper = create({ tone: 'mock' }, '仅供演练')
    expect(wrapper.classes()).toContain('mock')
    expect(wrapper.find('.title').text()).toBe('模拟数据')
    expect(wrapper.attributes('role')).toBe('status')
  })

  it('mock 可用 title 覆盖默认标题，但标题元素不可省', () => {
    const wrapper = create({ tone: 'mock', title: '模拟数据（演示环境）' })
    expect(wrapper.find('.title').text()).toBe('模拟数据（演示环境）')
  })

  it('口径说明默认中性样式、无标题、role=note', () => {
    const wrapper = create({})
    expect(wrapper.classes()).toContain('info')
    expect(wrapper.find('.title').exists()).toBe(false)
    expect(wrapper.attributes('role')).toBe('note')
    expect(wrapper.text()).toBe('说明正文')
  })

  it('四档 tone 类名各就各位，warn/danger 为 status', () => {
    for (const tone of ['info', 'warn', 'danger', 'mock'] as const) {
      const wrapper = create({ tone })
      expect(wrapper.classes()).toContain(tone)
      expect(wrapper.attributes('role')).toBe(tone === 'info' ? 'note' : 'status')
      wrapper.unmount()
    }
  })

  it('warn/danger 支持自定义标题', () => {
    const wrapper = create({ tone: 'danger', title: '数据不可用' }, '请先补齐合同价格')
    expect(wrapper.find('.title').text()).toBe('数据不可用')
    expect(wrapper.classes()).toContain('danger')
  })
})
