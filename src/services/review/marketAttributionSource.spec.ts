// 月度市场归因真实取数测试（#3392）
// 守的不变量：① 地区分流——云南价格只走 yn_system_forecast/da_user_price（fetchCaptured），
// 山西等其余地区只走 sdpt_zcqxhdl 契约（日前 rq·p3），绝不串族；② 月均聚合跨月/跨年
// 边界正确、null/NaN/缺日期跳过不进分母；③ 负荷年份来自 years[i]（确定性解析），
// 非闰年 2月29日空槽跳过、年份解析不出的行整行放弃（绝不猜年份）；④ 任一来源失败
// 只让对应序列为空、不抛、不合成；mock 信封不采纳。
// 坏掉的症状：归因面板读到他省口径或合成数据、月份错位/拼错年份、单来源失败拖垮整面板。
// issue：ChenShi-Tech/dljy#3392。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { fetchCapturedMock, priceContractMock, loadContractMock } = vi.hoisted(() => ({
  fetchCapturedMock: vi.fn(),
  priceContractMock: vi.fn(),
  loadContractMock: vi.fn()
}))

vi.mock('@/services/captured', () => ({ fetchCaptured: fetchCapturedMock }))
vi.mock('@/services/data/contracts', () => ({
  fetchMarketInsightPriceAnalysisContract: priceContractMock,
  fetchMarketInsightActualLoadContract: loadContractMock
}))

import { attributionMonths, fetchMarketAttributionSource } from './marketAttributionSource'
import type { MarketInsightActualLoadContract, MarketInsightPriceAnalysisContract } from '@/services/data/contracts'

function priceContract(status: string, dailyStats: Array<{ market: string; date: string; avg: number | null }>): MarketInsightPriceAnalysisContract {
  return { blocks: { price_analysis: { status, dailyStats } } } as unknown as MarketInsightPriceAnalysisContract
}

function loadContract(nameList: string[], years: string[], mat: Array<Array<number | null>>): MarketInsightActualLoadContract {
  return {
    blocks: {
      actual_load: {
        status: 'real',
        sources: { system: { nameList, years, metrics: { average: mat } }, misplace: null }
      }
    }
  } as unknown as MarketInsightActualLoadContract
}

const MONTH = '2026-03'

beforeEach(() => {
  fetchCapturedMock.mockReset()
  priceContractMock.mockReset()
  loadContractMock.mockReset()
  // 缺省给「无数据但成功」的负荷契约，未显式安排时不干扰价格用例的断言。
  loadContractMock.mockResolvedValue(loadContract([], [], []))
})

describe('attributionMonths（12 个月滚动窗口）', () => {
  it('复盘月及此前共 12 个月、升序、含复盘月', () => {
    const months = attributionMonths('2026-03')
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-04')
    expect(months[11]).toBe('2026-03')
    expect(months).toEqual([...months].sort())
  })

  it('1 月跨年：上一年 2 月起步', () => {
    const months = attributionMonths('2026-01')
    expect(months[0]).toBe('2025-02')
    expect(months[11]).toBe('2026-01')
  })

  it('非法月份返回空数组（不猜）', () => {
    expect(attributionMonths('bad')).toEqual([])
    expect(attributionMonths('2026-13')).toEqual([])
  })
})

