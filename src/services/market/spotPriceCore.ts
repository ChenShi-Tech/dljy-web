// 现货 96 点价格曲线核心逻辑：只依赖注入的回放载荷读取器，便于页面和 Node 门禁脚本共用。
//
// 本文件必须保持运行时零依赖：`scripts/verify/verify-role-access.mjs` 用
// `node --experimental-strip-types` 直接加载本文件做降级断言，Vite/tsconfig 的
// `shared` / `@` alias 在那个环境不存在（现有 `@/services/dataBasis` 是 type-only 导入，
// 会被 strip 掉）。故曲线抽取契约就地内联、不外链 shared 模块；契约与 `CAPTURE_FAMILIES`
// 的一致性由 `spotPriceCore.spec.ts` 交叉断言兜住。
import type { DataBasis } from '@/services/dataBasis'

// 演示开通地区（无真实市场数据采集、仅有演示公司）：这些地区抽不到真实曲线时**不合成
// demo 曲线**，返回空 points 让上游 emptyOverlay 接管（诚实空态，basis='empty'）。与
// regions.ts::OPENED_DEMO_REGION_IDS 同源，本文件运行时零依赖（见文件头注释），故就地内联；
// 一致性由 spotPriceCore.spec.ts 交叉断言兜住。
const OPENED_DEMO_REGION_IDS = new Set(['sichuan'])
function isOpenDemoRegion(region: string | null | undefined): boolean {
  return Boolean(region) && OPENED_DEMO_REGION_IDS.has(region as string)
}

export type CurvePoint = { time: string; value: number }
// isDemo 为兼容字段，新消费方请使用 basis（captured=真实采集回放 / synthetic=合成降级）
export type SpotCurve = {
  points: CurvePoint[]
  isDemo: boolean
  basis: DataBasis
  /**
   * 真实曲线的源粒度（#1459）：96=市场原生 15 分钟点位；24=小时级来源按阶梯展开而来
   * （山西逐日切片只有 24 点，实测即 96 点曲线的逐小时均值），UI 需据此标注「小时级」，
   * 不能让用户误以为看到的是 15 分钟分辨率。合成降级曲线不带该字段。
   */
  sourcePoints?: CurveGranularity
}

type FetchCapturedPayload = (family: string, match?: string) => Promise<unknown>

/** 源曲线粒度：24=小时级，96=15 分钟级。 */
export type CurveGranularity = 24 | 96

type CurveCandidate = {
  /** null=payload 顶层自身就是一行曲线；否则取 payload[container] 这个行数组。 */
  container: string | null
  /** 行内标识运行日的字段。顶层文档同样要校验，防止文件名子串匹配到邻日文件。 */
  dateField: string
  /** 该形状的源点位数；不足 96 时按阶梯（step）展开到 96 点。 */
  points: CurveGranularity
}

/**
 * 曲线抽取契约（#1459）：声明每个采集族「曲线藏在 payload 的什么位置、按哪个字段选运行日、
 * 源粒度多少点」，按顺序试探，命中即止。
 *
 * 取代早期 `fetchReplay` 的近似实现，那版把整个 payload walk 一遍、收集所有落在
 * (10, 5000) 开区间的数字后取前 96 个，对真实形状全线取错（下列均为本机 4174 实测）：
 *   - 错日：山西 `sdpt__zcqxhdl__list24__<date>.json` 的 `data.rqdj` 是 30 天滚动窗口，
 *     `match` 只是文件名子串、不筛行，从头 walk 取到的是窗口首日（请求 2026-05-15 拿到 04-16）；
 *   - 跨天拼接：该窗口每行只有 24 点，凑够 96 个数必然横跨 4~5 行即 4~5 天；
 *   - 混列：行内非曲线字段 `jz`（日均值，实测 280.82）落在数值区间内被一并扫入；
 *   - 点位乱序：实测键序为 `p1,hj,p2..p9,type,p10,jz,p12,p11,p14,p13,p16,p15…`
 *     （p12 排在 p11 前面），`Object.values` 按插入序遍历，连同一行内点位顺序都是错的；
 *   - 丢零点：`p15: 0`（午间光伏大发出清价归零）不落在 (10, 5000) 内，被静默丢弃。
 *
 * 现按「容器键 + 日期字段 + `p<i>` 显式索引」抽取，既不靠键序也不靠数值区间。
 */
