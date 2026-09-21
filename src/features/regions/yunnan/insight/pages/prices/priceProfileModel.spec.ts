// priceProfileModel 纯函数测试（dljy#3007 任务 6.8/6.9）
// ----------------------------------------------------------------------------
// 覆盖：网格归纳（真实时点集合不写死 96）、三维线拆段（缺测断开不补值、负价原样、
// 固定配色）、热力格子（缺测格子不存在、极值真实含负价）、默认剖面（最后一天 +
// 最高价时点、并列取最早）、双切面与证据表（缺一侧「—」、价差十进制）、窗口 7 天、
// 立体对象选择（同名多序列每阶段取一条、不合并）。
import { describe, expect, it } from 'vitest'
import {
  MAX_3D_NATIVE_POINTS,
  PHASE_LINE_COLOR,
  buildDayEvidence,
  buildDayProfile,
  buildHeatmap,
  buildLine3DSeries,
  buildPriceGrid,
  buildTimeOfDayEvidence,
  buildTimeOfDayProfile,
  defaultCrossSection,
  detectWebGL,
  objectNamesOf,
  selectObjectSeries,
  sevenDayWindowEndingAt,
  type ProfileRow,
  type ProfileSeriesEntry,
} from './priceProfileModel'

// ── 夹具 ─────────────────────────────────────────────────────────────────────────────────

function meta(seriesId: string, phase: 'day-ahead' | 'real-time', dimensions: Record<string, string | null> = {}): ProfileSeriesEntry {
  return {
    seriesId,
    sourceId: `src-${seriesId}`,
    fieldId: 'price',
    unit: '元/MWh',
    measureKind: 'price',
    dimensions,
    businessScope: 'yunnan',
    resolutionMinutes: 15,
    nativeResolutionMinutes: 15,
    priceObject: 'public-node',
    marketPhase: phase,
    variant: null,
  }
}

function row(seriesId: string, date: string, timeOfDay: string, value: string): ProfileRow {
  // 真实形状：时段 [timeOfDay, timeOfDay+15min)，首尾相接是三维线「连续」的判据。
  const [h, m] = timeOfDay.split(':').map(Number)
  const endMinutes = h! * 60 + m! + 15
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  return {
    seriesId,
    date,
    timeOfDay,
    intervalStart: `2025-06-${date.slice(-2)}T${timeOfDay}:00+08:00`,
    intervalEnd: `2025-06-${date.slice(-2)}T${endTime}:00+08:00`,
    value,
  }
}

/** 两天 × 日前+实时；第二天 00:30 缺实时、01:00 起有负价。 */
function makeGrid() {
  const series = [
    meta('da', 'day-ahead', { nodeName: 'A' }),
    meta('rt', 'real-time', { nodeName: 'A' }),
  ]
  const rows: ProfileRow[] = [
    row('da', '2025-06-06', '00:00', '210.5'),
    row('da', '2025-06-06', '00:15', '220'),
    row('rt', '2025-06-06', '00:00', '205.25'),
    row('rt', '2025-06-06', '00:15', '215'),
    row('da', '2025-06-07', '00:00', '150'),
    row('da', '2025-06-07', '00:15', '140'),
    row('da', '2025-06-07', '00:30', '130'),
    // 2025-06-07 00:30 实时缺测：行不存在
    row('rt', '2025-06-07', '00:00', '155'),
    row('rt', '2025-06-07', '00:15', '-12.5'),
    row('rt', '2025-06-07', '00:30', '145'),
  ]
  return buildPriceGrid(rows, series)
}

// ── 网格 ─────────────────────────────────────────────────────────────────────────────────

