// zsjfxDerived — 综合数据分析衍生线纯函数（Epic #3591 S2 / dljy#3594，ZW-05）。
// 两条已勾选曲线的当日 96 点逐点运算：差值/比值/覆盖率（实际/预测）。
// 纪律：空值传播（任一侧为空 → 该时段为空，绝不补零）；比值与覆盖率在分母为零或
// 接近零的时段置空并计数说明（可解释处理，不静默产出极大值）。前端确定性计算，
// 不发请求、不经 LLM（design D5）。

export type DerivedKind = 'diff' | 'ratio' | 'coverage'

export type DerivedSpec = {
  kind: DerivedKind
  a: string
  b: string
}

export type DerivedSeries = {
  name: string
  kind: DerivedKind
  a: string
  b: string
  points: Array<number | null>
  /** 分母为零/接近零被置空的时段数（ratio/coverage 才可能非零）。 */
  excludedZeroDenominator: number
  /** 任一侧为空而传播为空的时段数。 */
  nullPropagated: number
}

export const DERIVED_LABEL: Record<DerivedKind, string> = {
  diff: '差值',
  ratio: '比值',
  coverage: '覆盖率'
}

const DENOM_FLOOR = 1e-9
const round3 = (v: number) => Math.round(v * 1000) / 1000
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function derivedName(spec: DerivedSpec): string {
  const op = spec.kind === 'diff' ? '−' : '÷'
  return spec.kind === 'coverage' ? `覆盖率(${spec.a.slice(0, 8)}…/${spec.b.slice(0, 8)}…)` : `${spec.a} ${op} ${spec.b}`
}

/** 衍生线计算：a、b 为 96 点曲线（null=缺测）。diff=a−b；ratio=a÷b；coverage=b÷a（实际/预测）。 */
export function computeDerivedSeries(spec: DerivedSpec, a: Array<number | null> | undefined, b: Array<number | null> | undefined): DerivedSeries {
  const av = Array.isArray(a) ? a : []
  const bv = Array.isArray(b) ? b : []
  const points: Array<number | null> = []
  let excludedZeroDenominator = 0
  let nullPropagated = 0
  for (let i = 0; i < 96; i += 1) {
    const x = av[i]
    const y = bv[i]
    if (!isNum(x) || !isNum(y)) {
      points.push(null)
      nullPropagated += 1
      continue
    }
    if (spec.kind === 'diff') {
      points.push(round3(x - y))
    } else {
      const denom = spec.kind === 'ratio' ? y : x
      const numer = spec.kind === 'ratio' ? x : y
      if (Math.abs(denom) <= DENOM_FLOOR) {
        points.push(null)
        excludedZeroDenominator += 1
      } else {
        // coverage 输出百分数（95 = 95%），与 CSV/tooltip 的 % 单位一致（codex #238 R1-03）
        points.push(round3(spec.kind === 'coverage' ? (numer / denom) * 100 : numer / denom))
      }
    }
  }
  return { name: derivedName(spec), kind: spec.kind, a: spec.a, b: spec.b, points, excludedZeroDenominator, nullPropagated }
}

const DERIVED_KINDS: ReadonlyArray<DerivedKind> = ['diff', 'ratio', 'coverage']

/** 「我的视图」还原入口（ZW-05 场景 3）：契约 2.2.0 可选 derived 的防御式规整——
 * 非法项（缺字段/未知运算）逐项丢弃，旧视图无字段 → 空清单（不还原任何衍生线）。 */
export function normalizeDerivedSpecs(input: unknown): DerivedSpec[] {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is DerivedSpec =>
    !!item && typeof item === 'object'
    && DERIVED_KINDS.includes((item as DerivedSpec).kind)
    && typeof (item as DerivedSpec).a === 'string' && (item as DerivedSpec).a.length > 0
    && typeof (item as DerivedSpec).b === 'string' && (item as DerivedSpec).b.length > 0)
}
