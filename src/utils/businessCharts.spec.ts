// 业务图表 builder 回归：agent 产出的语义 JSON → ECharts option。
// 守的不变量：① 诚实降级——无法构成有效图表时返回 null（由解析器降级为 JSON 代码块），
// 绝不产一张误导性的空图/错图；② 业务语义——申报价阶梯、预测带 stack、K 线涨红跌绿、
// 瀑布累计分解等结构约定，错一个字段图表就「能看但全错」（用户照图报错价）。
// 深测 declaration/forecast/candle 三个代表，其余 builder 各守 smoke 两态。
import { describe, expect, it } from 'vitest'
import {
  buildDeclarationOption,
  buildForecastOption,
  buildCandleOption,
  buildPositionOption,
  buildArbitrageOption,
  buildStorageOption,
  buildGaugeOption,
  buildClearingOption,
  buildGeoOption,
  buildHeatmapOption,
  buildWaterfallOption,
  buildSankeyOption,
  buildPieOption
} from './businessCharts'

type ChartOpt = Record<string, unknown>
type ChartSeries = Record<string, unknown>
/** builder 返回 Record<string, unknown>；series 下标访问统一走这里消 TS unknown。 */
const sOf = (opt: ChartOpt | null): ChartSeries[] => ((opt ?? {}).series as ChartSeries[]) ?? []

describe('buildDeclarationOption（申报曲线）', () => {
  const data = {
    points: [
      { t: '00:15', price: 300, mw: 10 },
      { t: '00:30', price: 310, mw: 12 },
      { t: '00:45', price: 320, mw: 8 }
    ],
    priceCap: 500,
    priceFloor: 100
  }

  it('标准形状：电量 bar + 价格阶梯线 + 上下限 markLine + 双 y 轴', () => {
    const opt = buildDeclarationOption(data)!
    expect(opt.xAxis).toMatchObject({ type: 'category', data: ['00:15', '00:30', '00:45'], boundaryGap: true })
    expect(opt.yAxis).toEqual([
      { type: 'value', name: '元/MWh' },
      { type: 'value', name: 'MW' }
    ])
    const [bar, line] = sOf(opt) as Array<Record<string, unknown>>
    expect(bar).toMatchObject({ name: '申报电量', type: 'bar', data: [10, 12, 8], yAxisIndex: 1 })
    expect(line).toMatchObject({ name: '申报价格', type: 'line', step: 'middle', data: [300, 310, 320], yAxisIndex: 0 })
    expect((line as { markLine: { data: unknown[] } }).markLine.data).toEqual([
      { yAxis: 500, name: '限价上限' },
      { yAxis: 100, name: '限价下限' }
    ])
  })

  it('价格阶梯用 middle（半步居中贴合分时段价），不是默认折线', () => {
    expect(sOf(buildDeclarationOption({ points: [{ t: 1, price: 1 }] }))[0]).toMatchObject({ step: 'middle' })
  })

  it('agent 变体 {priceCurve.data, annotations}：平行数组成点、标注按 hour 落点', () => {
    const opt = buildDeclarationOption({
      priceCurve: { data: [100, 200] },
      annotations: [{ hour: 2, text: '尖峰', type: 'critical' }]
    })!
    expect(opt.xAxis).toMatchObject({ data: ['1', '2'] }) // 平行数组 t 退化为序号
    const line = sOf(opt)[0] as Record<string, { data: Array<Record<string, unknown>> }>
    expect(line).toMatchObject({ type: 'line', data: [100, 200] })
    const mp = (line.markPoint as { data: Array<Record<string, unknown>> }).data
    expect(mp[0]).toMatchObject({ name: '尖峰', coord: ['2', 200] }) // hour=2 → 索引 1
    expect((mp[0].itemStyle as { color: string }).color).toBe('#dc2626') // critical → 红
  })

  it('标注 hour 越界时钳到最后一个点位（不产越界坐标）', () => {
    const opt = buildDeclarationOption({
      priceCurve: { data: [100] },
      annotations: [{ hour: 99, text: 'x' }]
    })!
    const mp = ((sOf(opt)[0] as Record<string, unknown>).markPoint as { data: Array<{ coord: unknown[] }> }).data
    expect(mp[0].coord).toEqual(['1', 100])
  })

  it('只有电量时单 bar、y 轴名 MW；只有价格时单线、y 轴名 元/MWh', () => {
    const onlyMw = buildDeclarationOption({ points: [{ t: 'a', mw: 5 }] })!
    expect(sOf(onlyMw)).toHaveLength(1)
    expect(sOf(onlyMw)[0]).toMatchObject({ type: 'bar', yAxisIndex: 0 })
    expect(onlyMw.yAxis).toEqual([{ type: 'value', name: 'MW' }])
    const onlyPrice = buildDeclarationOption({ points: [{ t: 'a', price: 5 }] })!
    expect(sOf(onlyPrice)).toHaveLength(1)
    expect(onlyPrice.yAxis).toEqual([{ type: 'value', name: '元/MWh' }])
  })

  it.each([
    ['null', null],
    ['空对象', {}],
    ['空 points', { points: [] }],
    ['点位全无有效数值', { points: [{ t: 'a' }, { t: 'b' }] }],
    ['数值字段是脏字符串', { points: [{ t: 'a', price: 'abc', mw: 'x' }] }],
    ['输入是普通字符串', 'not-json-at-all']
  ])('诚实降级：%s → null（不画空图）', (_label, input) => {
    expect(buildDeclarationOption(input)).toBeNull()
  })

  it('半脏点位：只保留有 price 的序列而 mw 全 NaN 时退化为单线', () => {
    const opt = buildDeclarationOption({ points: [{ t: 'a', price: 5 }, { t: 'b', price: 6 }] })!
    expect(sOf(opt)).toHaveLength(1)
    expect(sOf(opt)[0]).toMatchObject({ name: '申报价格' })
  })
})

