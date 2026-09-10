// @vitest-environment happy-dom （envelope→regionContext 模块级读 window.localStorage，与 mockDemo.spec 同因）
// Mock 演示层 golden 全集契约护栏（PRD 附录 C.23）。
//
// 与 captureFixtures.spec.ts（12 例抽样、走真实适配器）互补，本 spec 把覆盖面拉到
// **族 × 文件全集**，并修掉抽样 spec 的一个结构性盲区：handleCaptured 是 fixtures-first，
// 经 resolveMockRequest 拿到的"mock 侧"在携带族上就是 fixture 原件，等价断言会退化为
// fixture-vs-fixture 空转（C.23 发现）。因此本 spec 用 synthesizeCapturedPayload()
// 直连合成器，对每个采集件断言「合成器输出 ⊇ golden 形状」：
//   * 键集合：golden 每一层对象的每个键都必须在合成器同名位置出现且类型一致
//     （合成器多出的加性键放行——多给数据不会画空图，缺键才会）；
//   * 数组：golden 非空数组在合成器同位置必须非空，首元素结构递归同规
//     （长度不要求相等：真实件是全历史/全量行，合成器是 60–365 天演示窗口）；
//   * 数值域：合成器数值全部有限，量级不超过 golden 量级 ×5+100（单位/缩放漂移报警）。
// 信封口径：golden 采集件是原样 HTTP 响应（{code,msg,data,success}），部分合成器分支
// 返回 {data:{...}} 容器——消费方（dataOf/适配器 asPayload）统一「有 .data 对象就解包
// 一层」，比对前对双侧做同一解包，与视图读取路径一致。
// 归类：无专属合成器分支的 (族, match)（如 sdpt_zjyap 全族、console 天气/负荷配置、
// actualLoad 的 xl0/xl1 曲线文件）按「仅 fixtures 供给」处理——只查路由层 200 +
// x-data-mock + 数据非空；这些文件在演示会话里恒由 fixtures 命中，合成器永不供数。
// zsjfx_day 例外：真实件是平台全量 ~60 序列、合成器是四序列演示子集（C.20 拍板），
// series 键集合取交集比对、双侧非空即可。fixtures 缺失（CI/新克隆）时整组 skip。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveMockRequest, synthesizeCapturedPayload } from './router'
import { fixtureFamilies, fixtureFileList, hasAnyFixture, type FixtureEntry } from './fixtures'

const FIXTURES_DIR = resolve(process.cwd(), 'src/services/mock/fixtures')

type ShapeError = { path: string; issue: string }

/** match 归类（日期/哈希归一），用于把全集漂移聚合成可修的形态类。 */
function matchClass(match: string): string {
  return match
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(/__[0-9a-f]{6,}$/g, '__<hash>')
    .replace(/id\d+/g, 'id<n>')
}

/** 文件名 → 客户端 match 形态（镜像各消费方真实的 match 传参）。 */
function matchFor(family: string, entry: FixtureEntry): string {
  const stem = entry.file.replace(/\.json$/, '')
  if (family === 'sdpt_zrqsb') return entry.date ?? stem // 内容日期索引族：客户端按运行日取
  if (family === 'sdpt_zptqx') return 'list'
  if (family === 'sdpt_zjyap') return 'calendar'
  if (family === 'sdpt_console') {
    // 负荷图 hash 变体：客户端直接以 10 位 hash 作为 match（real-list 也按 hash 清单）
    const hash = stem.match(/getTradingPlatformLoadChart__([0-9a-f]+)$/)?.[1]
    if (hash) return hash
    return stem.replace(/^sdpt__console__/, '').replace(/__[0-9a-f]+$/, '')
  }
  if (family === 'sdpt_fshq') {
    return stem
      .replace(/^sdpt__fshq__/, '')
      .replace(/^fshq__data__/, '')
      .replace(/^fshq__/, '')
      .replace(/__[0-9a-f]+$/, '')
  }
  if (family === 'sdpt_zcqxhdl') {
    const stripped = stem.replace(/^sdpt__zcqxhdl__/, '').replace(/__[0-9a-f]+$/, '')
    // 裸 24 点词干（hash 命名文件剥哈希后不带日期）：补默认日，落入 24 点分支而非容器分支
    if (/^_?list24$|^fhlist24$/.test(stripped)) return `${stripped}__2026-06-01`
    return stripped
  }
  if (family === 'sdpt_actualLoad') {
    return stem.replace(/^sdpt__actualLoad__/, '').replace(/__[0-9a-f]+$/, '')
  }
  if (family === 'knn-api_api') {
    return stem.replace(/__[0-9a-f]+$/, '')
  }
  return stem
}

// 有专属合成器分支、必须与 golden 结构等价的 match 形态（镜像 capturedPayload 的分派条件）。
const CONSOLE_HASHES = ['d859fbde03', '275c1ef9fa', '317f0f0bbd', '0b36fa2030', '0144aacb91', '7db3560c48']

