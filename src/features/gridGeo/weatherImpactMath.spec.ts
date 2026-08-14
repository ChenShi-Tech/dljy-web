import { describe, expect, it } from 'vitest'
import { hourlyAverage, optionalCaptureOnNotFound, pearsonCorrelation } from './weatherImpactMath'

describe('weather impact retrospective math', () => {
  it('requires enough aligned samples', () => {
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toEqual({ value: null, samples: 3 })
  })

  it('computes signed correlation on aligned non-null samples', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12]).value).toBeCloseTo(1)
    expect(pearsonCorrelation([1, 2, 3, 4, 5, 6], [12, 10, 8, 6, 4, 2]).value).toBeCloseTo(-1)
  })

  it('aggregates 96 slots into 24 hours without turning null into zero', () => {
    const values = Array.from({ length: 96 }, (_, index) => index < 4 ? null : index)
    expect(hourlyAverage(values)[0]).toBeNull()
    expect(hourlyAverage(values)[1]).toBe(5.5)
  })

  it('turns only a missing optional capture into an explicit empty fallback', async () => {
    const fallback = { rows: [], sourceType: 'NOT_CONFIGURED' }
    const missing = Object.assign(new Error('not found'), { name: 'ApiError', status: 404 })
    await expect(optionalCaptureOnNotFound(Promise.reject(missing), fallback)).resolves.toBe(fallback)

    const serverError = Object.assign(new Error('server error'), { name: 'ApiError', status: 500 })
    await expect(optionalCaptureOnNotFound(Promise.reject(serverError), {})).rejects.toBe(serverError)
    await expect(optionalCaptureOnNotFound(Promise.reject(new TypeError('network down')), {})).rejects.toThrow('network down')
  })
})
