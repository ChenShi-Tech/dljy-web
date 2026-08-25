// 临场改价留痕 store 测试（#2016 缺口二）：校验/登记/回判流转/待判定清单
// @vitest-environment happy-dom（需要 localStorage）
import { describe, expect, it, beforeEach } from 'vitest'
import {
  addPriceChange,
  clearPriceChanges,
  judgedPriceChanges,
  judgePriceChange,
  listPriceChanges,
  pendingPriceChanges,
  validatePriceChangeDraft,
  type PriceChangeDraft
} from './priceChangeStore'

const okDraft: PriceChangeDraft = {
  date: '2026-08-25',
  decisionPoint: '晚高峰申报价',
  planPrice: 0.35,
  changedPrice: 0.38,
  rationale: '午间新能源大发，晚峰供给收紧'
}

beforeEach(() => {
  localStorage.clear()
})

describe('validatePriceChangeDraft（纯函数校验）', () => {
  it('完整草稿通过', () => {
    expect(validatePriceChangeDraft(okDraft)).toEqual([])
  })

  it('缺决策点/依据、价相等、日期畸形 → 逐条报错', () => {
    expect(validatePriceChangeDraft({ ...okDraft, decisionPoint: ' ' }).join()).toContain('决策点')
    expect(validatePriceChangeDraft({ ...okDraft, rationale: '' }).join()).toContain('依据')
    expect(validatePriceChangeDraft({ ...okDraft, changedPrice: 0.35 }).join()).toContain('没有改动')
    expect(validatePriceChangeDraft({ ...okDraft, date: '昨天' }).join()).toContain('YYYY-MM-DD')
  })
})

describe('登记与回判流转', () => {
  it('登记 → 待判定；judge 改对 → 可复制 + 进已判定清单；judge 不存在 id → null', () => {
    const records = addPriceChange(okDraft)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ verdict: null, planPrice: 0.35, changedPrice: 0.38 })
    expect(pendingPriceChanges()).toHaveLength(1)

    const judged = judgePriceChange(records[0].id, 'replicable', '方向一致且多赚')
    expect(judged).not.toBeNull()
    expect(judged![0].verdict).toBe('replicable')
    expect(judged![0].verdictNote).toBe('方向一致且多赚')
    expect(pendingPriceChanges()).toHaveLength(0)
    expect(judgedPriceChanges()).toHaveLength(1)

    expect(judgePriceChange('no-such-id', 'needs-fix')).toBeNull()
  })

  it('校验失败向上抛（页面展示原因），不落半条记录', () => {
    expect(() => addPriceChange({ ...okDraft, planPrice: Number.NaN })).toThrow()
    expect(listPriceChanges()).toHaveLength(0)
  })

  it('待判定按日期倒序（新的在前）', () => {
    addPriceChange({ ...okDraft, date: '2026-08-24' })
    addPriceChange({ ...okDraft, date: '2026-08-25', decisionPoint: '早谷买入价' })
    const pending = pendingPriceChanges()
    expect(pending.map((r) => r.date)).toEqual(['2026-08-25', '2026-08-24'])
  })

  it('清空后全空', () => {
    addPriceChange(okDraft)
    expect(clearPriceChanges()).toHaveLength(0)
    expect(listPriceChanges()).toHaveLength(0)
  })
})
