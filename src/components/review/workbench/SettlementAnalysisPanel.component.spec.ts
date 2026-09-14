// 守周期/厂站筛选确实重查且不显示过期统计；公司结果不能冒充单笔。dljy#2875。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SettlementAnalysisPanel from './SettlementAnalysisPanel.vue'
import { fetchSettlementAnalysis, type SettlementAnalysis, type SettlementMetrics } from '@/services/review/settlementAnalysis'
import { captureSettlementReportEvidence } from '@/services/review/workpapers'
vi.mock('@/services/review/settlementAnalysis', () => ({ fetchSettlementAnalysis: vi.fn() }))
vi.mock('@/services/review/workpapers', () => ({ captureSettlementReportEvidence: vi.fn() }))
vi.mock('@/composables/useEChart', () => ({ useEChart: () => ({ setOption: vi.fn() }) }))
const metrics: SettlementMetrics = { energyMwh: 100, feeYuan: 20000, averagePrice: 200, longTermMwh: 60, dayAheadIncrementMwh: 30, realTimeIncrementMwh: 10, coverage: { records: 1, energy: 1, fee: 1, paired: 1, longTerm: 1, dayAhead: 1, realTime: 1 } }
const result: SettlementAnalysis = { periods: { current: { start: '2026-05-31', end: '2026-05-31' }, reference: { start: '2026-05-24', end: '2026-05-24' }, incomplete: false }, availablePlants: ['测试厂站'], selectedPlants: ['测试厂站'], current: { ...metrics, expectedPlantDays: 1, daily: [{ ...metrics, date: '2026-05-31' }], plants: [{ ...metrics, plant: '测试厂站' }] }, reference: { ...metrics, expectedPlantDays: 1, daily: [], plants: [] }, comparison: { matchedPlantDays: 1, currentEnergyMwh: 100, referenceEnergyMwh: 90, currentFeeYuan: 20000, referenceFeeYuan: 18000 }, source: { type: 'business_source', version: 'v1', mock: false, productionWrite: false }, notice: '电费不等于利润' }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchSettlementAnalysis).mockResolvedValue(result) })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })
async function open() { const wrapper = mount(SettlementAnalysisPanel, { props: { company: 'a', region: 'yunnan', date: '2026-05-31', companyLabel: '公司甲' } }); wrappers.push(wrapper); await flushPromises(); return wrapper }
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!
describe('公司周期与结算专题', () => {
  it('切周月后旧结果立即隐藏，重新统计向服务端提交新周期', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('结算电量100 MWh')
    await wrapper.get('select[aria-label="分析周期"]').setValue('month')
    expect(wrapper.find('.metrics').exists()).toBe(false)
    expect(wrapper.get<HTMLElement>('.plot').element.style.display).toBe('none')
    await button(wrapper, '重新统计').trigger('click'); await flushPromises()
    expect(fetchSettlementAnalysis).toHaveBeenLastCalledWith('a', expect.objectContaining({ period: expect.objectContaining({ date: '2026-05-31', cadence: 'month' }) }), expect.any(AbortSignal))
    expect(wrapper.text()).not.toMatch(/feeYuan|companyId|totalEnergy|sourceType/)
  })
  it('空周期不留下空坐标轴，真实零值仍可显示', async () => {
    vi.mocked(fetchSettlementAnalysis).mockResolvedValueOnce({ ...result, current: { ...result.current, daily: [] } })
    const wrapper = await open()
    expect(wrapper.get<HTMLElement>('.plot').element.style.display).toBe('none')
    expect(wrapper.text()).toContain('所选周期没有可绘制')
    vi.mocked(fetchSettlementAnalysis).mockResolvedValueOnce({ ...result, current: { ...result.current, daily: [{ ...metrics, date: '2026-05-31', energyMwh: 0, feeYuan: 0 }] } })
    await button(wrapper, '重新统计').trigger('click'); await flushPromises()
    expect(wrapper.get<HTMLElement>('.plot').element.style.display).not.toBe('none')
  })
  it('厂站下钻重新查询且不会被筛选监听取消', async () => {
    const wrapper = await open()
    await button(wrapper, '查看厂站').trigger('click'); await flushPromises()
    expect(fetchSettlementAnalysis).toHaveBeenLastCalledWith('a', expect.objectContaining({ plants: ['测试厂站'] }), expect.any(AbortSignal))
    expect(wrapper.find('.metrics').exists()).toBe(true)
  })
  it('切换公司后的旧响应不能覆盖新上下文', async () => {
    let finish!: (value: SettlementAnalysis) => void
    vi.mocked(fetchSettlementAnalysis).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await open()
    await wrapper.setProps({ company: 'b' })
    finish(result); await flushPromises()
    expect(wrapper.find('.metrics').exists()).toBe(false)
  })
  it('失败保留业务提示，不显示内部错误或旧经营数字', async () => {
    const wrapper = await open()
    vi.mocked(fetchSettlementAnalysis).mockRejectedValueOnce(new Error('SQL internal_field'))
    await button(wrapper, '重新统计').trigger('click'); await flushPromises()
    expect(wrapper.get<HTMLElement>('.plot').element.style.display).toBe('none')
    expect(wrapper.text()).toContain('结算统计未完成')
    expect(wrapper.text()).not.toContain('internal_field')
    expect(wrapper.find('.metrics').exists()).toBe(false)
  })
  it('按已完成统计的范围保存材料，换日期后不允许取用旧图', async () => {
    const material = { id: 'saved', region: 'yunnan', authorId: '主笔', createdAt: '', sourceKind: 'business_source', contentHash: 'hash', content: { topic: 'settlement' as const, labels: ['结算电量', '结算电费'] as [string, string], capturedAt: '', sourceNotice: '已入库资料', input: { scope: { objectId: 'plant:测试厂站', companyId: 'a' }, period: { date: '2026-05-31' } }, result } }
    vi.mocked(captureSettlementReportEvidence).mockResolvedValue(material)
    const wrapper = await open()
    await button(wrapper, '保存材料并加入底稿').trigger('click'); await flushPromises()
    expect(captureSettlementReportEvidence).toHaveBeenCalledWith('a', expect.objectContaining({ period: expect.objectContaining({ date: '2026-05-31' }) }))
    expect(wrapper.emitted('material')?.[0]).toEqual([material])
    await wrapper.get('input[aria-label="分析日期"]').setValue('2026-06-01')
    expect(wrapper.findAll('button').some(button => button.text() === '保存材料并加入底稿')).toBe(false)
  })
})