describe('云南价格分支（yn_system_forecast·da_user_price）', () => {
  it('走 fetchCaptured（12 个月窗口一次拉取），按月对有效值求均值；契约函数不被调用', async () => {
    fetchCapturedMock.mockResolvedValue({
      sourceType: 'DB',
      data: [
        { operateDate: '2026-03-01', timePoint: '00:00', value: 100 },
        { operateDate: '2026-03-01', timePoint: '01:00', value: 200 },
        { operateDate: '2026-03-02', timePoint: '00:00', value: 300 }, // 2026-03 → (100+200+300)/3 = 200
        { operateDate: '2026-02-05', timePoint: '00:00', value: null },
        { operateDate: '2026-02-06', timePoint: '00:00', value: 300 }, // null 跳过 → 300
        { operateDate: '2025-12-31', timePoint: '00:00', value: 50 },
        { operateDate: '2025-12-31', timePoint: '01:00', value: 51 }, // 跨年边界月 → 50.5
        { value: 999 } // 缺 operateDate：归不进月份，跳过
      ]
    })
    const src = await fetchMarketAttributionSource({ region: 'yunnan', month: MONTH })

    expect(fetchCapturedMock).toHaveBeenCalledTimes(1)
    const [family, match, filter] = fetchCapturedMock.mock.calls[0]
    expect(family).toBe('yn_system_forecast')
    expect(match).toBe('da_user_price')
    expect(filter).toMatchObject({ dateFrom: '2025-04-01', dateTo: '2026-03-31', region: 'yunnan' })
    expect(priceContractMock).not.toHaveBeenCalled()

    expect(src.points).toHaveLength(12)
    expect(src.points[11]).toMatchObject({ month: '2026-03', spotPrice: 200 })
    const byMonth = Object.fromEntries(src.points.map((p) => [p.month, p.spotPrice]))
    expect(byMonth['2026-02']).toBe(300)
    expect(byMonth['2025-12']).toBeCloseTo(50.5)
    expect(byMonth['2026-01']).toBeNull() // 无数据月诚实 null
    expect(src.priceSource).toMatchObject({ family: 'yn_system_forecast·da_user_price', basis: 'captured', label: '日前用户侧电价' })
  })

  it('mock/未知来源信封不采纳 → 价格 empty（真实或空）', async () => {
    fetchCapturedMock.mockResolvedValue({ mock: true, sourceType: 'MOCK', data: [{ operateDate: '2026-03-01', value: 123 }] })
    const src = await fetchMarketAttributionSource({ region: 'yunnan', month: MONTH })
    expect(src.points[11].spotPrice).toBeNull()
    expect(src.priceSource.basis).toBe('empty')
  })

  it('fetchCaptured 失败 → 价格 empty 但负荷正常，不抛不合成', async () => {
    fetchCapturedMock.mockRejectedValue(new Error('502'))
    loadContractMock.mockResolvedValue(
      loadContract(['3月1日'], ['2026年'], [[400]])
    )
    const src = await fetchMarketAttributionSource({ region: 'yunnan', month: MONTH })
    expect(src.priceSource.basis).toBe('empty')
    expect(src.points[11]).toMatchObject({ month: '2026-03', spotPrice: null, avgLoad: 400 })
  })
})

describe('山西价格分支（sdpt_zcqxhdl 日前 p3）', () => {
  it('走价格分析契约的 rq 逐日均价，ss 不采纳；fetchCaptured 不被调用', async () => {
    priceContractMock.mockResolvedValue(
      priceContract('real', [
        { market: 'rq', date: '2026-03-01', avg: 300 },
        { market: 'rq', date: '2026-03-02', avg: 400 }, // 2026-03 → 350
        { market: 'rq', date: '2026-02-20', avg: null }, // null 跳过
        { market: 'ss', date: '2026-03-01', avg: 999 } // 实时价不进日前口径
      ])
    )
    const src = await fetchMarketAttributionSource({ region: 'shanxi', month: MONTH })

    expect(priceContractMock).toHaveBeenCalledWith({ region: 'shanxi' })
    expect(fetchCapturedMock).not.toHaveBeenCalled()
    expect(src.points[11]).toMatchObject({ month: '2026-03', spotPrice: 350 })
    expect(src.points[10].spotPrice).toBeNull() // 2026-02 全 null
    expect(src.priceSource).toMatchObject({ basis: 'captured', label: '日前全省均价' })
  })

  it('契约 status 非 real（mock/missing）→ 价格 empty', async () => {
    priceContractMock.mockResolvedValue(priceContract('mock', [{ market: 'rq', date: '2026-03-01', avg: 300 }]))
    const src = await fetchMarketAttributionSource({ region: 'shanxi', month: MONTH })
    expect(src.priceSource.basis).toBe('empty')
    expect(src.points[11].spotPrice).toBeNull()
  })

  it('地区分支对调防护：山西绝不发 yn_system_forecast 请求', async () => {
    priceContractMock.mockResolvedValue(priceContract('real', []))
    await fetchMarketAttributionSource({ region: 'shanxi', month: MONTH })
    expect(fetchCapturedMock).not.toHaveBeenCalled()
    expect(priceContractMock).toHaveBeenCalledTimes(1)
  })
})