function requiresSynthParity(family: string, match: string): boolean {
  if (family === 'sdpt_zjyap') return false // 无专属分支：仅 fixtures 供给
  if (family === 'sdpt_console') {
    return match === 'getCorpNewEnergyChart' || match.startsWith('getAveragePriceChart') || CONSOLE_HASHES.includes(match)
  }
  if (family === 'sdpt_zcqxhdl') return match !== 'list' // 'list' 茎文件非客户端 match（客户端发 '__list__'）
  if (family === 'sdpt_actualLoad') return match.startsWith('query__') || match.startsWith('query2')
  if (family === 'knn-api_api') return false // 唯一文件是 KNN 预测完整 API 文档（demo 页消费的是合成日文档），按仅 fixtures 供给
  return true
}

/** zsjfx 例外：真实件是平台全量序列/分组、合成器是四序列演示子集（C.20 拍板），
 * 序列名键集合（series/groups/typeAxis/colorMap）取交集比对。 */
function isSeriesSubsetClass(family: string, match: string): boolean {
  return family === 'sdpt_zsjfx_idx' && (match.startsWith('zsjfx_day__') || match === 'zsjfx_meta')
}

/** 对 map 形键（键为业务序列名的对象）做 golden ∩ synth 键裁剪。 */
function clipMapKeys(golden: unknown, synth: unknown, keys: string[]): void {
  if (!golden || !synth || typeof golden !== 'object' || typeof synth !== 'object') return
  const g = golden as Record<string, unknown>
  const s = synth as Record<string, unknown>
  for (const key of keys) {
    const gv = g[key]
    const sv = s[key]
    if (!gv || !sv || typeof gv !== 'object' || typeof sv !== 'object' || Array.isArray(gv) || Array.isArray(sv)) continue
    for (const sub of Object.keys(gv as Record<string, unknown>)) {
      if (!(sub in (sv as Record<string, unknown>))) delete (gv as Record<string, unknown>)[sub]
    }
  }
}

/** 递归结构对比：golden 的每个键/类型/非空数组都必须在合成器同位置成立（加性键放行）。 */
function compareShape(golden: unknown, synth: unknown, path: string, errs: ShapeError[]): void {
  if (golden === null || golden === undefined) return
  if (Array.isArray(golden)) {
    if (!Array.isArray(synth)) {
      errs.push({ path, issue: `golden 是数组，合成器是 ${typeof synth}` })
      return
    }
    if (golden.length > 0 && synth.length === 0) errs.push({ path, issue: `golden 数组 ${golden.length} 行，合成器空数组` })
    if (golden.length > 0 && synth.length > 0) compareShape(golden[0], synth[0], `${path}[0]`, errs)
    return
  }
  if (typeof golden === 'object') {
    if (!synth || typeof synth !== 'object' || Array.isArray(synth)) {
      errs.push({ path, issue: `golden 是对象，合成器是 ${synth === null ? 'null' : typeof synth}` })
      return
    }
    const synthRecord = synth as Record<string, unknown>
    for (const key of Object.keys(golden as Record<string, unknown>)) {
      if (!(key in synthRecord)) {
        errs.push({ path: `${path}.${key}`, issue: '合成器缺键（golden 有、合成器无）' })
        continue
      }
      compareShape((golden as Record<string, unknown>)[key], synthRecord[key], `${path}.${key}`, errs)
    }
    return
  }
  if (typeof golden === 'number') {
    if (typeof synth !== 'number') errs.push({ path, issue: `golden 是数值，合成器是 ${typeof synth}` })
    return
  }
  if (typeof golden === 'string' && typeof synth !== 'string') {
    errs.push({ path, issue: `golden 是字符串，合成器是 ${typeof synth}` })
  }
}

/** 数值域扫描：合成器必须全有限数值；量级跳变（单位漂移）按 golden 量级 ×5+100 报警。 */
function numericDomain(value: unknown): { maxAbs: number; count: number; finite: boolean } {
  let maxAbs = 0
  let count = 0
  let finite = true
  const walk = (node: unknown): void => {
    if (typeof node === 'number') {
      count += 1
      if (!Number.isFinite(node)) finite = false
      else maxAbs = Math.max(maxAbs, Math.abs(node))
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node && typeof node === 'object') Object.values(node).forEach(walk)
  }
  walk(value)
  return { maxAbs, count, finite }
}

/** golden 侧 series 键集合裁剪到与合成器的交集（zsjfx_day 子集契约）。 */
function clipSeriesToIntersection(golden: unknown, synth: unknown): void {
  if (!golden || !synth || typeof golden !== 'object' || typeof synth !== 'object') return
  const g = (golden as Record<string, unknown>).series
  const s = (synth as Record<string, unknown>).series
  if (!g || !s || typeof g !== 'object' || typeof s !== 'object' || Array.isArray(g) || Array.isArray(s)) return
  for (const key of Object.keys(g as Record<string, unknown>)) {
    if (!(key in (s as Record<string, unknown>))) delete (g as Record<string, unknown>)[key]
  }
}