const CURVE_CONTRACTS: Record<string, { label: string; candidates: CurveCandidate[] }> = {
  // 出清/价格关系分析。三种真实形状，按分辨率从高到低试探：
  // ① 云南 etl 派生逐日 96 点文档（DB 层 / sdpt__zcqxhdl__curve__<date>.json）→ { drrq, p1..p96 }；
  // ② 全量列表 listrs_full 的 dmx 容器 → 每行 { date, drrq, type, jz, p1..p96 }，逐运行日 96 点；
  // ③ 山西平台原样切片 list24 / fhlist24__<date>.json → data.rqdj 为 30 天滚动窗口，
  // 每行 { date, type:'0', p1..p24, jz=日均值, hj=日合计 }，即日前电价的逐小时均值
  // （实测 rqdj[date=2026-05-15] 的 jz 与 dmx[date=2026-05-15] 完全相同、24 点恰为 96 点按小时求均）。
  //
  // 日期字段不能一刀切（实测）：平台原样行里 `date`=运行日、`drrq`=运行日+1；
  // 而 etl 派生的逐日文档刻意写 `drrq`=运行日（yunnan-parquet-to-family.mjs:167）。
  // 故顶层文档按 drrq 选、列表行按 date 选，两者不可互换，用错就整体错一天。
  //
  // 同一份 list24 里的 xd 是 [电量, 价格] 二元组、xnyz/xnyzd/xnyg/xnygd 是新能源出力（MW），
  // 都不是价格曲线，故不声明为容器。
  sdpt_zcqxhdl: {
    label: '日前出清价',
    candidates: [
      { container: null, dateField: 'drrq', points: 96 },
      { container: 'dmx', dateField: 'date', points: 96 },
      { container: 'rqdj', dateField: 'date', points: 24 }
    ]
  },
  // 日滚动价格预测（KNN）：etl 派生逐日 96 点文档 knn-api__api__knn__daily__<date>.json。
  'knn-api_api': {
    label: '日滚动价格预测(KNN)',
    candidates: [{ container: null, dateField: 'drrq', points: 96 }]
  }
}

/** 已登记曲线契约的族代码（供门禁交叉校验其确为已登记 capture family）。 */
export const CURVE_CONTRACT_FAMILIES = Object.keys(CURVE_CONTRACTS)

