// 决策日志服务端数据面纯逻辑测试（node 环境；传输层在 decisionLogClient，不进 node 测试）
// 契约对齐 #2037：Node BFF 行映射（rowToEntry，camelCase 出口）+ 双模式探针语义。
import { describe, expect, it } from 'vitest'
import {
  buildImportPlan,
  classifyDecisionLogError,
  classifyDecisionLogResponse,
  coerceEntry,
  coerceVerdict
} from './decisionLogApi'
import type { DecisionLogEntry } from 'shared/trading-rules/decision-log.mjs'

/** 服务端 rowToEntry 形状（camelCase，数字 id 串化） */
const serverRow = {
  id: '7',
  seq: 7,
  at: '2026-08-18T09:30:00.000Z',
  targetDate: '2026-08-18',
  decisionPoint: '储能充放时段选择',
  judgement: '低谷 02-05 充、尖峰 19-20 放',
  rationale: '尖谷价差 340，要求价差 109，安全倍数 3.1',
  p10: 180,
  p50: 240,
  p90: 380,
  confidence: 70,
  author: 'cgn-admin',
  actual: null,
  lesson: null,
  correctionOf: null,
  prevHash: 'GENESIS',
  hash: 'a'.repeat(64)
}

describe('coerceEntry（服务端行 → 共享 DecisionLogEntry）', () => {
  it('camelCase 行完整通过；actual/lesson 空值语义保留', () => {
    const e = coerceEntry(serverRow)
    expect(e).toMatchObject({ id: '7', seq: 7, targetDate: '2026-08-18', p50: 240, actual: null, lesson: null })
  })

  it('数字 id 也收（PG bigint 归一前防形态漂移）；numeric 字符串归一为数字', () => {
    const e = coerceEntry({ ...serverRow, id: 9, p10: '175.5', confidence: '80' })
    expect(e?.id).toBe('9')
    expect(e?.p10).toBe(175.5)
    expect(e?.confidence).toBe(80)
  })

  it('参与哈希/校验的字段缺失 → 丢行返回 null（宁丢一行不误读全链）', () => {
    expect(coerceEntry({ ...serverRow, hash: undefined })).toBeNull()
    expect(coerceEntry({ ...serverRow, p50: 'abc' })).toBeNull()
    expect(coerceEntry({ ...serverRow, targetDate: 123 })).toBeNull()
    expect(coerceEntry(null)).toBeNull()
  })

  it('correction_of snake 容忍 + 已回填条目带 actual/lesson', () => {
    const e = coerceEntry({ ...serverRow, correction_of: '6', actual: 262, lesson: '低估午间光伏' })
    expect(e?.correctionOf).toBe('6')
    expect(e?.actual).toBe(262)
    expect(e?.lesson).toBe('低估午间光伏')
  })
})

describe('classifyDecisionLogResponse（双模式探针）', () => {
  it('200 + {data:[…]} → available；裸数组信封同样可提取', () => {
    for (const body of [{ data: [serverRow] }, [serverRow]]) {
      expect(classifyDecisionLogResponse(200, body)).toMatchObject({ available: true })
    }
  })

  it('404/405 → endpoint-absent（回落浏览器原型的唯一合法信号）', () => {
    expect(classifyDecisionLogResponse(404, null)).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyDecisionLogResponse(405, null)).toEqual({ available: false, reason: 'endpoint-absent' })
  })

  it('401/403 → unauthorized；5xx → unreachable（端点在但故障，绝不静默回落本地）', () => {
    expect(classifyDecisionLogResponse(403, { code: 403, msg: 'forbidden' })).toEqual({ available: false, reason: 'unauthorized' })
    expect(classifyDecisionLogResponse(502, { code: 502 })).toEqual({ available: false, reason: 'unreachable' })
    expect(classifyDecisionLogError(new TypeError('Failed to fetch'))).toEqual({ available: false, reason: 'unreachable' })
  })

  it('200 但全部行形态不符 → endpoint-absent（HTML 兜底页不当空链）', () => {
    expect(classifyDecisionLogResponse(200, '<!doctype html>')).toEqual({ available: false, reason: 'endpoint-absent' })
    expect(classifyDecisionLogResponse(200, { data: [{ junk: 1 }] })).toEqual({ available: false, reason: 'endpoint-absent' })
  })
})

describe('coerceVerdict（服务端 SHA-256 链校验结论）', () => {
  it('intact 结论完整透传', () => {
    const v = coerceVerdict({ engine: 'sqlite', verdict: { intact: true, brokenAtSeq: null, reason: null } })
    expect(v).toEqual({ engine: 'sqlite', verdict: { intact: true, brokenAtSeq: null, reason: null } })
  })

  it('断链结论带 brokenAtSeq/reason；形态不符返回 null（页面如实显示校验不可用）', () => {
    const v = coerceVerdict({ engine: 'pg', verdict: { intact: false, brokenAtSeq: 3, reason: '哈希不匹配' } })
    expect(v?.verdict).toEqual({ intact: false, brokenAtSeq: 3, reason: '哈希不匹配' })
    expect(coerceVerdict({ engine: 'pg' })).toBeNull()
    expect(coerceVerdict(null)).toBeNull()
  })
})

describe('buildImportPlan（浏览器原型 → 服务端导入计划）', () => {
  const localEntry = (over: Partial<DecisionLogEntry> = {}): DecisionLogEntry => ({
    id: '2026-08-18#1',
    seq: 1,
    at: '2026-08-18T09:00:00.000Z',
    targetDate: '2026-08-18',
    decisionPoint: '储能充放时段选择',
    judgement: '低充高放',
    rationale: '价差 340',
    p10: 180,
    p50: 240,
    p90: 380,
    confidence: 70,
    author: '张三',
    actual: null,
    lesson: null,
    correctionOf: null,
    prevHash: 'GENESIS',
    hash: 'fnv-hash-1',
    ...over
  })

  it('按链序出计划；author/at 刻意不进 draft（服务端落名与落链时间为准）', () => {
    const plan = buildImportPlan([localEntry()])
    expect(plan).toHaveLength(1)
    expect(plan[0].draft).not.toHaveProperty('author')
    expect(plan[0].draft).not.toHaveProperty('at')
    expect(plan[0].draft.correctionOf).toBeNull()
    expect(plan[0].backfill).toBeNull()
  })

  it('correctionOf 保留本地 id（执行期查映射换服务端 id）；已回填条目补 backfill 步骤', () => {
    const plan = buildImportPlan([
      localEntry({ id: 'L1', actual: 262, lesson: '低估光伏' }),
      localEntry({ id: 'L2', seq: 2, correctionOf: 'L1', prevHash: 'fnv-hash-1', hash: 'fnv-hash-2' })
    ])
    expect(plan[1].draft.correctionOf).toBe('L1')
    expect(plan[0].backfill).toEqual({ actual: 262, lesson: '低估光伏' })
    expect(plan[1].backfill).toBeNull()
  })
})
