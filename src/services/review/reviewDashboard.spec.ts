import { describe, expect, it } from 'vitest'
import {
  HIDDEN_TABS,
  TAB_ORDER,
  TAB_SHORT,
  VISIBLE_TABS,
  deviationDetailRows,
  filterReportsByRange,
  dimSignal,
  heatCells,
  hourOf,
  hourlySpreadPnl,
  isShellTab,
  parseDimQuery,
  priceStats,
  shiftDate
} from './reviewDashboard'
import { buildDimensionCards } from './cockpitModel'
import type { ReviewDetailPoint } from '@/services/quant/quantClient'

// 变异纪律：每条断言在提交前都做过「改坏实现 → 必须红」的手工核对（见 PR 验证记录），
// 尤其守 null/跳过语义——这些分支最容易被「顺手折成 0」抹掉。

describe('标签顺序与深链解析', () => {
  it('六维 + 主体共七个标签，偏差居首、主体垫底', () => {
    expect(TAB_ORDER).toEqual(['deviation', 'result', 'market', 'strategy', 'risk', 'decision', 'subject'])
    expect(Object.keys(TAB_SHORT)).toHaveLength(7)
  })

  it('parseDimQuery 合法值透传、非法值/缺省/数组落回默认，不抛', () => {
    expect(parseDimQuery('market')).toBe('market')
    expect(parseDimQuery('subject')).toBe('subject')
    expect(parseDimQuery('nope')).toBe('deviation')
    expect(parseDimQuery(undefined)).toBe('deviation')
    expect(parseDimQuery(['risk'])).toBe('deviation')
    expect(parseDimQuery(null, 'result')).toBe('result')
  })

  it('isShellTab 只认七个键', () => {
    expect(isShellTab('decision')).toBe(true)
    expect(isShellTab('culture')).toBe(false)
    expect(isShellTab(3)).toBe(false)
  })

  it('风险/决策/主体藏而不删：tab 栏不渲染（VISIBLE_TABS），深链仍合法', () => {
    expect(HIDDEN_TABS).toEqual(['risk', 'decision', 'subject'])
    // 可见标签 = 全量顺序滤掉隐藏项，不能有遗漏/乱序/重复
    expect(VISIBLE_TABS).toEqual(['deviation', 'result', 'market', 'strategy'])
    expect(VISIBLE_TABS.every((t) => TAB_ORDER.includes(t))).toBe(true)
    // 藏而不删的深链保底：?dim=risk 依旧解析为该维，不落回偏差默认
    expect(parseDimQuery('risk')).toBe('risk')
    expect(parseDimQuery('decision')).toBe('decision')
    expect(parseDimQuery('subject')).toBe('subject')
  })
})

describe('标签就绪度信号', () => {
  const cards = buildDimensionCards()
  const cardOf = (k: string) => cards.find((c) => c.key === k) ?? null

  it('调用方判定 live 时恒 live，不看注册表', () => {
    expect(dimSignal(true, cardOf('strategy'))).toBe('live')
  })

  it('该维有 ready 模板 → pending（数据源在、页面此刻没数），不是 gap', () => {
    const deviation = cardOf('deviation')
    expect(deviation!.counts.ready).toBeGreaterThan(0)
    expect(dimSignal(false, deviation)).toBe('pending')
  })

  it('ready=0 且 dataGap>0 才是 gap', () => {
    expect(dimSignal(false, { key: 'risk', label: '风险', templates: [], counts: { ready: 0, dataGap: 3, deferred: 0 }, anchor: null })).toBe('gap')
    expect(dimSignal(false, { key: 'risk', label: '风险', templates: [], counts: { ready: 0, dataGap: 0, deferred: 2 }, anchor: null })).toBe('pending')
  })

  it('无卡片（未知维）不抛，落 pending', () => {
    expect(dimSignal(false, null)).toBe('pending')
    expect(dimSignal(false, undefined)).toBe('pending')
  })
})

