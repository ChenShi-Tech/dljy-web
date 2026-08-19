// 场站出力客户端回归：96 点时刻映射 / 序列构建缺测纪律 / 异常检测阈值。
// 守住的不变量：
// 1. pointToTime 是 15min 一点的 96 点日历，point↔HH:mm 偏一点，整条曲线就横向
// 错位一个时段，与实际功率曲线叠加时假偏差。
// 2. buildPlantOutputSeries 缺测点必须落 null（不插 0），插 0 会把「没回传」画成
// 「停机」，异常检测跟着误报。
// 3. 数据源优先级（子站回传>实际功率、最终下发>草稿、预测白名单序），取错 dataType
// = 拿草稿计划当考核基准。
// 4. detectPlantOutputAnomalies 双阈值（% 或 MW 任一命中）；坏掉的症状是全量误报或漏报。
// 5. 取数层「真实或空」：mock 信封/网络错误 → rows 空不抛，meta 如实标注。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/captured', () => ({
  fetchCaptured: vi.fn(),
}))

import { fetchCaptured } from '@/services/captured'
import {
  ALL_PLANTS,
  availableForecastTypes,
  buildPlantOutputSeries,
  detectPlantOutputAnomalies,
  loadPlantOutputSourcePayload,
  pointToTime,
  summarizePlantOutput,
  type PlantOutputRow,
  type PlantOutputSeries,
} from '@/services/market/plantOutputClient'

function row(over: Partial<PlantOutputRow> & Pick<PlantOutputRow, 'point' | 'dataType' | 'seriesRole' | 'valueMw'>): PlantOutputRow {
  return {
    id: `r-${over.point}-${over.dataType}-${Math.random().toString(36).slice(2, 6)}`,
    date: '2026-05-15',
    plant: '风场A',
    timePoint: pointToTime(over.point),
    ...over,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pointToTime 96 点对拍', () => {
  it('15min 一点：1→00:00、2→00:15、5→01:00、96→23:45', () => {
    expect(pointToTime(1)).toBe('00:00')
    expect(pointToTime(2)).toBe('00:15')
    expect(pointToTime(5)).toBe('01:00')
    expect(pointToTime(96)).toBe('23:45')
  })

  it('全 96 点与公式对拍（第 i 点 = (i-1)*15 分钟）', () => {
    for (let p = 1; p <= 96; p += 1) {
      const minutes = (p - 1) * 15
      const expectTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      expect(pointToTime(p)).toBe(expectTime)
    }
  })

  it('越界 clamp：0/负数→00:00，>96→23:45（脏数据不越界崩溃）', () => {
    expect(pointToTime(0)).toBe('00:00')
    expect(pointToTime(-5)).toBe('00:00')
    expect(pointToTime(97)).toBe('23:45')
    expect(pointToTime(9999)).toBe('23:45')
  })
})

describe('availableForecastTypes', () => {
  it('只收集 forecast 角色的 dataType，actual/plan 不进', () => {
    const rows = [
      row({ point: 1, dataType: '超短期预测', seriesRole: 'forecast', valueMw: 10 }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 10 }),
      row({ point: 1, dataType: '最终下发', seriesRole: 'plan', valueMw: 10 }),
    ]
    expect(availableForecastTypes(rows)).toEqual(['超短期预测'])
  })

  it('白名单序优先（乱序输入仍按 超短期/国能日新/远景 输出），白名单外按中文序排后', () => {
    const rows = [
      row({ point: 1, dataType: '远景集团预测', seriesRole: 'forecast', valueMw: 1 }),
      row({ point: 2, dataType: '自研模型', seriesRole: 'forecast', valueMw: 1 }),
      row({ point: 3, dataType: '国能日新预测', seriesRole: 'forecast', valueMw: 1 }),
      row({ point: 4, dataType: '超短期预测', seriesRole: 'forecast', valueMw: 1 }),
    ]
    expect(availableForecastTypes(rows)).toEqual(['超短期预测', '国能日新预测', '远景集团预测', '自研模型'])
  })

  it('空输入 → 空数组', () => {
    expect(availableForecastTypes([])).toEqual([])
  })
})

