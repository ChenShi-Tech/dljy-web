// Mock 演示层 golden 契约等价 spec（PRD 附录 C.19）。
//
// 守什么不变量：市场洞察域「演示 = 真实有数」的显示效果一致性——对同一 (family, match)，
// fixtures（真实采集回放件）与前端合成器两条供给路径，经同一消费路径（适配器 / 视图直读
// res.data）必须产出**同构的数据形状**（键集合、序列条数、96 点长度、日期轴非空）。
// 坏掉的症状：合成载荷形状漂移（如 rjz 缺 96 点、dataMap 缺键、yzConfig 变空数组）时，
// 演示端图表空/缺序列而真实端正常——过去这类问题只能靠人工截图逐页追形（PRD C.5–C.9
// 十六轮验收的根因），本 spec 把它变成门禁红绿灯。
// fixtures 缺失（CI/新克隆无本地采集件）时整组 skip，不阻塞五门禁。
// @vitest-environment happy-dom （envelope→regionContext 模块级读 window.localStorage，与 mockDemo.spec 同因）
import { describe, expect, it } from 'vitest'
import { resolveMockRequest } from './router'
import { fixtureFileList, hasAnyFixture, loadFixturePayload } from './fixtures'
import { extractEnvelopeMeta } from '@/services/data/request'
import {
  toMarketInsightActualLoadContract,
  toMarketInsightClearingSpotContract,
  toMarketInsightPriceAnalysisContract,
  toMarketInsightZsjfxDayContract,
  toMarketInsightZsjfxMetaContract,
  type MarketInsightAdapterMeta
} from '@/services/data/contracts/marketInsightHeavyPages'

const REAL_META: MarketInsightAdapterMeta = {
  basis: 'real',
  sourceType: 'CAPTURE',
  productionWrite: false,
  region_requested: 'shanxi',
  region_served: 'shanxi'
}

async function fetchMockPayload(family: string, match: string): Promise<Record<string, unknown>> {
  const res = await resolveMockRequest('GET', new URL(`http://localhost/api/real?family=${family}&match=${encodeURIComponent(match)}&region=shanxi`))
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, unknown>
}

/** fixtures 路径载荷：原样采集文件内容；mock 路径载荷：合成信封（二者同走 res.data 通道）。 */
async function bothPayloads(family: string, match: string): Promise<{ golden: Record<string, unknown>; mock: Record<string, unknown> }> {
  const fixture = await loadFixturePayload(family, match)
  expect(fixture, `fixtures 缺少 ${family}/${match}，导出脚本窗口需覆盖该样本`).not.toBeNull()
  const golden = fixture!.payload
  const mock = await fetchMockPayload(family, match)
  return { golden, mock }
}

const dataOf = (payload: unknown): Record<string, unknown> => {
  const body = (payload ?? {}) as { data?: unknown }
  return (body.data && typeof body.data === 'object' ? body.data : payload ?? {}) as Record<string, unknown>
}

const finiteOr = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 96 点曲线行通用断言：行对象 p1..p96 全为有限数值。 */
function expectPointRow(row: unknown, label: string): void {
  expect(row, label).toBeTypeOf('object')
  for (let p = 1; p <= 96; p++) {
    const value = (row as Record<string, unknown>)[`p${p}`]
    expect(finiteOr(value) || value === null, `${label} p${p}`).toBe(true)
  }
}

