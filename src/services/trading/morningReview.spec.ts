import { describe, expect, it } from 'vitest'
import {
  aggregatePeakFlatValley,
  causeIdOfLabel,
  causeLabelOf,
  CAUSE_IDS,
  DEVIATION_CAUSES,
  DEVIATION_RESPONSIBILITY,
  isCauseId,
  isPendingCause,
  isResponsibilityId,
  morningWindowState,
  responsibilityLabelOf,
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
    expect(validateMorningReview({ cause: 'load', responsibility: 'forecast', lessons: '今日核对晚高峰负荷预测' }).ok).toBe(true)
  })

  it('存中文标签不算合法主因——防止绕过 id 映射直接落库', () => {
    const v = validateMorningReview({ cause: '负荷', responsibility: 'forecast', lessons: '今日核对晚高峰负荷预测' })
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
    expect(validateMorningReview({ cause: 'load', responsibility: 'forecast', lessons: '看负荷' }).ok).toBe(false)
    expect(validateMorningReview({ cause: 'load', responsibility: 'strategy', lessons: '盯晚高峰' }).ok).toBe(true)
  })

  it('空白不算内容', () => {
    expect(validateMorningReview({ cause: 'load', responsibility: 'operation', lessons: '     ' }).ok).toBe(false)
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

// ── 六维复盘扩展（需求文档 §四 需求 1/3）──────────────────────────────────────
describe('DEVIATION_RESPONSIBILITY：责任归属四分类（模板七）', () => {
  it('四分类为预测不准/突发情况/策略失误/操作失误，各有 label 与 hint', () => {
    expect(DEVIATION_RESPONSIBILITY.map((r) => r.id)).toEqual([
      'forecast', 'emergency', 'strategy', 'operation'
    ])
    for (const r of DEVIATION_RESPONSIBILITY) {
      expect(r.label.length, `${r.id} 缺 label`).toBeGreaterThan(0)
      expect(r.hint.length, `${r.id} 缺 hint`).toBeGreaterThan(0)
    }
  })

  it('isResponsibilityId 只认 id；与物理成因 id 互不串线', () => {
    expect(isResponsibilityId('forecast')).toBe(true)
    expect(isResponsibilityId('load')).toBe(false)
    expect(isResponsibilityId('预测不准')).toBe(false)
    expect(isResponsibilityId(undefined)).toBe(false)
  })

  it('responsibilityLabelOf 命中渲染中文；历史中文值原样返回，不显示「未知」', () => {
    expect(responsibilityLabelOf('emergency')).toBe('突发情况')
    expect(responsibilityLabelOf('客户原因')).toBe('客户原因')
    expect(responsibilityLabelOf('')).toBe('—')
  })
})

describe('validateMorningReview：责任归属校验（需求 1）', () => {
  const lessons = '今日核对晚高峰负荷预测'
  it('主因已判定但未选责任归属 → 拒', () => {
    const v = validateMorningReview({ cause: 'load', lessons })
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('责任归属')
  })
  it('责任归属存中文标签不算合法——与主因同一纪律', () => {
    const v = validateMorningReview({ cause: 'load', responsibility: '预测不准', lessons })
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('责任归属')
  })
  it('主因「无明显偏差」无责可归，可不填', () => {
    expect(validateMorningReview({ cause: 'none', lessons: '维持既有策略' }).ok).toBe(true)
  })
  it('主因「待分析」时责任归属同为欠条，不强制——强填只会逼出假归因', () => {
    expect(validateMorningReview({ cause: 'pending', lessons: '补齐出清明细后归因' }).ok).toBe(true)
  })
})

describe('aggregatePeakFlatValley：峰平谷聚合（需求 3 第二层）', () => {
  const YUNNAN = [
    { segment: '高峰', hours: [9, 10, 11, 17, 18, 19, 20, 21, 22], factor: 1 },
    { segment: '平段', hours: [7, 8, 12, 13, 14, 15, 16, 23], factor: 1 },
    { segment: '低谷', hours: [0, 1, 2, 3, 4, 5, 6], factor: 1 }
  ]
  /** 96 点每点 1 MWh 的均匀曲线：占比只由小时数决定（9/8/7 → 37.5/33.3/29.2）。 */
  const flat96 = Array.from({ length: 96 }, () => 1)

  it('均匀曲线按小时数分占比：高峰 9 点 37.5%、平段 8 点 33.3%、低谷 7 点 29.2%', () => {
    const rows = aggregatePeakFlatValley(flat96, YUNNAN)
    // 输出按段名排序（稳定），三段共 96 点全覆盖
    expect(rows).toHaveLength(3)
    expect(rows.reduce((a, r) => a + r.slots, 0)).toBe(96)
    const bySeg = Object.fromEntries(rows.map((r) => [r.segment, r]))
    expect(bySeg['高峰'].slots).toBe(36)
    expect(bySeg['平段'].slots).toBe(32)
    expect(bySeg['低谷'].slots).toBe(28)
    expect(bySeg['高峰'].sharePct).toBe(37.5)
    expect(bySeg['低谷'].sharePct).toBe(29.2)
    expect(rows.every((r) => r.totalMwh === r.slots)).toBe(true)
  })

  it('15 分钟点按起始整点归属段（点 35=8:45 属平段 8 时）', () => {
    const curve = Array.from({ length: 96 }, () => 0)
    curve[35] = 4 // 8:45
    const bySeg = Object.fromEntries(aggregatePeakFlatValley(curve, YUNNAN).map((r) => [r.segment, r]))
    expect(bySeg['平段'].totalMwh).toBe(4)
    expect(bySeg['高峰'].totalMwh).toBe(0)
  })

  it('全零曲线 sharePct 为 null，不用 0 冒充「无占比」', () => {
    const rows = aggregatePeakFlatValley(Array.from({ length: 96 }, () => 0), YUNNAN)
    expect(rows.every((r) => r.sharePct === null)).toBe(true)
  })

  it('时段定义未覆盖的小时计入「未定义段」，不静默丢弃', () => {
    const partial = [{ segment: '高峰', hours: [9], factor: 1 }]
    const rows = aggregatePeakFlatValley(flat96, partial)
    const undef = rows.find((r) => r.segment === '未定义段')
    expect(undef?.slots).toBe(92)
  })

  it('空输入返回空数组', () => {
    expect(aggregatePeakFlatValley([], YUNNAN)).toEqual([])
    expect(aggregatePeakFlatValley(null, YUNNAN)).toEqual([])
    expect(aggregatePeakFlatValley(flat96, [])).toEqual([])
  })
})
