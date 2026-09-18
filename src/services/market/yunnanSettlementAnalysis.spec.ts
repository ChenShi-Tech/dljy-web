// 云南结算价页「综合结算均价（量费加权）」逻辑回归（#2992）。
// 守住的三条不变量：
// 1. 综合结算均价只直通服务端结算统计值（量费加权 Σ电费/Σ电量）——经典反例：
//    甲厂 10 MWh/1000 元（=100 元/MWh）+ 乙厂 30 MWh/6000 元（=200 元/MWh），
//    前端旧等权均值给 150，正确的量费加权是 7000/40=175。服务端给了 175，
//    前端序列就必须是 175；服务端失败时序列为空 + 中文原因，绝不出现 150。
// 2. 默认日期 = 北京时间「当天」；store 出厂默认（写死 2026-05-01）不算用户选择；
//    用户主动选的历史范围（含单日）原样尊重，不再强制拉回五月。
// 3. 「查看历史资料」入口只认真实覆盖区间（取不到为 null → 不编造覆盖）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/review/settlementAnalysis', () => ({
  fetchSettlementAnalysis: vi.fn()
}))

import { fetchSettlementAnalysis } from '@/services/review/settlementAnalysis'
import {
  describeWeightedFailure,
  fetchWeightedSettlementAvg,
  historyJumpRange,
  isHistoryRange,
  resolveInitialNodeDate,
  resolveInitialSettleRange,
  weightedAvgSeries,
  type SettlementAnalysis
} from '@/services/market/yunnanSettlementAnalysis'

// node 环境无 window（api→regionContext 顶层访问 localStorage），不静态 import ApiError；
// 403 场景用同形错误对象（describeWeightedFailure 只读 message，语义一致）。
function apiError403(message: string): Error {
  return Object.assign(new Error(message), { name: 'ApiError', status: 403, code: 403 })
}

const STORE_DEFAULT = ['2026-05-01', '2026-05-01'] as const

/** 服务端量费加权响应的形状骨架（只放测试关心的字段）。 */
function analysisOf(over: {
  daily?: Array<{ date: string; averagePrice: number | null }>
  buckets?: Array<{ key: string; averagePrice: number | null }>
  granularity?: 'week' | 'month'
}): SettlementAnalysis {
  return {
    periods: { current: { start: '2026-05-01', end: '2026-05-31' }, reference: { start: '2026-04-01', end: '2026-04-30' }, incomplete: false },
    availablePlants: [], selectedPlants: [],
    current: {
      energyMwh: 40, feeYuan: 7000, averagePrice: 175,
      longTermMwh: null, dayAheadIncrementMwh: null, realTimeIncrementMwh: null,
      coverage: { records: 2, energy: 2, fee: 2, paired: 2, longTerm: 0, dayAhead: 0, realTime: 0 },
      expectedPlantDays: 62,
      daily: (over.daily ?? []).map((d) => ({
        energyMwh: 40, feeYuan: 7000, averagePrice: d.averagePrice,
        longTermMwh: null, dayAheadIncrementMwh: null, realTimeIncrementMwh: null,
        coverage: { records: 2, energy: 2, fee: 2, paired: 2, longTerm: 0, dayAhead: 0, realTime: 0 },
        date: d.date
      })),
      ...(over.buckets
        ? {
            granularity: over.granularity,
            buckets: over.buckets.map((b) => ({
              key: b.key, start: b.key, end: b.key, days: 7, expectedPlantDays: 14,
              energyMwh: 40, feeYuan: 7000, averagePrice: b.averagePrice,
              longTermMwh: null, dayAheadIncrementMwh: null, realTimeIncrementMwh: null,
              coverage: { records: 2, energy: 2, fee: 2, paired: 2, longTerm: 0, dayAhead: 0, realTime: 0 }
            }))
          }
        : {}),
      plants: []
    },
    reference: {
      energyMwh: null, feeYuan: null, averagePrice: null,
      longTermMwh: null, dayAheadIncrementMwh: null, realTimeIncrementMwh: null,
      coverage: { records: 0, energy: 0, fee: 0, paired: 0, longTerm: 0, dayAhead: 0, realTime: 0 },
      expectedPlantDays: 62, daily: [], plants: []
    },
    comparison: { matchedPlantDays: 0, currentEnergyMwh: null, referenceEnergyMwh: null, currentFeeYuan: null, referenceFeeYuan: null },
    source: { type: 'business_source', version: 'x', mock: false, productionWrite: false },
    notice: ''
  } as unknown as SettlementAnalysis
}