describe.skipIf(!hasAnyFixture())('golden 全集护栏（capture-raw 族×文件全集 vs 合成器，C.23）', () => {
  const families = fixtureFamilies()
  it('fixtures 索引非空且覆盖现货交易域白名单族', () => {
    expect(families.length, '至少携带一个族').toBeGreaterThan(0)
    for (const family of ['sdpt_zcqxhdl', 'sdpt_fshq', 'sdpt_zjyap']) {
      expect(families, `白名单族 ${family} 应在索引中`).toContain(family)
    }
  })

  it('族×文件全集：合成器输出 ⊇ golden 形状（键集合/类型/非空数组/数值域）', { timeout: 120_000 }, async () => {
    const strictFailures: string[] = []
    const fixturesServedOnly: string[] = []
    const gapClasses = new Map<string, number>()
    let strictChecked = 0
    let goldenNumbers = 0
    for (const family of families) {
      const entries = fixtureFileList(family)
      expect(entries.length, `${family} 索引非空`).toBeGreaterThan(0)
      for (const entry of entries) {
        const raw = await readFile(resolve(FIXTURES_DIR, family, entry.file), 'utf8')
        const match = matchFor(family, entry)
        const golden = JSON.parse(raw) as unknown
        const synth = synthesizeCapturedPayload(family, match)
        const gBody = (golden as { data?: unknown }).data && typeof (golden as { data?: unknown }).data === 'object'
          ? (golden as { data: unknown }).data
          : golden
        const sBody = (synth as { data?: unknown }).data && typeof (synth as { data?: unknown }).data === 'object' && !Array.isArray(synth) && Object.keys(synth).length === 1
          ? (synth as { data: unknown }).data
          : synth
        if (isSeriesSubsetClass(family, match)) {
          clipSeriesToIntersection(gBody, sBody)
          clipMapKeys(gBody, sBody, ['groups', 'typeAxis', 'colorMap'])
        }
        const errs: ShapeError[] = []
        compareShape(gBody, sBody, '', errs)
        if (errs.length === 0) {
          strictChecked += 1
        } else if (requiresSynthParity(family, match)) {
          for (const e of errs) {
            const cls = `${family} [${matchClass(match)}] ${e.path} ${e.issue}`
            gapClasses.set(cls, (gapClasses.get(cls) ?? 0) + 1)
          }
          strictFailures.push(`${entry.file} (${match}): ${errs.slice(0, 3).map((e) => `${e.path} ${e.issue}`).join('; ')}`)
          continue
        } else {
          fixturesServedOnly.push(`${family}/${entry.file}`)
        }
        const g = numericDomain(gBody)
        const s = numericDomain(sBody)
        if (g.count > 0) {
          goldenNumbers += 1
          expect(s.finite, `${family}/${entry.file} 合成器数值应全有限`).toBe(true)
          // 量纲护栏只对携带真实量纲（maxAbs ≥ 1000）的 golden 生效：个别异常日文档
          // （行多为 null、数值 ≤ 1e3）与族内主流量纲天然不同，逐文件 ×5 会误报
          if (g.maxAbs >= 1000) {
            expect(s.maxAbs, `${family}/${entry.file} 数值量级跳变（单位漂移?）`).toBeLessThanOrEqual(g.maxAbs * 5 + 100)
          }
        }
      }
    }
    expect(strictChecked, '至少一批文件通过严格结构等价').toBeGreaterThan(0)
    expect(goldenNumbers, 'golden 侧应含数值样本').toBeGreaterThan(0)
    expect(
      strictFailures,
      `合成器形状漂移 ${strictFailures.length} 例，形态类 ${gapClasses.size} 个:\n` +
        [...gapClasses.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => `${n}\t${cls}`).join('\n')
    ).toEqual([])
  })

  it('「仅 fixtures 供给」的 (族, match)：路由层抽样供给完好（200 + x-data-mock + 数据非空）', { timeout: 60_000 }, async () => {
    let sampled = 0
    for (const family of families) {
      const entries = fixtureFileList(family)
      const notParity = entries.filter((entry) => !requiresSynthParity(family, matchFor(family, entry)))
      const sample = [notParity[0], notParity[Math.floor(notParity.length / 2)], notParity[notParity.length - 1]]
        .filter((entry, index, arr) => entry && arr.findIndex((e) => e?.file === entry.file) === index)
      for (const entry of sample) {
        const match = matchFor(family, entry!)
        const res = await resolveMockRequest('GET', new URL(`http://localhost/api/real?family=${encodeURIComponent(family)}&match=${encodeURIComponent(match)}&region=shanxi`))
        expect(res.status, `${family}/${entry!.file} 状态`).toBe(200)
        expect(res.headers.get('x-data-mock'), `${family}/${entry!.file} mock 标头`).toBe('true')
        const body = (await res.json()) as Record<string, unknown>
        const data = (body.data ?? body.rows ?? body) as unknown
        expect(data, `${family}/${entry!.file} 数据非空`).toBeTruthy()
        sampled += 1
      }
    }
    expect(sampled, '「仅 fixtures 供给」抽样应覆盖到文件').toBeGreaterThan(0)
  })
})
