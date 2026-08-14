import { describe, expect, it } from 'vitest'
import {
  basisFromProvenance,
  basisFromPythonEnvelope,
  basisFromSourceType,
  unifyBasis
} from './basis'

// 数据来源归一（basis.ts）纯函数回归锁：这些映射决定 UI 可信度徽标与决策层口径，
// 一旦回退语义被改错（把合成/未知误标真实）即 P1，故用带业务含义的断言锁死。
describe('basisFromSourceType', () => {
  it('把各套 SourceType 枚举归一到 DataSourceBasis', () => {
    expect(basisFromSourceType('REAL')).toBe('real')
    expect(basisFromSourceType('API')).toBe('real')
    expect(basisFromSourceType('CAPTURE')).toBe('captured')
    expect(basisFromSourceType('DB')).toBe('captured')
    expect(basisFromSourceType('IMPORT')).toBe('captured')
    expect(basisFromSourceType('MIXED')).toBe('illustrative')
    expect(basisFromSourceType('SEED')).toBe('synthetic')
    expect(basisFromSourceType('USER_SAVED')).toBe('user_saved')
  })

  it('大小写不敏感（小写/混合大小写归一）', () => {
    expect(basisFromSourceType('real')).toBe('real')
    expect(basisFromSourceType('Captured')).toBe('captured')
  })

  it('未知/空值保守回落 synthetic（宁可标合成也不伪装真实）', () => {
    expect(basisFromSourceType(undefined)).toBe('synthetic')
    expect(basisFromSourceType(null)).toBe('synthetic')
    expect(basisFromSourceType('')).toBe('synthetic')
    expect(basisFromSourceType('NOT_A_SOURCE')).toBe('synthetic')
  })
})

describe('basisFromPythonEnvelope', () => {
  it('mock=true 强制 synthetic，即使 sourceType 声称 REAL', () => {
    expect(basisFromPythonEnvelope({ mock: true, sourceType: 'REAL' })).toBe('synthetic')
  })

  it('mock 非真时按 sourceType/source_type 归一', () => {
    expect(basisFromPythonEnvelope({ mock: false, sourceType: 'REAL' })).toBe('real')
    expect(basisFromPythonEnvelope({ source_type: 'CAPTURED' })).toBe('captured')
  })
})

describe('basisFromProvenance', () => {
  it('无 provenance 回落 synthetic', () => {
    expect(basisFromProvenance(null)).toBe('synthetic')
    expect(basisFromProvenance(undefined)).toBe('synthetic')
  })

  it('有 sourceType 时优先按其归一', () => {
    expect(basisFromProvenance({ sourceType: 'CAPTURE' })).toBe('captured')
  })

  it('无 sourceType 但 realDataConnected=true 保守标 captured，否则 synthetic', () => {
    expect(basisFromProvenance({ realDataConnected: true })).toBe('captured')
    expect(basisFromProvenance({ realDataConnected: false })).toBe('synthetic')
  })
})

describe('unifyBasis', () => {
  it('非对象输入返回 undefined', () => {
    expect(unifyBasis(null)).toBeUndefined()
    expect(unifyBasis('REAL')).toBeUndefined()
    expect(unifyBasis(42)).toBeUndefined()
  })

  it('按优先级 mock → sourceType → provenance → basis 归一', () => {
    expect(unifyBasis({ mock: true, sourceType: 'REAL' })).toBe('synthetic')
    expect(unifyBasis({ sourceType: 'DB' })).toBe('captured')
    expect(unifyBasis({ provenance: { sourceType: 'CAPTURE' } })).toBe('captured')
    expect(unifyBasis({ basis: 'illustrative' })).toBe('illustrative')
  })

  it('无任何可信度字段的对象返回 undefined', () => {
    expect(unifyBasis({})).toBeUndefined()
    expect(unifyBasis({ foo: 'bar' })).toBeUndefined()
  })
})
