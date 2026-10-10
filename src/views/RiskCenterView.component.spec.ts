// 风控阈值面板失败态守卫（fix-spot-degradation-honesty）：
// 价差/告警取数失败时卡片必须呈现灰色失败态并说明原因，不得回落绿色「安全」——
// 本机实测告警端点 500 时页面曾显示「0 条 · 安全」（失败被当成零告警成功）。
// 成功且确实零异动/零告警时，绿色「安全」判定保持不变。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const fetchReview = vi.fn()
const fetchMonitor = vi.fn()
const fetchSummary = vi.fn()
const listAlertsMock = vi.fn()

vi.mock('@/services/quant/quantClient', () => ({
  fetchReview: (...a: unknown[]) => fetchReview(...a),
  fetchMonitor: (...a: unknown[]) => fetchMonitor(...a),
  classifyReviewError: () => ({ title: '复盘数据加载失败', description: '请核对输入后重试' }),
}))
vi.mock('@/services/hedge/hedgeApi', () => ({
  fetchSummary: (...a: unknown[]) => fetchSummary(...a),
}))
vi.mock('@/services/alertClient', () => ({
  listAlerts: (...a: unknown[]) => listAlertsMock(...a),
}))

const { mount } = await import('@/test/mount')
const RiskCenterView = (await import('./RiskCenterView.vue')).default

const EMPTY_MONITOR = { alerts: [], spread_threshold: 80 }
const EMPTY_REVIEW = {
  deviation: { estimated_penalty_yuan: 0, total_abs_deviation_mwh: 0, tolerance_pct: 3 },
}

async function mountView() {
  const wrapper = mount(RiskCenterView)
  await flushPromises()
  return wrapper
}

function cardOf(wrapper: ReturnType<typeof mount>, title: string) {
  return wrapper.findAll('.rc-card').find((c) => c.text().includes(title))!
}

describe('价差/告警卡失败态（失败不得判绿）', () => {
  it('monitor 与告警端点失败：灰色失败态 + 原因，无「安全」标签、无假空态', async () => {
    fetchReview.mockResolvedValue(EMPTY_REVIEW)
    fetchMonitor.mockRejectedValue(new Error('请求失败: 500'))
    fetchSummary.mockResolvedValue({ status: 'OK', scheme: null })
    listAlertsMock.mockRejectedValue(new Error('告警列表请求失败: HTTP 500'))

    const wrapper = await mountView()
    const spreadCard = cardOf(wrapper, '实时-日前价差异动')
    expect(spreadCard.classes()).toContain('state-empty')
    expect(spreadCard.text()).toContain('价差数据加载失败')
    expect(spreadCard.text()).toContain('请求失败: 500')
    // 不渲染红黄绿判级标签（绿色「安全」标签只在数据成功时出现）
    expect(spreadCard.find('.rc-tag').exists()).toBe(false)

    const alertCard = cardOf(wrapper, '盯盘告警（未消除）')
    expect(alertCard.classes()).toContain('state-empty')
    expect(alertCard.text()).toContain('告警读取失败')
    expect(alertCard.text()).toContain('HTTP 500')
    expect(alertCard.find('.rc-tag').exists()).toBe(false)

    // 底部活跃告警列表：失败时是错误态，不是「暂无活跃告警」假空态
    expect(wrapper.find('.rc-alerts').text()).toContain('告警读取失败')
    expect(wrapper.find('.rc-alerts').text()).not.toContain('暂无活跃告警')
    wrapper.unmount()
  })

  it('成功且零异动/零告警：维持绿色「安全」与「0 条」', async () => {
    fetchReview.mockResolvedValue(EMPTY_REVIEW)
    fetchMonitor.mockResolvedValue(EMPTY_MONITOR)
    fetchSummary.mockResolvedValue({ status: 'OK', scheme: { name: '默认' } })
    listAlertsMock.mockResolvedValue({ alerts: [], open_count: 0 })

    const wrapper = await mountView()
    const spreadCard = cardOf(wrapper, '实时-日前价差异动')
    expect(spreadCard.classes()).toContain('lv-green')
    expect(spreadCard.text()).toContain('0 条')
    expect(spreadCard.text()).toContain('安全')

    const alertCard = cardOf(wrapper, '盯盘告警（未消除）')
    expect(alertCard.classes()).toContain('lv-green')
    expect(alertCard.text()).toContain('安全')
    expect(wrapper.find('.rc-alerts').text()).toContain('暂无活跃告警')
    wrapper.unmount()
  })
})

describe('切地区迟到守卫（fix-stale-response-guards）', () => {
  it('切地区后旧地区慢响应不覆盖新地区数据与判级', async () => {
    let resolveOldMonitor!: (v: unknown) => void
    fetchReview.mockResolvedValue(EMPTY_REVIEW)
    fetchSummary.mockResolvedValue({ status: 'OK', scheme: { name: '默认' } })
    listAlertsMock.mockResolvedValue({ alerts: [], open_count: 0 })
    // 首轮（云南）monitor 挂起；其余端点即刻完成
    fetchMonitor.mockImplementationOnce(() => new Promise((r) => { resolveOldMonitor = r }))
    const wrapper = await mountView()

    // 切地区（山西）触发第二轮 load：monitor 返回 1 条异动（黄色关注档）
    fetchMonitor.mockResolvedValue({ alerts: [{ id: 'a' }], spread_threshold: 80 })
    const { setCurrentRegionId } = await import('@/services/region/regionContext')
    setCurrentRegionId('shanxi')
    await flushPromises()
    const card = () => cardOf(wrapper, '实时-日前价差异动')
    expect(card().text()).toContain('1 条')

    // 旧地区（云南）的 monitor 此刻迟到返回 3 条：不得覆盖新地区数据
    resolveOldMonitor({ alerts: [{ id: 'b' }, { id: 'c' }, { id: 'd' }], spread_threshold: 99 })
    await flushPromises()
    expect(card().text()).toContain('1 条')
    wrapper.unmount()
  })
})

// slim-spot-page-explainers：风控副题收纳（spec spot-page-hint-density「风控阈值页副题收纳」）。
describe('风控页副题收纳（slim-spot-page-explainers）', () => {
  it('副题两行段落不再渲染，口径/来源经 ⓘ 可达，地区徽标保留', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('p.rc-sub').exists()).toBe(false)
    const info = wrapper.find('.rc-head h2').findComponent({ name: 'InfoHint' })
    expect(info.exists()).toBe(true)
    expect(info.props('text')).toContain('/agent-api/agent/quant/*')
    expect(info.props('text')).toContain('仅供参考')
    expect(wrapper.find('.rc-head-region').exists()).toBe(true)
  })
})
