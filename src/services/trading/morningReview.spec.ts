import { describe, expect, it } from 'vitest'
import {
  causeIdOfLabel,
  causeLabelOf,
  CAUSE_IDS,
  DEVIATION_CAUSES,
  isCauseId,
  isPendingCause,
  morningWindowState,
  validateMorningReview
} from 'shared/trading-rules/morning-review.mjs'

describe('S1 偏差主因分类表', () => {
  it('业务成因恰为负荷/新能源/通道/价格四类，另加两个结论态', () => {
    expect(CAUSE_IDS).toEqual(['load', 'renewable', 'corridor', 'price', 'none', 'pending'])
  })

  it('每一类都给出「今天该盯什么」——没有下一步动作的分类是死字段', () => {
    for (const c of DEVIATION_CAUSES) {
      expect(c.nextAction.length, `${c.id} 缺 nextAction`).toBeGreaterThan(0)
      expect(c.hint.length, `${c.id} 缺 hint`).toBeGreaterThan(0)
    }
  })

  it('isCauseId 只认 id，不认中文标签', () => {
    expect(isCauseId('load')).toBe(true)
    expect(isCauseId('负荷')).toBe(false)
    expect(isCauseId('')).toBe(false)
    expect(isCauseId(undefined)).toBe(false)
  })
})

describe('causeIdOfLabel：AI 返回值落库前的映射', () => {
  it('命中中文标签映射为 id', () => {
    expect(causeIdOfLabel('负荷')).toBe('load')
    expect(causeIdOfLabel('新能源')).toBe('renewable')
    expect(causeIdOfLabel('通道')).toBe('corridor')
    expect(causeIdOfLabel('价格')).toBe('price')
    expect(causeIdOfLabel('待分析')).toBe('pending')
  })

  it('两侧空白照常命中', () => {
    expect(causeIdOfLabel('  价格 ')).toBe('price')
  })

  it('改版前的旧分类不做模糊匹配，一律返回 null——宁可不填也不猜', () => {
    // 「预测偏差」语义上最接近「负荷」，但它不在表内，映射必须失败而不是就近取。
    expect(causeIdOfLabel('预测偏差')).toBeNull()
    expect(causeIdOfLabel('价格误判')).toBeNull()
    expect(causeIdOfLabel('负荷偏差')).toBeNull()
    expect(causeIdOfLabel('load')).toBeNull()
    expect(causeIdOfLabel(42)).toBeNull()
  })
})

describe('causeLabelOf：展示兜底', () => {
  it('id 渲染成中文', () => {
    expect(causeLabelOf('renewable')).toBe('新能源')
  })

  it('改版前写下的中文主因原样显示，不显示成「未知」', () => {
    // 抹掉当时真实写下的判断，比显示一个陌生词更糟。
    expect(causeLabelOf('预测偏差')).toBe('预测偏差')
  })

  it('空值显示占位符', () => {
    expect(causeLabelOf('')).toBe('—')
    expect(causeLabelOf(null)).toBe('—')
  })
})

describe('validateMorningReview：写回门槛', () => {
  it('主因 + 要点齐全即可写回', () => {
    expect(validateMorningReview({ cause: 'load', lessons: '今日核对晚高峰负荷预测' }).ok).toBe(true)
  })

  it('存中文标签不算合法主因——防止绕过 id 映射直接落库', () => {
    const v = validateMorningReview({ cause: '负荷', lessons: '今日核对晚高峰负荷预测' })
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('偏差主因')
  })

  it('归因无法判定时选「待分析」可以写回（手册异常处理路径）', () => {
    expect(validateMorningReview({ cause: 'pending', lessons: '今日补齐昨日出清明细后再归因' }).ok).toBe(true)
    expect(isPendingCause('pending')).toBe(true)
    expect(isPendingCause('load')).toBe(false)
  })

  it('「待分析」同样要求写今日要点——主因待查不等于今天没有该盯的事', () => {
    const v = validateMorningReview({ cause: 'pending', lessons: '' })
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('今日不重犯要点')
  })

  it('要点长度卡在 4 字：3 字拒、4 字过', () => {
    expect(validateMorningReview({ cause: 'load', lessons: '看负荷' }).ok).toBe(false)
    expect(validateMorningReview({ cause: 'load', lessons: '盯晚高峰' }).ok).toBe(true)
  })

  it('空白不算内容', () => {
    expect(validateMorningReview({ cause: 'load', lessons: '     ' }).ok).toBe(false)
  })

  it('两项都缺时两条错误都报出来，不是只报第一条', () => {
    const v = validateMorningReview({ cause: '', lessons: '' })
    expect(v.errors).toHaveLength(2)
  })
})

describe('morningWindowState：08:00–08:30 作业窗口', () => {
  it('窗口前', () => {
    expect(morningWindowState(7 * 60 + 59)).toBe('before')
  })

  it('起止时刻都算窗口内（闭区间）', () => {
    expect(morningWindowState(8 * 60)).toBe('within')
    expect(morningWindowState(8 * 60 + 30)).toBe('within')
  })

  it('过窗一分钟即判 after', () => {
    expect(morningWindowState(8 * 60 + 31)).toBe('after')
  })
})