describe('buildPriceGrid', () => {
  it('时点与日期集合来自真实行（不按粒度补满，不写死 96/24）', () => {
    const grid = makeGrid()
    expect(grid.timePoints).toEqual(['00:00', '00:15', '00:30'])
    expect(grid.dates).toEqual(['2025-06-06', '2025-06-07'])
  })

  it('小时价 24 个时点也按真实行归纳', () => {
    const series = [meta('da', 'day-ahead')]
    const rows = Array.from({ length: 24 }, (_, h) => row('da', '2025-06-07', `${String(h).padStart(2, '0')}:00`, '100'))
    const grid = buildPriceGrid(rows, series)
    expect(grid.timePoints).toHaveLength(24)
    expect(grid.timePoints[0]).toBe('00:00')
    expect(grid.timePoints[23]).toBe('23:00')
  })

  it('非日前/实时阶段的序列不进网格', () => {
    const forecastSeries = { ...meta('other', 'day-ahead'), marketPhase: 'forecast' }
    const series = [meta('da', 'day-ahead'), forecastSeries]
    const grid = buildPriceGrid([row('da', '2025-06-07', '00:00', '100'), row('other', '2025-06-07', '00:00', '999')], series)
    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0]!.seriesId).toBe('da')
  })

  it('cell 按 阶段×日×时点 取值；缺测返回 undefined（不是 0）', () => {
    const grid = makeGrid()
    expect(grid.cell('real-time', '2025-06-06', '00:00')?.value).toBe('205.25')
    expect(grid.cell('real-time', '2025-06-07', '00:30')?.value).toBe('145')
    // 日前 00:45 不存在
    expect(grid.cell('day-ahead', '2025-06-07', '00:45')).toBeUndefined()
  })
})

// ── 三维线 ───────────────────────────────────────────────────────────────────────────────

describe('buildLine3DSeries', () => {
  it('每业务日×阶段一条线；日前/实时固定配色（不随日期变彩虹色）', () => {
    const lines = buildLine3DSeries(makeGrid())
    expect(lines.map((l) => [l.phase, l.date])).toEqual([
      ['day-ahead', '2025-06-06'],
      ['day-ahead', '2025-06-07'],
      ['real-time', '2025-06-06'],
      ['real-time', '2025-06-07'],
    ])
    for (const line of lines) {
      expect(line.color).toBe(PHASE_LINE_COLOR[line.phase])
    }
    expect(PHASE_LINE_COLOR['day-ahead']).not.toBe(PHASE_LINE_COLOR['real-time'])
  })

  it('缺测时段两侧拆段断开（不跨缺测连线、不补值）；缺测时点全局不存在时同样断开', () => {
    const series = [meta('rt', 'real-time')]
    const rows = [
      row('rt', '2025-06-07', '00:00', '100'),
      row('rt', '2025-06-07', '00:15', '110'),
      // 00:30 缺（所有序列都没有 → 时点也不进轴集合，下标连续但物理时段不相接）
      row('rt', '2025-06-07', '00:45', '130'),
      // 01:00 起连续
      row('rt', '2025-06-07', '01:00', '140'),
    ]
    const lines = buildLine3DSeries(buildPriceGrid(rows, series))
    expect(lines).toHaveLength(1)
    // 两段：[00:00, 00:15] 与 [00:45, 01:00]——下标连续也不能跨洞连线
    expect(lines[0]!.segments).toEqual([
      [
        [0, 0, 100],
        [1, 0, 110],
      ],
      [
        [2, 0, 130],
        [3, 0, 140],
      ],
    ])
  })

  it('负价原样为负（z 不截到 0）', () => {
    const lines = buildLine3DSeries(makeGrid())
    const rt0607 = lines.find((l) => l.phase === 'real-time' && l.date === '2025-06-07')!
    const values = rt0607.segments.flat().map((p) => p[2])
    expect(values).toContain(-12.5)
  })

  it('连续时点合为一段；时点下标按真实集合（非写死 96）', () => {
    const lines = buildLine3DSeries(makeGrid())
    const da0607 = lines.find((l) => l.phase === 'day-ahead' && l.date === '2025-06-07')!
    expect(da0607.segments).toEqual([
      [
        [0, 1, 150],
        [1, 1, 140],
        [2, 1, 130],
      ],
    ])
  })
})

// ── 热力 ─────────────────────────────────────────────────────────────────────────────────