describe('日期步进', () => {
  it('跨月/跨年/闰日都按公历走，不受本地时区影响', () => {
    expect(shiftDate('2026-05-18', 1)).toBe('2026-05-19')
    expect(shiftDate('2026-05-01', -1)).toBe('2026-04-30')
    expect(shiftDate('2025-12-31', 1)).toBe('2026-01-01')
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftDate('2026-05-18', 0)).toBe('2026-05-18')
  })
})

describe('96 格热力条', () => {
  it('实际>申报为 over、<为 under、alpha 随 |比率| 线性到满刻度封顶、下限 0.12', () => {
    const cells = heatCells([
      { datetime: '2026-05-18 00:00', declared: 100, actual: 103.5 },   // +3.5% → 0.5
      { datetime: '2026-05-18 00:15', declared: 100, actual: 90 },      // −10% → 封顶 1
      { datetime: '2026-05-18 00:30', declared: 100, actual: 100.1 }    // +0.1% → 下限 0.12
    ])
    expect(cells.map((c) => c.tone)).toEqual(['over', 'under', 'over'])
    expect(cells[0].alpha).toBeCloseTo(0.5, 5)
    expect(cells[1].alpha).toBe(1)
    expect(cells[2].alpha).toBe(0.12)
    expect(cells[0].label).toBe('00:00')
  })

  it('申报为 0 的格子 flat 且 ratio=null，不除零', () => {
    const [c] = heatCells([{ datetime: '2026-05-18 12:00', declared: 0, actual: 5 }])
    expect(c.tone).toBe('flat')
    expect(c.ratio).toBeNull()
  })
})

describe('分时价差盈亏', () => {
  const pt = (dt: string, declared: number, actual: number, da?: number, rt?: number): ReviewDetailPoint =>
    ({ datetime: dt, declared, actual, deviation: actual - declared, assessed_mwh: 0, da_price: da, rt_price: rt })

  it('按小时聚合 (da−rt)×(actual−declared)，"T"/空格分隔都认', () => {
    const { hours, missing } = hourlySpreadPnl([
      pt('2026-05-18 19:00', 80, 90, 500, 450),   // (50)×(10) = 500
      pt('2026-05-18T19:15', 80, 70, 500, 560),   // (−60)×(−10) = 600
      pt('2026-05-18 12:00', 80, 75, 300, 320)    // (−20)×(−5) = 100
    ])
    expect(hours[19]).toBe(1100)
    expect(hours[12]).toBe(100)
    expect(hours.filter((v) => v !== 0)).toHaveLength(2)
    expect(missing).toBe(0)
  })

  it('缺价点跳过并计数，不按 0 价臆造', () => {
    const { hours, missing } = hourlySpreadPnl([
      pt('2026-05-18 08:00', 80, 90, undefined, 450),
      pt('2026-05-18 08:15', 80, 90, 500, undefined),
      pt('bad', 80, 90, 500, 450)
    ])
    expect(hours.every((v) => v === 0)).toBe(true)
    expect(missing).toBe(3)
  })

  it('hourOf 解析边界', () => {
    expect(hourOf('2026-05-18 23:45')).toBe(23)
    expect(hourOf('2026-05-18T00:00')).toBe(0)
    expect(hourOf('2026-05-18 24:00')).toBeNull()
    expect(hourOf(undefined)).toBeNull()
  })
})

describe('市场价格统计', () => {
  const pt = (da?: number, rt?: number): ReviewDetailPoint =>
    ({ datetime: 'x', declared: 1, actual: 1, deviation: 0, assessed_mwh: 0, da_price: da, rt_price: rt })

  it('只统计双侧都有价的点，spread = 日前均 − 实时均', () => {
    const s = priceStats([pt(300, 320), pt(500, 480), pt(400, undefined)])
    expect(s).not.toBeNull()
    expect(s!.points).toBe(2)
    expect(s!.daAvg).toBe(400)
    expect(s!.rtAvg).toBe(400)
    expect(s!.spread).toBe(0)
    expect(s!.daPeak).toBe(500)
    expect(s!.daValley).toBe(300)
    expect(s!.rtPeak).toBe(480)
    expect(s!.rtValley).toBe(320)
  })

  it('一个双侧点都没有 → null（不出全 0）', () => {
    expect(priceStats([pt(300, undefined), pt(undefined, 320)])).toBeNull()
    expect(priceStats([])).toBeNull()
  })
})

