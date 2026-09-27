// 守公共指标卡（#2954）：数值与单位分开渲染（页面断言按标签取值依赖此契约）、
// tone 语义类落在主数上、button 形态可点击筛选卡、compact 长文本主数降字号、ⓘ 悬浮不落页。
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@/test/mount'
import MetricTile from './MetricTile.vue'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
const create = (props: Record<string, unknown>, attrs: Record<string, unknown> = {}) => {
  const wrapper = mount(MetricTile, { props, attrs })
  wrappers.push(wrapper)
  return wrapper
}

describe('公共指标卡', () => {
  it('渲染 label / 主数 / 单位 / 副行，单位是独立小字元素', () => {
    const wrapper = create({ label: '已确认电量', value: '1,200.5', unit: 'MWh', sub: '3 份合同' })
    expect(wrapper.find('.k').text()).toContain('已确认电量')
    expect(wrapper.find('.v').text()).toContain('1,200.5')
    expect(wrapper.find('.v small').text()).toBe('MWh')
    expect(wrapper.find('.s').text()).toBe('3 份合同')
  })

  it('占位值 — 不渲染单位', () => {
    const wrapper = create({ label: '均价', value: '—', unit: '元/MWh' })
    expect(wrapper.find('.v small').exists()).toBe(false)
  })

  it('tone 语义类落在主数元素上，四档语义各就各位', () => {
    for (const tone of ['good', 'bad', 'warn', 'muted'] as const) {
      const wrapper = create({ label: 'x', value: '1', tone })
      expect(wrapper.find('.v').classes()).toContain(tone)
      wrapper.unmount()
    }
  })

  it('默认 div 形态不带 type 属性', () => {
    const wrapper = create({ label: 'x', value: '1' })
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.attributes('type')).toBeUndefined()
  })

  it('as=button 渲染为 type="button" 的可点击筛选卡，click 透传', async () => {
    let clicks = 0
    const wrapper = mount(MetricTile, {
      props: { label: '待核对', value: '3', as: 'button' },
      attrs: { onClick: () => clicks++ }
    })
    wrappers.push(wrapper)
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    await wrapper.trigger('click')
    expect(clicks).toBe(1)
  })

  it('compact 长文本主数降字号（根元素带 compact 类）', () => {
    const wrapper = create({ label: '已知部分加权均价', value: '— 元/MWh', compact: true })
    expect(wrapper.classes()).toContain('compact')
  })

  it('ⓘ 口径说明只进悬浮不落页，pill 状态徽标渲染语义类', () => {
    const wrapper = create(
      { label: '均价', value: '320', unit: '元/MWh', info: '口径：不含环境价值', pill: { text: '已知', tone: 'ok' } }
    )
    expect(wrapper.text()).not.toContain('口径：不含环境价值')
    expect(wrapper.find('.ihint').attributes('aria-label')).toBe('口径说明')
    expect(wrapper.find('.pill').text()).toBe('已知')
    expect(wrapper.find('.pill').classes()).toContain('ok')
  })
})
