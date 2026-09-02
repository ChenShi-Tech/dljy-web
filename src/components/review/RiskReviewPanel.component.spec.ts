// 风险事件库与压力测试面板组件测试（#2047 主路径：触发清单/压测真引擎/评级/near_miss）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/reviewPeriodClient', () => ({ fetchReviewRange: vi.fn() }))
vi.mock('@/services/quant/quantClient', () => ({ fetchCvar: vi.fn() }))
vi.mock('@/services/tradingMemory', () => ({ getRegionWinStats: vi.fn() }))
vi.mock('@/services/region/regionContext', () => ({ currentRegion: { value: { id: 'shanxi' } } }))
vi.mock('@/services/review/reviewStoreClient', () => ({
  fetchRiskEvents: vi.fn(),
  registerRiskEvent: vi.fn(),
  patchRiskEvent: vi.fn(),
  fetchCases: vi.fn(),
  registerCase: vi.fn()
}))

import { fetchReviewRange, type PeriodReviewDay } from '@/services/review/reviewPeriodClient'
import { fetchCases, fetchRiskEvents, patchRiskEvent, registerCase, registerRiskEvent } from '@/services/review/reviewStoreClient'
import { fetchCvar } from '@/services/quant/quantClient'
import { getRegionWinStats } from '@/services/tradingMemory'
import RiskReviewPanel from './RiskReviewPanel.vue'
import { mount } from '@/test/mount'

function okDay(date: string, spreadPnl: number | null, devPct = 0.02): PeriodReviewDay {
  return {
    ok: true as const, date, declaredTotalMwh: 1000, causeId: null, causeLabel: null,
    result: {
      date,
      source: 'platform',
      deviation: { points: 1, total_abs_deviation_mwh: devPct * 1000, assessed_mwh: 5, estimated_penalty_yuan: 500, tolerance_pct: 3, worst_point: { datetime: date, deviation: 1 } },
      backtest: { da_revenue_yuan: 1, avg_da_price: 1, da_rt_spread_pnl_yuan: spreadPnl ?? undefined, note: '' },
      detail: [
        { datetime: `${date} 00:15`, declared: 10, actual: 10, da_price: 100, rt_price: 105 },
        { datetime: `${date} 00:30`, declared: 10, actual: 10, da_price: 100, rt_price: 95 }
      ]
    }
  } as unknown as PeriodReviewDay
}

beforeEach(() => {
  vi.mocked(fetchReviewRange).mockReset()
  vi.mocked(fetchCvar).mockReset()
  vi.mocked(getRegionWinStats).mockReset()
  vi.mocked(fetchRiskEvents).mockReset()
  vi.mocked(fetchRiskEvents).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
  vi.mocked(registerRiskEvent).mockReset()
  vi.mocked(patchRiskEvent).mockReset()
  vi.mocked(fetchCases).mockReset()
  vi.mocked(fetchCases).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
  vi.mocked(registerCase).mockReset()
  localStorage.removeItem('dljy.review.nearMissDraft')
})

async function settle(wrapper: ReturnType<typeof mount>) {
  for (let i = 0; i < 8; i++) await nextTick()
  return wrapper
}