// 偏差 96 点逐时明细行（清单 R8）：图-表同源——带内判定与主图容差带同口径，
// 合计受考核电量与 KPI 卡同口径。坏掉的症状：表合计 ≠ KPI、带内外判定与图上带矛盾。
describe('偏差 96 点明细行', () => {
  const pt = (datetime: string, declared: number, actual: number, assessed = 0) =>
    ({ datetime, declared, actual, deviation: actual - declared, assessed_mwh: assessed }) as ReviewDetailPoint

  it('label 取 datetime 尾部、tone 与热力条同规则（over/under/申报0为flat）', () => {
    const rows = deviationDetailRows([
      pt('2026-05-18 00:00', 100, 110, 2),
      pt('2026-05-18 00:15', 100, 90, 2),
      pt('2026-05-18 00:30', 0, 5, 1)
    ], 3)
    expect(rows.map((r) => r.label)).toEqual(['00:00', '00:15', '00:30'])
    expect(rows.map((r) => r.tone)).toEqual(['over', 'under', 'flat'])
  })

  it('带内按 |actual−declared| ≤ declared×容差%：容差带边界内/外两侧', () => {
    // 容差 5%、申报 100 → 带宽 ±5：104 带内、106 超带
    const rows = deviationDetailRows([pt('2026-05-18 00:00', 100, 104), pt('2026-05-18 00:15', 100, 106)], 5)
    expect(rows.map((r) => r.inBand)).toEqual([true, false])
  })

  it('申报为 0：actual=0 记带内、actual>0 记超带（与图上零高度带一致，不出第三种口径）', () => {
    const rows = deviationDetailRows([pt('2026-05-18 00:00', 0, 0), pt('2026-05-18 00:15', 0, 3)], 3)
    expect(rows.map((r) => r.inBand)).toEqual([true, false])
  })

  it('assessedMwh 原样透传供合计对拍 KPI；非有限数值折 0 不污染求和', () => {
    const rows = deviationDetailRows([
      pt('2026-05-18 00:00', 100, 104, 1.5),
      { datetime: '2026-05-18 00:15', declared: 100, actual: 106, deviation: 6, assessed_mwh: Number.NaN } as unknown as ReviewDetailPoint
    ], 5)
    expect(rows[0].assessedMwh).toBe(1.5)
    expect(rows[1].assessedMwh).toBe(0)
  })
})

// 报告库归档区间过滤（清单 R4「全部报告」列表）：mtime → 北京日期（+08:00），
// 闭区间、边界空串不限。坏掉的症状：UTC 晚 8 点后的报告被归到前一天。
describe('报告库归档区间过滤', () => {
  const rep = (id: string, beijingIso: string) =>
    ({ session_id: id, path: 'p', title: id, mtime: new Date(`${beijingIso}+08:00`).getTime() / 1000 })
  const reports = [
    rep('a', '2026-05-30 07:00'), // UTC 05-29 23:00 —— 北京日期必须算成 05-30
    rep('b', '2026-05-31 12:00'),
    rep('c', '2026-06-02 09:00')
  ]

  it('按北京日期落区间，闭区间两端都含', () => {
    expect(filterReportsByRange(reports, '2026-05-30', '2026-05-31').map((r) => r.session_id)).toEqual(['a', 'b'])
    expect(filterReportsByRange(reports, '2026-05-31', '2026-05-31').map((r) => r.session_id)).toEqual(['b'])
  })

  it('边界空串表示不限；无命中返回空数组', () => {
    expect(filterReportsByRange(reports, '', '2026-05-31').map((r) => r.session_id)).toEqual(['a', 'b'])
    expect(filterReportsByRange(reports, '2026-06-01', '').map((r) => r.session_id)).toEqual(['c'])
    expect(filterReportsByRange(reports, '', '')).toHaveLength(3)
    expect(filterReportsByRange(reports, '2020-01-01', '2020-12-31')).toEqual([])
  })
})
