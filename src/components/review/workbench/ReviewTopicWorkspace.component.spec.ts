import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReviewTopicWorkspace from './ReviewTopicWorkspace.vue'
import { buildReviewEvidence } from '@/services/review/reviewEvidence'

const snapshot = buildReviewEvidence({ company: 'a', region: 'yunnan', day: '2026-05-31', objectKey: '', objectLabel: '当前资料' })
snapshot.intervals = [{ time: '00:00', forecast: 10, declared: 9, actual: 8, cleared: 9, adjustment: -1, difference: -1, daPrice: 100, rtPrice: 120 }]
const props = { company: 'a', companyLabel: '公司', region: 'yunnan', date: '2026-05-31', snapshot, view: 'generator' as const, topic: 'energy' as const, busy: false }
const stubs = { TopicAnalysisPanel: true, SettlementAnalysisPanel: true, ReviewDataMaintenance: true }
describe('专题页面与弹窗共用工作区', () => {
  it('有申报出清、无实际量时先选可比较基准，零值也算有效数据', () => {
    const partial = { ...snapshot, intervals: [{ ...snapshot.intervals[0], forecast: null, actual: null, declared: 0, cleared: 0 }] }
    const wrapper = mount(ReviewTopicWorkspace, { props: { ...props, snapshot: partial }, global: { stubs } })
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).props('bases')[0]).toBe('declared_cleared')
  })
  it('业务视角改变优先基准，所有既有基准仍可选择', async () => {
    const wrapper = mount(ReviewTopicWorkspace, { props, global: { stubs } })
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).props('bases')[0]).toBe('forecast_actual')
    await wrapper.setProps({ view: 'retail' })
    const bases = wrapper.findComponent({ name: 'TopicAnalysisPanel' }).props('bases')
    expect(bases[0]).toBe('declared_actual')
    expect(bases).toHaveLength(3)
    expect(wrapper.text()).toContain('实际用电')
  })
  it('缺曲线时不给空图表，维护入口仍可用', () => {
    const wrapper = mount(ReviewTopicWorkspace, { props: { ...props, snapshot: null }, global: { stubs } })
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('缺少可用分时资料')
    expect(wrapper.text()).toContain('查看资料维护')
  })
})
