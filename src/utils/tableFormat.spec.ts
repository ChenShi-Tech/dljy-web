// tableFormat 表格显示增强回归：正负红绿、阈值分级、状态 tag 映射、汇总行工厂。
// 这些纯函数坏掉不报错，只会让 13 个表格视图整列着错色（负偏差标绿）/合计行算错数，
// 用户拿错误颜色当风险信号。重点守：非数与空值一律中性（''/info），绝不给脏输入上色。
import { describe, expect, it } from 'vitest'
import { avgBy, makeSummary, maxBy, signClass, statusTagType, sumBy, thresholdClass } from './tableFormat'

describe('signClass：正负着色，零/非数必须中性', () => {
  it.each([
    [5, 'cell-pos'],
    [5.5, 'cell-pos'],
    ['12.5', 'cell-pos'], // 数字字符串经 Number 强转
    [-3, 'cell-neg'],
    ['-0.01', 'cell-neg'],
    [0, ''],
    ['0', ''],
    [-0, ''], // -0 === 0，不算负
    [0.0, ''],
    [NaN, ''],
    ['abc', ''], // Number('abc')=NaN
    ['12px', ''], // 混入单位的后端脏值不上色
    ['', ''], // Number('')=0 → 中性（空串不是正数）
    [null, ''], // Number(null)=0 → 中性
    [undefined, ''],
    [Infinity, ''],
    [-Infinity, ''],
    [{}, ''], // Number({})=NaN
    [[], ''], // Number([])=0 → 中性（现行为：空数组强转为 0）
    [true, 'cell-pos'], // 现行为：boolean 强转数值（true→1）参与着色，记录之
  ])('signClass(%p) → %s', (v, expected) => {
    expect(signClass(v)).toBe(expected)
  })

  it('正绿负红的语义不可互换（防红绿色号写反）', () => {
    expect(signClass(1)).toBe('cell-pos')
    expect(signClass(-1)).toBe('cell-neg')
    expect(signClass(1)).not.toBe(signClass(-1))
  })
})

describe('thresholdClass：|v| 分级，阈值边界含等于', () => {
  const W = 20
  const D = 50
  it.each([
    [15, ''],
    [0, ''],
    [19.99, ''],
    [20, 'cell-warn'], // 恰好 warn：≥ 语义
    [49.9, 'cell-warn'],
    [50, 'cell-neg'], // 恰好 danger
    [100, 'cell-neg'],
    [-30, 'cell-warn'], // 负偏差取绝对值，正负偏差同样醒目
    [-50, 'cell-neg'],
    [-19, ''],
    [NaN, ''],
    ['abc', ''],
    [Infinity, ''], // 非有限数不上色（±Infinity 视为脏值而非「无穷大风险」）
    [-Infinity, ''],
    [null, ''], // Math.abs(Number(null))=0 → 低于 warn → ''
  ])('thresholdClass(%p, 20, 50) → %s', (v, expected) => {
    expect(thresholdClass(v, W, D)).toBe(expected)
  })

  it('warn 高于 danger 的病态配置下 danger 分支优先（≥danger 先判）', () => {
    // 现行为：先判 ≥danger。若调用方把阈值写反（warn=50 danger=20），30 命中 danger。
    expect(thresholdClass(30, 50, 20)).toBe('cell-neg')
  })
})

describe('statusTagType：状态关键字映射（大小写不敏感、子串匹配、danger 优先）', () => {
  it.each([
    ['正常', 'success'],
    ['已通过', 'success'],
    ['通过', 'success'],
    ['已成交', 'success'],
    ['已签约', 'success'],
    ['approved', 'success'],
    ['static-ready', 'success'],
    ['低', 'success'],
    ['关注', 'warning'],
    ['待确认', 'warning'],
    ['待续签', 'warning'],
    ['中', 'warning'],
    ['pending', 'warning'],
    ['pending-runtime-data', 'warning'],
    ['高', 'danger'],
    ['异常', 'danger'],
    ['停机', 'danger'],
    ['受阻', 'danger'],
    ['blocked', 'danger'],
    ['blocked-by-private-cache', 'danger'],
    ['Approved', 'success'], // 大小写不敏感
    ['APPROVED', 'success'],
    ['PENDING', 'warning'],
    ['BLOCKED', 'danger'],
    ['  正常  ', 'success'], // 首尾空白
    ['未知状态', 'info'], // 未命中归 info
    ['已归档', 'info'],
    ['', 'info'],
    [null, 'info'],
    [undefined, 'info'],
    [0, 'info'], // 数字 0 → '0' 无命中
  ])('statusTagType(%p) → %s', (v, expected) => {
    expect(statusTagType(v)).toBe(expected)
  })

  it('同串多级命中时 danger > warning > success（按危险优先，不按先出现）', () => {
    expect(statusTagType('停机后已恢复运行')).toBe('danger') // 停机(danger) vs 运行(success)
    expect(statusTagType('受阻已成交')).toBe('danger') // 受阻 vs 已成交
    expect(statusTagType('待确认已通过')).toBe('warning') // 待确认 vs 已通过
    expect(statusTagType('待续签已签约')).toBe('warning')
  })

  it('中文单字子串匹配是子串级而非整词级（现行为记录）', () => {
    // '高中'含'高'→danger、'中流'含'中'→warning：单字关键字会命中任何含该字的串。
    expect(statusTagType('高中负荷')).toBe('danger')
    expect(statusTagType('中位数')).toBe('warning')
    // '生效中'含'中'（warning 列）先于'生效'语义命中，warning 优先级高于 success 的代价。
    expect(statusTagType('生效中')).toBe('warning')
  })
})

