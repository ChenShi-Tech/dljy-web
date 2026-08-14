// #1459 回归单测：loadClearingCurve 对列表族取错日/跨地区/混列却标 captured。
//
// fixture 严格仿真实采集形状（取自 data/private/capture-raw 实际文件，包括**乱序键名**
// 与非曲线字段），否则测不出老实现的失败模式：
//   - 山西 sdpt__zcqxhdl__list24__<date>.json：data.rqdj 是 30 天滚动窗口，每行 24 点，
//     键序为 date,p1,hj,p2..p9,type,p10,jz,p12,p11,p14,p13,p16,p15,… （p12 在 p11 之前）；
//   - 云南 sdpt__zcqxhdl__curve__<date>.json：顶层即 { drrq, p1..p96 }。
import { describe, expect, it } from 'vitest'
import { CAPTURE_FAMILIES } from 'shared/schema/entities/capture-families.mjs'
import {
  CURVE_CONTRACT_FAMILIES,
  createSpotPriceLoaders,
  curveStats,
  resolveCurveFromCaptured
} from '@/services/market/spotPriceCore'
import { OPENED_DEMO_REGION_IDS } from '@/data/regions'

/** 真实 rqdj 行（山西 2026-05-15，含 p13=0 的午间零价点）。 */
const RQDJ_2026_05_15 = {
  date: '2026-05-15',
  p1: 323,
  hj: 6598.45,
  p2: 323,
  p3: 331,
  p4: 326,
  p5: 332,
  p6: 348,
  p7: 329,
  p8: 279,
  p9: 260,
  type: '0',
  p10: 239,
  jz: 274.94,
  p12: 212,
  p11: 223,
  p14: 145,
  p13: 0,
  p16: 250,
  p15: 203,
  p18: 309,
  p17: 273,
  p19: 345,
  id: 328125,
  drrq: '2026-05-16',
  prov_id: 1,
  p21: 335,
  p20: 359,
  p23: 278,
  p22: 306,
  p24: 272
} as const

/** 窗口首行（2026-04-16）——老实现从头 walk 取到的就是它，用来断言不再错日。 */
const RQDJ_2026_04_16 = {
  date: '2026-04-16',
  p1: 355,
  hj: 6739.7225,
  p2: 335,
  p3: 330,
  p4: 352,
  p5: 338,
  p6: 370,
  p7: 397,
  p8: 388,
  p9: 377,
  type: '0',
  p10: 322,
  jz: 280.82,
  p12: 225,
  p11: 262,
  p14: 78,
  p13: 145,
  p16: 154,
  p15: 0,
  p18: 262,
  p17: 222,
  p19: 293,
  id: 283528,
  drrq: '2026-04-17',
  prov_id: 1,
  p21: 321,
  p20: 314,
  p23: 305,
  p22: 310,
  p24: 285
} as const

const EXPECTED_24 = [
  323, 323, 331, 326, 332, 348, 329, 279, 260, 239, 223, 212, 0, 145, 203, 250, 273, 309, 345, 359,
  335, 306, 278, 272
]

/** 山西逐日切片载荷（含 xd 二元组容器与新能源出力容器，都不得被误当价格曲线）。 */
function shanxiList24Payload() {
  return {
    rqdj: [RQDJ_2026_04_16, RQDJ_2026_05_15],
    xd: [{ date: '2026-05-15', p1: [28767, 323], p2: [27886, 323] }],
    xnyz: [{ date: '2026-05-15', type: '3', jz: 28047.741, ...pFields(24, () => 28767) }]
  }
}

function pFields(count: number, value: (index: number) => number) {
  const out: Record<string, number> = {}
  for (let i = 1; i <= count; i++) out[`p${i}`] = value(i)
  return out
}

/** 云南 etl 派生逐日 96 点文档：drrq 就是运行日。 */
function yunnanCurveDoc(date: string, seed = 200) {
  return { drrq: date, ...pFields(96, (i) => seed + i) }
}

function envelope(data: unknown, provenance: Record<string, unknown> = { realDataConnected: true, served: 'shanxi', fallback: false }) {
  return { code: 200, data, provenance }
}