describe('buildPlantOutputSeries（slot 粒度）', () => {
  it('times 恒 96 点；无行点位落 null（缺测不插 0）', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100 }),
    ])
    expect(s.times).toHaveLength(96)
    expect(s.times[0]).toBe('00:00')
    expect(s.times[95]).toBe('23:45')
    expect(s.actual[0]).toBe(100)
    expect(s.actual[1]).toBeNull() // point 2 无行
    expect(s.actual.filter((v) => v === 0)).toHaveLength(0) // 任何位置都不出现假 0
  })

  it('同点多机组等权均值', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100 }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 200 }),
    ])
    expect(s.actual[0]).toBe(150)
  })

  it('数据源优先级：actual 子站回传 > 实际功率；plan 最终下发 > 其它', () => {
    const s = buildPlantOutputSeries([
      // actual：存在子站回传时「实际功率」行不参与
      row({ point: 1, dataType: '实际功率', seriesRole: 'actual', valueMw: 50 }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100 }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 200 }),
      // plan：存在最终下发时「草稿」行不参与
      row({ point: 2, dataType: '草稿', seriesRole: 'plan', valueMw: 999 }),
      row({ point: 2, dataType: '最终下发', seriesRole: 'plan', valueMw: 300 }),
    ])
    expect(s.actual[0]).toBe(150) // (100+200)/2，实际功率 50 被忽略
    expect(s.actualSource).toBe('子站回传')
    expect(s.plan[1]).toBe(300)
    expect(s.targetSource).toBe('最终下发')
  })

  it('仅剩「实际功率」时作为 actual 兜底源', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '实际功率', seriesRole: 'actual', valueMw: 42 }),
    ])
    expect(s.actual[0]).toBe(42)
    expect(s.actualSource).toBe('实际功率')
  })

  it('forecast 无显式类型时按白名单序选源（同 point 内并存多类型才比优先级）', () => {
    // 白名单是逐 point 生效的：该点只有国能日新 → 兜底分支收下（无更优档可选）
    const onlySecond = buildPlantOutputSeries([
      row({ point: 1, dataType: '国能日新预测', seriesRole: 'forecast', valueMw: 50 }),
    ])
    expect(onlySecond.forecast[0]).toBe(50)

    // 同一 point 两档并存 → 只取白名单更靠前的「超短期预测」
    const both = buildPlantOutputSeries([
      row({ point: 1, dataType: '国能日新预测', seriesRole: 'forecast', valueMw: 50 }),
      row({ point: 1, dataType: '超短期预测', seriesRole: 'forecast', valueMw: 70 }),
    ])
    expect(both.forecast[0]).toBe(70)
    expect(both.forecastSource).toBe('超短期预测')
  })

  it('forecastType 显式指定时按 dataType 精确过滤', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '国能日新预测', seriesRole: 'forecast', valueMw: 50 }),
      row({ point: 1, dataType: '超短期预测', seriesRole: 'forecast', valueMw: 70 }),
    ], '国能日新预测')
    expect(s.forecast[0]).toBe(50)
    expect(s.forecastSource).toBe('国能日新预测')
  })

  it('target 选择：有 plan 用 plan（targetKind=plan），无 plan 用 forecast', () => {
    const withPlan = buildPlantOutputSeries([
      row({ point: 1, dataType: '最终下发', seriesRole: 'plan', valueMw: 100 }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 90 }),
      row({ point: 1, dataType: '超短期预测', seriesRole: 'forecast', valueMw: 80 }),
    ])
    expect(withPlan.targetKind).toBe('plan')
    expect(withPlan.target[0]).toBe(100)
    expect(withPlan.deviation[0]).toBe(-10) // 90-100
    expect(withPlan.completion[0]).toBe(90) // 90/100*100

    const noPlan = buildPlantOutputSeries([
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 60 }),
      row({ point: 1, dataType: '超短期预测', seriesRole: 'forecast', valueMw: 80 }),
    ])
    expect(noPlan.targetKind).toBe('forecast')
    expect(noPlan.target[0]).toBe(80)
    expect(noPlan.deviation[0]).toBe(-20)
  })

  it('completion：target 缺测或为 0 → null（除以 0 的 Infinity 不上图）', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 10 }),
      row({ point: 1, dataType: '最终下发', seriesRole: 'plan', valueMw: 0 }),
      row({ point: 2, dataType: '子站回传', seriesRole: 'actual', valueMw: 10 }),
      row({ point: 2, dataType: '最终下发', seriesRole: 'plan', valueMw: 20 }),
      row({ point: 3, dataType: '子站回传', seriesRole: 'actual', valueMw: 10 }),
      // point 3 无 plan/forecast → target null（序列已有 plan → 不回落 forecast）
    ])
    expect(s.completion[0]).toBeNull() // target=0（|t|<1e-9）
    expect(s.completion[1]).toBe(50) // 10/20*100
    expect(s.completion[2]).toBeNull() // target null
    expect(s.completion.every((v) => v === null || Number.isFinite(v))).toBe(true)
  })
})