describe('RiskReviewPanel', () => {
  it('触发清单+压测主路径：连续超标 red、CVaR 真引擎指标、评级选择', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({
      days: [okDay('2026-08-01', -100, 0.06), okDay('2026-08-02', -50, 0.07), okDay('2026-08-03', -80, 0.01), okDay('2026-08-04', null, 0.02)],
      missingDays: []
    })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1,
      policy_source: '权威引擎：历史模拟法'
    })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('偏差率连续 2 日超 5%')
    expect(text).toContain('价差盈亏连续 3 日为负')
    expect(text).toContain('VaR95')
    expect(text).toContain('5.00%')
    expect(text).toContain('决策参考，非结算依据')
    expect(text).toContain('承受能力评级')
    expect(text).toContain('near_miss')
  })

  it('无越限：负例文案（未越限不生成待办）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [okDay('2026-08-01', 100, 0.02)], missingDays: [] })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1
    })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('无越限触发')
    expect(wrapper.text()).toContain('止损仓位越限：待数据接入')
  })

  /** near_miss 服务端落库路径的登记回读样本（registerRiskEvent 成功响应）。 */
  const registeredEvent = {
    id: '7', eventTime: '2026-08-15T02:00:00.000Z', eventType: 'near_miss',
    riskLevel: 'medium' as const, impactYuan: null, impactCaliber: null, nearMiss: true,
    disposal: null, effective: null, lessons: '止盈信号犹豫但未触发实亏', updatedAt: '2026-08-15T02:05:00.000Z',
    extremeValue: null, durationHours: null, positionSnapshot: null
  }

  it('near_miss 登记主路径：服务端可用 → registerRiskEvent(near_miss 不计损失) + 处置回填 + 已落库', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [], missingDays: [] })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    vi.mocked(fetchRiskEvents).mockResolvedValue({ available: true, events: [] })
    vi.mocked(registerRiskEvent).mockResolvedValue(registeredEvent)
    vi.mocked(patchRiskEvent).mockResolvedValue(registeredEvent)
    vi.mocked(fetchCases).mockResolvedValue({ available: true, cases: [] })
    vi.mocked(registerCase).mockResolvedValue({ id: '1', caseNo: 'AL-20260818-001', caseType: 'risk', title: 't', visibility: 'internal', lessons: 'l', createdAt: null })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    await wrapper.find('input[type="datetime-local"]').setValue('2026-08-15T10:00')
    await wrapper.find('.rrp-save').trigger('click')
    await settle(wrapper)
    expect(registerRiskEvent).toHaveBeenCalledTimes(1)
    const draft = vi.mocked(registerRiskEvent).mock.calls[0][0]
    expect(draft.nearMiss).toBe(true)
    expect(draft.impactYuan ?? null).toBeNull() // #2047 红线：侥幸逃过不计损失金额
    expect(patchRiskEvent).not.toHaveBeenCalled() // 未填处置 → 不回填（处置是登记后补）
    expect(wrapper.text()).toContain('已落库')
    expect(wrapper.text()).toContain('不计入损失金额统计')
    // #2047 验收：near_miss 事件落库后自动沉淀案例库（case_no 回执）
    expect(registerCase).toHaveBeenCalledTimes(1)
    const caseDraft = vi.mocked(registerCase).mock.calls[0][0]
    expect(caseDraft.caseType).toBe('risk')
    expect(caseDraft.visibility).toBe('internal')
    expect(wrapper.text()).toContain('AL-20260818-001')
  })

  it('near_miss 案例沉淀失败：红字 + 重试按钮（写路径不静默）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [], missingDays: [] })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    vi.mocked(fetchRiskEvents).mockResolvedValue({ available: true, events: [] })
    vi.mocked(registerRiskEvent).mockResolvedValue(registeredEvent)
    vi.mocked(fetchCases).mockResolvedValue({ available: true, cases: [] })
    vi.mocked(registerCase).mockRejectedValue(new Error('案例登记失败（HTTP 503）'))
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    await wrapper.find('input[type="datetime-local"]').setValue('2026-08-15T10:00')
    await wrapper.find('.rrp-save').trigger('click')
    await settle(wrapper)
    expect(registerCase).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('案例沉淀失败不静默')
    expect(wrapper.text()).toContain('重试沉淀案例')
    // 重试成功 → 回执
    vi.mocked(registerCase).mockResolvedValue({ id: '2', caseNo: 'AL-20260818-002', caseType: 'risk', title: 't', visibility: 'internal', lessons: 'l', createdAt: null })
    await wrapper.findAll('button').find((b) => b.text().includes('重试沉淀案例'))!.trigger('click')
    await settle(wrapper)
    expect(registerCase).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('AL-20260818-002')
  })

  it('阈值触发自动草稿：已存在同 eventType 不再 POST（幂等 GET 去重）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({
      days: [okDay('2026-08-01', 100, 0.06), okDay('2026-08-02', 100, 0.07)],
      missingDays: []
    })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1
    })
    vi.mocked(fetchRiskEvents).mockResolvedValue({
      available: true,
      events: [{ ...registeredEvent, eventType: 'trigger_deviation_streak' }]
    })
    const wrapper = mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } })
    await wrapper.find('input[type="month"]').setValue('2026-08') // 对齐 mock 数据月份，去重按当月
    await settle(wrapper)
    expect(registerRiskEvent).not.toHaveBeenCalled() // 已存在 → 不重复 POST
    expect(wrapper.text()).toContain('不重复登记')
  })

  it('阈值触发自动草稿：上月已登记同类触发，本月越限仍须重新登记（跨月不吞）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({
      days: [okDay('2026-08-01', 100, 0.06), okDay('2026-08-02', 100, 0.07)],
      missingDays: []
    })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1
    })
    // 历史事件停留在上月（2026-08），当月（2026-09）查无同类 → 新越限须登记
    vi.mocked(fetchRiskEvents).mockResolvedValue({
      available: true,
      events: [{ ...registeredEvent, eventType: 'trigger_deviation_streak' }]
    })
    vi.mocked(registerRiskEvent).mockResolvedValue(registeredEvent)
    const wrapper = mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } })
    await wrapper.find('input[type="month"]').setValue('2026-09')
    await settle(wrapper)
    expect(registerRiskEvent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(registerRiskEvent).mock.calls[0][1]).toBe('trigger-deviation-streak-2026-09')
    expect(wrapper.text()).toContain('已生成事件库草稿')
  })

  it('near_miss 端点缺席：回落本地草稿（真持久化到本机），缺事件时间仍拦截', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [], missingDays: [] })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    vi.mocked(fetchRiskEvents).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    // 缺席分支同口径校验：事件时间必填（不再跳过）
    await wrapper.find('.rrp-save').trigger('click')
    await settle(wrapper)
    expect(wrapper.text()).toContain('事件时间必填')
    expect(registerRiskEvent).not.toHaveBeenCalled()
    // 填齐后：草稿真写入 localStorage（「回落本地草稿」承诺），文案如实
    await wrapper.find('input[type="datetime-local"]').setValue('2026-08-15T10:00')
    await wrapper.find('.rrp-save').trigger('click')
    await settle(wrapper)
    expect(registerRiskEvent).not.toHaveBeenCalled()
    const raw = localStorage.getItem('dljy.review.nearMissDraft')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toMatchObject({ eventTime: '2026-08-15T10:00', riskLevel: 'medium' })
    expect(wrapper.text()).toContain('已存本地草稿')
  })

  it('阈值触发自动草稿：未越限不 POST（负例红线）', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [okDay('2026-08-01', 100, 0.02)], missingDays: [] })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    vi.mocked(fetchCvar).mockResolvedValue({
      var_95: 0.05, var_99: 0.08, cvar_95: 0.07, cvar_99: 0.1, max_drawdown: 0.12,
      volatility: 0.35, sharpe_ratio: 1.2, sortino_ratio: 1.5, tail_risk: 0.1
    })
    vi.mocked(fetchRiskEvents).mockResolvedValue({ available: true, events: [] })
    await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    expect(registerRiskEvent).not.toHaveBeenCalled()
  })

  it('既有事件行内回填：有效性未评估行出补录控件，PATCH 处置+有效性后行刷新', async () => {
    vi.mocked(fetchReviewRange).mockResolvedValue({ days: [], missingDays: [] })
    vi.mocked(getRegionWinStats).mockReturnValue({
      wins: 0, losses: 0, sampleSize: 0, priorWinRate: 0.5, posteriorWinRate: 0.5,
      credibleLow: 0.2, credibleHigh: 0.8, strength: 4, cumulativePnlWan: 0
    })
    // 一条已评估（只读）+ 一条未评估（出回填控件）+ 一条带极值/时长（结构化列带出）
    vi.mocked(fetchRiskEvents).mockResolvedValue({
      available: true,
      events: [
        { id: '8', eventTime: '2026-08-01T02:00:00.000Z', eventType: 'near_miss', riskLevel: 'low', impactYuan: null, impactCaliber: null, nearMiss: true, disposal: '已复盘', effective: true, lessons: '', extremeValue: null, durationHours: null, positionSnapshot: null, updatedAt: null },
        { id: '9', eventTime: '2026-08-10T02:00:00.000Z', eventType: 'near_miss', riskLevel: 'medium', impactYuan: null, impactCaliber: null, nearMiss: true, disposal: null, effective: null, lessons: '', extremeValue: null, durationHours: null, positionSnapshot: null, updatedAt: null },
        { id: '10', eventTime: '2026-08-12T02:00:00.000Z', eventType: 'price_anomaly', riskLevel: 'high', impactYuan: null, impactCaliber: null, nearMiss: false, disposal: null, effective: null, lessons: '', extremeValue: 412.5, durationHours: 3, positionSnapshot: null, updatedAt: null }
      ]
    })
    vi.mocked(patchRiskEvent).mockResolvedValue({
      id: '9', eventTime: '2026-08-10T02:00:00.000Z', eventType: 'near_miss', riskLevel: 'medium', impactYuan: null, impactCaliber: null, nearMiss: true, disposal: '盘中口头止损', effective: true, lessons: '', extremeValue: null, durationHours: null, positionSnapshot: null, updatedAt: null
    })
    const wrapper = await settle(mount(RiskReviewPanel, { props: { tolerancePct: 3, penaltyPrice: 100 } }))
    // 结构化列带出：极值/持续时长只在有值的事件行出现
    expect(wrapper.text()).toContain('极值 412.5')
    expect(wrapper.text()).toContain('持续 3 小时')
    // 有效性未评估的行（9/10 两条）出回填控件；已评估行（8）不出
    expect(wrapper.findAll('.rrp-backfill').length).toBe(2)
    const draft = wrapper.find('.rrp-backfill')
    await draft.find('input').setValue('盘中口头止损')
    await draft.find('select').setValue('true')
    await draft.find('.rrp-save').trigger('click')
    await settle(wrapper)
    expect(patchRiskEvent).toHaveBeenCalledWith('9', { disposal: '盘中口头止损', effective: true })
    // 回填后行刷新为「处置有效」，补录控件随之消失
    expect(wrapper.text()).toContain('盘中口头止损')
    expect(wrapper.findAll('.rrp-backfill').length).toBe(1)
  })
})
