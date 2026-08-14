import { describe, expect, it } from 'vitest'
import {
  declarationLinesOf,
  hasDeclarationWork,
  POSITION_DECLARATION_LINES,
  POSITION_ROLE_HINTS
} from '@/data/positionCapability'
import type { SubjectType } from '@/services/governance'

const ALL: SubjectType[] = ['GROUP', 'GENERATOR', 'RETAILER', 'STORAGE', 'LOAD', 'TRADER']

describe('立场决定今天要交哪张单（立场的可证伪定义）', () => {
  it('售电立场交 T3 用户侧需求曲线，报量不报价', () => {
    const lines = declarationLinesOf('RETAILER')
    expect(lines).toHaveLength(1)
    expect(lines[0].formCode).toBe('T3')
    expect(lines[0].quoteMode).toBe('quantity_only')
    expect(lines[0].scenarioLine).toBe('B')
  })

  it('储能立场交 T2 充放电计划，且是价格接受者', () => {
    const lines = declarationLinesOf('STORAGE')
    expect(lines).toHaveLength(1)
    expect(lines[0].formCode).toBe('T2')
    expect(lines[0].quoteMode).toBe('price_taker')
    expect(lines[0].requiresAsset).toBe('ess')
  })

  it('发电立场交 T1 分段报价，报量报价', () => {
    const lines = declarationLinesOf('GENERATOR')
    expect(lines[0].formCode).toBe('T1')
    expect(lines[0].quoteMode).toBe('quantity_price')
  })

  it('换立场 ⇒ 单据类型真的不同（这是立场存在的理由）', () => {
    const forms = (['RETAILER', 'STORAGE', 'GENERATOR'] as SubjectType[]).map(
      (p) => declarationLinesOf(p)[0].formCode
    )
    expect(new Set(forms).size).toBe(3)
  })
})

describe('管理视角与未知立场不虚构单据', () => {
  it('集团是只读管理视角，无申报作业', () => {
    expect(declarationLinesOf('GROUP')).toEqual([])
    expect(hasDeclarationWork('GROUP')).toBe(false)
  })

  it('立场为空（会话未就绪）时返回空数组，不默认成售电', () => {
    expect(declarationLinesOf(null)).toEqual([])
    expect(declarationLinesOf(undefined)).toEqual([])
  })
})

describe('装配表完整性', () => {
  it('六个立场全部登记，无遗漏（新增立场必须同步本表）', () => {
    for (const p of ALL) {
      expect(POSITION_DECLARATION_LINES[p]).toBeDefined()
      expect(POSITION_ROLE_HINTS[p]).toBeDefined()
      expect(POSITION_ROLE_HINTS[p].length).toBeGreaterThan(0)
    }
  })

  it('每条申报线都带阻断式校验要点与作业入口', () => {
    for (const p of ALL) {
      for (const line of POSITION_DECLARATION_LINES[p]) {
        expect(line.blockingChecks.length).toBeGreaterThan(0)
        expect(line.route.startsWith('/')).toBe(true)
      }
    }
  })

  it('角色收窄符合立场语义：纯售电立场不提示电厂运营', () => {
    expect(POSITION_ROLE_HINTS.RETAILER).not.toContain('PLANT_OPERATOR')
    expect(POSITION_ROLE_HINTS.RETAILER).toContain('RETAIL_MANAGER')
    expect(POSITION_ROLE_HINTS.STORAGE).not.toContain('PLANT_OPERATOR')
    expect(POSITION_ROLE_HINTS.STORAGE).toContain('STORAGE_OPERATOR')
    expect(POSITION_ROLE_HINTS.GENERATOR).toContain('PLANT_OPERATOR')
  })
})

describe('交易组合是跨立场视角', () => {
  it('TRADER 装配全部三条线（组合管理者需看全部）', () => {
    const lines = declarationLinesOf('TRADER')
    expect(lines).toHaveLength(3)
    expect(new Set(lines.map((l) => l.scenarioLine))).toEqual(new Set(['A', 'B', 'C']))
  })
})
