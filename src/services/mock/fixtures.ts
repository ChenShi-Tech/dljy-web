// 演示采集 fixtures 加载器（PRD 附录 C.19）：市场洞察域的真实采集回放件。
//
// 解析规则与后端 server/capture-replay.mjs 逐条对齐——「文件名子串匹配 + 同候选取最大
// 文件」，保证演示端对同一 (family, match) 命中与真实 /api/real 相同的那份原始载荷：
// 显示效果（图表形状/日期覆盖/统计特征）与真实有数账号一致，不再依赖人工追形。
//
// 加载方式：import.meta.glob 惰性动态 import（JSON 经 vite 转为按需 chunk），按请求
// 取件、解析一次后内存缓存——绝不 eager 解析（几十 MB 同步解析会阻塞主线程，C.10 教训）。
// fixtures 目录与索引由 scripts/export-mock-capture-fixtures.mjs 生成，.gitignore 忽略，
// 仅本地演示 worktree 携带；目录为空（如 CI/他人克隆）时全部查询返回 null，路由层自动
// 回落前端合成器，行为与此前一致。

export type FixtureEntry = { file: string; bytes: number; date?: string; capturedAt?: string }

type FixtureIndex = { generatedAt?: string; source?: string; families?: Record<string, FixtureEntry[]> }

// 索引与数据件都在构建期由 glob 收集：索引 eager（几 KB），数据件惰性 thunk（按需加载）。
const INDEX_GLOB = import.meta.glob('./fixtures-index.json', { eager: true, import: 'default' }) as Record<string, FixtureIndex>
const FIXTURE_MODULES = import.meta.glob('./fixtures/**/*.json', { import: 'default' }) as Record<string, () => Promise<unknown>>

const fixtureIndex: FixtureIndex = Object.values(INDEX_GLOB)[0] ?? { families: {} }

/** 该族是否有 fixtures（real-list 决定走索引清单还是合成清单）。 */
export function hasFixtureFamily(family: string): boolean {
  return (fixtureIndex.families?.[family]?.length ?? 0) > 0
}

/** 索引中的全部族名（golden 全集 spec 的遍历依据）。 */
export function fixtureFamilies(): string[] {
  return Object.keys(fixtureIndex.families ?? {})
}

/** 该族文件清单（bytes 降序，镜像后端 listCaptured 排序口径）。 */
export function fixtureFileList(family: string): FixtureEntry[] {
  return fixtureIndex.families?.[family] ?? []
}

/** 是否至少存在一份 fixtures（golden 契约 spec 的 skip 依据）。 */
export function hasAnyFixture(): boolean {
  return Object.values(fixtureIndex.families ?? {}).some((list) => list.length > 0)
}

// 后端选文件口径：f.includes(match) 过滤后按体积取最大（sort 大→小后取首个）。索引已按
// bytes 降序，这里直接线性扫保持同序 + 文件名升序的确定性次序。match 为纯 ISO 日期且
// 索引带内容日期（hash 命名族，如 sdpt_zrqsb 走侧车日期）时优先按日期命中——同日期多份
// 采集取 capturedAt 最新（镜像后端 contentDateIndexFor 的「严格大于才替换」口径）。
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const dateIndexCache = new Map<string, Map<string, FixtureEntry>>()

function dateIndexFor(family: string): Map<string, FixtureEntry> {
  let index = dateIndexCache.get(family)
  if (index) return index
  index = new Map()
  for (const entry of fixtureFileList(family)) {
    if (!entry.date) continue
    const prev = index.get(entry.date)
    if (!prev || (entry.capturedAt ?? '') > (prev.capturedAt ?? '')) index.set(entry.date, entry)
  }
  dateIndexCache.set(family, index)
  return index
}

function resolveEntry(family: string, match: string): FixtureEntry | null {
  if (match && ISO_DATE_RE.test(match)) {
    const byDate = dateIndexFor(family).get(match)
    if (byDate) return byDate
  }
  let winner: FixtureEntry | null = null
  for (const entry of fixtureFileList(family)) {
    if (match && !entry.file.includes(match)) continue
    if (!winner || entry.bytes > winner.bytes || (entry.bytes === winner.bytes && entry.file < winner.file)) {
      winner = entry
    }
  }
  return winner
}

const payloadCache = new Map<string, Record<string, unknown> | null>()

// —— 价格软化（PRD C.22）——
// 真实采集的 dmx 价格行含 1500 限价尖峰/顶格平台（近月 p95=437，个别点打满 1500），
// 驾驶舱「现货价格」与实时监盘「实时 vs 日前」的 y 轴被两根针拉满，其余曲线压扁、
// 峰谷价差 KPI 冲到 ~1450。对 dmx 行做确定性压缩：>620 的值按 v'=620+(v-620)*0.22
// 收敛（1500→814、1000→668、800→640），≤620 原样（覆盖 95% 真实点，鸭子曲线形态
// 与随机性保留）。只动 dmx 容器（价格明细约定键），负荷/出力行（fhlist24/xnyzd）不动；
// 同一文件全消费方（驾驶舱/监盘/复盘/市场洞察）读同一份软化后载荷，跨页数值一致。
const PRICE_SOFTEN_ABOVE = 620
const PRICE_SOFTEN_SLOPE = 0.22