describe('buildForecastOption（价格预测带）', () => {
  const data = {
    points: [
      { t: '01', value: 100, lower: 80, upper: 130 },
      { t: '02', value: 110 }, // 该点缺 band
      { t: '03', value: 120, lower: 90, upper: 160 }
    ]
  }

  it('中值 + 置信带 stack：range = upper - lower 手算对拍', () => {
    const opt = buildForecastOption(data)!
    expect(opt.xAxis).toMatchObject({ data: ['01', '02', '03'], boundaryGap: false })
    const [lo, band, mid] = sOf(opt) as Array<Record<string, unknown>>
    expect(lo).toMatchObject({ name: '下界', stack: 'conf', data: [80, null, 90] }) // 缺 band 的点是 null 槽，不编 0
    // 手算：130-80=50、160-90=70；02 点 null。
    expect(band).toMatchObject({ name: '置信区间', stack: 'conf', data: [50, null, 70] })
    expect(mid).toMatchObject({ name: '预测中值', data: [100, 110, 120], step: 'end' })
    expect(opt.legend).toMatchObject({ data: ['预测中值', '置信区间'] })
    expect(opt.yAxis).toMatchObject({ name: '元/MWh', scale: true }) // scale: 不强制从 0 起
  })

  it('全部点无 band → 单中值线、legend 不出现置信区间', () => {
    const opt = buildForecastOption({ points: [{ t: 1, value: 5 }, { t: 2, value: 6 }] })!
    expect(sOf(opt)).toHaveLength(1)
    expect(opt.legend).toMatchObject({ data: ['预测中值'] })
  })

  it('agent 平行数组变体 {time, value, lower, upper}', () => {
    const opt = buildForecastOption({
      time: ['a', 'b'],
      value: [1, 2],
      lower: [0, 0],
      upper: [2, 4]
    })!
    expect(opt.xAxis).toMatchObject({ data: ['a', 'b'] })
    const [lo, band, mid] = sOf(opt) as Array<{ data: number[] }>
    expect(lo.data).toEqual([0, 0])
    expect(band.data).toEqual([2, 4]) // 手算 2-0=2、4-0=4
    expect(mid.data).toEqual([1, 2])
  })

  it('unit 覆盖默认单位', () => {
    expect(buildForecastOption({ points: [{ t: 1, value: 5 }], unit: 'MW' })!.yAxis).toMatchObject({ name: 'MW' })
  })

  it.each([
    ['null', null],
    ['空对象', {}],
    ['空 points', { points: [] }],
    ['中值全非数', { points: [{ t: 'a', lower: 1, upper: 2 }] }] // 只有 band 没有 mid 也降级
  ])('诚实降级：%s → null', (_label, input) => {
    expect(buildForecastOption(input)).toBeNull()
  })
})