describe('buildHeatmap', () => {
  it('缺测格子不存在（不是 0）；visualMap 极值是真实极值（含负价）', () => {
    const grid = makeGrid()
    const build = buildHeatmap(grid, 'real-time')!
    // 实时：06 有 2 格、07 有 3 格（无缺整日）→ 共 5 格，00:45 从未出现所以无格子
    expect(build.cells).toHaveLength(5)
    expect(build.min).toBe(-12.5)
    expect(build.max).toBe(215)
  })

  it('该阶段没有行返回 null', () => {
    const series = [meta('da', 'day-ahead')]
    const grid = buildPriceGrid([row('da', '2025-06-07', '00:00', '100')], series)
    expect(buildHeatmap(grid, 'real-time')).toBeNull()
  })

  it('全正价时极值仍为真实正区间（顺序色带场景）', () => {
    const grid = makeGrid()
    const build = buildHeatmap(grid, 'day-ahead')!
    expect(build.min).toBe(130)
    expect(build.max).toBe(220)
  })
})

// ── 默认剖面 ─────────────────────────────────────────────────────────────────────────────

describe('defaultCrossSection', () => {
  it('默认选窗口最后一天 + 该日最高价时点', () => {
    const grid = makeGrid()
    // 06-07 最高价：日前 00:00 = 150（实时 00:00=155 更高）
    expect(defaultCrossSection(grid)).toEqual({ date: '2025-06-07', timeOfDay: '00:00' })
  })

  it('并列最高取最早时点（十进制比较，210.5 与 210.50 视为相等）', () => {
    const series = [meta('da', 'day-ahead'), meta('rt', 'real-time')]
    const rows = [
      row('da', '2025-06-07', '00:15', '210.50'),
      row('rt', '2025-06-07', '00:00', '210.5'),
    ]
    const grid = buildPriceGrid(rows, series)
    expect(defaultCrossSection(grid)).toEqual({ date: '2025-06-07', timeOfDay: '00:00' })
  })

  it('空网格返回 null', () => {
    expect(defaultCrossSection(buildPriceGrid([], []))).toBeNull()
  })
})

// ── 双切面 ───────────────────────────────────────────────────────────────────────────────

describe('buildDayProfile / buildTimeOfDayProfile', () => {
  it('日剖面按真实时点集合给值；缺测为 null（断开）', () => {
    const grid = makeGrid()
    const facet = buildDayProfile(grid, '2025-06-06')
    expect(facet.da).toEqual([210.5, 220, null])
    expect(facet.rt).toEqual([205.25, 215, null])
  })

  it('跨日切面按业务日给值；负价原样', () => {
    const grid = makeGrid()
    const facet = buildTimeOfDayProfile(grid, '00:15')
    expect(facet.da).toEqual([220, 140])
    expect(facet.rt).toEqual([215, -12.5])
  })
})

// ── 证据表 ───────────────────────────────────────────────────────────────────────────────

describe('buildDayEvidence / buildTimeOfDayEvidence', () => {
  it('价差 = 日前 − 实时（十进制）；缺一侧为 null 显示「—」', () => {
    const grid = makeGrid()
    const cells = buildDayEvidence(grid, '2025-06-07')
    // 00:15：日前 140、实时 -12.5 → 价差 152.5（十进制减法，非浮点）
    const c0015 = cells.find((c) => c.key === '00:15')!
    expect(c0015.dayAhead).toBe('140')
    expect(c0015.realTime).toBe('-12.5')
    expect(c0015.spread).toBe('152.5')
    // 00:30：日前 130、实时 145 → -15
    expect(cells.find((c) => c.key === '00:30')!.spread).toBe('-15')
    // 完全没有行的时点不出现
    expect(cells.map((c) => c.key)).toEqual(['00:00', '00:15', '00:30'])
  })

  it('至少一侧有行即成行；只缺一侧时价差为 null', () => {
    const series = [meta('da', 'day-ahead')]
    const grid = buildPriceGrid([row('da', '2025-06-07', '08:00', '300')], series)
    const cells = buildTimeOfDayEvidence(grid, '08:00')
    expect(cells).toHaveLength(1)
    expect(cells[0]!.dayAhead).toBe('300')
    expect(cells[0]!.realTime).toBeNull()
    expect(cells[0]!.spread).toBeNull()
  })
})

