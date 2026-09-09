import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TopicAnalysisPanel from './TopicAnalysisPanel.vue'
import { previewTopicAnalysis, type TopicAnalysisResult } from '@/services/review/topicAnalysis'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'

vi.mock('@/services/review/topicAnalysis', async original => ({ ...await original<typeof import('@/services/review/topicAnalysis')>(), previewTopicAnalysis: vi.fn() }))
vi.mock('@/composables/useEChart', () => ({ useEChart: () => ({ setOption: vi.fn() }) }))
const snapshot: ReviewEvidenceSnapshot = { scope: { company: 'a', region: 'yunnan', day: '2026-05-31', objectKey: 'order:a', objectLabel: '测试申报', version: 'v1' }, capturedAt: '2026-06-01T00:00:00Z', simulated: true, focus: '', entries: [], intervals: [], limitations: [] }
const point = { start: '2026-05-30T16:00:00.000Z', end: '2026-05-30T16:15:00.000Z', durationMinutes: 15, baselineMwh: 10, actualMwh: 12, differenceMwh: 2, daPrice: null, rtPrice: null }
const result: TopicAnalysisResult = { intervals: [point], anomalies: [point], coverage: { expectedMinutes: 1440, observedMinutes: 15, comparableMinutes: 15, ratio: 15 / 1440 }, energy: { baselineMwh: 10, actualMwh: 12, netDeviationMwh: 2, absoluteDeviationMwh: 2, absoluteDeviationPct: 20 }, prices: { daAverage: null, rtAverage: null, comparableMinutes: 0 }, notice: '资料预览', methodology: '非考核判定', simulated: true }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.clearAllMocks(); vi.mocked(previewTopicAnalysis).mockResolvedValue(result) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
async function open() { const wrapper = mount(TopicAnalysisPanel, { props: { snapshot } }); wrappers.push(wrapper); await flushPromises(); return wrapper }

describe('电量偏差分析交互', () => {
  it('申报默认与出清比较，选区传服务端重新统计而不是浏览器改金额', async () => {
    const wrapper = await open()
    expect(previewTopicAnalysis).toHaveBeenCalledWith(snapshot, 'declared_cleared', undefined, {}, expect.any(AbortSignal))
    await wrapper.get('input[type=checkbox]').setValue(true); await flushPromises()
    expect(previewTopicAnalysis).toHaveBeenLastCalledWith(snapshot, 'declared_cleared', [point.start], {}, expect.any(AbortSignal))
    expect(wrapper.text()).toContain('模拟演练')
    expect(wrapper.text()).not.toMatch(/companyId|sourceVersion|absoluteDeviation/)
  })
  it('切换基准后旧请求晚到不能覆盖新结果', async () => {
    let finish!: (value: TopicAnalysisResult) => void
    vi.mocked(previewTopicAnalysis).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await open()
    await wrapper.get('select').setValue('forecast_actual'); await flushPromises()
    finish({ ...result, energy: { ...result.energy, netDeviationMwh: 99999 } }); await flushPromises()
    expect(wrapper.text()).not.toContain('99,999')
    expect(wrapper.text()).toContain('净差异 2 MWh')
  })
  it('失败隐藏统计结果，内部错误不进入业务页面', async () => {
    const wrapper = await open()
    vi.mocked(previewTopicAnalysis).mockRejectedValueOnce(new Error('SQL internal_column'))
    await wrapper.get('select').setValue('declared_actual'); await flushPromises()
    expect(wrapper.text()).toContain('分析暂未完成')
    expect(wrapper.text()).not.toContain('internal_column')
    expect(wrapper.find('.metrics').exists()).toBe(false)
  })
})
