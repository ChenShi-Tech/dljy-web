import { describe, expect, it } from 'vitest'
import {
  assessIntegrity,
  canDeclareUnder,
  exposureFactorOf,
  REQUIRED_SOURCES,
  type SourceStatus
} from 'shared/trading-rules/data-integrity.mjs'

function allSources(overrides: Partial<Record<string, Partial<SourceStatus>>> = {}): SourceStatus[] {
  return REQUIRED_SOURCES.map((s) => ({
    id: s.id,
    present: true,
    credibility: 'B' as const,
    timestamp: '2026-08-09T07:30:00+08:00',
    ...(overrides[s.id] ?? {})
  }))
}

describe('八源验签与完整率', () => {
  it('八源齐备且最弱为 B → 可申报', () => {
    const v = assessIntegrity(allSources())
    expect(v.presentCount).toBe(8)
    expect(v.completenessRate).toBe(1)
    expect(v.gate).toBe('declarable')
    expect(v.degradeLevel).toBe(0)
    expect(canDeclareUnder(v.gate)).toBe(true)
  })

  it('缺一源 → 完整率 87.5%，跌到「仅展示」并触发二级降级', () => {
    const v = assessIntegrity(allSources({ boundary: { present: false } }))
    expect(v.completenessRate).toBeCloseTo(0.875, 4)
    expect(v.gate).toBe('display_only')
    expect(v.degradeLevel).toBe(2)
    expect(v.problems.some((p) => p.id === 'boundary' && p.reason === '未到位')).toBe(true)
  })

  it('八源都在但某源内容只有 80% → 完整率 97.5%，落「可参考」+ 一级降级', () => {
    const v = assessIntegrity(allSources({ customer_load: { completeness: 0.8 } }))
    expect(v.completenessRate).toBeCloseTo(0.975, 4)
    expect(v.gate).toBe('reference')
    expect(v.degradeLevel).toBe(1)
  })
})

describe('可信度链条：最弱环节决定门禁', () => {
  it('含 C 级自建模型 → 最多「可参考」，即便完整率 100%', () => {
    const v = assessIntegrity(allSources({ load_forecast: { credibility: 'C' } }))
    expect(v.completenessRate).toBe(1)
    expect(v.weakestCredibility).toBe('C')
    expect(v.gate).toBe('reference')
    expect(canDeclareUnder(v.gate)).toBe(false)
  })

  it('含 D 级估算/沿用 → 直接「仅展示」，不得作为申报依据', () => {
    const v = assessIntegrity(allSources({ renewable_forecast: { credibility: 'D' } }))
    expect(v.weakestCredibility).toBe('D')
    expect(v.gate).toBe('display_only')
    expect(v.problems.some((p) => p.reason.includes('D 级'))).toBe(true)
  })

  it('全 A 级实测 → 可申报', () => {
    const v = assessIntegrity(
      REQUIRED_SOURCES.map((s) => ({ id: s.id, present: true, credibility: 'A' as const, timestamp: 'x' }))
    )
    expect(v.gate).toBe('declarable')
  })
})

describe('Mock 数据永远进不了申报（与 P1 标注红线合流）', () => {
  it('任一源为 Mock → 强制「仅展示」，哪怕完整率 100% 且全 A 级', () => {
    const sources = REQUIRED_SOURCES.map((s) => ({
      id: s.id,
      present: true,
      credibility: 'A' as const,
      timestamp: 'x',
      mock: s.id === 'interprovincial'
    }))
    const v = assessIntegrity(sources)
    expect(v.completenessRate).toBe(1)
    expect(v.weakestCredibility).toBe('A')
    expect(v.gate).toBe('display_only')
    expect(v.problems.some((p) => p.reason.includes('Mock'))).toBe(true)
  })
})

describe('门禁 → 暴露系数（供 R4 裁剪偏置）', () => {
  it('可申报 1.0 / 可参考 0.5（暴露减半）/ 仅展示 0（强制中枢）', () => {
    expect(exposureFactorOf('declarable')).toBe(1)
    expect(exposureFactorOf('reference')).toBe(0.5)
    expect(exposureFactorOf('display_only')).toBe(0)
  })
})

describe('完全空输入', () => {
  it('一源未到位 → 仅展示、二级降级、八条全部记为问题', () => {
    const v = assessIntegrity([])
    expect(v.presentCount).toBe(0)
    expect(v.completenessRate).toBe(0)
    expect(v.gate).toBe('display_only')
    expect(v.degradeLevel).toBe(2)
    expect(v.problems).toHaveLength(8)
  })
})