describe('buildCandleOption（电价 K 线）', () => {
  const data = {
    points: [
      { t: '5-1', open: 10, close: 12, low: 9, high: 13 },
      { t: '5-2', open: 12, close: 11 }, // 缺 high/low
      { t: '5-3', close: 15, low: 1, high: 20 } // 缺 open
    ],
    ma: [2, 1]
  }

  it('OHLC 顺序开/收/低/高，缺字段兜底，坏点跳过', () => {
    const opt = buildCandleOption(data)!
    expect(opt.xAxis).toMatchObject({ data: ['5-1', '5-2'] }) // 5-3 缺 open 整点跳过
    const [candle, ma2] = sOf(opt) as Array<Record<string, unknown>>
    // 手算：5-2 缺 high/low → high=max(12,11)=12、low=min(12,11)=11
    expect(candle).toMatchObject({
      type: 'candlestick',
      data: [
        [10, 12, 9, 13],
        [12, 11, 11, 12]
      ]
    })
    // 涨红跌绿（国内习惯）
    expect(candle.itemStyle).toMatchObject({ color: '#dc2626', color0: '#16a34a' })
    // 手算 MA2：closes=[12,11] → 首点无满窗 null，次点 (12+11)/2=11.5
    expect(ma2).toMatchObject({ name: 'MA2', type: 'line', data: [null, 11.5] })
  })

  it('ma 周期 <2 被过滤（1 日均线无意义）', () => {
    expect(buildCandleOption(data)!.series).toHaveLength(2) // candle + MA2，无 MA1
  })

  it('agent 平行数组变体 {time, open, close}', () => {
    const opt = buildCandleOption({ time: ['d1'], open: [5], close: [6] })!
    expect(sOf(opt)[0]).toMatchObject({
      type: 'candlestick',
      data: [[5, 6, 5, 6]] // 缺 high/low 兜底 min/max(open,close)
    })
  })

  it.each([
    ['null', null],
    ['空对象', {}],
    ['无 open/close', { points: [{ t: 'a', low: 1, high: 2 }] }]
  ])('诚实降级：%s → null', (_label, input) => {
    expect(buildCandleOption(input)).toBeNull()
  })
})

// ── 其余 builder：smoke 两态（脏输入 → null 不画误导图；最小合法 fixture → 非 null 且关键结构在） ──

describe('buildPositionOption（持仓敞口）', () => {
  it('最小 fixture：中长期/现货堆叠 + 净敞口线', () => {
    const opt = buildPositionOption({ items: [{ label: '1月', midlong: 100, spot: -30, net: 70 }] })!
    expect(sOf(opt).map((s: Record<string, unknown>) => s.name)).toEqual(['中长期', '现货', '净敞口'])
    expect(sOf(opt)[0]).toMatchObject({ type: 'bar', stack: 'pos', data: [100] })
    expect(sOf(opt)[2]).toMatchObject({ type: 'line', data: [70] })
    expect(opt.xAxis).toMatchObject({ data: ['1月'] })
  })

  it('行无 net 字段 → 不造净敞口线（诚实：缺数据不画）', () => {
    const opt = buildPositionOption({ items: [{ label: '1月', midlong: 100, spot: 30 }] })!
    expect(sOf(opt)).toHaveLength(2)
  })

  it.each([
    [null],
    [{ items: [] }],
    ['plain string'],
    [{ items: [] }] // 空清单不画图
  ])('脏输入 %p → null', (input) => {
    expect(buildPositionOption(input)).toBeNull()
  })

  it('现行为记录：数值字段全缺的行按 0 画图而非降级 null', () => {
    const opt = buildPositionOption({ items: [{ label: 'x' }] })
    expect(opt).not.toBeNull()
    expect((sOf(opt)[0] as { data: number[] }).data).toEqual([0]) // num(..., 0) 默认值
  })
})

