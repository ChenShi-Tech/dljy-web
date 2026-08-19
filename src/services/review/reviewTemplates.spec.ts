import { describe, expect, it } from 'vitest'
import {
  CADENCES,
  REVIEW_TEMPLATES,
  SOURCE_CATALOG,
  TEMPLATE_IDS,
  readinessSummary,
  templateById,
  templatesByCadence,
  templatesByDimension,
  templatesBySubject
} from 'shared/review-templates/registry.mjs'

// 注册表结构性校验的主力在门禁 verify:review-templates（快照/来源/红线/口径）；
// 本 spec 只守helper 语义与几条业务不变量，helper 与数据解耦烂掉时这里先红。

describe('复盘模板注册表 helper', () => {
  it('templateById 命中返回模板、未命中返回 null 不抛', () => {
    expect(templateById('T01')?.name).toBe('决策复盘单')
    expect(templateById('E3')?.subject).toBe('storage')
    expect(templateById('不存在')).toBeNull()
  })

  it('templatesByCadence 命中多周期模板（T08 同属 daily 与 monthly）', () => {
    const daily = templatesByCadence('daily').map((t) => t.id)
    const monthly = templatesByCadence('monthly').map((t) => t.id)
    expect(daily).toContain('T08')
    expect(monthly).toContain('T08')
    expect(daily).toContain('E3')
    expect(monthly).not.toContain('E3')
  })

  it('templatesBySubject 默认含 common，可显式排除', () => {
    const withCommon = templatesBySubject('storage').map((t) => t.id)
    expect(withCommon).toContain('S1')
    expect(withCommon).toContain('T01')
    expect(withCommon).not.toContain('R1')
    const own = templatesBySubject('storage', { includeCommon: false }).map((t) => t.id)
    expect(own).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'E1', 'E2', 'E3'])
  })

  it('templatesByDimension 返回项维度一致且六维都有归属', () => {
    for (const dim of ['result', 'strategy', 'market', 'deviation', 'risk', 'decision'] as const) {
      const hit = templatesByDimension(dim)
      expect(hit.length).toBeGreaterThan(0)
      expect(hit.every((t) => t.dimension === dim)).toBe(true)
    }
  })

  it('readinessSummary 三态之和恒等于 31', () => {
    const s = readinessSummary()
    expect(s.total).toBe(31)
    expect(s.ready + s.data_gap + s.deferred).toBe(s.total)
    expect(TEMPLATE_IDS).toHaveLength(31)
  })
})

describe('业务不变量（与门禁互为补充）', () => {
  it('决策复盘单判断栏永远人填且必填——方案红线「严禁系统代填」', () => {
    const t01 = templateById('T01')
    for (const key of ['basisInfo', 'basisLogic', 'basisEmotion', 'conclusionInfo', 'conclusionLogic', 'conclusionEmotion', 'improvement']) {
      const field = t01?.fields.find((f) => f.key === key)
      expect(field?.fill, key).toBe('human')
      expect(field?.required, key).toBe(true)
    }
  })

  it('data_gap 模板的 gapNote 都能对上缺口台账（D1–D6 或 issue 号）', () => {
    for (const t of REVIEW_TEMPLATES.filter((x) => x.readiness !== 'ready')) {
      expect(t.gapNote, t.id).toMatch(/D[1-6]|#\d+/)
    }
  })

  it('24 时段模板恰为 N1/E1/E2/E3（96 点底层、24 时段展示聚合的拍板范围）', () => {
    const slots = REVIEW_TEMPLATES.filter((t) => t.slots24).map((t) => t.id).sort()
    expect(slots).toEqual(['E1', 'E2', 'E3', 'N1'])
  })

  it('周期枚举与保留期口径稳定', () => {
    expect(CADENCES).toContain('event')
    expect(REVIEW_TEMPLATES.every((t) => t.retentionYears >= 5)).toBe(true)
    expect(SOURCE_CATALOG.length).toBeGreaterThan(0)
  })
})
