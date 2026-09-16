import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@/test/mount'
import ReviewWorkbenchView from './ReviewWorkbenchView.vue'
import { getDeclaration, listDeclarationsPage, type DeclarationOrder } from '@/services/declarations'
import { fetchReview, fetchSettlementReview, type SettlementReviewResult } from '@/services/quant/quantClient'
import { fetchDecisionLogFeed } from '@/services/trading/decisionLogClient'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'

vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan', shortName: '云南' }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('company-a'), currentCompany: (await import('vue')).ref({ name: '核验公司' }) }))
vi.mock('@/services/declarations', () => ({ getDeclaration: vi.fn(), listDeclarationsPage: vi.fn() }))
vi.mock('@/services/quant/quantClient', () => ({ fetchReview: vi.fn(), fetchSettlementReview: vi.fn(), classifyReviewError: vi.fn(() => ({ kind: 'load-failed' })) }))
vi.mock('@/services/trading/decisionLogClient', () => ({ fetchDecisionLogFeed: vi.fn(), postBackfill: vi.fn() }))
vi.mock('@/services/review/reviewStoreClient', () => ({ fetchImprovementActions: vi.fn(async () => ({ available: true, actions: [] })), fetchAllImprovementActions: vi.fn(async () => ({ available: true, actions: [] })), createImprovementAction: vi.fn(), patchImprovementAction: vi.fn() }))
vi.mock('@/composables/useEChart', () => ({ useEChart: () => ({ setOption: vi.fn(), instance: () => null }) }))