describe('buildArbitrageOption（套利窗口）', () => {
  it('最小 fixture：价格阶梯线 + 充电窗口绿/卖出窗口红 markArea', () => {
    const opt = buildArbitrageOption({
      points: [{ t: '01', price: 300 }, { t: '02', price: 150 }],
      windows: [
        { start: '01', end: '01', type: 'charge' },
        { start: '02', end: '02', type: 'sell' }
      ]
    })!
    expect(sOf(opt)[0]).toMatchObject({ type: 'line', step: 'end', data: [300, 150] })
    const area = (sOf(opt)[0] as { markArea: { data: unknown[] } }).markArea.data
    expect((area[0] as Array<{ itemStyle: { color: string } }>)[0].itemStyle.color).toBe('rgba(22,163,74,0.12)') // charge 绿
    expect((area[1] as Array<{ itemStyle: { color: string } }>)[0].itemStyle.color).toBe('rgba(220,38,38,0.12)') // sell 红
  })

  it('现行为记录（源码可疑点）：buy 判定用 includes("charge")，"discharge" 含该子串 → 放电窗口也染充电绿', () => {
    // 源码 businessCharts.ts buildArbitrageOption:
    //   const buy = type.includes('charge') || type.includes('buy') || type.includes('谷') || type.includes('低')
    // 'discharge'.includes('charge') === true —— 放电（卖出）窗口拿到买入色，套利方向读反。
    // 若日后修复（如改为词首匹配），本用例先行提示需同步更新。
    const opt = buildArbitrageOption({
      points: [{ t: '01', price: 1 }],
      windows: [{ start: '01', end: '01', type: 'discharge' }]
    })!
    const area = (sOf(opt)[0] as { markArea: { data: Array<Array<{ itemStyle: { color: string } }>> } }).markArea.data
    expect(area[0][0].itemStyle.color).toBe('rgba(22,163,74,0.12)') // 现行为：绿；语义上应为红
  })

  it.each([[null], [{ points: [] }], [{ points: [{ t: 1 }] }]])('脏输入 %p → null（无有效价格不画）', (input) => {
    expect(buildArbitrageOption(input)).toBeNull()
  })
})

describe('buildStorageOption（储能充放）', () => {
  it('power 缺省时 = charge − discharge（手算 10−4=6）', () => {
    const opt = buildStorageOption({ points: [{ t: 1, soc: 50, charge: 10, discharge: 4, price: 300 }] })!
    expect((sOf(opt)[0] as { data: number[] }).data).toEqual([6])
    expect(sOf(opt).map((s: Record<string, unknown>) => s.name)).toEqual(['充放功率', 'SOC', '电价'])
    expect(opt.yAxis).toHaveLength(3) // MW / SOC% / 元/MWh
  })

  it('显式 power 优先于 charge/discharge 推算', () => {
    const opt = buildStorageOption({ points: [{ t: 1, power: 5, charge: 10, discharge: 4 }] })!
    expect((sOf(opt)[0] as { data: number[] }).data).toEqual([5])
  })

  it.each([[null], [{}], [{ points: [] }]])('脏输入 %p → null', (input) => {
    expect(buildStorageOption(input)).toBeNull()
  })
})

