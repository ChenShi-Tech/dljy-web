import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReviewTopicWorkspace from './ReviewTopicWorkspace.vue'
import { buildReviewEvidence } from '@/services/review/reviewEvidence'

const snapshot = buildReviewEvidence({ company: 'a', region: 'yunnan', day: '2026-05-31', objectKey: '', objectLabel: '当前资料' })
snapshot.intervals = [{ time: '00:00', forecast: 10, declared: 9, actual: 8, cleared: 9, adjustment: -1, difference: -1, daPrice: 100, rtPrice: 120 }]
const props = { company: 'a', companyLabel: '公司', region: 'yunnan', date: '2026-05-31', snapshot, view: 'generator' as const, topic: 'energy' as const, busy: false }
const stubs = { ImportedIntervalPanel: true, PeriodDecisionPanel: true, TopicAnalysisPanel: true, SettlementAnalysisPanel: true, ReviewDataMaintenance: true, DailyEnergyAnalysisPanel: true, MarketPriceAnalysisPanel: true }
describe('专题页面与弹窗共用工作区', () => {
  it('只有统计成功的周期才能回查，换专题撤去旧范围', async () => {
    const wrapper = mount(ReviewTopicWorkspace, { props, global: { stubs } })
    expect(wrapper.findComponent({ name: 'PeriodDecisionPanel' }).exists()).toBe(false)
    wrapper.findComponent({ name: 'DailyEnergyAnalysisPanel' }).vm.$emit('period', { start: '2026-05-25', end: '2026-05-31' })
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'PeriodDecisionPanel' }).props('period')).toEqual({ start: '2026-05-25', end: '2026-05-31' })
    await wrapper.setProps({ topic: 'price' as never })
    expect(wrapper.findComponent({ name: 'PeriodDecisionPanel' }).exists()).toBe(false)
  })
  it('有申报出清、无实际量时先选可比较基准，零值也算有效数据', async () => {
    const partial = { ...snapshot, intervals: [{ ...snapshot.intervals[0], forecast: null, actual: null, declared: 0, cleared: 0 }] }
    const wrapper = mount(ReviewTopicWorkspace, { props: { ...props, snapshot: partial }, global: { stubs } })
    await wrapper.get('[aria-label=分析资料来源]').findAll('button').find(button => button.text() === '本次决策留存资料')!.trigger('click')
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).props('bases')[0]).toBe('declared_cleared')
  })
  it('业务视角改变优先基准，所有既有基准仍可选择', async () => {
    const wrapper = mount(ReviewTopicWorkspace, { props, global: { stubs } })
    await wrapper.get('[aria-label=分析资料来源]').findAll('button').find(button => button.text() === '本次决策留存资料')!.trigger('click')
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).props('bases')[0]).toBe('forecast_actual')
    await wrapper.setProps({ view: 'retail' })
    await wrapper.get('[aria-label=分析资料来源]').findAll('button').find(button => button.text() === '本次决策留存资料')!.trigger('click')
    const bases = wrapper.findComponent({ name: 'TopicAnalysisPanel' }).props('bases')
    expect(bases[0]).toBe('declared_actual')
    expect(bases).toHaveLength(3)
    expect(wrapper.text()).toContain('实际用电')
  })
  it('维护日报选择对应资料类型，提交成功返回原专题', async () => {
    const wrapper=mount(ReviewTopicWorkspace,{props,global:{stubs}})
    wrapper.findComponent({name:'DailyEnergyAnalysisPanel'}).vm.$emit('maintenance')
    await wrapper.setProps({topic:'maintenance' as never})
    const maintenance=wrapper.findComponent({name:'ReviewDataMaintenance'})
    expect(maintenance.props('preferredDataset')).toBe('cgn-plant-daily-metrics')
    maintenance.vm.$emit('saved')
    expect(wrapper.emitted('update:topic')?.at(-1)).toEqual(['energy'])
    wrapper.unmount()
  })
  it('缺曲线时不给空图表，维护入口仍可用', async () => {
    const wrapper = mount(ReviewTopicWorkspace, { props: { ...props, snapshot: null }, global: { stubs } })
    await wrapper.get('[aria-label=分析资料来源]').findAll('button').find(button => button.text() === '本次决策留存资料')!.trigger('click')
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('缺少可用分时资料')
    expect(wrapper.text()).toContain('分析补充分时资料')
  })
  it('售电和储能仅展示适用的来源，切换来源清除旧周期，维护后回到原来源', async () => {
    const wrapper = mount(ReviewTopicWorkspace, { props, global: { stubs } })
    expect(wrapper.findComponent({ name: 'DailyEnergyAnalysisPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ImportedIntervalPanel' }).exists()).toBe(false)
    await wrapper.setProps({ view: 'retail' })
    expect(wrapper.findComponent({ name: 'DailyEnergyAnalysisPanel' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ImportedIntervalPanel' }).props('view')).toBe('retail')
    expect(wrapper.text()).toContain('客户与组合分时资料')
    wrapper.findComponent({ name: 'ImportedIntervalPanel' }).vm.$emit('period', { start: '2026-05-01', end: '2026-05-31' })
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'PeriodDecisionPanel' }).exists()).toBe(true)
    await wrapper.setProps({ view: 'storage' })
    expect(wrapper.findComponent({ name: 'PeriodDecisionPanel' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('充放电分时资料')
    wrapper.findComponent({ name: 'ImportedIntervalPanel' }).vm.$emit('maintenance')
    await wrapper.setProps({ topic: 'maintenance' as never })
    expect(wrapper.findComponent({ name: 'ReviewDataMaintenance' }).props('preferredDataset')).toBe('review-intervals')
    await wrapper.setProps({ topic: 'energy' })
    expect(wrapper.findComponent({ name: 'ImportedIntervalPanel' }).exists()).toBe(true)
    await wrapper.setProps({ topic: 'settlement' as never })
    expect(wrapper.findComponent({ name: 'SettlementAnalysisPanel' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('储能结算资料尚未接入本专题')
    wrapper.unmount()
  })

  it('申报仅有电量时不默认打开空价格副本，单边零价格也算可用', async () => {
    const energyOnly = { ...snapshot, scope: { ...snapshot.scope, objectKey: 'declaration-a' }, intervals: [{ ...snapshot.intervals[0], daPrice: null, rtPrice: null }] }
    const wrapper = mount(ReviewTopicWorkspace, { props: { ...props, snapshot: energyOnly }, global: { stubs } })
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).exists()).toBe(true)
    await wrapper.setProps({ topic: 'price' as never })
    expect(wrapper.findComponent({ name: 'MarketPriceAnalysisPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).exists()).toBe(false)
    await wrapper.setProps({ snapshot: { ...energyOnly, scope: { ...energyOnly.scope, objectKey: 'declaration-b' }, intervals: [{ ...energyOnly.intervals[0], daPrice: 0 }] } })
    expect(wrapper.findComponent({ name: 'TopicAnalysisPanel' }).exists()).toBe(true)
    wrapper.unmount()
  })
  it('补充资料跨专题重新挂载，撤去之前的对象和目录', async () => {
    const wrapper = mount(ReviewTopicWorkspace, { props: { ...props, view: 'retail' }, global: { stubs } })
    const energyPanel = wrapper.findComponent({ name: 'ImportedIntervalPanel' }).vm
    await wrapper.setProps({ topic: 'price' as never })
    expect(wrapper.findComponent({ name: 'ImportedIntervalPanel' }).vm).not.toBe(energyPanel)
    expect(wrapper.findComponent({ name: 'ImportedIntervalPanel' }).props('topic')).toBe('price')
    wrapper.unmount()
  })

})
