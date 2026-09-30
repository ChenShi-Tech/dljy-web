// 一日作业台容器测试（trading-day-morning-summary-and-lazy-stages 任务 3.2 / 4.1）
// 验收：首屏只装配当前步（其余步 stub 不实例化）；?stage= 深链直达未加载步；步进事件
// 按需装配新步；绑单行默认一行收起、展开后建单/换单功能等价。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { h, nextTick, reactive } from 'vue'
import { flushPromises } from '@vue/test-utils'

const routeQuery = reactive<Record<string, string>>({})
const replace = vi.fn()

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery, path: '/xhjy/trading-day' }),
  useRouter: () => ({ replace })
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan', shortName: '云南' } },
  packageRegionSummary: () => ''
}))

vi.mock('shared/trading-rules/trading-calendar.mjs', () => ({
  defaultTargetDate: () => '2026-09-28',
  getTradingCalendar: () => null,
  workdaySummary: () => ''
}))

const listDeclarations = vi.fn()
const createDeclaration = vi.fn()
vi.mock('@/services/declarations', () => ({
  listDeclarations: (...args: unknown[]) => listDeclarations(...args),
  createDeclaration: (...args: unknown[]) => createDeclaration(...args),
  STATUS_LABEL: { DRAFT: '草稿' }
}))

function stub(name: string) {
  return { default: { name, setup: () => () => h('div', name) } }
}
vi.mock('@/components/trading/stages/StageMorningReview.vue', () => stub('S1-STUB'))
vi.mock('@/components/trading/stages/StageMarketAnalysis.vue', () => stub('S2-STUB'))
vi.mock('@/components/trading/stages/StageDirection.vue', () => stub('S3-STUB'))
vi.mock('@/components/trading/stages/StageDeclare.vue', () => stub('S4-STUB'))
vi.mock('@/components/trading/stages/StageClearing.vue', () => stub('S5-STUB'))
vi.mock('@/components/trading/stages/StageContract.vue', () => stub('S6-STUB'))
vi.mock('@/components/trading/stages/StageDailyClose.vue', () => stub('S7-STUB'))

import TradingDayView from './TradingDayView.vue'
import WorkflowStepper from '@/components/spot/WorkflowStepper.vue'
import { mount } from '@/test/mount'

async function settle(wrapper: ReturnType<typeof mount>, rounds = 4) {
  await flushPromises()
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

beforeEach(() => {
  routeQuery.stage = undefined as unknown as string
  replace.mockReset()
  listDeclarations.mockReset().mockResolvedValue([])
  createDeclaration.mockReset()
})

describe('TradingDayView（一日作业台容器）', () => {
  it('首屏默认落第一个未完成步，只装配该步面板；绑单行收起为一行', async () => {
    const wrapper = await settle(mount(TradingDayView))
    expect(wrapper.text()).toContain('S1-STUB')
    expect(wrapper.text()).not.toContain('S2-STUB')
    expect(wrapper.text()).not.toContain('S7-STUB')
    // 绑单收敛：一行摘要可见，展开明细不渲染；步进区（含引导）与主内容同屏
    expect(wrapper.find('.td-bind-bar').exists()).toBe(true)
    expect(wrapper.find('.td-bind-detail').exists()).toBe(false)
    expect(wrapper.find('.td-nav .td-guide').exists()).toBe(true)
    expect(wrapper.find('.td-stage').exists()).toBe(true)
  })

  it('?stage= 深链直达未加载步骤', async () => {
    routeQuery.stage = 'daily-close'
    const wrapper = await settle(mount(TradingDayView))
    expect(wrapper.text()).toContain('S7-STUB')
    expect(wrapper.text()).not.toContain('S1-STUB')
  })

  it('步进切步按需装配新步、卸开旧步', async () => {
    const wrapper = await settle(mount(TradingDayView))
    wrapper.findComponent(WorkflowStepper).vm.$emit('select', 'direction')
    await settle(wrapper)
    expect(wrapper.text()).toContain('S3-STUB')
    expect(wrapper.text()).not.toContain('S1-STUB')
  })

  it('展开绑单行后建单功能与收敛前等价', async () => {
    createDeclaration.mockResolvedValue({
      id: 'DECL-1', status: 'DRAFT', capacityMw: 50, targetDate: '2026-09-28',
      energyCurveMwh96: [], priceCurve96: [], updatedAt: ''
    })
    const wrapper = await settle(mount(TradingDayView))
    await wrapper.find('.td-bind-bar').trigger('click')
    expect(wrapper.find('.td-bind-detail').exists()).toBe(true)

    await wrapper.find('input.td-input-cap').setValue('50')
    await wrapper.find('input.td-rat').setValue('晚高峰预测上调，按基准容量申报保供')
    await wrapper.find('.td-create').trigger('click')
    await settle(wrapper)
    expect(createDeclaration).toHaveBeenCalledWith(
      expect.objectContaining({ targetDate: '2026-09-28', capacityMw: 50 })
    )
    expect(wrapper.text()).toContain('DECL-1')
  })

  it('有单据时摘要行直显单号，展开见换单指引', async () => {
    listDeclarations.mockResolvedValue([
      { id: 'DECL-9', status: 'DRAFT', capacityMw: 80, targetDate: '2026-09-28', energyCurveMwh96: [], priceCurve96: [], updatedAt: '2026-09-28T01:00:00Z' }
    ])
    const wrapper = await settle(mount(TradingDayView))
    expect(wrapper.text()).toContain('DECL-9')
    expect(wrapper.find('.td-bind-detail').exists()).toBe(false)
    await wrapper.find('.td-bind-bar').trigger('click')
    expect(wrapper.text()).toContain('换单：改上方标的交易日后自动重读该日最新单据')
  })
})