describe('sumBy/avgBy/maxBy：非数值跳过、空数组按源码约定返 0', () => {
  const rows = [
    { v: 10 },
    { v: '20' }, // 数字字符串计入（Number 强转）
    { v: null }, // Number(null)=0 计入（现行为：null 不被当作「缺数据」跳过）
    { v: undefined }, // NaN 跳过
    { v: 'x' }, // NaN 跳过
    { v: 30 },
  ]

  it('sumBy 混合脏值：10 + 20 + 0(null) + 30 = 60', () => {
    // 手算：Number('20')=20 计入；Number(null)=0 计入；undefined 与 'x' 为 NaN 跳过。
    expect(sumBy(rows, 'v')).toBe(60)
  })

  it('avgBy 分母只数有限值：xs=[10,20,0,30] → 60/4 = 15', () => {
    // 手算：null 以 0 计入分子且占一个分母位；undefined/'x' 不进 xs。
    expect(avgBy(rows, 'v')).toBe(15)
  })

  it('maxBy 取最大有限值', () => {
    expect(maxBy(rows, 'v')).toBe(30)
  })

  it('maxBy 全负数取最大负值，不与「空数组返 0」约定混淆', () => {
    expect(maxBy([{ v: -5 }, { v: -2 }, { v: -9 }], 'v')).toBe(-2)
  })

  it('空数组按源码约定返 0（不是 null——页面靠 0 显示空合计）', () => {
    expect(sumBy([], 'v')).toBe(0)
    expect(avgBy([], 'v')).toBe(0)
    expect(maxBy([], 'v')).toBe(0)
  })

  it('全脏值同样返 0（求和无可加项即 0，均值无样本不造 NaN）', () => {
    const dirty = [{ v: 'a' }, { v: undefined }]
    expect(sumBy(dirty, 'v')).toBe(0)
    expect(avgBy(dirty, 'v')).toBe(0)
    expect(maxBy(dirty, 'v')).toBe(0)
  })
})

describe('makeSummary：el-table 合计行工厂', () => {
  const columns = [
    { property: 'name' },
    { property: 'volumeMWh' },
    { property: 'price' },
    { property: 'cost' },
    { property: 'unmapped' }, // spec 未配置的列
    {}, // selection 列无 property
  ]
  const data = [
    { volumeMWh: 100.5, price: 10, cost: 10 },
    { volumeMWh: 200, price: 20, cost: 20.5 },
    { volumeMWh: null, price: 30 }, // cost 缺省 → NaN 跳过
    { volumeMWh: 'x', price: 'y' }, // 双列脏值跳过
  ]

  it('首列「合计」，sum/avg/digits/unit 手算对拍', () => {
    const summary = makeSummary({
      volumeMWh: { type: 'sum', unit: 'MWh' },
      price: { type: 'avg' },
      cost: { type: 'sum', digits: 1, unit: '元' },
    })( { columns, data } )
    // 手算：
    //   volumeMWh sum = 100.5 + 200 + 0(null) = 300.5 → fmtNum → '300.5'
    //   price avg = (10+20+30)/3 = 20 → '20'（无 unit 不拼后缀）
    //   cost sum = 10 + 20.5 = 30.5，digits=1 → '30.5 元'
    expect(summary).toEqual(['合计', '300.5 MWh', '20', '30.5 元', '', ''])
  })

  it('firstLabel 可自定义（如「当月合计」）', () => {
    const summary = makeSummary({}, '当月合计')({ columns: [], data: [] })
    expect(summary).toEqual([])
    const one = makeSummary({}, '当月合计')({ columns: [{ property: 'a' }], data: [] })
    expect(one[0]).toBe('当月合计')
  })

  it('digits 缺省为 2（默认小数位与 fmtNum 口径一致）', () => {
    const summary = makeSummary({ p: { type: 'sum' } })({
      columns: [{ property: 'label' }, { property: 'p' }],
      data: [{ label: 'a', p: 1234.567 }],
    })
    expect(summary[1]).toBe('1,234.57') // 1234.567 两位舍入 + 千分位
  })

  it('空数据行 sum 仍输出 0（不因无数据抛错，也不显示短横线占位）', () => {
    const summary = makeSummary({ p: { type: 'sum' } })({
      columns: [{ property: 'label' }, { property: 'p' }],
      data: [],
    })
    expect(summary[1]).toBe('0')
  })
})