describe('buildGaugeOption（风险仪表）', () => {
  it('单值形状：gauge series + 值与单位', () => {
    const opt = buildGaugeOption({ value: 42, label: '风险', unit: '分' })!
    expect(sOf(opt)[0]).toMatchObject({ type: 'gauge' })
    expect((sOf(opt)[0] as { data: Array<{ value: number; name: string }> }).data[0]).toEqual({ value: 42, name: '风险' })
    expect((sOf(opt)[0] as { detail: { formatter: string } }).detail.formatter).toBe('{value}分')
  })

  it('多表盘变体 {gauges:[]}', () => {
    const opt = buildGaugeOption({ gauges: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] })!
    expect(sOf(opt)).toHaveLength(2)
  })

  it.each([
    [null],
    [{}],
    [{ value: 'abc' }], // 值非数不画表盘
    [{ gauges: [] }]
  ])('脏输入 %p → null', (input) => {
    expect(buildGaugeOption(input)).toBeNull()
  })
})

describe('buildClearingOption（出清博弈）', () => {
  it('按成本排序的阶梯供给曲线（手算点位）+ 出清价/需求标线', () => {
    const opt = buildClearingOption({
      segments: [
        { capacity: 100, cost: 200 },
        { capacity: 50, cost: 100 }
      ],
      clearingPrice: 150,
      demand: 120
    })!
    // 手算：排序后 [50MW@100, 100MW@200]；累积容量 0→50→150：
    //   pts = [0,100],[50,100],[50,200],[150,200]（阶梯跳变各两点半开区间拼接）
    expect((sOf(opt)[0] as { data: number[][] }).data).toEqual([
      [0, 100],
      [50, 100],
      [50, 200],
      [150, 200]
    ])
    const ml = (sOf(opt)[0] as { markLine: { data: Array<Record<string, unknown>> } }).markLine.data
    expect(ml).toEqual([
      { yAxis: 150, name: '出清价', lineStyle: { color: '#dc2626' } },
      { xAxis: 120, name: '需求', lineStyle: { color: '#2563eb' } }
    ])
    expect(opt.xAxis).toMatchObject({ type: 'value', name: '累积容量 MW' })
  })

  it('边际机组变体 {marginal_unit, contender_units} 合成阶梯', () => {
    const opt = buildClearingOption({
      marginal_unit: { capacity: 50, cost: 200 },
      contender_units: [{ capacity: 50, cost: 100 }]
    })!
    expect((sOf(opt)[0] as { data: number[][] }).data).toHaveLength(4)
  })

  it.each([[null], [{ segments: [] }], [{ segments: [{ capacity: 100 }] }]])('脏输入 %p → null', (input) => {
    expect(buildClearingOption(input)).toBeNull()
  })
})

describe('buildGeoOption（地理分布）', () => {
  it('经纬散点 + visualMap 数值域', () => {
    const opt = buildGeoOption({
      points: [
        { name: 'a', lng: 100, lat: 20, value: 5 },
        { name: 'b', lng: 101, lat: 21, value: 10 }
      ]
    })!
    expect(sOf(opt)[0]).toMatchObject({ type: 'scatter' })
    expect((sOf(opt)[0] as { data: Array<{ value: number[] }> }).data.map((d) => d.value)).toEqual([
      [100, 20, 5],
      [101, 21, 10]
    ])
    expect(opt.visualMap).toMatchObject({ min: 5, max: 10 })
  })

  it.each([
    [null],
    [{ points: [] }],
    [{ points: [{ name: 'x', value: 5 }] }] // 缺经纬度整点过滤后为空
  ])('脏输入 %p → null', (input) => {
    expect(buildGeoOption(input)).toBeNull()
  })
})

