import { describe, expect, it } from 'vitest'
import { DisclosureRequestPool } from './disclosureRequestPool'

describe('disclosure request pool', () => {
  it('shares three slots across batches and skips stale queued shards', async () => {
    const pool = new DisclosureRequestPool(3)
    let batch = 1
    let active = 0
    let maxActive = 0
    const started: string[] = []
    const releases: Array<() => void> = []

    const makeJob = (id: string, jobBatch: number) => pool.enqueue(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(id)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return id
    }, () => jobBatch === batch)

    const oldJobs = Array.from({ length: 6 }, (_, index) => makeJob(`old-${index}`, 1))
    await Promise.resolve()
    expect(started).toEqual(['old-0', 'old-1', 'old-2'])

    batch = 2
    const newJobs = [makeJob('new-0', 2), makeJob('new-1', 2)]
    expect(started).toEqual(['old-0', 'old-1', 'old-2'])

    releases.splice(0, 3).forEach((release) => release())
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual(['old-0', 'old-1', 'old-2', 'new-0', 'new-1'])
    expect(maxActive).toBeLessThanOrEqual(3)

    releases.splice(0).forEach((release) => release())
    await expect(Promise.all(oldJobs)).resolves.toEqual(['old-0', 'old-1', 'old-2', undefined, undefined, undefined])
    await expect(Promise.all(newJobs)).resolves.toEqual(['new-0', 'new-1'])
  })
})
