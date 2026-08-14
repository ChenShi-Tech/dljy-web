import { describe, expect, it } from 'vitest'
import { buildWeatherTracks, decisionAtForTrack, selectWeatherRowsAsOf, weatherPointEvidenceTitle, type WeatherAsOfRow } from './weatherTracks'

function row(overrides: Partial<WeatherAsOfRow> = {}): WeatherAsOfRow {
  return {
    provider: 'open-meteo-previous-runs',
    forecastRunId: 'run-safe',
    modelVersion: 'ecmwf_ifs025:operational-archive',
    featureVersion: 'weather-asof-open-meteo-v1',
    forecastAt: '2026-05-02T11:00:00+08:00',
    validAt: '2026-05-03T00:00:00+08:00',
    ingestedAt: '2026-07-24T00:00:00Z',
    regionId: 'yunnan',
    stationId: 'YN-KUNMING',
    leadHours: 24,
    values: { wind_speed_100m: 7 },
    sourceType: 'REAL',
    basis: 'captured',
    mock: false,
    productionWrite: false,
    rawVersionId: 'raw-safe',
    ...overrides,
  }
}

describe('weather as-of timeline', () => {
  it('derives stable D-2/D-1/intraday decision cutoffs in Asia/Shanghai', () => {
    expect(decisionAtForTrack('2026-05-03', 'd2', 12)).toBe('2026-05-01T04:00:00.000Z')
    expect(decisionAtForTrack('2026-05-03', 'd1', 12)).toBe('2026-05-02T04:00:00.000Z')
    expect(decisionAtForTrack('2026-05-03', 'intraday', 12)).toBe('2026-05-03T04:00:00.000Z')
  })

  it('rejects revisions released after the decision cutoff and keeps the latest eligible version', () => {
    const futureRevision = row({ forecastRunId: 'run-future', rawVersionId: 'raw-future', forecastAt: '2026-05-02T13:00:00+08:00', values: { wind_speed_100m: 99 } })
    const older = row({ forecastRunId: 'run-old', rawVersionId: 'raw-old', forecastAt: '2026-05-02T09:00:00+08:00', values: { wind_speed_100m: 5 } })
    const selected = selectWeatherRowsAsOf([older, row(), futureRevision], {
      decisionAt: decisionAtForTrack('2026-05-03', 'd1', 12),
      targetDate: '2026-05-03', regionId: 'yunnan', stationId: 'YN-KUNMING',
    })
    expect(selected.rejected.futureForecastAt).toBe(1)
    expect(selected.selected).toHaveLength(1)
    expect(selected.selected[0]?.forecastRunId).toBe('run-safe')
  })

  it('fails closed on wrong region, mock, ERA5 basis, timezone-less timestamps, and invalid time order', () => {
    const selected = selectWeatherRowsAsOf([
      row({ regionId: 'shanxi' }),
      row({ mock: true, sourceType: 'MOCK' }),
      row({ basis: 'era5_actual' }),
      row({ forecastAt: '2026-05-02T11:00:00' }),
      row({ validAt: '2026-05-02T10:00:00+08:00' }),
    ], {
      decisionAt: decisionAtForTrack('2026-05-03', 'd1', 12),
      targetDate: '2026-05-03', regionId: 'yunnan', stationId: 'YN-KUNMING',
    })
    expect(selected.selected).toEqual([])
    expect(selected.rejected).toEqual({ invalidContract: 2, scopeMismatch: 1, nonReal: 2, futureForecastAt: 0, outsideHorizon: 0 })
    expect(selectWeatherRowsAsOf([row()], {
      decisionAt: decisionAtForTrack('2026-05-03', 'd1', 12),
      targetDate: '2026-05-03', regionId: 'yunnan', stationId: null,
    }).selected).toEqual([])
  })

  it('preserves explicit missing hours and exposes point-level forecastAt/sourceRef evidence', () => {
    const tracks = buildWeatherTracks({
      forecastRows: [row()], actualValues: Array(24).fill(null), actualSourceType: 'CAPTURED',
      plantType: 'wind', targetDate: '2026-05-03', regionId: 'yunnan', stationId: 'YN-KUNMING', decisionHour: 12,
    })
    const d1 = tracks[1]!
    expect(d1).toMatchObject({ status: 'partial', availableHours: 1, expectedHours: 24, asOfSafeForDisplay: true, asOfSafeForForecastBacktest: false })
    expect(d1.points[0]).toMatchObject({ status: 'available', value: 7, forecastAt: '2026-05-02T11:00:00+08:00', sourceRef: 'raw-safe' })
    expect(d1.points[1]).toMatchObject({ status: 'missing', value: null, forecastAt: null })
  })

  it('marks hours already realized at an intraday cutoff as outside the forecast horizon', () => {
    const tracks = buildWeatherTracks({
      forecastRows: [], actualValues: [1, ...Array(23).fill(null)], actualSourceType: 'CAPTURED',
      plantType: 'wind', targetDate: '2026-05-03', regionId: 'yunnan', stationId: 'YN-KUNMING', decisionHour: 12,
    })
    expect(tracks[2]?.points[12]?.status).toBe('outside-forecast-horizon')
    expect(tracks[2]?.points[13]?.status).toBe('missing')
    expect(tracks[3]).toMatchObject({ id: 'actual', status: 'partial', asOfSafeForForecastBacktest: false })
    expect(weatherPointEvidenceTitle('actual', 'available')).toBe('实现后实况点（非 as-of 预报）')
    expect(weatherPointEvidenceTitle('d1', 'available')).toBe('该点通过 as-of 时间门')
  })

  it('measures provider divergence only after applying the same as-of cutoff', () => {
    const secondProvider = row({ provider: 'provider-b', forecastRunId: 'run-b', rawVersionId: 'raw-b', values: { wind_speed_100m: 9 } })
    const d1 = buildWeatherTracks({
      forecastRows: [row(), secondProvider], actualValues: Array(24).fill(null), actualSourceType: '',
      plantType: 'wind', targetDate: '2026-05-03', regionId: 'yunnan', stationId: 'YN-KUNMING', decisionHour: 12,
    })[1]!
    expect(d1.providerCount).toBe(2)
    expect(d1.divergence).toMatchObject({ status: 'available', comparedHours: 1, meanSpread: 2 })
  })
})
