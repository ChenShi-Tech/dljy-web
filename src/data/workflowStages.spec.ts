import { describe, expect, it } from 'vitest'
import {
  ALL_STAGES,
  TRADING_DAY_ROUTE,
  chainProgress,
  isStageDone,
  stageStates,
  stagesForPosition
} from '@/data/workflowStages'
import type { DeclarationOrder } from '@/services/declarations'

function decl(overrides: Partial<DeclarationOrder> = {}): DeclarationOrder {
  return { id: 'D-1', status: 'DRAFT', riskCheck: null, preflight: {}, ...overrides } as DeclarationOrder
}

const ts = { writtenBy: 'trader', writtenAt: '2026-08-10T08:40:00+08:00' }
const reviewWritten = { morningReview: { reviewedDate: '2026-08-09', reviewedDeclarationId: 'D-0', clearRate: 0.92, cause: '预测偏差', lessons: '高峰段少报 5%', ...ts } }
const gateWritten = { dataGate: { gate: 'declarable', completenessRate: 1, weakestCredibility: 'B', degradeLevel: 0, ...ts } }
const forecastWritten = { forecast: { curveMwh96: [1], source: 'S3', direction: 'add' as const, confidence: 72, ...ts } }
const clearingWritten = { clearingReview: { clearRate: 0.9, maxGapSlot: 74, needsRealtimeAction: false, summary: '中标率 90%', ...ts } }
const contractWritten = { contract: { gapMwh: 120, gapPct: 0.08, suggestion: 'buy', action: '挂牌买入 120MWh', reason: '缺口+偏紧', ...ts } }
const closeWritten = { dailyClose: { reportSummary: '日报', decisionsLogged: 3, coverageOk: true, ...ts } }

describe('一日作业链：v1.0 的线性七步', () => {
  it('七步齐备且顺序与手册一致', () => {
    expect(ALL_STAGES.map((s) => s.scenario)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
    expect(ALL_STAGES.map((s) => s.id)).toEqual([
      'morning-review',
      'market-analysis',
      'direction',
      'declare',
      'clearing',
      'contract',
      'daily-close'
    ])
  })

  it('每步都带产出物与 OODA 环节（缺一则界面提示不完整）', () => {
    for (const s of ALL_STAGES) {
      expect(s.output).toBeTruthy()
      expect(s.ooda).toBeTruthy()
    }
  })

  it('**单页承载**：不再有逐阶段路由，深链只经作业台 + stage 参数', () => {
    expect(TRADING_DAY_ROUTE).toBe('/xhjy/trading-day')
    for (const s of ALL_STAGES) {
      expect(s).not.toHaveProperty('route')
    }
  })

  it('**链长不随立场变化**——不同租户的交易员要能用同一套「第几步」沟通', () => {
    const forRetail = stagesForPosition('RETAILER').map((s) => s.id)
    const forStorage = stagesForPosition('STORAGE').map((s) => s.id)
    const forNull = stagesForPosition(null).map((s) => s.id)
    expect(forStorage).toEqual(forRetail)
    expect(forNull).toEqual(forRetail)
    // 立场差异体现在每步内部（如 S4 申报时储能多一张计划单），不增删步骤
  })
})

describe('阶段完成只从单据事实推导，不另存进度', () => {
  it('无单据时一切未完成', () => {
    expect(isStageDone('market-analysis', null)).toBe(false)
    expect(isStageDone('declare', null)).toBe(false)
  })

  it('晨会复盘完成 = 昨日复盘已写回 preflight.morningReview', () => {
    expect(isStageDone('morning-review', decl())).toBe(false)
    expect(isStageDone('morning-review', decl({ preflight: reviewWritten }))).toBe(true)
  })

  it('早间分析完成 = 市场判断已写回 preflight.dataGate', () => {
    expect(isStageDone('market-analysis', decl())).toBe(false)
    expect(isStageDone('market-analysis', decl({ preflight: gateWritten }))).toBe(true)
  })

  it('方向判断完成 = 方向与预测已写回 preflight.forecast', () => {
    expect(isStageDone('direction', decl({ preflight: forecastWritten }))).toBe(true)
  })

  it('申报执行完成 = 状态机到 SUBMITTED 及之后（APPROVED 还不算，单子没出门）', () => {
    expect(isStageDone('declare', decl({ status: 'APPROVED' }))).toBe(false)
    expect(isStageDone('declare', decl({ status: 'SUBMITTED' }))).toBe(true)
  })

  it('出清分析完成 = 出清已登记 **且** 偏差结论已写回——只登记不分析不算完', () => {
    // 只登记出清、没写回分析结论 → 未完成
    expect(isStageDone('clearing', decl({ status: 'CLEARED' }))).toBe(false)
    // 只写回结论、状态机没走到出清（编的分析）→ 未完成
    expect(isStageDone('clearing', decl({ status: 'SUBMITTED', preflight: clearingWritten }))).toBe(false)
    // 两者齐备 → 完成
    expect(isStageDone('clearing', decl({ status: 'CLEARED', preflight: clearingWritten }))).toBe(true)
    expect(isStageDone('clearing', decl({ status: 'SETTLED', preflight: clearingWritten }))).toBe(true)
  })

  it('补仓完成 = 补仓决定已写回；日报完成 = 收口摘要已写回', () => {
    expect(isStageDone('contract', decl())).toBe(false)
    expect(isStageDone('contract', decl({ preflight: contractWritten }))).toBe(true)
    expect(isStageDone('daily-close', decl())).toBe(false)
    expect(isStageDone('daily-close', decl({ preflight: closeWritten }))).toBe(true)
  })
})

describe('阶段状态推导', () => {
  it('全新单据 → 第一步进行中，其后待前置', () => {
    const st = stageStates(ALL_STAGES, decl())
    expect(st['morning-review']).toBe('current')
    expect(st['market-analysis']).toBe('locked')
  })

  it('跳步完成不虚报前序阶段——S1 没做就是没做', () => {
    // 早间分析已写回但 S1 复盘没写 → S1 仍是进行中
    const st = stageStates(ALL_STAGES, decl({ preflight: gateWritten }))
    expect(st['morning-review']).toBe('current')
    expect(st['market-analysis']).toBe('done')
    // S3 的前置 S2 已完成 → 待办而非待前置
    expect(st['direction']).toBe('pending')
  })

  it('前置未完成的后续步标「待前置」，与「待办」区分开', () => {
    const st = stageStates(ALL_STAGES, decl())
    expect(st['direction']).toBe('locked')
    expect(st['declare']).toBe('locked')
  })
})

describe('链路完成度', () => {
  it('空单据为 0；写回三段产出后计 3/7', () => {
    expect(chainProgress(ALL_STAGES, decl()).done).toBe(0)
    const p = chainProgress(
      ALL_STAGES,
      decl({ preflight: { ...reviewWritten, ...gateWritten, ...forecastWritten } })
    )
    expect(p.done).toBe(3)
    expect(p.total).toBe(7)
    expect(p.rate).toBeCloseTo(3 / 7, 4)
  })

  it('七段全齐 + 状态走到结算 → 7/7', () => {
    const p = chainProgress(
      ALL_STAGES,
      decl({
        status: 'SETTLED',
        preflight: {
          ...reviewWritten,
          ...gateWritten,
          ...forecastWritten,
          ...clearingWritten,
          ...contractWritten,
          ...closeWritten
        }
      })
    )
    expect(p.done).toBe(7)
  })
})