const settlement = { date: '2026-05-31', region: 'yunnan', mock: false, sourceType: 'REAL', plant_count: 1, summary: { ltmEnergy: 30, daDevEnergy: 20, rtDevEnergy: 10, actualOnGridEnergy: 60, totalFee: 600, avgPrice: 10 }, plants: [{ plant: '核验用厂站', actualOnGridEnergy: 60, totalFee: 600, avgPrice: 10 }] } as SettlementReviewResult
function order(id: string): DeclarationOrder { return { id, companyId: 'company-a', targetDate: '2026-05-31', region: 'yunnan', status: 'CLEARED', quoteRationale: `${id} 的申报理由`, energyCurveMwh96: Array(96).fill(10), clearing: { clearedCurveMwh96: Array(96).fill(8) }, createdAt: '2026-05-30T08:00:00+08:00' } as DeclarationOrder }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks(); currentRegion.value.id = 'yunnan'; selectedCompanyId.value = 'company-a'
  vi.mocked(listDeclarationsPage).mockResolvedValue({ rows: [order('a')], total: 1 } as never)
  vi.mocked(getDeclaration).mockImplementation(async id => order(id))
  vi.mocked(fetchDecisionLogFeed).mockResolvedValue({ available: true, entries: [] })
  vi.mocked(fetchSettlementReview).mockResolvedValue(settlement)
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function open(query = '', standaloneTopics = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/xhjy/review', component: ReviewWorkbenchView }, { path: '/xhjy/review/analysis', component: ReviewWorkbenchView }, { path: '/xhjy/desk', component: { template: '<div>申报台</div>' } }] })
  await router.push(`/xhjy/review?layout=decisions&date=2026-05-31${query}`); await router.isReady()
  const wrapper = mount(ReviewWorkbenchView, { props: { standaloneTopics }, global: { plugins: [router], stubs: { RegionDataBanner: true, ReviewTopicWorkspace: true, ReportArchivePanel: true, ReportWorkpaperEditor: true } } }); wrappers.push(wrapper)
  await flushPromises(); return { wrapper, router }
}
describe('真实接口复盘工作流', () => {
  it('导入材料以自身对象和完整周期建立底稿，不借用当前申报对象', async () => {
    const { wrapper } = await open('&declarationId=a', true)
    const material = { sourceKind: 'imported', region: 'yunnan', content: { topic: 'energy', objectLabel: '补充用电组合', capturedAt: '2026-06-01T00:00:00Z', input: { scope: { companyId: 'company-a', objectId: 'imported:object' } }, result: { simulated: true, periods: { current: { start: '2026-05-25', end: '2026-05-31' } } } } }
    wrapper.findComponent({ name: 'ReviewTopicWorkspace' }).vm.$emit('material', material); await flushPromises()
    const snapshot = wrapper.findComponent({ name: 'ReportWorkpaperEditor' }).props('snapshot')
    expect(snapshot.scope.objectKey).toBe('imported:object')
    expect(snapshot.scope.period).toEqual({ start: '2026-05-25', end: '2026-05-31' })
    expect(snapshot.simulated).toBe(true)
  })
  it.each([true, false])('真实路由返回有草稿时只确认一次，确认结果为 %s', async accepted => {
    const confirm = vi.fn(() => accepted)
    vi.stubGlobal('confirm', confirm)
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/xhjy/review', component: ReviewWorkbenchView },
      { path: '/xhjy/review/analysis', component: { template: '<div>已返回专题</div>' } }
    ] })
    const back = '/xhjy/review/analysis?companyId=company-a&region=yunnan&cadence=week'
    await router.push({ path: '/xhjy/review', query: { date: '2026-05-31', task: 'improvement', analysisReturn: back } })
    const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router], stubs: { RegionDataBanner: true, ImprovementWorkbench: true, ReviewTopicWorkspace: true, ReportArchivePanel: true } } }); wrappers.push(wrapper)
    await flushPromises()
    wrapper.findComponent({ name: 'ImprovementWorkbench' }).vm.$emit('draft', ['尚未保存的措施'], 'test-draft')
    await wrapper.findAll('button').find(b => b.text() === '返回原周期专题分析')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe(accepted ? '/xhjy/review/analysis' : '/xhjy/review')
  })

  it.each([true, false])('同页专题弹窗切换对象也只确认一次，确认结果为 %s', async accepted => {
    const confirm = vi.fn(() => accepted); vi.stubGlobal('confirm', confirm)
    const { wrapper, router } = await open('&task=improvement')
    wrapper.findComponent({ name: 'ImprovementWorkbench' }).vm.$emit('draft', ['尚未保存的措施'], 'same-page')
    await wrapper.findAll('button').find(b => b.text() === '专题分析')!.trigger('click'); await flushPromises()
    wrapper.findComponent({ name: 'ReviewTopicWorkspace' }).vm.$emit('decision', order('a'))
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.query.declarationId).toBe(accepted ? 'a' : undefined)
  })
  it('周期申报回查保存全部专题筛选并跳到申报实际交易日', async () => {
    const { wrapper, router } = await open('&topic=settlement&cadence=week&periodDate=2026-05-31&plants=甲厂&priceIntervals=2026-05-30T00:00:00%2B08:00', true)
    const workspace = wrapper.findComponent({ name: 'ReviewTopicWorkspace' })
    workspace.vm.$emit('decision', { ...order('b'), targetDate: '2026-05-30' })
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ date: '2026-05-30', declarationId: 'b', task: 'decision' })
    const back = router.resolve(String(router.currentRoute.value.query.analysisReturn))
    expect(back.path).toBe('/xhjy/review/analysis')
    expect(back.query).toMatchObject({ date: '2026-05-31', periodDate: '2026-05-31', cadence: 'week', plants: '甲厂', companyId: 'company-a', region: 'yunnan' })
    expect(back.query.priceIntervals).toBe('2026-05-30T00:00:00+08:00')
    expect(wrapper.text()).toContain('返回原周期专题分析')
  })
  it('不同公司或地区的返回链接不展示', async () => {
    const back = encodeURIComponent('/xhjy/review/analysis?companyId=other&region=yunnan')
    const { wrapper } = await open('&analysisReturn=' + back)
    expect(wrapper.text()).not.toContain('返回原周期专题分析')
  })

  it('独立专题沿用单笔资料加载，并保留业务视角和对象', async () => {
    const { wrapper } = await open('&declarationId=a&view=retail&topic=price&companyId=company-a&region=yunnan', true)
    expect(wrapper.text()).toContain('复盘专题分析')
    expect(wrapper.find('nav.tasks').exists()).toBe(false)
    const workspace = wrapper.findComponent({ name: 'ReviewTopicWorkspace' })
    expect(workspace.props('view')).toBe('retail')
    expect(workspace.props('topic')).toBe('price')
    expect(workspace.props('snapshot').scope.objectKey).toBe('order:a')
    expect(workspace.props('snapshot').scope.businessView).toBe('retail')
  })
  it('切日期一次重置全部专题链接，重新打开不会恢复旧范围', async () => {
    const { wrapper, router } = await open('&energyDate=2026-05-20&energyPlants=old&priceDate=2026-05-21&pricePlant=old&periodDate=2026-05-22&plants=old', true)
    await router.replace({ query: { ...router.currentRoute.value.query, date: '2026-06-01' } }); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ date: '2026-06-01', energyDate: '2026-06-01', priceDate: '2026-06-01', periodDate: '2026-06-01' })
    expect(router.currentRoute.value.query.energyPlants).toEqual([])
    expect(router.currentRoute.value.query.pricePlant).toBeUndefined()
    expect(router.currentRoute.value.query.plants).toEqual([])
    expect(wrapper.findComponent({ name: 'ReviewTopicWorkspace' }).exists()).toBe(true)
  })
  it('公司切换同时清空单笔和专题范围，不能被筛选同步恢复旧单笔', async () => {
    const { router } = await open('&declarationId=a&energyPlants=old&pricePlant=old&plants=old', true)
    selectedCompanyId.value = 'company-b'; await flushPromises()
    expect(router.currentRoute.value.query.declarationId).toBeUndefined()
    expect(router.currentRoute.value.query.energyPlants).toEqual([])
    expect(router.currentRoute.value.query.pricePlant).toBeUndefined()
    expect(router.currentRoute.value.query.plants).toEqual([])
  })
  it('独立链接公司不匹配时不加载或替换成当前公司的统计', async () => {
    const { wrapper } = await open('&companyId=other&declarationId=a', true)
    expect(wrapper.text()).toContain('公司或地区与当前选择不一致')
    expect(getDeclaration).not.toHaveBeenCalled()
    expect(fetchSettlementReview).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'ReviewTopicWorkspace' }).exists()).toBe(false)
  })
  it('先打开新报告目录，旧报告保留独立入口与日期', async () => {
    const { wrapper, router } = await open()
    await wrapper.findAll('button').find(b => b.text().includes('报告目录'))!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.layout).toBe('decisions')
    const archive = wrapper.findComponent({ name: 'ReportArchivePanel' })
    expect(archive.props()).toMatchObject({ company: 'company-a', region: 'yunnan' })
    archive.vm.$emit('legacy'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ layout: 'classic', date: '2026-05-31' })
  })
  it('云南有结算即展示；偏差缺源不挡整页，也不请求已知未接入的曲线', async () => {
    const { wrapper } = await open()
    expect(wrapper.text()).toContain('600'); expect(wrapper.text()).toContain('结算资料核验')
    expect(wrapper.text()).toContain('结算增量不能替代实际分时电量')
    expect(fetchReview).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toMatch(/actual_mwh|serving-route|review\.|#1488|模板/)
  })
  it('单笔仅显示自己出清曲线，不把公司结算或平台实际量挂到这笔交易', async () => {
    const { wrapper, router } = await open('&declarationId=a')
    expect(getDeclaration).toHaveBeenCalledWith('a', 'company-a'); expect(listDeclarationsPage).toHaveBeenCalledWith(expect.any(Object), 'company-a')
    expect(wrapper.text()).toContain('分时核验'); expect(wrapper.text()).toContain('可比较 96 / 96')
    expect(wrapper.text()).not.toContain('结算资料核验')
    expect(wrapper.text()).toContain('实际电量尚未与这笔申报逐时段关联')
    const button = wrapper.findAll('button').find(b => b.text().includes('打开这笔申报'))!
    await button.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/xhjy/desk')
    expect(router.currentRoute.value.query).toMatchObject({ declarationId: 'a', targetDate: '2026-05-31' })
  })
  it('申报读取失败或地区不匹配均阻断单笔分析，不能替换基准继续计算', async () => {
    vi.mocked(getDeclaration).mockResolvedValue({ ...order('a'), region: 'shanxi' })
    const { wrapper } = await open('&declarationId=a')
    expect(wrapper.text()).toContain('交易日或地区与当前范围不一致')
    expect(wrapper.text()).not.toContain('可比较 96 / 96')
    expect(wrapper.text()).not.toContain('结算资料核验')
    expect(fetchReview).not.toHaveBeenCalled()
  })
  it('旧日期的慢响应不会覆盖新日期的证据', async () => {
    let resolveOld!: (value: SettlementReviewResult) => void
    vi.mocked(fetchSettlementReview).mockImplementation(day => day === '2026-05-31' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ ...settlement, date: day, summary: { ...settlement.summary, totalFee: 9876 } }))
    const { wrapper, router } = await open()
    await router.replace({ query: { layout: 'decisions', date: '2026-06-01' } }); await flushPromises()
    resolveOld(settlement); await flushPromises()
    expect(wrapper.find('.metrics').text()).toContain('9,876'); expect(wrapper.find('.metrics').text()).not.toContain('600')
  })
  it('公司切换丢弃旧公司慢响应；未选公司时不读取或显示业务数据', async () => {
    let resolveOld!: (value: SettlementReviewResult) => void
    vi.mocked(fetchSettlementReview).mockImplementation(() => selectedCompanyId.value === 'company-a' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ ...settlement, summary: { ...settlement.summary, totalFee: 9876 } }))
    const { wrapper } = await open()
    selectedCompanyId.value = 'company-b'; await flushPromises()
    resolveOld(settlement); await flushPromises()
    expect(wrapper.find('.metrics').text()).toContain('9,876')
    expect(wrapper.find('.metrics').text()).not.toContain('600')
    const requests = vi.mocked(fetchSettlementReview).mock.calls.length
    selectedCompanyId.value = ''; await flushPromises()
    expect(wrapper.text()).toContain('请先在顶部选择有权查看的公司')
    expect(wrapper.find('.metrics').exists()).toBe(false)
    expect(fetchSettlementReview).toHaveBeenCalledTimes(requests)
  })
  it('非当前公司的申报不能进入单笔核验', async () => {
    vi.mocked(getDeclaration).mockResolvedValue({ ...order('a'), companyId: 'company-b' })
    const { wrapper } = await open('&declarationId=a')
    expect(wrapper.text()).toContain('公司、交易日或地区与当前范围不一致')
    expect(wrapper.text()).not.toContain('可比较 96 / 96')
  })
  it('同页换单后旧申报慢响应不能顶替新单', async () => {
    let resolveOld!: (value: DeclarationOrder) => void
    vi.mocked(getDeclaration).mockImplementation(id => id === 'a' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(order(id)))
    const { wrapper, router } = await open('&declarationId=a&task=decision')
    await router.replace({ query: { ...router.currentRoute.value.query, declarationId: 'b' } }); await flushPromises()
    resolveOld(order('a')); await flushPromises()
    expect(wrapper.text()).toContain('b 的申报理由'); expect(wrapper.text()).not.toContain('a 的申报理由')
  })
})