// ── 立体对象选择 ─────────────────────────────────────────────────────────────────────────

describe('selectObjectSeries / objectNamesOf', () => {
  const series = [
    meta('da-1', 'day-ahead', { nodeName: '节点A' }),
    meta('da-2', 'day-ahead', { nodeName: '节点B' }),
    meta('rt-1', 'real-time', { nodeName: '节点A' }),
    meta('rt-2', 'real-time', { nodeName: '节点B' }),
  ]

  it('未指定对象名或无对象维度 → 全部序列', () => {
    expect(selectObjectSeries(series, null, 'nodeName')).toHaveLength(4)
    expect(selectObjectSeries(series, '节点A', null)).toHaveLength(4)
  })

  it('指定对象 → 只留该对象序列', () => {
    const picked = selectObjectSeries(series, '节点A', 'nodeName')
    expect(picked.map((s) => s.seriesId).sort()).toEqual(['da-1', 'rt-1'])
  })

  it('同名多条序列（同对象名两个上游节点）每阶段只取 seriesId 排序第一条，不合并', () => {
    const dup = [
      meta('da-x2', 'day-ahead', { nodeName: '节点A' }),
      meta('da-x1', 'day-ahead', { nodeName: '节点A' }),
      meta('rt-y', 'real-time', { nodeName: '节点A' }),
    ]
    const picked = selectObjectSeries(dup, '节点A', 'nodeName')
    expect(picked.map((s) => s.seriesId).sort()).toEqual(['da-x1', 'rt-y'])
  })

  it('对象名清单升序去重', () => {
    expect(objectNamesOf(series, 'nodeName')).toEqual(['节点A', '节点B'])
    expect(objectNamesOf(series, null)).toEqual([])
  })
})

// ── 窗口与检测 ───────────────────────────────────────────────────────────────────────────

describe('sevenDayWindowEndingAt / detectWebGL / MAX_3D_NATIVE_POINTS', () => {
  it('以结束日往前数 7 天（共 7 天）', () => {
    expect(sevenDayWindowEndingAt('2025-06-07')).toEqual({ start: '2025-06-01', end: '2025-06-07' })
    expect(sevenDayWindowEndingAt('2025-03-02')).toEqual({ start: '2025-02-24', end: '2025-03-02' })
  })

  it('非法日期原样返回单日（不造窗口）', () => {
    expect(sevenDayWindowEndingAt('not-a-date')).toEqual({ start: 'not-a-date', end: 'not-a-date' })
  })

  it('node 环境无 document → WebGL 检测返回 false（不抛错）', () => {
    expect(detectWebGL()).toBe(false)
  })

  it('三维预算上限为 6000 原生点', () => {
    expect(MAX_3D_NATIVE_POINTS).toBe(6000)
  })
})

// ── 统计不随抽样与呈现次序改变（16.8 / A20）────────────────────────────────────────────────
// D6.1/A20 的「降采样不改变统计」在纯函数层的落点：网格是唯一事实面，三维顶点、热力格子、
// 证据表与切面全部从同一份 rows 归纳；行序、呈现次序、拆段与阶梯只是表达，
// 不允许新增或改动任何观测点。

