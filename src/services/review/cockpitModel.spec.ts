// 六维驾驶舱纯模型测试（node 环境，import 注册表单源）
import { describe, expect, it } from 'vitest'
import {
  buildDimensionCards,
  deviationMetricOf,
  enrichTodos,
  RISK_CARD_NOTE
} from './cockpitModel'
import { DIMENSIONS, REVIEW_TEMPLATES, readinessSummary } from 'shared/review-templates/registry.mjs'
import type { TodoView } from './templateInstanceApi'

describe('buildDimensionCards（六维入口卡）', () => {
  const cards = buildDimensionCards()

  it('六维齐全且顺序与注册表 DIMENSIONS 一致', () => {
    expect(cards.map((c) => c.key)).toEqual(Object.keys(DIMENSIONS))
    expect(cards.map((c) => c.label)).toEqual(Object.values(DIMENSIONS))
  })

  it('每维计数与全表就绪度汇总恒等（六卡计数之和 = readinessSummary）', () => {
    const sum = cards.reduce(
      (acc, c) => ({
        ready: acc.ready + c.counts.ready,
        dataGap: acc.dataGap + c.counts.dataGap,
        deferred: acc.deferred + c.counts.deferred
      }),
      { ready: 0, dataGap: 0, deferred: 0 }
    )
    const rs = readinessSummary()
    expect(sum).toEqual({ ready: rs.ready, dataGap: rs.data_gap, deferred: rs.deferred })
  })

  it('卡片模板数之和 = 31 项注册表总量，无模板丢失或重复', () => {
    const total = cards.reduce((n, c) => n + c.templates.length, 0)
    expect(total).toBe(REVIEW_TEMPLATES.length)
    const ids = cards.flatMap((c) => c.templates.map((t) => t.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('六维全部锚到驾驶舱区块（#2042–#2049 落地后无「空维度」）', () => {
    const by = Object.fromEntries(cards.map((c) => [c.key, c.anchor]))
    expect(by.deviation).toBe('deviation')
    expect(by.result).toBe('result')
    expect(by.strategy).toBe('strategy')
    expect(by.market).toBe('market')
    expect(by.risk).toBe('risk')
    expect(by.decision).toBe('decision')
  })

  it('data_gap 模板卡带 gapNote（缺数据要说明缺口，不许静默）', () => {
    const gaps = cards.flatMap((c) => c.templates).filter((t) => t.readiness === 'data_gap')
    expect(gaps.length).toBeGreaterThan(0)
    for (const g of gaps) expect(typeof g.gapNote).toBe('string')
  })
})

describe('deviationMetricOf（顶部指标卡 · 偏差率）', () => {
  it('总偏差/申报总量 → 偏差率', () => {
    expect(
      deviationMetricOf({ totalAbsDeviationMwh: 12, declaredTotalMwh: 400, estimatedPenaltyYuan: 3000 })
    ).toEqual({ deviationPct: 0.03, totalAbsDeviationMwh: 12, estimatedPenaltyYuan: 3000 })
  })

  it('无结果或申报总量 ≤0 → pct null（「无从计率」，不用 0 冒充无偏差）', () => {
    expect(deviationMetricOf({ totalAbsDeviationMwh: null, declaredTotalMwh: 400, estimatedPenaltyYuan: null }).deviationPct).toBeNull()
    expect(deviationMetricOf({ totalAbsDeviationMwh: 5, declaredTotalMwh: 0, estimatedPenaltyYuan: 1 }).deviationPct).toBeNull()
    expect(deviationMetricOf({ totalAbsDeviationMwh: 5, declaredTotalMwh: null, estimatedPenaltyYuan: 1 }).deviationPct).toBeNull()
  })
})

describe('enrichTodos（待办行挂接注册表元信息）', () => {
  const todo = (over: Partial<TodoView> = {}): TodoView => ({
    id: 'i1',
    templateId: 'T01',
    periodKey: '2026-08-14',
    status: 'pending',
    dueAt: null,
    updatedAt: null,
    overdue: false,
    ...over
  })

  it('已知模板挂模板名/维度/时限文案', () => {
    const rows = enrichTodos([todo()])
    expect(rows[0].templateName).toBe('决策复盘单')
    expect(rows[0].dimensionLabel).toBe('决策复盘')
    expect(rows[0].deadlineLabel).toBe('当日填写')
  })

  it('未知 templateId 如实标注，不猜名称', () => {
    const rows = enrichTodos([todo({ templateId: 'X99' })])
    expect(rows[0].templateName).toContain('X99')
    expect(rows[0].dimensionLabel).toBeNull()
  })
})

describe('风险事件卡占位文案', () => {
  it('M3 前不显示占位数字的承诺写进文案', () => {
    expect(RISK_CARD_NOTE).toContain('M3')
    expect(RISK_CARD_NOTE).toContain('不显示占位数字')
  })
})
