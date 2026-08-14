import { describe, expect, it } from 'vitest'
import { aggregateFreshness, deriveJourneySteps } from './onboardingJourney'

// 数据接入向导旅程状态推导回归锁（#885）：与 verify:page-help 互补——守卫校验路由/docPath，
// 本单测校验「五步状态折算行为」，防止 deriveJourneySteps 把缺信号误判为 done（诚实红线）。

describe('deriveJourneySteps 旅程状态推导', () => {
  it('全信号缺失时五步均 pending（不猜不夸大）', () => {
    expect(deriveJourneySteps({})).toEqual({
      input: 'pending', validate: 'pending', deliver: 'pending', effect: 'pending', consume: 'pending'
    })
  })

  it('有模板记录点亮输入步；false/null/undefined 均 pending', () => {
    expect(deriveJourneySteps({ hasTemplateRecord: true }).input).toBe('done')
    expect(deriveJourneySteps({ hasTemplateRecord: false }).input).toBe('pending')
    expect(deriveJourneySteps({ hasTemplateRecord: null }).input).toBe('pending')
  })

  it('COMMITTED 记录点亮校验步', () => {
    expect(deriveJourneySteps({ hasCommitted: true }).validate).toBe('done')
    expect(deriveJourneySteps({ hasCommitted: false }).validate).toBe('pending')
  })

  it('deliveredPaths 非空点亮落位步', () => {
    expect(deriveJourneySteps({ hasDelivered: true }).deliver).toBe('done')
    expect(deriveJourneySteps({ hasDelivered: false }).deliver).toBe('pending')
  })

  it('freshness 非 unknown 点亮生效+见数（fresh/aging/stale 均算走通）', () => {
    for (const f of ['fresh', 'aging', 'stale'] as const) {
      const steps = deriveJourneySteps({ freshness: f })
      expect(steps.effect, `freshness=${f} 应生效`).toBe('done')
      expect(steps.consume, `freshness=${f} 应见数`).toBe('done')
    }
  })

  it('freshness unknown 时生效+见数 pending（数据未落 capture）', () => {
    const steps = deriveJourneySteps({ freshness: 'unknown' })
    expect(steps.effect).toBe('pending')
    expect(steps.consume).toBe('pending')
  })

  it('freshness 缺失（null/undefined）等同 unknown', () => {
    expect(deriveJourneySteps({ freshness: null }).effect).toBe('pending')
    expect(deriveJourneySteps({ freshness: undefined }).consume).toBe('pending')
  })

  it('完整链路（记录+COMMITTED+投递+fresh）五步全 done', () => {
    expect(
      deriveJourneySteps({ hasTemplateRecord: true, hasCommitted: true, hasDelivered: true, freshness: 'fresh' })
    ).toEqual({ input: 'done', validate: 'done', deliver: 'done', effect: 'done', consume: 'done' })
  })

  it('stale（曾生效但过期）仍点亮生效+见数（档位由 UI 另标，不影响走到哪步判定）', () => {
    const steps = deriveJourneySteps({ hasTemplateRecord: true, hasCommitted: true, hasDelivered: true, freshness: 'stale' })
    expect(steps.effect).toBe('done')
    expect(steps.consume).toBe('done')
  })

  it('投递完成但 ETL 未跑（freshness unknown）：落位 done、生效/见数 pending（如实反映 #885 修复的断点）', () => {
    const steps = deriveJourneySteps({ hasTemplateRecord: true, hasCommitted: true, hasDelivered: true, freshness: 'unknown' })
    expect(steps.deliver).toBe('done')
    expect(steps.effect).toBe('pending')
    expect(steps.consume).toBe('pending')
  })
})

describe('aggregateFreshness 多族新鲜度聚合', () => {
  it('全 unknown → unknown', () => {
    expect(aggregateFreshness(['unknown', 'unknown'])).toBe('unknown')
  })

  it('取最有利档位（best-wins: fresh > aging > stale > unknown）', () => {
    expect(aggregateFreshness(['stale', 'fresh', 'aging'])).toBe('fresh')
    expect(aggregateFreshness(['unknown', 'aging', 'stale'])).toBe('aging')
    expect(aggregateFreshness(['unknown', 'stale'])).toBe('stale')
  })

  it('空数组或全 null/undefined → unknown', () => {
    expect(aggregateFreshness([])).toBe('unknown')
    expect(aggregateFreshness([null, undefined])).toBe('unknown')
  })

  it('跳过 null/undefined 取有效档位', () => {
    expect(aggregateFreshness([null, 'aging', null])).toBe('aging')
  })
})