describe('统计不随抽样与呈现次序改变（16.8）', () => {
  it('rows 乱序输入：网格轴、热力极值与格子数与原序一致（行序是传输细节，不进统计）', () => {
    const series = [meta('da', 'day-ahead'), meta('rt', 'real-time')]
    const rows: ProfileRow[] = [
      row('rt', '2025-06-07', '00:30', '145'),
      row('da', '2025-06-06', '00:00', '210.5'),
      row('rt', '2025-06-06', '00:15', '215'),
      row('da', '2025-06-07', '00:30', '130'),
      row('rt', '2025-06-07', '00:00', '155'),
      row('da', '2025-06-06', '00:15', '220'),
      row('rt', '2025-06-06', '00:00', '205.25'),
      row('da', '2025-06-07', '00:15', '140'),
      row('rt', '2025-06-07', '00:15', '-12.5'),
      row('da', '2025-06-07', '00:00', '150'),
    ]
    const ordered = buildPriceGrid(rows, series)
    const shuffled = buildPriceGrid([...rows].reverse(), series)
    expect(shuffled.timePoints).toEqual(ordered.timePoints)
    expect(shuffled.dates).toEqual(ordered.dates)
    const h1 = buildHeatmap(ordered, 'real-time')!
    const h2 = buildHeatmap(shuffled, 'real-time')!
    expect(h2.min).toBe(h1.min)
    expect(h2.max).toBe(h1.max)
    expect(h2.cells).toHaveLength(h1.cells.length)
  })

  it('三维顶点合计 === 网格原生行数：阶梯与拆段只是表达，不新增观测点', () => {
    const grid = makeGrid()
    expect(grid.rows.length).toBeGreaterThan(0)
    const lines = buildLine3DSeries(grid)
    const vertexCount = lines.flatMap((line) => line.segments).reduce((sum, seg) => sum + seg.length, 0)
    expect(vertexCount).toBe(grid.rows.length)
  })

  it('缺测拆段无桥接顶点：各段顶点一一对应真实行，段间不存在补出的连接点', () => {
    const series = [meta('rt', 'real-time')]
    const rows = [
      row('rt', '2025-06-07', '00:00', '100'),
      row('rt', '2025-06-07', '00:15', '110'),
      // 00:30 缺测（该时点全局不存在，轴下标连续也不能连线）
      row('rt', '2025-06-07', '00:45', '130'),
      row('rt', '2025-06-07', '01:00', '140'),
    ]
    const grid = buildPriceGrid(rows, series)
    const segments = buildLine3DSeries(grid)[0]!.segments
    expect(segments).toHaveLength(2)
    const flat = segments.reduce((sum, seg) => sum + seg.length, 0)
    expect(flat).toBe(rows.length)
  })

  it('全负价序列：热力极值两端均为负（轴 domain 可整体为负），切面与默认剖面照常解析', () => {
    const series = [meta('rt', 'real-time')]
    const grid = buildPriceGrid(
      [
        row('rt', '2025-06-06', '00:00', '-30'),
        row('rt', '2025-06-06', '00:15', '-45'),
        row('rt', '2025-06-07', '00:00', '-20'),
      ],
      series
    )
    const build = buildHeatmap(grid, 'real-time')!
    expect(build.min).toBe(-45)
    expect(build.max).toBeLessThan(0)
    expect(buildDayProfile(grid, '2025-06-06').rt).toEqual([-30, -45])
    // 默认剖面仍取「最高」价（最接近 0 的 -20，不向 0 截断）
    expect(defaultCrossSection(grid)).toEqual({ date: '2025-06-07', timeOfDay: '00:00' })
  })

  it('同一网格下三维顶点、热力格子与证据表对同一时段给出同一值（各视图不各自抽样）', () => {
    const grid = makeGrid()
    // 2025-06-07 00:15 实时 = -12.5
    const x = grid.timePoints.indexOf('00:15')
    const y = grid.dates.indexOf('2025-06-07')
    const line = buildLine3DSeries(grid).find((l) => l.phase === 'real-time' && l.date === '2025-06-07')!
    const vertex = line.segments.flat().find((p) => p[0] === x)!
    expect(vertex[2]).toBe(-12.5)
    const heat = buildHeatmap(grid, 'real-time')!
    expect(heat.cells).toContainEqual([x, y, -12.5])
    const evidence = buildDayEvidence(grid, '2025-06-07').find((c) => c.key === '00:15')!
    expect(evidence.realTime).toBe('-12.5')
  })
})
