// 守说明框（复盘域薄包装）：模拟数据提示必须带标题且与普通口径说明区分，不能退回和正文同色的小字。dljy#2875。
// 实现已上移 src/components/common/CalloutBox.vue（#2954），本 spec 锁薄包装的对外契约：tone 'note' → 公共 'info'。
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewCallout from './ReviewCallout.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
const create = (props: Record<string, unknown>, text = '说明正文') => { const wrapper = mount(ReviewCallout, { props, slots: { default: text } }); wrappers.push(wrapper); return wrapper }

describe('复盘说明框', () => {
  it('模拟数据固定带「模拟数据」标题并使用提醒样式，不能省略', () => {
    const wrapper = create({ tone: 'mock' }, '仅供演练')
    expect(wrapper.classes()).toContain('mock')
    expect(wrapper.find('.title').text()).toBe('模拟数据')
    expect(wrapper.attributes('role')).toBe('status')
  })
  it('口径说明默认中性样式、无标题（tone note 映射为公共 info）', () => {
    const wrapper = create({})
    expect(wrapper.classes()).toContain('info')
    expect(wrapper.find('.title').exists()).toBe(false)
    expect(wrapper.attributes('role')).toBe('note')
    expect(wrapper.text()).toBe('说明正文')
  })
})