describe('resolveCurveFromCaptured', () => {
  it('列表族按目标日选行，不取窗口首日', () => {
    const hit = resolveCurveFromCaptured(shanxiList24Payload(), 'sdpt_zcqxhdl', '2026-05-15')
    expect(hit).not.toBeNull()
    expect(hit!.container).toBe('rqdj')
    expect(hit!.sourcePoints).toBe(24)
    // 每小时值阶梯展开成 4 个 15 分钟位
    expect(hit!.values).toHaveLength(96)
    expect(hit!.values.slice(0, 8)).toEqual([323, 323, 323, 323, 323, 323, 323, 323])
    expect(hit!.values.filter((_, i) => i % 4 === 0)).toEqual(EXPECTED_24)
  })

  it('点位按 p<i> 显式索引取值，不受 JSON 键序影响', () => {
    // 真实键序里 p12 排在 p11 之前；老实现按 Object.values 遍历会得到 …,212,223,…（颠倒）。
    const hit = resolveCurveFromCaptured(shanxiList24Payload(), 'sdpt_zcqxhdl', '2026-05-15')!
    const hourly = hit.values.filter((_, i) => i % 4 === 0)
    expect(hourly[10]).toBe(223) // p11
    expect(hourly[11]).toBe(212) // p12
  })

  it('非曲线字段（jz 日均值 / hj 日合计 / id）不进曲线，零价点保留', () => {
    const hit = resolveCurveFromCaptured(shanxiList24Payload(), 'sdpt_zcqxhdl', '2026-05-15')!
    expect(hit.values).not.toContain(274.94) // jz
    expect(hit.values).not.toContain(6598.45) // hj
    expect(hit.values).not.toContain(328125) // id
    expect(hit.values.filter((v) => v === 0)).toHaveLength(4) // p13=0 展开成 4 个点，未被区间过滤吞掉
  })

  it('不跨行拼接：目标日行点位不全时判无数据，而非从下一行补齐', () => {
    const broken = { ...RQDJ_2026_05_15, p20: null }
    const payload = { rqdj: [RQDJ_2026_04_16, broken] }
    expect(resolveCurveFromCaptured(payload, 'sdpt_zcqxhdl', '2026-05-15')).toBeNull()
  })

  it('请求区间外日期 → null（不返回近似值）', () => {
    expect(resolveCurveFromCaptured(shanxiList24Payload(), 'sdpt_zcqxhdl', '2026-05-20')).toBeNull()
  })

  it('顶层 96 点文档按 drrq 选中运行日', () => {
    const hit = resolveCurveFromCaptured(yunnanCurveDoc('2026-05-15'), 'sdpt_zcqxhdl', '2026-05-15')!
    expect(hit.container).toBeNull()
    expect(hit.sourcePoints).toBe(96)
    expect(hit.values[0]).toBe(201)
    expect(hit.values[95]).toBe(296)
  })

  it('顶层文档 drrq 不是请求日 → null（防文件名子串匹配到邻日文件）', () => {
    expect(resolveCurveFromCaptured(yunnanCurveDoc('2026-05-16'), 'sdpt_zcqxhdl', '2026-05-15')).toBeNull()
  })

  it('96 点 dmx 容器优先于 24 点 rqdj', () => {
    const payload = {
      dmx: [{ date: '2026-05-15', drrq: '2026-05-16', type: '0', jz: 274.94, ...pFields(96, (i) => 100 + i) }],
      rqdj: [RQDJ_2026_05_15]
    }
    const hit = resolveCurveFromCaptured(payload, 'sdpt_zcqxhdl', '2026-05-15')!
    expect(hit.container).toBe('dmx')
    expect(hit.sourcePoints).toBe(96)
  })

  it('未登记曲线契约的族 → null', () => {
    expect(resolveCurveFromCaptured(yunnanCurveDoc('2026-05-15'), 'sdpt_zptjg', '2026-05-15')).toBeNull()
  })

  it('契约声明的族必须是已登记 capture family', () => {
    for (const family of CURVE_CONTRACT_FAMILIES) {
      expect(Object.keys(CAPTURE_FAMILIES)).toContain(family)
    }
  })
})