export function softenPriceValue(v: number): number {
  if (v <= PRICE_SOFTEN_ABOVE) return v
  return Math.round((PRICE_SOFTEN_ABOVE + (v - PRICE_SOFTEN_ABOVE) * PRICE_SOFTEN_SLOPE) * 10) / 10
}

function softenDmxRows(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows
  let touched = false
  const out = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const rec = row as Record<string, unknown>
    let changed = false
    const next: Record<string, unknown> = { ...rec }
    if (typeof next.jz === 'number' && next.jz > PRICE_SOFTEN_ABOVE) {
      next.jz = softenPriceValue(next.jz)
      changed = true
    }
    for (let p = 1; p <= 96; p += 1) {
      const key = `p${p}`
      const value = next[key]
      if (typeof value === 'number' && value > PRICE_SOFTEN_ABOVE) {
        next[key] = softenPriceValue(value)
        changed = true
      }
    }
    if (changed) {
      touched = true
      return next
    }
    return row
  })
  return touched ? out : rows
}

function softenPricePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null
  if (data && Array.isArray(data.dmx)) {
    const softened = softenDmxRows(data.dmx)
    if (softened !== data.dmx) return { ...payload, data: { ...data, dmx: softened } }
  }
  if (Array.isArray(payload.dmx)) {
    const softened = softenDmxRows(payload.dmx)
    if (softened !== payload.dmx) return { ...payload, dmx: softened }
  }
  return payload
}

/**
 * 解析 (family, match) 对应的原始采集载荷；未命中返回 null（调用方回落合成器）。
 * 键为 glob 相对路径 `./fixtures/<family>/<file>`；match 为空串时同后端「family-only」
 * 语义（全族候选中取最大）。
 */
export async function loadFixturePayload(family: string, match: string): Promise<{ payload: Record<string, unknown>; entry: FixtureEntry } | null> {
  const entry = resolveEntry(family, match)
  if (!entry) return null
  const key = `./fixtures/${family}/${entry.file}`
  let payload = payloadCache.get(key)
  if (payload === undefined) {
    const loader = FIXTURE_MODULES[key]
    if (!loader) {
      // 索引与 glob 不一致（目录被手动删改）：按未命中处理并记账，不抛错
      console.warn(`[mock-demo] fixture 索引指向缺失文件: ${key}`)
      payloadCache.set(key, null)
      return null
    }
    try {
      payload = softenPricePayload((await loader()) as Record<string, unknown>)
    } catch (error) {
      console.warn(`[mock-demo] fixture 加载失败: ${key}`, error)
      payloadCache.set(key, null)
      return null
    }
    payloadCache.set(key, payload)
  }
  if (!payload) return null
  return { payload, entry }
}

const dayCurveCache = new Map<string, { da: number[] | null; rt: number[] | null }>()

/**
 * 某交易日的真实日前/实时出清价 96 点曲线（源自 sdpt_zcqxhdl/listrs_full 采集件的 dmx 行，
 * type '0'=日前 '1'=实时）。用于让 quant 监盘/复盘/预测等智能体域端点与驾驶舱、市场洞察
 * 共享同一份真实价格——同一天全系统数值一致（「逼真」的核心：跨页一致性）。
 * 采集窗口外或无 fixtures 返回 { da:null, rt:null }，调用方回落标定合成曲线。
 */
export async function loadRealDayCurve(date: string): Promise<{ da: number[] | null; rt: number[] | null }> {
  const cached = dayCurveCache.get(date)
  if (cached) return cached
  const out = { da: null, rt: null } as { da: number[] | null; rt: number[] | null }
  const fixture = await loadFixturePayload('sdpt_zcqxhdl', 'listrs_full')
  const dmx = (fixture?.payload as { data?: { dmx?: unknown } } | null)?.data?.dmx
  if (Array.isArray(dmx)) {
    const pick = (type: string): number[] | null => {
      const row = dmx.find((r) => (r as { date?: unknown; type?: unknown }).date === date && String((r as { type?: unknown }).type) === type) as Record<string, unknown> | undefined
      if (!row) return null
      const points: number[] = []
      for (let p = 1; p <= 96; p++) {
        const value = row[`p${p}`]
        points.push(typeof value === 'number' && Number.isFinite(value) ? value : 0)
      }
      return points
    }
    out.da = pick('0')
    out.rt = pick('1')
  }
  dayCurveCache.set(date, out)
  return out
}
