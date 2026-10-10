// 结算价聚合回归（云南现货 S5）：周/月聚合与「真实或空」纪律。
// 守住的不变量：
// 1. weekKey 是 ISO 周一分组，2026-01-01（周四）必须归入 2025-12-29（周一）那周；
// 偏一天就会把跨年周劈成两半，图上出现假拐点。
// 2. null 缺测不进均值、组内全 null → null（缺测不连线、绝不拉回 0 元/MWh 假信号）。
// 3. loadSettlementPrices 空态不抛：云南属严格地区，读不到真实数据 → hasData=false
// 由页面渲染空态；mock 信封/网络错误若抛错 = 整个结算页崩。
// 4. plantCount 跨日累加、组间按时间排序（x 轴时序）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/captured', () => ({
  fetchCaptured: vi.fn(),
}))

import { fetchCaptured } from '@/services/captured'
import { aggregatePoints, loadSettlementPrices, type SettlementPricePoint } from '@/services/market/settlementClient'

function pt(date: string, over: Partial<SettlementPricePoint> = {}): SettlementPricePoint {
  return { date, daPrice: 100, rtPrice: 100, sampleAvgPrice: 100, ltmPrice: 100, plantCount: 1, ...over }
}

beforeEach(() => {
  vi.mocked(fetchCaptured).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('aggregatePoints', () => {
  it('day 粒度原样返回（同一引用，不重算）', () => {
    const points = [pt('2026-05-01'), pt('2026-05-02')]
    expect(aggregatePoints(points, 'day')).toBe(points)
  })

  it('week 按 ISO 周一分组：2026-01-01（周四）归入 2025-12-29（周一）那周（手算对拍）', () => {
    // 跨年一周：12-30（周二）/ 01-01（周四）/ 01-03（周六）同属 2025-12-29 周一那周
    const out = aggregatePoints([
      pt('2025-12-30', { daPrice: 300, rtPrice: 200, plantCount: 2 }),
      pt('2026-01-01', { daPrice: 100, rtPrice: null, plantCount: 1 }),
      pt('2026-01-03', { daPrice: 200, rtPrice: 100, plantCount: 3 }),
      pt('2026-01-05', { daPrice: null, rtPrice: null, plantCount: 2 }), // 下周一，另起一组
    ], 'week')
    expect(out.map((p) => p.date)).toEqual(['2025-12-29 周', '2026-01-05 周'])
    const w1 = out[0]
    expect(w1.daPrice).toBe(200) // (300+100+200)/3
    expect(w1.rtPrice).toBe(150) // null 不计入：(200+100)/2
    expect(w1.plantCount).toBe(6) // 2+1+3 累加
    const w2 = out[1]
    expect(w2.daPrice).toBeNull() // 组内全缺测 → null，不拉回 0
    expect(w2.rtPrice).toBeNull()
    expect(w2.plantCount).toBe(2)
  })

  it('单维度缺测只影响该维度：da null 而 rt 正常 → da null、rt 照算', () => {
    const out = aggregatePoints([
      pt('2026-03-02', { daPrice: null, rtPrice: 100 }),
      pt('2026-03-03', { daPrice: null, rtPrice: 300 }),
    ], 'week')
    expect(out).toHaveLength(1)
    expect(out[0].daPrice).toBeNull()
    expect(out[0].rtPrice).toBe(200)
  })

  it('0 值样本被剔除（0 是缺测占位不是真 0 价）', () => {
    const out = aggregatePoints([pt('2026-03-02', { daPrice: 100 }), pt('2026-03-09', { daPrice: 0 })], 'week')
    expect(out).toHaveLength(2)
    expect(out[0].daPrice).toBe(100)
    expect(out[1].daPrice).toBeNull() // 全 0 → 无有效样本 → null
  })

  it('month 按自然月分组、组间排序', () => {
    const out = aggregatePoints([
      pt('2026-02-01', { daPrice: 60 }),
      pt('2026-01-31', { daPrice: 40 }),
      pt('2026-01-01', { daPrice: 20 }),
    ], 'month')
    expect(out.map((p) => p.date)).toEqual(['2026-01 月', '2026-02 月'])
    expect(out[0].daPrice).toBe(30)
    expect(out[1].daPrice).toBe(60)
  })

  it('空输入原样返回', () => {
    expect(aggregatePoints([], 'week')).toEqual([])
  })
})

describe('loadSettlementPrices', () => {
  function envelope(rows: unknown[], over: Record<string, unknown> = {}) {
    return {
      data: rows,
      provenance: { sourceType: 'REAL', realDataConnected: true, capturedAt: '2026-06-01T00:00:00Z' },
      ...over,
    }
  }

  function row(over: Record<string, unknown> = {}) {
    return {
      date: '2026-05-10', plant: '华能A厂', daPrice: 300, rtPrice: 200, avgPrice: 250, ltmPrice: 220,
      ...over,
    }
  }

  it('真实信封：按日聚合等权均值 + 元信息透传', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([
      row({ plant: '华能A厂', daPrice: 300, rtPrice: 200 }),
      row({ plant: '大唐B厂', daPrice: 100, rtPrice: 100 }),
    ]))
    const r = await loadSettlementPrices()
    expect(r.points).toEqual([{
      date: '2026-05-10',
      daPrice: 200, // (300+100)/2 等权
      rtPrice: 150,
      sampleAvgPrice: 250,
      ltmPrice: 220,
      plantCount: 2,
    }])
    expect(r).toMatchObject({
      basis: 'captured', hasData: true, sourceType: 'REAL', mock: false,
      updatedAt: '2026-06-01T00:00:00Z', matchedPlant: null,
    })
    expect(r.plantOptions).toEqual(['大唐B厂', '华能A厂']) // zh-CN 拼音序：da < hua
    // 取数参数：族/数据集/地区；缺省区间不再内置演示月（#2992）→ 空串=不过滤日期
    expect(vi.mocked(fetchCaptured)).toHaveBeenCalledWith(
      'yn_spot_settlement', 'yn_settlement_daily',
      { region: 'yunnan', dateFrom: '', dateTo: '' }
    )
  })

  it('电厂筛选只影响聚合，plantOptions 仍是全量（下拉稳定）', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([
      row({ plant: '华能A厂', daPrice: 300 }),
      row({ plant: '大唐B厂', daPrice: 100, date: '2026-05-11' }),
    ]))
    const r = await loadSettlementPrices({ plant: '大唐B厂' })
    expect(r.points).toHaveLength(1)
    expect(r.points[0]).toMatchObject({ date: '2026-05-11', daPrice: 100, plantCount: 1 })
    expect(r.plantOptions).toEqual(['大唐B厂', '华能A厂']) // zh-CN 拼音序：da < hua
    expect(r.matchedPlant).toBe('大唐B厂')
  })

  it('plantCandidates：未显式选厂时取第一个在数据中出现的候选', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([row({ plant: '大唐B厂' })]))
    const r = await loadSettlementPrices({ plantCandidates: ['不存在的厂', '大唐B厂', '华能A厂'] })
    expect(r.matchedPlant).toBe('大唐B厂')
    expect(r.points[0].plantCount).toBe(1) // 只聚合大唐B厂
  })

  it('日界外行被过滤（闭区间）', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([
      row({ date: '2026-05-31' }),
      row({ date: '2026-06-01' }), // 右开
      row({ date: '2026-05-31', plant: 'x' }), // 边界日内两厂都算
    ]))
    const r = await loadSettlementPrices({ dateRange: ['2026-05-01', '2026-05-31'] })
    expect(r.points).toHaveLength(1)
    expect(r.points[0].plantCount).toBe(2)
  })

  it('mock 信封 → 空态不抛（真实或空，不展示合成结算价）', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([row()], { mock: true, provenance: { realDataConnected: true } }))
    const r = await loadSettlementPrices()
    expect(r).toMatchObject({ basis: 'empty', hasData: false, points: [], mock: true })
  })

  it('realDataConnected=false → 空态', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([row()], { provenance: { realDataConnected: false } }))
    const r = await loadSettlementPrices()
    expect(r.hasData).toBe(false)
  })

  it('fetchCaptured 网络失败 → 上抛失败态（失败≠未摄取，不再吞错置空）', async () => {
    // slim-and-fix-market-insight-pages R2：吞错置空会把接口故障伪装成「族未摄取、
    // 请先跑 ETL」误导排查方向；三个调用方（结算价面板/驾驶舱 safe/厂站属性）都有错误通道。
    vi.mocked(fetchCaptured).mockRejectedValue(new Error('network down'))
    await expect(loadSettlementPrices()).rejects.toThrow('结算数据读取失败：network down')
  })

  it('fetchCaptured 404/空类错误 → 同样上抛（原文保留，供调用方按空态分类）', async () => {
    vi.mocked(fetchCaptured).mockRejectedValue(new Error('capture family not found: yn_spot_settlement (404)'))
    await expect(loadSettlementPrices()).rejects.toThrow('结算数据读取失败：capture family not found: yn_spot_settlement (404)')
  })

  it('行内 null 价经 toNum 落 0 再被均值剔除 → 该维度 null', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue(envelope([row({ daPrice: null, rtPrice: 100 })]))
    const r = await loadSettlementPrices()
    expect(r.points[0].daPrice).toBeNull()
    expect(r.points[0].rtPrice).toBe(100)
  })
})
