// 六维入口卡组件测试（Epic #2033 · M1 · #2038）
import { describe, expect, it } from 'vitest'
import DimensionGrid from './DimensionGrid.vue'
import { mount } from '@/test/mount'

describe('DimensionGrid（六维入口卡）', () => {
  it('六维齐全：全部维度有锚（偏差/结果=现有区块，其余=深入面板），模板 chip 带就绪度徽章', () => {
    const wrapper = mount(DimensionGrid)
    const text = wrapper.text()
    for (const label of ['结果复盘', '策略复盘', '市场复盘', '偏差复盘', '风险复盘', '决策复盘']) {
      expect(text).toContain(label)
    }
    const tags = wrapper.findAll('.dg-anchor-tag').map((t) => t.text())
    expect(tags.filter((t) => t === '现有区块')).toHaveLength(2)
    expect(tags.filter((t) => t === '深入面板')).toHaveLength(4)
    // 缺数据模板 chip 有「缺数据」标记（如 T02 data_gap）
    expect(text).toContain('缺数据')
    // 就绪模板有「就绪」标记
    expect(text).toContain('就绪')
  })

  it('点击维度卡发出 select-dimension；点击模板 chip 发出 open-template', async () => {
    const wrapper = mount(DimensionGrid)
    const cards = wrapper.findAll('.dg-card')
    await cards[0].trigger('click') // 结果复盘
    expect(wrapper.emitted('select-dimension')).toBeTruthy()
    const chips = wrapper.findAll('.dg-chip')
    expect(chips.length).toBeGreaterThan(0)
    await chips[0].trigger('click')
    expect(wrapper.emitted('open-template')).toBeTruthy()
    const tpl = wrapper.emitted('open-template')![0][0] as { id: string }
    expect(tpl.id).toMatch(/^(T|S|R|N|E)\d+$/)
  })

  it('slots24 模板 chip 带 ·24h 标记', () => {
    const wrapper = mount(DimensionGrid)
    expect(wrapper.text()).toContain('·24h')
  })
})
