// 守时段选择：只能从材料自身的时段里选，选多少就交出多少，超出上限不交出。dljy#2875。
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EvidenceSegmentPicker from './EvidenceSegmentPicker.vue'
import type { ReportEvidence } from '@/services/review/workpapers'

const intervals = Array.from({ length: 3 }, (_, i) => ({ start: new Date(Date.parse('2026-05-31T10:00:00Z') + i * 900000).toISOString(), end: new Date(Date.parse('2026-05-31T10:15:00Z') + i * 900000).toISOString() }))
const evidence = { id: 'm1', content: { topic: 'energy', labels: ['申报电量', '实际电量'], result: { intervals } } } as unknown as ReportEvidence
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
const create = (value = evidence) => { const wrapper = mount(EvidenceSegmentPicker, { props: { evidence: value } }); wrappers.push(wrapper); return wrapper }
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(node => node.text().startsWith(text))!

describe('从材料中选择时段', () => {
  it('交出的正是勾选的那些时段', async () => {
    const wrapper = create()
    const boxes = wrapper.findAll('input[type=checkbox]')
    expect(boxes).toHaveLength(3)
    expect(button(wrapper, '为所选时段添加原因').attributes('disabled')).toBeDefined()
    await boxes[0].setValue(true); await boxes[2].setValue(true)
    await button(wrapper, '为所选时段添加原因').trigger('click')
    expect(wrapper.emitted('pick')![0]).toEqual([[intervals[0], intervals[2]]])
  })
  it('全选后超过上限时拒绝交出并提示拆分', async () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ start: `s${i}`, end: `e${i}` }))
    const wrapper = create({ ...evidence, content: { ...evidence.content, result: { intervals: many } } } as unknown as ReportEvidence)
    await button(wrapper, '全选').trigger('click')
    expect(wrapper.text()).toContain('已选 200 / 205')
    await button(wrapper, '为所选时段添加原因').trigger('click')
    expect(wrapper.emitted('pick')![0][0]).toHaveLength(200)
  })
  it('材料没有时段时直接说明，不给空列表', () => {
    const wrapper = create({ ...evidence, content: { ...evidence.content, result: { intervals: [] } } } as unknown as ReportEvidence)
    expect(wrapper.text()).toContain('没有可对应的时段')
  })
})
