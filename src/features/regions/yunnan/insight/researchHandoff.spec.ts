// researchHandoff.spec.ts — 研究承接语义选区白名单回归（dljy#3114，任务 13.7，RS08、DE10）
// 守什么不变量：
//   ① 选区 → 地址参数白名单只有：窗口起止业务日（时段选区折叠）+ 对象 + 来源 + 来源页；
//      时段数组、版本令牌、原始数据不进 URL；
//   ② 来源页不在白名单 / 空选区：不承接（返回 null），不假装预填；
//   ③ 预设建议按「登记输入来源 ∩ 承接来源」最大者，并列取登记顺序，无交集不预填；
//   ④ 返回原页带回窗口/对象/来源（与 useInsightContext 同一套参数名，可恢复口径）。
import { describe, expect, it } from 'vitest'
import type { InsightSelection } from 'shared/insight/handoff.mjs'
import { listResearchPresets } from 'shared/insight/research.mjs'
import {
  buildResearchHandoffQuery,
  handoffReturnLocation,
  parseResearchHandoffOrigin,
  suggestResearchPresetId,
} from './researchHandoff'

function selectionFixture(overrides: Record<string, unknown> = {}): InsightSelection {
  return {
    schemaVersion: 'insight-selection/v1',
    resultRef: { queryId: 'q1', resultVersion: `rv1:${'a'.repeat(64)}`, readSetRef: `rs1:${'a'.repeat(64)}`, expiresAt: null },
    regionId: 'yunnan',
    companyId: 'c1',
    objectRefs: [{ type: 'object', id: 'node-A' }],
    timeIntervals: [{ start: '2026-09-03T18:00:00+08:00', end: '2026-09-03T21:00:00+08:00' }],
    metricRefs: [],
    recordRefs: [],
    priceObject: null,
    marketPhase: 'day-ahead',
    sourceIds: ['yn.price.user.day-ahead'],
    contextVersion: 3,
    ...overrides,
  } as unknown as InsightSelection
}

describe('选区 → 承接地址参数', () => {
  it('多段时段选区折叠为起止业务日；对象/来源去重逗号连接；不带时段数组与版本令牌', () => {
    const query = buildResearchHandoffQuery(
      selectionFixture({
        timeIntervals: [
          { start: '2026-09-03T18:00:00+08:00', end: '2026-09-03T21:00:00+08:00' },
          { start: '2026-09-01T00:00:00+08:00', end: '2026-09-02T00:00:00+08:00' },
        ],
        objectRefs: [{ type: 'object', id: 'node-A' }, { type: 'object', id: 'node-B' }],
      }),
      'prices'
    )
    expect(query).toEqual({
      from: 'prices',
      start: '2026-09-01',
      end: '2026-09-03',
      objects: 'node-A,node-B',
      sources: 'yn.price.user.day-ahead',
    })
    expect(JSON.stringify(query)).not.toContain('timeIntervals')
    expect(JSON.stringify(query)).not.toContain('resultVersion')
  })

  it('只承接对象引用（无时段）也成立；日期非法时只承接对象与来源', () => {
    const objectsOnly = buildResearchHandoffQuery(
      selectionFixture({ timeIntervals: [] }),
      'grid-boundaries'
    )
    expect(objectsOnly).toEqual({
      from: 'grid-boundaries',
      objects: 'node-A',
      sources: 'yn.price.user.day-ahead',
    })

    const badDays = buildResearchHandoffQuery(
      selectionFixture({ timeIntervals: [{ start: 'not-a-time', end: 'not-a-time' }] }),
      'prices'
    )
    expect(badDays).not.toHaveProperty('start')
    expect(badDays).not.toHaveProperty('end')
  })

  it('空选区（无时段且无对象）与白名单外来源页：不承接', () => {
    expect(buildResearchHandoffQuery(selectionFixture({ timeIntervals: [], objectRefs: [] }), 'prices')).toBeNull()
    expect(buildResearchHandoffQuery(selectionFixture(), 'unknown-page')).toBeNull()
    expect(buildResearchHandoffQuery(null, 'prices')).toBeNull()
  })

  it('parseResearchHandoffOrigin：白名单外/缺失返回 null，不认识的来源不假装承接', () => {
    expect(parseResearchHandoffOrigin({ from: 'plants' })).toBe('plants')
    expect(parseResearchHandoffOrigin({ from: 'evil' })).toBeNull()
    expect(parseResearchHandoffOrigin({})).toBeNull()
    expect(parseResearchHandoffOrigin({ from: 42 })).toBeNull()
  })
})

describe('预设建议', () => {
  const presets = listResearchPresets('yunnan')

  it('承接来源含价格来源：建议登记顺序最前、来源交集最大的相关预设', () => {
    expect(suggestResearchPresetId(presets, ['yn.price.user.day-ahead'])).toBe('research.price-new-energy-correlation')
  })

  it('承接来源只含负荷/新能源实际：建议同类日或同进度（交集最大者，并列取登记序）', () => {
    // 负荷实际命中：价格×负荷相关（2 个来源里 1 个）、同类日特征（1）……最大交集为 1，取登记序靠前
    expect(suggestResearchPresetId(presets, ['yn.system.load.actual'])).toBe('research.price-load-correlation')
    // 新能源实际只命中 价格×新能源 相关 的 y 侧来源
    expect(suggestResearchPresetId(presets, ['yn.system.new-energy.actual'])).toBe('research.price-new-energy-correlation')
  })

  it('无交集或无来源：不预填（不假装能承接）', () => {
    expect(suggestResearchPresetId(presets, ['yn.transfer.tie-line.flow'])).toBeNull()
    expect(suggestResearchPresetId(presets, [])).toBeNull()
  })
})

describe('返回原页', () => {
  it('返回位置 = 来源页路径 + 窗口/对象/来源（useInsightContext 同名参数，可恢复口径）', () => {
    const location = handoffReturnLocation(
      'prices',
      { start: '2026-09-01', end: '2026-09-10' },
      ['node-A', 'node-B'],
      ['yn.price.user.day-ahead']
    )
    expect(location).toEqual({
      path: '/insight/prices',
      query: { start: '2026-09-01', end: '2026-09-10', objects: 'node-A,node-B', sources: 'yn.price.user.day-ahead' },
    })
    // 没有对象/来源时只带窗口（不写空键）
    const windowOnly = handoffReturnLocation('plants', { start: '2026-09-01', end: '2026-09-01' }, [], [])
    expect(windowOnly).toEqual({ path: '/insight/plants', query: { start: '2026-09-01', end: '2026-09-01' } })
  })
})
