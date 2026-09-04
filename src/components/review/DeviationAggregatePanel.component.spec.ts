// 偏差周月聚合面板组件测试（#2042 主路径：恒等合计呈现 / 缺数日 / 二轴仅周聚合；
// 上期改进措施回查接入 improvement_actions 后的带入与诚实降级）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/reviewPeriodClient', () => ({ fetchReviewRange: vi.fn() }))
vi.mock('@/services/review/reviewStoreClient', () => ({ fetchCarryOverActions: vi.fn() }))
vi.mock('@/services/review/templateInstanceClient', () => ({
  fetchTemplateInstanceFeed: vi.fn(),
  invalidateTemplateInstanceCache: vi.fn(),
  patchTemplateInstance: vi.fn()
}))

import { fetchReviewRange } from '@/services/review/reviewPeriodClient'
import { fetchCarryOverActions } from '@/services/review/reviewStoreClient'
import { fetchTemplateInstanceFeed, patchTemplateInstance } from '@/services/review/templateInstanceClient'
import { isoWeekKeyOf } from '@/services/review/deviationAggregate'
import { todayBeijing } from '@/utils/beijingDate'
import DeviationAggregatePanel from './DeviationAggregatePanel.vue'
import { mount } from '@/test/mount'
import type { PeriodReview } from '@/services/review/reviewPeriodClient'

function day(date: string, ok: boolean, dev = 10): PeriodReview['days'][number] {
  if (!ok) return { ok: false, date, reason: '503' }
  return {
    ok: true, date, declaredTotalMwh: 500, causeId: 'load', causeLabel: '负荷预测偏差',
    result: {
      deviation: { points: 96, total_abs_deviation_mwh: dev, assessed_mwh: 4, estimated_penalty_yuan: 400, tolerance_pct: 3, worst_point: { datetime: `${date}T00:00`, deviation: 1 } }
    } as never
  }
}

beforeEach(() => {
  vi.mocked(fetchReviewRange).mockReset()
  vi.mocked(fetchCarryOverActions).mockReset()
  vi.mocked(fetchCarryOverActions).mockResolvedValue({ available: true, actions: [] })
  vi.mocked(fetchTemplateInstanceFeed).mockReset()
  vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: true, instances: [] })
  vi.mocked(patchTemplateInstance).mockReset()
  vi.mocked(patchTemplateInstance).mockResolvedValue(undefined)
  localStorage.clear()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  await nextTick(); await nextTick(); await nextTick()
  return wrapper
}

describe('DeviationAggregatePanel', () => {
  it('周聚合主路径：逐日+合计行+成因分布+二轴选择区（仅周）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true, 12), day('2026-08-11', true, 8)], missingDays: [] })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('模板七')
    expect(text).toContain('合计（2 日）')
    expect(text).toContain('20.00') // 12+8 恒等合计
    expect(text).toContain('负荷预测偏差')
    expect(text).toContain('责任归因（第二轴 · 仅周聚合人工补填')
    expect(text).toContain('映射建议')
  })

  it('缺数日如实列出不进合计；月模式无二轴', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true, 10), day('2026-08-11', false)], missingDays: ['2026-08-11'] })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('缺数 1 日')
    expect(text).toContain('2026-08-11')
    expect(text).toContain('合计（1 日）')
    // 切到月模式：二轴补填区消失
    const monthBtn = wrapper.findAll('.dap-ctrl button').find((b) => b.text() === '月')
    await monthBtn!.trigger('click')
    await nextTick(); await nextTick(); await nextTick()
    expect(wrapper.text()).not.toContain('仅周聚合人工补填')
  })

  it('全周期无数据 → 诚实空态不合成', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [], missingDays: [] })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('无可用数据日')
  })

  it('上期改进措施回查：未闭环项（open/carried_over）自动带入', async () => {
    vi.mocked(fetchCarryOverActions).mockResolvedValue({
      available: true,
      actions: [
        { id: '1', action: '修订负荷预测流程', owner: '交易员A', dueDate: '2026-09-10', status: 'open', updatedAt: null },
        { id: '2', action: '复盘新能源预测偏差', owner: null, dueDate: null, status: 'carried_over', updatedAt: null }
      ]
    })
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true)], missingDays: [] })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('未闭环项自动带入')
    expect(text).toContain('修订负荷预测流程')
    expect(text).toContain('已顺延')
    expect(text).toContain('责任人 交易员A')
    expect(text).toContain('共 2 项未闭环')
    expect(text).toContain('会议纪要')
  })

  it('改进措施端点缺席 → 诚实降级：需人工带入，不做假回查', async () => {
    vi.mocked(fetchCarryOverActions).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true)], missingDays: [] })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('需人工带入')
    expect(wrapper.text()).not.toContain('共 ')
  })

  // 责任归因二轴落库（清单 #2042 断链修复）：选择写入锚定周 T07 实例 causeCategory，
  // 有实例落库回显、无实例如实说明未落库——选择不再是无反馈的本地摆设。
  const mondayOfThisWeek = isoWeekKeyOf(todayBeijing()) // 锚日默认本周一，周键同源推导

  it('选责任归因 → PATCH 锚定周 T07 实例 causeCategory（中文标签）并回显已记录', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true)], missingDays: [] })
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({
      available: true,
      instances: [
        { id: '7', templateId: 'T07', periodKey: mondayOfThisWeek, status: 'pending', dueAt: null, updatedAt: null, payload: {} }
      ]
    })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    await wrapper.find('.dap-axis select').setValue('contingency')
    await settle(wrapper)
    expect(patchTemplateInstance).toHaveBeenCalledWith('7', {
      payload: { causeCategory: '突发情况' }
    })
    expect(wrapper.text()).toContain('已记录责任归因：突发情况')
    expect(wrapper.text()).toContain('写入 T07 周报实例 #7')
  })

  it('本周无 T07 实例 → 本机暂存（刷新保留）+ 如实标注未落库，不发 PATCH', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true)], missingDays: [] })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    await wrapper.find('.dap-axis select').setValue('strategy_error')
    await settle(wrapper)
    expect(patchTemplateInstance).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已暂存选择：策略失误')
    expect(wrapper.text()).toContain('本机暂存，刷新保留')
    expect(wrapper.text()).toContain('未落库')
    // 刷新等价场景：重挂组件后从 localStorage 恢复选择
    wrapper.unmount()
    const remounted = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect((remounted.find('.dap-axis select').element as HTMLSelectElement).value).toBe('strategy_error')
  })

  it('实例 payload 已有责任归因：回灌选择框（用户未手选前不覆盖）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [day('2026-08-10', true)], missingDays: [] })
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({
      available: true,
      instances: [
        { id: '9', templateId: 'T07', periodKey: mondayOfThisWeek, status: 'draft', dueAt: null, updatedAt: null, payload: { causeCategory: '预测不准' } }
      ]
    })
    const wrapper = await settle(mount(DeviationAggregatePanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect((wrapper.find('.dap-axis select').element as HTMLSelectElement).value).toBe('forecast_miss')
  })
})