function synth96(dateSeed: string, base = 420, amplitude = 180, shift = 0): CurvePoint[] {
  let seed = 0
  for (const ch of dateSeed) seed = (seed * 31 + ch.charCodeAt(0)) % 9973
  const pts: CurvePoint[] = []
  for (let i = 0; i < 96; i++) {
    const h = i / 4
    const shape =
      Math.sin(((h - 6) / 24) * 2 * Math.PI) * 0.6 +
      Math.exp(-((h - 11) ** 2) / 8) * 0.5 +
      Math.exp(-((h - 19) ** 2) / 6) * 0.8
    const noise = Math.sin(seed % 97 + i * 0.7) * 0.08
    pts.push({
      time: `${String(Math.floor(h)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      value: Math.round((base + shift + amplitude * (shape + noise)) * 100) / 100
    })
  }
  return pts
}

type ReplayProvenance = {
  realDataConnected?: unknown
  /** 文件层（sourceType=CAPTURE）：实际命中的地区 + 是否为基线回退。 */
  served?: unknown
  fallback?: unknown
  /** DB 层（sourceType=DB）：命中数据集所属地区。 */
  region?: unknown
}

/**
 * 剥出可用于抽取的回放载荷；任何「不是本地区真实数据」的情形一律返回 null。
 *
 * 地区校验（#1459 验收标准 ③）：文件层 provenance 带 `served`/`fallback`，DB 层带 `region`。
 * `fallback:true` 表示命中的是基线地区（山西）目录，请求方拿到的是别的地区口径
 * 与「真实或空」严格地区谓词同源纪律，这里直接判为无数据，绝不静默串读。
 * 无 provenance 的响应保持原有宽松语义（老回放出口不带该字段），只是无从做地区校验。
 */
function replayPayload(body: unknown, requestedRegion?: string | null): unknown | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const envelope = body as { code?: unknown; data?: unknown; mock?: unknown; provenance?: ReplayProvenance }
  if (typeof envelope.code === 'number' && envelope.code >= 400) return null
  if (envelope.mock === true) return null
  const provenance = envelope.provenance
  if (provenance) {
    if (provenance.realDataConnected !== true) return null
    if (provenance.fallback === true) return null
    const served =
      typeof provenance.served === 'string'
        ? provenance.served
        : typeof provenance.region === 'string'
          ? provenance.region
          : null
    if (requestedRegion && served && served !== requestedRegion) return null
  }
  return 'data' in envelope ? envelope.data : body
}

/** 96 点标准时间轴（00:00…23:45）。导出供消费方把纯数组曲线铺到同一横轴上——
 *  各写一份迟早与出清曲线的时刻对不齐，那种错在图上看不出来。 */
export const timeAxis96 = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0')
  return `${h}:${String((i % 4) * 15).padStart(2, '0')}`
})

/** 日期字段归一：容忍 `2026-05-15T00:00:00` / `2026-05-15 00:00:00` 这类带时间后缀的写法。 */
function isSameDay(raw: unknown, date: string): boolean {
  return typeof raw === 'string' && raw.slice(0, 10) === date
}

/** 按 `p1..pN` 显式索引读一行曲线；任一点缺失/非有限数即整行作废（不插值、不跨行补齐）。 */
function readRowCurve(row: Record<string, unknown>, points: CurveGranularity): number[] | null {
  const values: number[] = []
  for (let i = 1; i <= points; i++) {
    const value = row[`p${i}`]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    values.push(value)
  }
  return values
}

/** 源粒度 → 96 点。24 点按阶梯（每小时值占满 4 个 15 分钟位）展开，不做平滑插值。 */
function expandTo96(values: number[]): number[] | null {
  if (values.length === 96) return values
  if (values.length === 24) return values.flatMap((value) => [value, value, value, value])
  return null
}

function asRow(node: unknown): Record<string, unknown> | null {
  return node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : null
}

export type CurveResolution = {
  /** 96 点序列（源粒度不足 96 时已按阶梯展开）。 */
  values: number[]
  /** 源粒度，供调用方标注「小时级展开」。 */
  sourcePoints: CurveGranularity
  /** 命中的容器键（null=顶层文档）。 */
  container: string | null
}

/**
 * 按族登记的曲线契约，从回放载荷里抽出指定运行日的 96 点曲线。
 * 抽不到（族未登记 / 无该日行 / 点位不全）一律返回 null，绝不返回近似值。
 */
export function resolveCurveFromCaptured(payload: unknown, family: string, date: string): CurveResolution | null {
  const contract = CURVE_CONTRACTS[family]
  if (!contract) return null
  const root = asRow(payload)
  if (!root) return null

  for (const candidate of contract.candidates) {
    const rows: Record<string, unknown>[] = []
    if (candidate.container === null) {
      rows.push(root)
    } else {
      const container = root[candidate.container]
      if (!Array.isArray(container)) continue
      for (const item of container) {
        const row = asRow(item)
        if (row) rows.push(row)
      }
    }
    for (const row of rows) {
      if (!isSameDay(row[candidate.dateField], date)) continue
      const values = readRowCurve(row, candidate.points)
      if (!values) continue
      const expanded = expandTo96(values)
      if (!expanded) continue
      return { values: expanded, sourcePoints: candidate.points, container: candidate.container }
    }
  }
  return null
}

export type SpotPriceLoaderOptions = {
  /**
   * 当前请求地区。用于校验回放命中的地区与请求一致，注入方（spotPrice.ts）传
   * `() => currentRegion.value.id`；门禁脚本不传则只做 `fallback:true` 硬拒。
   */
  resolveRegion?: () => string | null | undefined
}

export function createSpotPriceLoaders(
  fetchCapturedPayload: FetchCapturedPayload,
  options: SpotPriceLoaderOptions = {}
) {
  async function fetchCurve(family: string, date: string): Promise<CurveResolution | null> {
    try {
      const region = options.resolveRegion?.() ?? null
      const payload = replayPayload(await fetchCapturedPayload(family, date), region)
      if (payload == null) return null
      return resolveCurveFromCaptured(payload, family, date)
    } catch {
      return null
    }
  }

  function toCurve(resolution: CurveResolution): SpotCurve {
    return {
      points: resolution.values.map((value, index) => ({ time: timeAxis96[index], value })),
      isDemo: false,
      basis: 'captured',
      sourcePoints: resolution.sourcePoints
    }
  }

  /** 某日出清价 96 点曲线（昨日复盘用）。取不到真实曲线时：演示开通地区返空（empty），其余降级合成（synthetic）。 */
  async function loadClearingCurve(date: string): Promise<SpotCurve> {
    const real = await fetchCurve('sdpt_zcqxhdl', date)
    if (real) return toCurve(real)
    // 演示开通地区（如四川）：无真实市场数据时不合成 demo 曲线，返回空让上游 emptyOverlay 接管。
    const region = options.resolveRegion?.() ?? null
    if (isOpenDemoRegion(region)) return { points: [], isDemo: false, basis: 'empty' }
    return { points: synth96(`clearing:${date}`), isDemo: true, basis: 'synthetic' }
  }

  /** 目标日价格预测 96 点曲线（申报策略输入）。取不到真实曲线时：演示开通地区返空（empty），其余降级合成（synthetic）。 */
  async function loadForecastCurve(date: string): Promise<SpotCurve> {
    const real = await fetchCurve('knn-api_api', date)
    if (real) return toCurve(real)
    // 演示开通地区（如四川）：无真实市场数据时不合成 demo 曲线，返回空让上游 emptyOverlay 接管。
    const region = options.resolveRegion?.() ?? null
    if (isOpenDemoRegion(region)) return { points: [], isDemo: false, basis: 'empty' }
    // 预测曲线相对出清整体形态一致、带 +10 偏移，便于演示对比
    return { points: synth96(`forecast:${date}`, 430, 170, 10), isDemo: true, basis: 'synthetic' }
  }

  return { loadClearingCurve, loadForecastCurve }
}

export function curveStats(points: CurvePoint[]): { mean: number | null; max: number | null; min: number | null; spread: number | null } {
  const vs = points.map((p) => p.value)
  // 空序列兜底：演示开通地区返空 points 时，Math.max(...[])/Math.min(...[]) 会产生
  // ±Infinity、mean 会被 max(1,0) 掩盖成 0，这里返回全 null，让消费方（KPI formatStat）显示「—」。
  if (vs.length === 0) return { mean: null, max: null, min: null, spread: null }
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length
  return {
    mean: Math.round(mean * 10) / 10,
    max: Math.max(...vs),
    min: Math.min(...vs),
    spread: Math.round((Math.max(...vs) - Math.min(...vs)) * 10) / 10
  }
}
