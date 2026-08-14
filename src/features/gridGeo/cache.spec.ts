import { describe, expect, it } from 'vitest'
import { gridGeoCached, invalidateGridGeoCache, resetGridGeoCacheForTest } from './cache'

describe('grid geo request cache', () => {
  it('coalesces concurrent requests and reuses ttl value', async () => {
    resetGridGeoCacheForTest()
    let calls = 0
    const loader = async () => ++calls
    const [a, b] = await Promise.all([gridGeoCached('plants', 1000, loader), gridGeoCached('plants', 1000, loader)])
    expect([a, b, calls]).toEqual([1, 1, 1])
    expect(await gridGeoCached('plants', 1000, loader)).toBe(1)
  })

  it('invalidates by prefix after writes', async () => {
    resetGridGeoCacheForTest()
    let calls = 0
    await gridGeoCached('plant:a', 1000, async () => ++calls)
    invalidateGridGeoCache('plant:')
    expect(await gridGeoCached('plant:a', 1000, async () => ++calls)).toBe(2)
  })
})
