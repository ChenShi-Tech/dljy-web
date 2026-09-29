import { describe, expect, it } from 'vitest'
import {
  isMixedProvenance, isMockProvenance, isUnavailableProvenance, provenanceWarnings, sourceTypeOf,
} from './forecastProvenance'

describe('forecastProvenance', () => {
  it('mock:true 或任一拼写的 sourceType 为 MOCK 都判为模拟', () => {
    expect(isMockProvenance({ mock: true })).toBe(true)
    expect(isMockProvenance({ sourceType: 'MOCK' })).toBe(true)
    expect(isMockProvenance({ source_type: 'mock' })).toBe(true)
    expect(isMockProvenance({ mock: false, sourceType: 'REAL' })).toBe(false)
  })
  it('空值/旧后端无字段不崩，一律按无标识处理', () => {
    for (const v of [undefined, null, {}]) {
      expect(isMockProvenance(v)).toBe(false)
      expect(isMixedProvenance(v)).toBe(false)
      expect(isUnavailableProvenance(v)).toBe(false)
      expect(provenanceWarnings(v)).toEqual([])
      expect(sourceTypeOf(v)).toBe('')
    }
  })
  it('UNAVAILABLE 与 available:false 都判不可用；MIXED 单独识别', () => {
    expect(isUnavailableProvenance({ sourceType: 'UNAVAILABLE' })).toBe(true)
    expect(isUnavailableProvenance({ available: false })).toBe(true)
    expect(isUnavailableProvenance({ available: true, sourceType: 'REAL' })).toBe(false)
    expect(isMixedProvenance({ sourceType: 'MIXED' })).toBe(true)
  })
  it('warnings 只保留非空字符串，非数组返回空', () => {
    expect(provenanceWarnings({ warnings: ['a', '  ', '', 'b '] })).toEqual(['a', 'b'])
    expect(provenanceWarnings({ warnings: 'x' as unknown as string[] })).toEqual([])
  })
})
