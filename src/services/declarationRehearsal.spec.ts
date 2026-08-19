// 历史模拟单的溯源信息：被模拟的日期与发起模拟的时间必须同时可读可取回。
// 只标目标日的话，复盘时分不清这张单是当年真报的、还是事后补跑的回测，两者含义完全不同。
import { describe, expect, it } from 'vitest'

import { buildRehearsalNote, formatRehearsalStamp, parseRehearsalStartedAt } from '@/services/declarationRehearsal'

describe('buildRehearsalNote', () => {
  const note = buildRehearsalNote({
    targetDate: '2026-07-01',
    startedAt: '2026-07-29 12:34 (+08:00)',
    sourceId: 'DECL-20260701-ff62f6a8',
    sourceStatusLabel: '已逾期',
  })

  it('同时写清被模拟日期与发起时间', () => {
    expect(note).toContain('模拟目标日 2026-07-01')
    expect(note).toContain('于 2026-07-29 12:34 (+08:00) 发起')
  })

  it('保留原单溯源（id + 当时状态）', () => {
    expect(note).toContain('复制自 DECL-20260701-ff62f6a8')
    expect(note).toContain('已逾期')
  })

  it('构造出的 note 能被自己解析回发起时间（往返一致）', () => {
    expect(parseRehearsalStartedAt(note)).toBe('2026-07-29 12:34 (+08:00)')
  })
})

describe('parseRehearsalStartedAt', () => {
  it('普通备注取不出时间 → 空串', () => {
    expect(parseRehearsalStartedAt('风险偏好 均衡')).toBe('')
  })

  it('null / undefined 不抛', () => {
    expect(parseRehearsalStartedAt(null)).toBe('')
    expect(parseRehearsalStartedAt(undefined)).toBe('')
  })

  it('格式不完整（缺时分）不硬凑', () => {
    expect(parseRehearsalStartedAt('历史模拟 · 于 2026-07-29 发起')).toBe('')
  })

  it('目标日与发起日相同也能区分两个字段', () => {
    const note = buildRehearsalNote({
      targetDate: '2026-07-29', startedAt: '2026-07-29 09:00 (+08:00)',
      sourceId: 'DECL-X', sourceStatusLabel: '已驳回',
    })
    expect(note).toContain('模拟目标日 2026-07-29')
    expect(parseRehearsalStartedAt(note)).toBe('2026-07-29 09:00 (+08:00)')
  })
})

describe('formatRehearsalStamp', () => {
  // 电力市场口径恒为 +08:00，浏览器时区未必。不显式换算的话，UTC 浏览器在北京时间 12:34
  // 发起的模拟会被记成「04:34」，复盘按市场口径读就差 8 小时，溯源信息本身失真。
  it('显式换算到 +08:00，不随浏览器时区漂移', () => {
    expect(formatRehearsalStamp(Date.UTC(2026, 6, 29, 4, 34))).toBe('2026-07-29 12:34 (+08:00)')
    expect(formatRehearsalStamp(Date.UTC(2026, 6, 28, 16, 0))).toBe('2026-07-29 00:00 (+08:00)') // 跨日
  })

  it('旧格式（无时区后缀）仍可解析，存量 note 不失效', () => {
    expect(parseRehearsalStartedAt('历史模拟 · 于 2026-07-01 08:00 发起')).toBe('2026-07-01 08:00')
  })

  it('输出与 note 同格式，可被 parse 回读（往返一致）', () => {
    // 用绝对时刻（UTC）构造，断言才不随运行环境时区漂移
    const stamp = formatRehearsalStamp(Date.UTC(2026, 6, 29, 1, 5)) // 01:05Z = 09:05 (+08:00)
    expect(stamp).toBe('2026-07-29 09:05 (+08:00)')
    const note = buildRehearsalNote({
      targetDate: '2026-07-01', startedAt: stamp, sourceId: 'DECL-X', sourceStatusLabel: '已逾期',
    })
    expect(parseRehearsalStartedAt(note)).toBe(stamp)
  })
})