describe('buildHeatmapOption（分时热力）', () => {
  it('矩阵形状：cells [xi,yi,v] 手算对拍 + visualMap 域', () => {
    const opt = buildHeatmapOption({ x: ['h1', 'h2'], y: ['d1', 'd2'], matrix: [[1, 2], [3, 4]] })!
    expect((sOf(opt)[0] as { data: number[][] }).data).toEqual([
      [0, 0, 1],
      [1, 0, 2],
      [0, 1, 3],
      [1, 1, 4]
    ])
    expect(opt.visualMap).toMatchObject({ min: 1, max: 4 })
    expect(opt.xAxis).toMatchObject({ data: ['h1', 'h2'] })
  })

  it.each([
    [null],
    [{}],
    [{ matrix: [['a', 'b']] }], // 全非数 cell → cells 空
    [{ data: [[0, 0]] }] // 三元组缺 v
  ])('脏输入 %p → null', (input) => {
    expect(buildHeatmapOption(input)).toBeNull()
  })
})

describe('buildWaterfallOption（瀑布分解）', () => {
  it('占位柱 + 升/降/合计四序列手算对拍', () => {
    const opt = buildWaterfallOption({
      start: 5,
      items: [
        { label: 'a', value: 10 },
        { label: 'b', value: -4 },
        { label: 't', value: 9, type: 'total' }
      ]
    })!
    // 手算：cum=5；a→ph=5,incr=10,cum=15；b→ph=15-4=11,decr=4,cum=11；t→totalBar=9
    const [ph, incr, decr, total] = sOf(opt) as Array<{ data: Array<number | null> }>
    expect(ph.data).toEqual([5, 11, 0])
    expect(incr.data).toEqual([10, null, null])
    expect(decr.data).toEqual([null, 4, null])
    expect(total.data).toEqual([null, null, 9])
  })

  it.each([
    [null],
    [{ items: [] }],
    [{ items: [{ label: 'a' }] }], // value 非数且非 total → 无有效项
    [{ items: [{ label: 'a', value: 'x' }] }]
  ])('脏输入 %p → null', (input) => {
    expect(buildWaterfallOption(input)).toBeNull()
  })
})

describe('buildSankeyOption（流向桑基）', () => {
  it('links 推断节点集 ∪ 显式 nodes', () => {
    const opt = buildSankeyOption({
      nodes: [{ name: '电源' }],
      links: [{ source: '电源', target: '负荷', value: 100 }]
    })!
    const names = (sOf(opt)[0] as { data: Array<{ name: string }> }).data.map((n) => n.name)
    expect(names.sort()).toEqual(['电源', '负荷'])
    expect((sOf(opt)[0] as { links: unknown[] }).links).toHaveLength(1)
  })

  it.each([
    [null],
    [{ links: [] }],
    [{ links: [{ source: 'a', target: 'a', value: 1 }] }], // 自环过滤后为空
    [{ nodes: [{ name: '孤立节点' }] }] // 只有节点无 links 不成流向图
  ])('脏输入 %p → null', (input) => {
    expect(buildSankeyOption(input)).toBeNull()
  })
})

describe('buildPieOption（结构占比）', () => {
  it('顶层数组形状：pie series + 数据片', () => {
    const opt = buildPieOption([
      { name: '风电', value: 40 },
      { name: '光伏', value: 60 }
    ])!
    expect(sOf(opt)[0]).toMatchObject({
      type: 'pie',
      data: [
        { name: '风电', value: 40 },
        { name: '光伏', value: 60 }
      ]
    })
    expect((sOf(opt)[0] as { radius: string }).radius).toBe('64%') // 实心饼
  })

  it('donut 形状 → 环形 radius', () => {
    const opt = buildPieOption({ items: [{ name: 'a', value: 1 }], donut: true })!
    expect((sOf(opt)[0] as { radius: [string, string] }).radius).toEqual(['42%', '68%'])
  })

  it.each([
    [null],
    [[]],
    [[{ name: 'a', value: -1 }]], // 负值片过滤
    [[{ name: '', value: 1 }]], // 无名片过滤
    [[{ name: 'a', value: 'x' }]] // 非数值片过滤
  ])('脏输入 %p → null', (input) => {
    expect(buildPieOption(input)).toBeNull()
  })
})