describe('createSpotPriceLoaders 地区与口径纪律', () => {
  function loaders(body: unknown, region?: string) {
    return createSpotPriceLoaders(async () => body, region ? { resolveRegion: () => region } : {})
  }

  it('命中本地区真实数据 → basis=captured 且带源粒度', async () => {
    const { loadClearingCurve } = loaders(envelope(shanxiList24Payload()), 'shanxi')
    const curve = await loadClearingCurve('2026-05-15')
    expect(curve.basis).toBe('captured')
    expect(curve.isDemo).toBe(false)
    expect(curve.sourcePoints).toBe(24)
    expect(curve.points[0]).toEqual({ time: '00:00', value: 323 })
  })

  it('请求 yunnan 却命中 shanxi → 判为无数据，降级 synthetic', async () => {
    const { loadClearingCurve } = loaders(envelope(shanxiList24Payload()), 'yunnan')
    const curve = await loadClearingCurve('2026-05-15')
    expect(curve.basis).toBe('synthetic')
    expect(curve.isDemo).toBe(true)
    expect(curve.sourcePoints).toBeUndefined()
  })

  it('provenance.fallback=true（基线回退）→ 判为无数据', async () => {
    const body = envelope(shanxiList24Payload(), { realDataConnected: true, served: 'shanxi', fallback: true })
    const { loadClearingCurve } = loaders(body, 'shanxi')
    expect((await loadClearingCurve('2026-05-15')).basis).toBe('synthetic')
  })

  it('DB 层 provenance.region 同样参与校验', async () => {
    const body = envelope(yunnanCurveDoc('2026-05-15'), { realDataConnected: true, region: 'yunnan' })
    expect((await loaders(body, 'yunnan').loadClearingCurve('2026-05-15')).basis).toBe('captured')
    expect((await loaders(body, 'guangdong').loadClearingCurve('2026-05-15')).basis).toBe('synthetic')
  })

  it('mock:true / realDataConnected:false → synthetic', async () => {
    const mock = { code: 200, mock: true, data: yunnanCurveDoc('2026-05-15') }
    expect((await loaders(mock, 'yunnan').loadClearingCurve('2026-05-15')).basis).toBe('synthetic')
    const notConnected = envelope(yunnanCurveDoc('2026-05-15'), { realDataConnected: false, region: 'yunnan' })
    expect((await loaders(notConnected, 'yunnan').loadClearingCurve('2026-05-15')).basis).toBe('synthetic')
  })

  it('取数抛错 → synthetic 而非抛给页面', async () => {
    const { loadClearingCurve } = createSpotPriceLoaders(async () => {
      throw new Error('network down')
    })
    expect((await loadClearingCurve('2026-05-15')).basis).toBe('synthetic')
  })

  it('loadForecastCurve 同样按运行日抽取 knn 逐日文档', async () => {
    const { loadForecastCurve } = loaders(envelope(yunnanCurveDoc('2026-05-15', 300), { realDataConnected: true, region: 'yunnan' }), 'yunnan')
    const curve = await loadForecastCurve('2026-05-15')
    expect(curve.basis).toBe('captured')
    expect(curve.points[0].value).toBe(301)
    // 目标日与文档运行日不一致时不得复用
    expect((await loadForecastCurve('2026-05-16')).basis).toBe('synthetic')
  })

  it('演示开通地区(sichuan)抽不到真实数据 → 返空 empty（不合成 synthetic）', async () => {
    // 即使回放层误 serve 了别地区数据（served=shanxi），演示开通地区严格判无数据 → empty
    const { loadClearingCurve, loadForecastCurve } = loaders(envelope(shanxiList24Payload()), 'sichuan')
    const clearing = await loadClearingCurve('2026-05-15')
    expect(clearing.basis).toBe('empty')
    expect(clearing.isDemo).toBe(false)
    expect(clearing.points).toHaveLength(0)
    const forecast = await loadForecastCurve('2026-05-15')
    expect(forecast.basis).toBe('empty')
    expect(forecast.points).toHaveLength(0)
  })

  it('演示开通策略不误伤真实地区降级（yunnan 缺数据仍 synthetic）', async () => {
    const { loadClearingCurve } = loaders(envelope(shanxiList24Payload()), 'yunnan')
    expect((await loadClearingCurve('2026-05-15')).basis).toBe('synthetic')
  })
})

describe('curveStats 空序列兜底', () => {
  it('空序列返回全 null（防 ±Infinity / max(1,0) 掩盖成 0）', () => {
    expect(curveStats([])).toEqual({ mean: null, max: null, min: null, spread: null })
  })

  it('正常序列算 mean/max/min/spread', () => {
    expect(curveStats([
      { time: '00:00', value: 10 },
      { time: '00:15', value: 20 },
      { time: '00:30', value: 30 }
    ])).toEqual({ mean: 20, max: 30, min: 10, spread: 20 })
  })
})

// spotPriceCore 内联的 OPENED_DEMO_REGION_IDS 与 regions.ts 权威源须一致——
// 演示地区空态策略生效前提。若 regions.ts 改了演示开通集合，须同步 spotPriceCore 内联。
describe('演示开通地区集合一致性', () => {
  it('regions.ts OPENED_DEMO_REGION_IDS 含 sichuan', () => {
    expect(OPENED_DEMO_REGION_IDS.has('sichuan')).toBe(true)
  })
})