describe.skipIf(!hasAnyFixture())('市场洞察 golden 契约等价（fixtures=真实采集 vs 合成器）', () => {
  it('价格分析 listrs_full：双侧产出日均/逐日/统计三类序列，96 点对齐', { timeout: 30_000 }, async () => {
    const { golden, mock } = await bothPayloads('sdpt_zcqxhdl', 'listrs_full')
    const goldenVm = toMarketInsightPriceAnalysisContract({ payload: golden, meta: REAL_META }).blocks.price_analysis
    const mockMeta = extractEnvelopeMeta(mock)
    const mockVm = toMarketInsightPriceAnalysisContract({ payload: mock, meta: mockMeta }).blocks.price_analysis
    for (const vm of [goldenVm, mockVm]) {
      expect(vm.averageCurves.length, 'rjz 日内均价序列').toBeGreaterThan(0)
      expect(vm.dayCurves.length, 'dmx 逐日曲线').toBeGreaterThan(0)
      expect(vm.dailyStats.length, 'rmx 统计行').toBeGreaterThan(0)
      expect(vm.dates.length).toBeGreaterThan(0)
      for (const curve of [...vm.averageCurves, ...vm.dayCurves]) {
        expect(curve.points).toHaveLength(96)
      }
      expect(new Set([...vm.averageCurves, ...vm.dailyStats].map((item) => item.market)).size, '日前+实时两类都在').toBe(2)
    }
    expect(new Set(goldenVm.averageCurves.map((c) => c.market))).toEqual(new Set(mockVm.averageCurves.map((c) => c.market)))
    // 双侧日期轴都非空即可（golden 全历史 vs 合成器近 365 天的跨度差异是窗口裁剪的预期行为）
    expect(goldenVm.dates.length).toBeGreaterThan(0)
    expect(mockVm.dates.length).toBeGreaterThan(0)
  })

  it('出清现货电量分析 __list__：双侧 timePoints×series 平行序列', async () => {
    const { golden, mock } = await bothPayloads('sdpt_zcqxhdl', '__list__')
    const goldenVm = toMarketInsightClearingSpotContract({ payload: golden, meta: REAL_META }).blocks.clearing_spot
    const mockVm = toMarketInsightClearingSpotContract({ payload: mock, meta: extractEnvelopeMeta(mock) }).blocks.clearing_spot
    for (const vm of [goldenVm, mockVm]) {
      expect(vm.timePoints.length).toBeGreaterThan(1)
      expect(vm.series.length).toBeGreaterThan(0)
      for (const serie of vm.series) {
        expect(serie.values).toHaveLength(vm.timePoints.length)
      }
    }
    expect(goldenVm.series.length).toBe(mockVm.series.length)
  })

  it('逐日系统负荷 query__：双侧「日序标签 × 多年」矩阵对齐', async () => {
    const { golden, mock } = await bothPayloads('sdpt_actualLoad', 'query__')
    const goldenVm = toMarketInsightActualLoadContract({ payload: golden, meta: REAL_META }).blocks.actual_load
    const mockVm = toMarketInsightActualLoadContract({ payload: mock, meta: extractEnvelopeMeta(mock) }).blocks.actual_load
    for (const vm of [goldenVm, mockVm]) {
      const system = vm.sources.system!
      // 真实形状：nameList 是「1月1日…12月31日」日序标签（非 96 时点），pjz/zxz/zdz 每行与轴等长
      expect(system.nameList.length, '日序轴（全年 366 日）').toBe(366)
      expect(system.years.length, '近 6 年').toBe(6)
      for (const metric of [system.metrics.average, system.metrics.min, system.metrics.max]) {
        expect(metric.length, '每年一行').toBe(system.years.length)
        for (const row of metric) expect(row, '行与日序轴对齐').toHaveLength(system.nameList.length)
      }
    }
  })

  it('综合数据分析 zsjfx_meta：双侧日期索引/分组/双轴配置齐全', async () => {
    const { golden, mock } = await bothPayloads('sdpt_zsjfx_idx', 'zsjfx_meta')
    const goldenVm = toMarketInsightZsjfxMetaContract({ payload: golden, meta: REAL_META }).blocks.zsjfx.meta!
    const mockVm = toMarketInsightZsjfxMetaContract({ payload: mock, meta: extractEnvelopeMeta(mock) }).blocks.zsjfx.meta!
    for (const vm of [goldenVm, mockVm]) {
      expect(vm.dates.length).toBeGreaterThan(0)
      expect(Object.keys(vm.groups).length).toBeGreaterThan(0)
      expect(vm.defaults.length).toBeGreaterThan(0)
      expect(vm.yzConfig.length, 'yzConfig 是 Y 轴定义数组（C.7 根因）').toBeGreaterThan(0)
      for (const axis of vm.yzConfig) expect(finiteOr(axis.min) || (axis.min ?? null) === null).toBe(true)
    }
  })

  it('综合数据分析 zsjfx_day__<date>：双侧全序列 96 点', async () => {
    const day = '2026-06-01'
    const { golden, mock } = await bothPayloads('sdpt_zsjfx_idx', `zsjfx_day__${day}`)
    const goldenVm = toMarketInsightZsjfxDayContract({ payload: golden, date: day, meta: REAL_META }).blocks.zsjfx.day!
    const mockVm = toMarketInsightZsjfxDayContract({ payload: mock, date: day, meta: extractEnvelopeMeta(mock) }).blocks.zsjfx.day!
    for (const vm of [goldenVm, mockVm]) {
      const series = Object.values(vm.series)
      expect(series.length, '曲线组非空').toBeGreaterThan(0)
      for (const points of series) expect(points).toHaveLength(96)
    }
    // golden 是平台全量序列（60 组），合成器是四序列子集——序列名不要求相等，只锁「双侧
    // 都出多序列 96 点」的形状；真实载荷为裸 {date,series}（无 data 容器），适配器同径消化。
    expect(Object.keys(goldenVm.series).length).toBeGreaterThanOrEqual(Object.keys(mockVm.series).length)
  })

  it('洞察驾驶舱 getCorpNewEnergyChart：双侧 dateList 与 6 类出力序列等长', async () => {
    const { golden, mock } = await bothPayloads('sdpt_console', 'getCorpNewEnergyChart')
    for (const raw of [golden, mock]) {
      const data = dataOf(raw)
      const dateList = data.dateList as unknown[]
      expect(Array.isArray(dateList) && dateList.length > 1).toBe(true)
      for (const key of ['corpTotalList', 'yyTotalList', 'corpWindList', 'yyWindList', 'corpLightList', 'yyLightList']) {
        expect(Array.isArray(data[key]), `${key} 存在`).toBe(true)
        expect((data[key] as unknown[]).length, `${key} 与 dateList 等长`).toBe(dateList.length)
      }
    }
  })

  it('洞察驾驶舱负荷图 hash 变体：双侧 D-3/D-2/D-1/实际四轨齐全', async () => {
    const hash = fixtureFileList('sdpt_console').map((entry) => entry.file.match(/getTradingPlatformLoadChart__([0-9a-f]+)\.json/)?.[1]).find(Boolean)
    expect(hash, 'console 族应携带负荷图 hash 变体').toBeTruthy()
    const { golden, mock } = await bothPayloads('sdpt_console', hash!)
    for (const raw of [golden, mock]) {
      const data = dataOf(raw)
      const dateList = data.dateList as unknown[]
      expect(Array.isArray(dateList) && dateList.length > 1).toBe(true)
      for (const key of ['d3List', 'd2List', 'd1List', 'actualValueList']) {
        expect((data[key] as unknown[] | undefined)?.length).toBe(dateList.length)
      }
    }
  })

  it('洞察驾驶舱日均价：双侧 96 点日前/实时/价差三序列 + dayTime', async () => {
    const { golden, mock } = await bothPayloads('sdpt_console', 'getAveragePriceChart')
    for (const raw of [golden, mock]) {
      const data = dataOf(raw)
      expect(typeof data.dayTime).toBe('string')
      expect(data.dayAheadPriceList).toHaveLength(96)
      expect(data.realTimePriceList).toHaveLength(96)
      expect(data.diffPriceList).toHaveLength(96)
    }
  })

  it('分时行情 rqlx0__2026-06-01：双侧日K/出清线/extendMap 同构', async () => {
    const { golden, mock } = await bothPayloads('sdpt_fshq', 'rqlx0__2026-06-01')
    for (const raw of [golden, mock]) {
      const data = dataOf(raw)
      // 真实载荷不带 nameList（合成器附带它供渲染兜底），横轴以 opData 行自带时间为准
      const opData = data.opData as unknown[][]
      expect(opData.length, '96 根日K').toBe(96)
      for (const row of opData.slice(0, 5)) expect(row, '日K 行 [时间,开,收,低,高,量]').toHaveLength(6)
      for (const key of ['rqjcqList', 'ssjcqList']) expect((data[key] as unknown[]).length).toBe(96)
      expect(data.extendMap, 'extendMap（买卖盘锚点）存在').toBeTypeOf('object')
    }
  })

  it('分时行情 dataDet 买卖盘：双侧 dataMap 13 序列', async () => {
    const detFile = fixtureFileList('sdpt_fshq').map((entry) => entry.file.match(/dataDet__id\d+/)?.[0]).find(Boolean)
    expect(detFile, 'fshq 族应携带 dataDet 样例').toBeTruthy()
    const { golden, mock } = await bothPayloads('sdpt_fshq', detFile!)
    for (const raw of [golden, mock]) {
      const data = dataOf(raw)
      const dataMap = data.dataMap as Record<string, unknown[]>
      expect(Array.isArray(data.nameList) && (data.nameList as unknown[]).length).toBeGreaterThan(0)
      expect(Object.keys(dataMap).length, '买卖 1-3 量价 + 最新价 = 13 序列').toBeGreaterThanOrEqual(13)
    }
  })

  it('现货价格×新能源/统调负荷 24 点散点：双侧 xd 二元组 + 各自参照线容器', async () => {
    // golden 口径：xd 行 p1..p24 为 [指标值, 价格] 二元组；线行 p1..p24 为数值；
    // list24 线容器 xnyzd/xnyg/xnygd(+xnyz)，fhlist24 仅 xnyzd(+xnyz)——合成器同构供给。
    const cases: Array<{ match: string; lines: string[] }> = [
      { match: '_list24__2026-06-02', lines: ['xnyzd', 'xnyg', 'xnygd'] },
      { match: 'fhlist24__2026-06-02', lines: ['xnyzd'] }
    ]
    for (const { match, lines } of cases) {
      const { golden, mock } = await bothPayloads('sdpt_zcqxhdl', match)
      for (const raw of [golden, mock]) {
        const data = dataOf(raw)
        const xd = data.xd as Record<string, unknown>[]
        expect(Array.isArray(xd) && xd.length > 0, `${match} xd 行`).toBe(true)
        expect(Object.keys(xd[0]).filter((key) => /^p\d+$/.test(key)).length, '24 个小时点').toBe(24)
        expect(Array.isArray(xd[0].p1) && (xd[0].p1 as unknown[]).length, 'p 点为 [指标,价格] 二元组').toBe(2)
        for (const line of lines) {
          const rows = data[line] as Record<string, unknown>[]
          expect(Array.isArray(rows) && rows.length > 0, `${line} 参照线`).toBe(true)
          const pKeys = Object.keys(rows[0]).filter((key) => /^p\d+$/.test(key))
          expect(pKeys.length, `${line} 行 p1..p24`).toBe(24)
          expect(typeof rows[0].p1, '线值是数值').toBe('number')
        }
      }
    }
  })

  it('逐日出清散点行 96 点护栏：listrs rjz 逐行 p1..p96 有限值抽查', { timeout: 30_000 }, async () => {
    // C.8 根因回归：rjz 行曾只给 p1/p2/p3 统计值导致时点切面空——fixtures 路径天然携带
    // 完整 96 点，此断言锁「golden 96 点 + 合成器 96 点」双侧同规。
    const { golden, mock } = await bothPayloads('sdpt_zcqxhdl', 'listrs_full')
    const goldenRows = dataOf(golden).rjz as Record<string, unknown>[]
    const mockRows = dataOf(mock).rjz as Record<string, unknown>[]
    expect(goldenRows.length).toBeGreaterThan(0)
    expectPointRow(goldenRows[0], 'golden rjz 首行')
    expectPointRow(mockRows[0], 'mock rjz 首行')
  })
})
