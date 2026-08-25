// S1 市场复盘纯逻辑测试（#2012）：异常点判定、供需快照归一、关联提示、③维摘要、口径红线
import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_HINT_NOTE,
  attributionHintOf,
  fundamentalSnapshot,
  marketDimSummary,
  POLICY_DATA_GAP_NOTE,
  PRICE_ANOMALY_DEV_PCT,
  priceAnomalyPoints
} from './marketReview'
import type { MarketDigest } from '@/services/trading/marketDigest'
import type { FundamentalEntry } from '@/services/trading/fundamentalsClient'

function digestOf(prices: Array<number | null>, weightedAvg: number | null = null): MarketDigest {
  const priced = prices.filter((p): p is number => p !== null)
  return {
    sourceBasis: 'cleared',
    totalVolumeMwh: 100,
    openYuanPerMwh: prices[0] ?? null,
    closeYuanPerMwh: prices[23] ?? null,
    highYuanPerMwh: priced.length ? Math.max(...priced) : null,
    lowYuanPerMwh: priced.length ? Math.min(...priced) : null,
    highHour: null,
    lowHour: null,
    weightedAvgYuanPerMwh: weightedAvg,
    hourly: prices.map((p, hour) => ({ hour, volumeMwh: 10, priceYuanPerMwh: p }))
  }
}

function entry(field: FundamentalEntry['field'], value: number, source: FundamentalEntry['source_kind']): FundamentalEntry {
  return {
    slot_label: 'all-day',
    field,
    value_mw: value,
    source_kind: source,
    credibility: 'A',
    note: null,
    entered_by: 't',
    entered_at: '2026-08-25T08:00:00Z'
  }
}

describe('priceAnomalyPoints（异常高低点）', () => {
  it('偏离加权均值 ≥15% 的高低点各标出，方向正确', () => {
    // 均值口径由调用方传入：设 400；550 偏离 +37.5%，300 偏离 -25%，410/390 不越限
    const d = digestOf([400, 550, 410, 390, 300, ...Array(19).fill(400)], 400)
    const pts = priceAnomalyPoints(d)
    expect(pts).toHaveLength(2)
    expect(pts[0]).toMatchObject({ hour: 1, direction: 'high' })
    expect(pts[0].devPct).toBeCloseTo(0.375, 2)
    expect(pts[1]).toMatchObject({ hour: 4, direction: 'low' })
    expect(PRICE_ANOMALY_DEV_PCT).toBe(0.15)
  })

  it('负例：缺加权均价 / 有价小时 <4 → 空（不出半真结论）', () => {
    expect(priceAnomalyPoints(digestOf([100, 200], null))).toEqual([])
    expect(priceAnomalyPoints(digestOf([100, 500], 300))).toEqual([])
    expect(priceAnomalyPoints(null)).toEqual([])
  })
})

describe('fundamentalSnapshot（供需快照归一）', () => {
  it('四项映射正确；同字段多条取均值并注明；无记录如实占位', () => {
    const snap = fundamentalSnapshot([
      entry('system_load_mw', 9000, 'dispatch'),
      entry('renewable_forecast_mw', 3000, 'capture'),
      entry('renewable_forecast_mw', 2000, 'capture'),
      entry('net_import_mw', -500, 'company'),
    ])
    const byKey = Object.fromEntries(snap.map((s) => [s.key, s]))
    expect(byKey.load).toMatchObject({ valueMw: 9000, trusted: true })
    expect(byKey.renewable).toMatchObject({ valueMw: 2500, trusted: true })
    expect(byKey.renewable.note).toContain('2 条按均值')
    expect(byKey.netImport).toMatchObject({ valueMw: -500, trusted: false }) // company=自报口径
    expect(byKey.dispatchable.valueMw).toBeNull()
    expect(byKey.dispatchable.note).toContain('无记录')
  })

  it('label 明示「预测出力/近似」口径，不装作偏差或实际', () => {
    const snap = fundamentalSnapshot([])
    expect(snap.find((s) => s.key === 'renewable')?.label).toContain('预测')
    expect(snap.find((s) => s.key === 'dispatchable')?.label).toContain('近似')
  })
})

describe('attributionHintOf（关联提示，非因果）', () => {
  it('高点：新能源占比低/净受入为负给提示；低点：新能源占比高给提示', () => {
    const snap = fundamentalSnapshot([
      entry('system_load_mw', 10000, 'dispatch'),
      entry('renewable_forecast_mw', 1000, 'dispatch'), // 占比 10% < 20%
      entry('net_import_mw', -300, 'dispatch'),
    ])
    const high = attributionHintOf({ hour: 19, priceYuanPerMwh: 550, devPct: 0.375, direction: 'high' }, snap)
    expect(high).toContain('19:00')
    expect(high).toContain('新能源占比低')
    expect(high).toContain('受入减少')
    const lowSnap = fundamentalSnapshot([
      entry('system_load_mw', 10000, 'dispatch'),
      entry('renewable_forecast_mw', 5000, 'dispatch'), // 占比 50% > 30%
    ])
    const low = attributionHintOf({ hour: 3, priceYuanPerMwh: 200, devPct: -0.4, direction: 'low' }, lowSnap)
    expect(low).toContain('新能源占比高')
  })

  it('口径红线文案：明示关联非因果 / data_gap 不装作有数据', () => {
    expect(ATTRIBUTION_HINT_NOTE).toContain('非归因结论')
    expect(POLICY_DATA_GAP_NOTE).toContain('data_gap')
  })
})

describe('marketDimSummary（六维③维）', () => {
  it('有价+有基本面 → ready；有价无基本面 → 待 S2 录入；缺价 → 不 ready', () => {
    const d = digestOf(Array(24).fill(400), 400)
    expect(marketDimSummary(d, fundamentalSnapshot([entry('system_load_mw', 1, 'manual')])).ready).toBe(true)
    const noFund = marketDimSummary(d, fundamentalSnapshot([]))
    expect(noFund.ready).toBe(false)
    expect(noFund.summary).toContain('待 S2 录入')
    const noPrice = marketDimSummary(digestOf(Array(24).fill(null), null), [])
    expect(noPrice.ready).toBe(false)
    expect(noPrice.summary).toContain('无基准')
  })
})