describe('buildPlantOutputSeries（day 外聚合）', () => {
  it('month 聚合：按自然月分桶、跨日均值、label 带「月」', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100, date: '2026-05-01' }),
      row({ point: 2, dataType: '子站回传', seriesRole: 'actual', valueMw: 200, date: '2026-05-02' }),
      row({ point: 3, dataType: '子站回传', seriesRole: 'actual', valueMw: 400, date: '2026-06-01' }),
    ], undefined, 'month')
    expect(s.times).toEqual(['2026-05 月', '2026-06 月'])
    expect(s.actual).toEqual([150, 400])
    expect(s.aggregation).toBe('month')
  })

  it('week 聚合：ISO 周一分组（12-30 与 01-01 同周）', () => {
    const s = buildPlantOutputSeries([
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100, date: '2025-12-30' }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 200, date: '2026-01-01' }),
      row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 300, date: '2026-01-05' }),
    ], undefined, 'week')
    expect(s.times).toEqual(['2025-12-29 周', '2026-01-05 周'])
    expect(s.actual).toEqual([150, 300])
  })
})

describe('detectPlantOutputAnomalies', () => {
  function series(over: Partial<PlantOutputSeries> = {}): PlantOutputSeries {
    return {
      times: ['00:00', '00:15', '00:30'],
      actual: [80, 95, null],
      plan: [100, 100, 100],
      forecast: [],
      target: [100, 100, 100],
      deviation: [-20, -5, null],
      completion: [80, 95, null],
      actualSource: '子站回传', forecastSource: '预测', targetSource: '最终下发',
      targetKind: 'plan', aggregation: 'slot',
      ...over,
    }
  }

  it('正例：偏差 % 命中（|−20%| ≥ 10%）', () => {
    const out = detectPlantOutputAnomalies(series(), { deviationPct: 10, deviationMw: 1000 })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      timePoint: '00:00', actualMw: 80, targetMw: 100, deviationMw: -20, deviationPct: -20, completionPct: 80,
    })
  })

  it('正例：偏差 MW 维度命中（% 未达阈时 MW 兜住）', () => {
    // 00:00 偏差小（两维度都不达阈），00:15 只靠 MW 维度命中
    const s = series({ actual: [98, 94, null], deviation: [-2, -6, null], completion: [98, 94, null] })
    const out = detectPlantOutputAnomalies(s, { deviationPct: 50, deviationMw: 5 })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ timePoint: '00:15', deviationMw: -6, deviationPct: -6 })
  })

  it('反例：两维度都未达阈 → 空（正常波动不误报）', () => {
    const out = detectPlantOutputAnomalies(series(), { deviationPct: 30, deviationMw: 50 })
    expect(out).toEqual([])
  })

  it('缺测点（actual/target/deviation/completion 任一 null）跳过', () => {
    const out = detectPlantOutputAnomalies(series(), { deviationPct: 1, deviationMw: 1 })
    expect(out.map((a) => a.timePoint)).toEqual(['00:00', '00:15']) // 00:30 null 不进
  })

  it('target≈0 跳过（避免除零产生的假百分比）', () => {
    const s = series({
      times: ['00:00'],
      actual: [10], plan: [1e-10], target: [1e-10], deviation: [10 - 1e-10], completion: [null],
    })
    expect(detectPlantOutputAnomalies(s, { deviationPct: 1, deviationMw: 1 })).toEqual([])
  })

  it('groupLabel 透传到异常记录', () => {
    const out = detectPlantOutputAnomalies(series(), { deviationPct: 10, deviationMw: 1000 }, '1号机组')
    expect(out[0].groupLabel).toBe('1号机组')
  })
})

