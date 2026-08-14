import { describe, expect, it } from 'vitest'
import {
  aggregateIntradayEnvelope,
  calculateDisclosureMape,
  dedupeInterProvincialForecastRows,
  getDisclosurePeriodWindow,
  pairForecastActual,
  resolveDisclosureWindow,
  splitDisclosureWindow,
  shiftDisclosurePeriod,
  shiftDisclosureWindow
} from './disclosureChart'

describe('disclosure chart period windows', () => {
  it('computes day, Monday-based week, and natural month boundaries', () => {
    expect(getDisclosurePeriodWindow('2026-03-04', 'day')).toMatchObject({ from: '2026-03-04', to: '2026-03-04' })
    expect(getDisclosurePeriodWindow('2026-03-04', 'week')).toMatchObject({ from: '2026-03-02', to: '2026-03-08' })
    expect(getDisclosurePeriodWindow('2026-02-14', 'month')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('moves across month and year boundaries', () => {
    const month = getDisclosurePeriodWindow('2026-01-15', 'month')
    expect(shiftDisclosurePeriod(month, 'month', -1)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
    expect(shiftDisclosurePeriod(getDisclosurePeriodWindow('2026-12-31', 'week'), 'week', 1).from).toBe('2027-01-04')
    expect(shiftDisclosureWindow('2026-01-30', '2026-02-02', 'month', 1)).toMatchObject({ from: '2026-02-28', to: '2026-03-03' })
  })

  it('splits a month across calendar boundaries without gaps or overlap', () => {
    expect(splitDisclosureWindow('2026-01-29', '2026-02-03', 'month', 3)).toEqual([
      { from: '2026-01-29', to: '2026-01-31', label: '2026-01' },
      { from: '2026-02-01', to: '2026-02-03', label: '2026-02' }
    ])
  })

  it('keeps a single day as one chunk and returns no chunks for an empty window', () => {
    expect(splitDisclosureWindow('2026-03-04', '2026-03-04', 'day')).toEqual([
      { from: '2026-03-04', to: '2026-03-04', label: '2026-03-04' }
    ])
    expect(splitDisclosureWindow('2026-03-05', '2026-03-04', 'month')).toEqual([])
  })

  it('converges an oversized custom window to the latest bounded chunks', () => {
    const resolution = resolveDisclosureWindow('2026-01-01', '2026-12-31', 'day', 7, 16)
    expect(resolution.requestedChunkCount).toBe(365)
    expect(resolution.constrained).toBe(true)
    expect(resolution.retainedChunkCount).toBe(16)
    expect(resolution.retainedDays).toBe(16)
    expect(resolution.window).toMatchObject({ from: '2026-12-16', to: '2026-12-31' })
    expect(resolution.chunks).toHaveLength(16)
  })

  it('does not converge a window within the chunk cap', () => {
    const resolution = resolveDisclosureWindow('2026-03-01', '2026-03-04', 'day', 7, 16)
    expect(resolution.constrained).toBe(false)
    expect(resolution.window).toMatchObject({ from: '2026-03-01', to: '2026-03-04' })
    expect(resolution.chunks).toHaveLength(4)
  })
})

describe('disclosure forecast and actual pairing', () => {
  const rows = (values: Array<{ date: string; timePoint: string; region: string; value: number }>) =>
    values.map((row) => ({ operateDate: row.date, ...row }))

  it('pairs by date and time point, preferring Yunnan', () => {
    const pairs = pairForecastActual(
      rows([{ date: '2026-03-01', timePoint: '00:00', region: 'yn', value: 110 }]),
      rows([{ date: '2026-03-01', timePoint: '00:00', region: 'yn', value: 100 }])
    )
    expect(pairs).toEqual([{ date: '2026-03-01', timePoint: '00:00', region: 'yn', forecast: 110, actual: 100 }])
    expect(calculateDisclosureMape(pairs)).toBe(10)
  })

  it('falls back to all-region rows and skips missing/near-zero pairs', () => {
    const pairs = pairForecastActual(
      rows([
        { date: '2026-03-01', timePoint: '01:00', region: 'yn', value: 999 },
        { date: '2026-03-01', timePoint: '00:00', region: 'all', value: 120 },
        { date: '2026-03-01', timePoint: '00:15', region: 'all', value: 300 }
      ]),
      rows([
        { date: '2026-03-01', timePoint: '01:15', region: 'yn', value: 888 },
        { date: '2026-03-01', timePoint: '00:00', region: 'all', value: 100 },
        { date: '2026-03-01', timePoint: '00:30', region: 'all', value: 0 }
      ])
    )
    expect(pairs).toHaveLength(1)
    expect(calculateDisclosureMape(pairs)).toBe(20)
    expect(calculateDisclosureMape([])).toBeNull()
  })
})

describe('intraday price envelope', () => {
  it('aggregates normal and empty inputs across days', () => {
    expect(aggregateIntradayEnvelope([
      { date: '2026-03-01', timePoint: '00:00', value: 10 },
      { date: '2026-03-02', timePoint: '00:00', value: 14 },
      { date: '2026-03-01', timePoint: '00:15', value: 12 }
    ])).toEqual([
      { timePoint: '00:00', min: 10, mean: 12, max: 14, count: 2 },
      { timePoint: '00:15', min: 12, mean: 12, max: 12, count: 1 }
    ])
    expect(aggregateIntradayEnvelope([])).toEqual([])
  })

  it('deduplicates repeated date, time point, and region keys before aggregation', () => {
    expect(aggregateIntradayEnvelope([
      { date: '2026-03-01', timePoint: '00:00', region: 'all', value: 10 },
      { date: '2026-03-01', timePoint: '00:00', region: 'all', value: 14 },
      { date: '2026-03-01', timePoint: '00:00', region: 'yn', value: 100 },
      { date: '2026-03-02', timePoint: '00:00', region: 'all', value: 16 }
    ])).toEqual([
      { timePoint: '00:00', min: 14, mean: 130 / 3, max: 100, count: 3 }
    ])
  })
})

describe('inter-provincial forecast duplicate rows', () => {
  it('keeps the last row for the same date, time point, section, and metric', () => {
    const rows = [
      { targetDate: '2026-03-01', timePoint: '00:00', region: '云南送出断面', metric: 'send', value: 100 },
      { targetDate: '2026-03-01', timePoint: '00:00', region: '云南送出断面', metric: 'send', value: 135 },
      { targetDate: '2026-03-01', timePoint: '00:00', region: '云南受入断面', metric: 'send', value: 40 },
      { targetDate: '2026-03-01', timePoint: '00:00', region: '云南送出断面', metric: 'receive', value: 20 }
    ]
    expect(dedupeInterProvincialForecastRows(rows)).toEqual([rows[1], rows[2], rows[3]])
  })
})