describe('其它地区（真实或空，不串读）', () => {
  it('契约 missing（能力外地区不发请求）→ 三序列为空、价格/负荷 empty', async () => {
    priceContractMock.mockResolvedValue(priceContract('missing', []))
    loadContractMock.mockResolvedValue(loadContract([], [], []))
    const src = await fetchMarketAttributionSource({ region: 'sichuan', month: MONTH })
    expect(src.points).toHaveLength(12)
    expect(src.points.every((p) => p.spotPrice === null && p.avgLoad === null)).toBe(true)
    expect(src.priceSource.basis).toBe('empty')
    expect(src.loadSource.basis).toBe('empty')
    expect(fetchCapturedMock).not.toHaveBeenCalled()
  })
})

describe('月均负荷聚合（sdpt_actualLoad）', () => {
  it('years[i] ↔ 矩阵第 i 行：跨年归月正确、非闰年 2月29日跳过、null 跳过', async () => {
    loadContractMock.mockResolvedValue(
      loadContract(
        ['12月30日', '12月31日', '1月1日', '2月28日', '2月29日', '3月1日'],
        ['2025年', '2026年'],
        [
          [100, 110, null, null, null, null], // 2025-12 → (100+110)/2 = 105；2026-01 值为 null 不入
          [null, null, 300, 200, 9, 400] // 2026-01 → 300；2026-02 → (200+400)/2=300（2/29 非闰年跳过）；2026-03 → 400
        ]
      )
    )
    const src = await fetchMarketAttributionSource({ region: 'yunnan', month: MONTH })
    const byMonth = Object.fromEntries(src.points.map((p) => [p.month, p.avgLoad]))
    expect(byMonth['2025-12']).toBe(105)
    expect(byMonth['2026-01']).toBe(300)
    expect(byMonth['2026-02']).toBe(200) // 只有 2月28日 值有效（9 在假 2/29 槽位，未混入）
    expect(byMonth['2026-03']).toBe(400)
    expect(src.loadSource).toMatchObject({ family: 'sdpt_actualLoad', basis: 'captured' })
  })

  it('years 标签解析不出年份 → 该行整行放弃（绝不猜年份），全空则负荷 empty', async () => {
    loadContractMock.mockResolvedValue(loadContract(['1月1日'], ['未知'], [[123]]))
    const src = await fetchMarketAttributionSource({ region: 'yunnan', month: MONTH })
    expect(src.points.every((p) => p.avgLoad === null)).toBe(true)
    expect(src.loadSource.basis).toBe('empty')
  })

  it('负荷契约失败 → 负荷 empty 但价格正常，不抛', async () => {
    loadContractMock.mockRejectedValue(new Error('timeout'))
    priceContractMock.mockResolvedValue(priceContract('real', [{ market: 'rq', date: '2026-03-01', avg: 320 }]))
    const src = await fetchMarketAttributionSource({ region: 'shanxi', month: MONTH })
    expect(src.loadSource.basis).toBe('empty')
    expect(src.points[11]).toMatchObject({ spotPrice: 320, avgLoad: null })
  })

  it('负荷契约 mock 合成（缺自身采集地区落 mock:true 信封）→ 不采纳、负荷 empty', async () => {
    loadContractMock.mockResolvedValue({
      blocks: { actual_load: { status: 'mock', sources: { system: { nameList: ['1月1日'], years: ['2026年'], metrics: { average: [[123]] } }, misplace: null } } }
    } as unknown as MarketInsightActualLoadContract)
    const src = await fetchMarketAttributionSource({ region: 'sichuan', month: MONTH })
    expect(src.loadSource.basis).toBe('empty')
    expect(src.points.every((p) => p.avgLoad === null)).toBe(true)
  })
})