beforeEach(() => {
  vi.mocked(fetchSettlementAnalysis).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('weightedAvgSeries：只直通服务端量费加权值', () => {
  it('day 粒度取 current.daily 的 averagePrice：服务端 175 就是 175，不是等权 150', () => {
    // 同一例子下若前端还在等权平均，两条厂站日(100/200)会得到 150；
    // 服务端已按 Σ电费/Σ电量 算成 175，序列必须原样 175。
    const analysis = analysisOf({ daily: [{ date: '2026-05-10', averagePrice: 175 }] })
    expect(weightedAvgSeries(analysis, 'day')).toEqual([{ key: '2026-05-10', price: 175 }])
  })

  it('week/month 粒度取 current.buckets 的 averagePrice（key=ISO 周一/月份）', () => {
    const analysis = analysisOf({
      granularity: 'month',
      buckets: [{ key: '2026-05', averagePrice: 175 }]
    })
    expect(weightedAvgSeries(analysis, 'month')).toEqual([{ key: '2026-05', price: 175 }])
  })

  it('桶内无成对记录 → price 为 null（不拉回 0，缺测断开）', () => {
    const analysis = analysisOf({ daily: [{ date: '2026-05-11', averagePrice: null }] })
    expect(weightedAvgSeries(analysis, 'day')).toEqual([{ key: '2026-05-11', price: null }])
  })

  it('week 粒度但服务端没带 buckets（异常响应）→ 空序列，不自行按日重算', () => {
    const analysis = analysisOf({ daily: [{ date: '2026-05-10', averagePrice: 175 }] })
    expect(weightedAvgSeries(analysis, 'week')).toEqual([])
  })

  it('analysis 为 null（尚未取得/失败清空）→ 空序列', () => {
    expect(weightedAvgSeries(null, 'day')).toEqual([])
  })
})

describe('fetchWeightedSettlementAvg：入参拼装与失败透传', () => {
  it('全部厂站：传 range + region=yunnan，不传 plants；day 粒度不传 granularity', async () => {
    vi.mocked(fetchSettlementAnalysis).mockResolvedValue(analysisOf({}))
    await fetchWeightedSettlementAvg({
      company: 'c1', plants: [], dateRange: ['2026-09-18', '2026-09-18'], aggregation: 'day',
      signal: new AbortController().signal
    })
    expect(vi.mocked(fetchSettlementAnalysis)).toHaveBeenCalledWith('c1', {
      region: 'yunnan',
      range: { start: '2026-09-18', end: '2026-09-18' }
    }, expect.any(AbortSignal))
    const input = vi.mocked(fetchSettlementAnalysis).mock.calls[0][1]
    expect('plants' in input).toBe(false)
    expect('granularity' in input).toBe(false)
  })

  it('单厂：plants=[厂名]；week 粒度传 granularity=week', async () => {
    vi.mocked(fetchSettlementAnalysis).mockResolvedValue(analysisOf({}))
    await fetchWeightedSettlementAvg({
      company: 'c1', plants: ['大唐B厂'], dateRange: ['2026-09-01', '2026-09-18'], aggregation: 'week'
    })
    const input = vi.mocked(fetchSettlementAnalysis).mock.calls[0][1]
    expect(input.plants).toEqual(['大唐B厂'])
    expect(input.granularity).toBe('week')
  })

  it('服务端 403：中文原因原样透传，序列被清空，不产生等权回退值', async () => {
    vi.mocked(fetchSettlementAnalysis).mockRejectedValue(
      apiError403('当前账号无权读取所选公司的资料')
    )
    await expect(
      fetchWeightedSettlementAvg({ company: 'c1', plants: [], dateRange: ['2026-05-01', '2026-05-31'], aggregation: 'day' })
    ).rejects.toThrow('当前账号无权读取所选公司的资料')
    // 失败路径下面板置 analysis=null → 序列空；展示原因带「结算统计不可用」前缀。
    expect(weightedAvgSeries(null, 'day')).toEqual([])
    expect(describeWeightedFailure(new Error('当前账号无权读取所选公司的资料'))).toBe(
      '结算统计不可用：当前账号无权读取所选公司的资料'
    )
  })

  it('未选公司/空日期：直接抛中文错误，不发请求', async () => {
    await expect(
      fetchWeightedSettlementAvg({ company: '', plants: [], dateRange: ['2026-05-01', '2026-05-31'], aggregation: 'day' })
    ).rejects.toThrow('尚未选择公司')
    await expect(
      fetchWeightedSettlementAvg({ company: 'c1', plants: [], dateRange: ['', ''], aggregation: 'day' })
    ).rejects.toThrow('请选择有效的起止日期')
    expect(vi.mocked(fetchSettlementAnalysis)).not.toHaveBeenCalled()
  })
})

describe('默认日期：北京时间当天，不写死五月', () => {
  beforeEach(() => {
    // 固定「今天」= 北京时间 2026-09-18（UTC 2026-09-17T20:00:00Z 即北京 09-18 04:00，
    // 恰好覆盖「UTC 还在今天前一天」的时段，防 UTC 口径回归）。
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T20:00:00Z'))
  })

  it('无选区/store 出厂默认 → 北京时间当天单日（不是 2026-05）', () => {
    expect(resolveInitialSettleRange(undefined, STORE_DEFAULT, '2026-09-18')).toEqual(['2026-09-18', '2026-09-18'])
    expect(resolveInitialSettleRange(STORE_DEFAULT, STORE_DEFAULT, '2026-09-18')).toEqual(['2026-09-18', '2026-09-18'])
    expect(resolveInitialSettleRange(['', ''], STORE_DEFAULT, '2026-09-18')).toEqual(['2026-09-18', '2026-09-18'])
  })

  it('用户主动选过的范围（含单日）原样尊重，不再强制拉回五月', () => {
    expect(resolveInitialSettleRange(['2026-05-15', '2026-05-15'], STORE_DEFAULT, '2026-09-18')).toEqual(['2026-05-15', '2026-05-15'])
    expect(resolveInitialSettleRange(['2026-07-01', '2026-07-31'], STORE_DEFAULT, '2026-09-18')).toEqual(['2026-07-01', '2026-07-31'])
  })

  it('节点电价快照日默认跟随范围末日', () => {
    expect(resolveInitialNodeDate(['2026-05-01', '2026-05-31'])).toBe('2026-05-31')
    expect(resolveInitialNodeDate(['2026-09-18', '2026-09-18'])).toBe('2026-09-18')
  })

  it('历史判定：范围末日早于今天 → 历史资料；当天不算历史', () => {
    expect(isHistoryRange(['2026-05-01', '2026-05-31'], '2026-09-18')).toBe(true)
    expect(isHistoryRange(['2026-09-18', '2026-09-18'], '2026-09-18')).toBe(false)
    expect(isHistoryRange(['2026-09-01', '2026-09-30'], '2026-09-18')).toBe(false)
  })
})

describe('查看历史资料：入口只认真实覆盖区间', () => {
  it('覆盖区间有效 → 跳转范围 = 覆盖起止', () => {
    expect(historyJumpRange({ start: '2026-05-01', end: '2026-05-31' })).toEqual(['2026-05-01', '2026-05-31'])
  })

  it('取不到覆盖（无权/未登记/接口失败）→ null，不编造覆盖', () => {
    expect(historyJumpRange(null)).toBeNull()
  })

  it('覆盖区间非法（start>end）→ null', () => {
    expect(historyJumpRange({ start: '2026-06-01', end: '2026-05-01' })).toBeNull()
  })
})