describe('summarizePlantOutput 数值对拍', () => {
  // 现行为注记：avg() 的过滤是 Number.isFinite(Number(v))，而 Number(null)===0 是
  // finite，序列里的 null 缺测点被当 0 计入均值（分子分母都算）。这与
  // maxAbsDeviation/pointCount 的 `!== null` 判空不一致，疑似应同口径；本文件记录
  // 现行为不修源码（见报告）。
  it('maxAbsDeviation / pointCount 正确忽略 null；avg 现行为把 null 当 0 计入', () => {
    const s: PlantOutputSeries = {
      times: ['00:00', '00:15', '00:30', '00:45'],
      actual: [100, null, 200, 60],
      plan: [100, 100, 100, 100],
      forecast: [],
      target: [100, 100, 100, 100],
      deviation: [0, null, 100, -30],
      completion: [100, null, 200, 60],
      actualSource: '子站回传', forecastSource: '预测', targetSource: '最终下发',
      targetKind: 'plan', aggregation: 'slot',
    }
    const summary = summarizePlantOutput(s, [{ timePoint: '00:30' } as never])
    expect(summary).toEqual({
      actualAvg: 90, // (100+0+200+60)/4：null 缺测点当 0 拉低均值（现行为）
      targetAvg: 100,
      completionAvg: 90,
      maxAbsDeviation: 100, // 该维度用 `!== null` 判空，null 不进
      anomalyCount: 1,
      pointCount: 3, // 同样正确忽略 null
    })
  })

  it('全缺测 → avg 现行为落 0 而非 null（maxAbsDeviation/pointCount 正确落 null/0）', () => {
    const s: PlantOutputSeries = {
      times: ['00:00'], actual: [null], plan: [], forecast: [], target: [null],
      deviation: [null], completion: [null],
      actualSource: '子站回传', forecastSource: '预测', targetSource: '最终下发',
      targetKind: 'plan', aggregation: 'slot',
    }
    expect(summarizePlantOutput(s, [])).toEqual({
      actualAvg: 0, targetAvg: 0, completionAvg: 0, // 现行为：null 当 0 → 0/1
      maxAbsDeviation: null, anomalyCount: 0, pointCount: 0,
    })
  })
})

describe('loadPlantOutputSourcePayload（真实或空）', () => {
  beforeEach(() => {
    vi.mocked(fetchCaptured).mockReset()
  })

  it('真实信封 → rows 解出 + meta 标注真实', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue({
      data: [row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100 })],
      provenance: { sourceType: 'REAL', realDataConnected: true, capturedAt: '2026-06-01T00:00:00Z' },
    })
    const p = await loadPlantOutputSourcePayload({ family: 'yn_plant_output', dataset: 'yn_plant_output', region: 'yunnan' }, '2026-05-15')
    expect(p.rows).toHaveLength(1)
    expect(p.meta).toMatchObject({ hasRealData: true, mock: false, sourceType: 'REAL', updatedAt: '2026-06-01T00:00:00Z' })
    expect(vi.mocked(fetchCaptured)).toHaveBeenCalledWith('yn_plant_output', 'yn_plant_output', {
      region: 'yunnan', dateFrom: '2026-05-15', dateTo: '2026-05-15',
    })
  })

  it('mock 信封 → rows 空、mock 如实标注（不展示合成出力）', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue({
      data: [row({ point: 1, dataType: '子站回传', seriesRole: 'actual', valueMw: 100 })],
      mock: true,
    })
    const p = await loadPlantOutputSourcePayload({ family: 'yn_plant_output', dataset: 'yn_plant_output', region: 'yunnan' })
    expect(p.rows).toEqual([])
    expect(p.meta.mock).toBe(true)
  })

  it('取数抛错 → rows 空 + meta.error 记录，不向上抛', async () => {
    vi.mocked(fetchCaptured).mockRejectedValue(new Error('network down'))
    const p = await loadPlantOutputSourcePayload({ family: 'yn_plant_output', dataset: 'yn_plant_output', region: 'yunnan' })
    expect(p.rows).toEqual([])
    expect(p.meta.error).toBe('network down')
  })

  it('日期区间输入归一化：dateRange 二元组 / 单日字符串同义', async () => {
    vi.mocked(fetchCaptured).mockResolvedValue({ data: [], provenance: { realDataConnected: true } })
    await loadPlantOutputSourcePayload({ family: 'f', dataset: 'd', region: 'r' }, ['2026-05-01', '2026-05-31'])
    expect(vi.mocked(fetchCaptured).mock.calls[0][2]).toMatchObject({ dateFrom: '2026-05-01', dateTo: '2026-05-31' })
  })
})

describe('ALL_PLANTS 语义常量', () => {
  it('哨兵值不被误当真实厂站名（下划线包裹）', () => {
    expect(ALL_PLANTS).toBe('__all__')
  })
})
