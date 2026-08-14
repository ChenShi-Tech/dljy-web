// Artifact 围栏解析：把 agent 流式输出的 Markdown 切成有序「块」，其中约定围栏被
// 提升为一等 artifact，其余正文走完整 Markdown 渲染（见 ./markdown）。
//
// 扩展方式（关键）：新增一种 artifact = 往 FENCE_REGISTRY 填一个 { types, parse } 项
// （+ 如需自定义视图再加一个组件并在 ArtifactRenderer 注册）。业务图表类（申报曲线、
// 预测带、敞口…）的 parse 把语义 JSON 经 ./businessCharts 转成 ECharts option，统一
// 回落 kind:'chart' 复用 ChartArtifact —— 无需新组件、不改 ArtifactRenderer。
//
// 设计原则：JSON body 解析失败安全降级为代码块，绝不丢内容；解析是纯函数，供流式
// （每次 token 追加后整体重解析）与静态场景共用。

import hljs from 'highlight.js/lib/common'
import { renderMarkdown } from './markdown'
import type { AnalysisChartSpec, AnalysisChartType, AnalysisDashboard } from '@dljy/contracts'
import {
  buildDeclarationOption,
  buildForecastOption,
  buildPositionOption,
  buildArbitrageOption,
  buildStorageOption,
  buildGaugeOption,
  buildClearingOption,
  buildGeoOption,
  buildHeatmapOption,
  buildCandleOption,
  buildWaterfallOption,
  buildSankeyOption,
  buildPieOption
} from './businessCharts'

// ── 块类型（discriminated union；每加一种带独立视图的 artifact 加一个 kind） ──
export type CardMetric = {
  label: string
  value: string | number
  unit?: string
  delta?: string | number
  trend?: 'up' | 'down' | 'flat'
  tone?: 'up' | 'down' | 'neutral'
  hint?: string
}
export type CalloutLevel = 'info' | 'warning' | 'critical' | 'success' | 'tip'

export type MarkdownArtifactBlock = { kind: 'markdown'; html: string }
export type CodeArtifactBlock = {
  kind: 'code'
  lang: string
  label: string
  code: string
  html: string
  lines: number
}
export type ChartArtifactBlock = { kind: 'chart'; title: string; option: Record<string, unknown> }
export type AnalysisChartArtifactBlock = { kind: 'analysis-chart'; spec: AnalysisChartSpec }
export type AnalysisDashboardArtifactBlock = { kind: 'analysis-dashboard'; dashboard: AnalysisDashboard }
export type HtmlArtifactBlock = { kind: 'html'; title: string; code: string }
export type CardArtifactBlock = {
  kind: 'card'
  title: string
  subtitle?: string
  metrics: CardMetric[]
  footnote?: string
}
export type CalloutArtifactBlock = {
  kind: 'callout'
  level: CalloutLevel
  title: string
  html: string
}
export type TableColumn = { key: string; label: string; align?: 'left' | 'right' | 'center' }
export type TableArtifactBlock = { kind: 'table'; title: string; columns: TableColumn[]; rows: string[][]; footnote?: string }
export type Citation = { title: string; url?: string; source?: string; date?: string; snippet?: string }
export type CiteArtifactBlock = { kind: 'cite'; sources: Citation[] }
export type JsonViewArtifactBlock = { kind: 'jsonview'; title: string; data: unknown }
export type TimelineEvent = { time?: string; title: string; desc?: string; tone?: 'up' | 'down' | 'neutral' | 'active' }
export type TimelineArtifactBlock = { kind: 'timeline'; title: string; events: TimelineEvent[] }
export type SettlementCellDiff = { row: number; col: number; reason?: string; color?: string }
export type SettlementMatrixRow = { label: string; values: string[] }
export type SettlementArtifactBlock = {
  kind: 'settlement'
  title: string
  header: string[]
  rows: SettlementMatrixRow[]
  diffs: SettlementCellDiff[]
  summary?: string
}
export type MathArtifactBlock = { kind: 'math'; code: string }
export type MermaidArtifactBlock = { kind: 'mermaid'; title: string; code: string }
export type DownloadFile = { name: string; content?: string; url?: string; mime?: string; bytes?: number }
export type DownloadArtifactBlock = { kind: 'download'; title: string; files: DownloadFile[] }
export type FormFieldType = 'text' | 'number' | 'select' | 'textarea'
export type FormField = {
  name: string
  label: string
  type: FormFieldType
  placeholder?: string
  value?: string
  options?: string[]
}
export type FormArtifactBlock = { kind: 'form'; title: string; fields: FormField[]; submitLabel: string }
export type StepStatus = 'done' | 'doing' | 'todo' | 'blocked'
export type StepItem = { title: string; desc?: string; status?: StepStatus; time?: string }
export type StepsArtifactBlock = { kind: 'steps'; title: string; steps: StepItem[]; ordered: boolean }
export type DiffArtifactBlock = {
  kind: 'diff'
  title: string
  before: string
  after: string
  beforeLabel: string
  afterLabel: string
  language?: string
}
export type DljyUiArtifactBlock = {
  kind: 'dljy-ui'
  component: string
  title?: string
  props: Record<string, unknown>
  basis?: 'real' | 'captured' | 'synthetic' | 'illustrative'
  dataRef?: string
}
export type ArtifactBlock =
  | MarkdownArtifactBlock
  | CodeArtifactBlock
  | ChartArtifactBlock
  | AnalysisChartArtifactBlock
  | AnalysisDashboardArtifactBlock
  | HtmlArtifactBlock
  | CardArtifactBlock
  | CalloutArtifactBlock
  | TableArtifactBlock
  | CiteArtifactBlock
  | JsonViewArtifactBlock
  | TimelineArtifactBlock
  | SettlementArtifactBlock
  | MathArtifactBlock
  | MermaidArtifactBlock
  | DownloadArtifactBlock
  | FormArtifactBlock
  | StepsArtifactBlock
  | DiffArtifactBlock
  | DljyUiArtifactBlock

const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/

// ── 宽松 JSON：容忍 // 与 /* */ 注释、对象/数组尾随逗号（LLM 常见），仍走
// JSON.parse（绝不 eval）。失败返回 undefined，由调用方降级为代码块。
export function looseParseJson(src: string): unknown {
  const direct = tryJson(src)
  if (direct !== undefined) return direct
  const cleaned = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  return tryJson(cleaned)
}
function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 高亮：指定语言优先，否则自动检测，再不行转义兜底（与 ./markdown 策略一致）。
function highlightCode(code: string, lang: string): { html: string; lang: string } {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang }
    } catch {
      /* 降级自动检测 */
    }
  }
  try {
    const r = hljs.highlightAuto(code)
    return { html: r.value, lang: lang || r.language || '' }
  } catch {
    return { html: escapeHtml(code), lang: lang || '' }
  }
}

export function codeBlock(lang: string, label: string, code: string): CodeArtifactBlock {
  const { html, lang: detected } = highlightCode(code, lang)
  return { kind: 'code', lang: detected, label, code, html, lines: code === '' ? 0 : code.split('\n').length }
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}
function optStr(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v)
  return s === '' ? undefined : s
}
// 链接协议白名单：仅放行 http(s)，挡掉 javascript:/data: 等绕过净化的危险协议(Codex P2)。
function safeHttpUrl(v: unknown): string | undefined {
  const s = optStr(v)
  if (!s) return undefined
  const t = s.trim()
  return /^https?:\/\//i.test(t) ? t : undefined
}
function trendOf(v: unknown): CardMetric['trend'] {
  const s = String(v ?? '').toLowerCase()
  if (s === 'up' || s === 'rise' || s === 'increase') return 'up'
  if (s === 'down' || s === 'fall' || s === 'decrease') return 'down'
  if (s === 'flat' || s === 'equal') return 'flat'
  return undefined
}
function toneOf(v: unknown): CardMetric['tone'] {
  const s = String(v ?? '').toLowerCase()
  if (s === 'up' || s === 'pos' || s === 'positive' || s === 'good') return 'up'
  if (s === 'down' || s === 'neg' || s === 'negative' || s === 'bad') return 'down'
  if (s === 'neutral' || s === 'flat') return 'neutral'
  return undefined
}

// card JSON 归一：兼容 {metrics|items:[...]} 或顶层就是数组；逐项容错。
function normalizeCard(data: unknown, fallbackTitle: string): CardArtifactBlock | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const raw: unknown[] | null = Array.isArray(data)
    ? (data as unknown[])
    : Array.isArray(d.metrics)
      ? (d.metrics as unknown[])
      : Array.isArray(d.items)
        ? (d.items as unknown[])
        : null
  if (!raw) return null

  const metrics: CardMetric[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const label = str(r.label ?? r.name ?? r.key ?? r.title)
    const value = (r.value ?? r.val ?? r.amount) as string | number | undefined
    if (!label && value === undefined) continue
    metrics.push({
      label,
      value: value ?? '',
      unit: optStr(r.unit),
      delta: (r.delta ?? r.change ?? r.diff) as string | number | undefined,
      trend: trendOf(r.trend),
      tone: toneOf(r.tone),
      hint: optStr(r.hint ?? r.note ?? r.desc)
    })
  }
  if (!metrics.length) return null
  return {
    kind: 'card',
    title: (Array.isArray(data) ? '' : str(d.title)) || fallbackTitle || '测算结果',
    subtitle: Array.isArray(data) ? undefined : optStr(d.subtitle),
    metrics,
    footnote: Array.isArray(data) ? undefined : optStr(d.footnote ?? d.note ?? d.remark)
  }
}

// ── 围栏 info 拆分：首词为类型，其余为标题 ──
function splitInfo(info: string): { type: string; title: string } {
  const sp = info.search(/\s/)
  const type = (sp === -1 ? info : info.slice(0, sp)).toLowerCase()
  const title = (sp === -1 ? '' : info.slice(sp + 1)).trim()
  return { type, title }
}

// ── 各类围栏 parser（匹配 type 后调用；自带降级，返回的一定是合法块） ──
function parseChartFence(title: string, body: string): ArtifactBlock {
  const opt = looseParseJson(body)
  if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
    return { kind: 'chart', title: title || '图表', option: opt as Record<string, unknown> }
  }
  return codeBlock('json', title, body)
}
function parseCardFence(title: string, body: string): ArtifactBlock {
  return normalizeCard(looseParseJson(body), title) ?? codeBlock('json', title, body)
}
function parseHtmlFence(title: string, body: string): ArtifactBlock {
  return { kind: 'html', title: title || '交互页面', code: body }
}

// 已知 ECharts series.type 白名单：判定「这个 series 像不像真 ECharts 系列」。
const ECHARTS_SERIES_TYPES = new Set([
  'line', 'bar', 'pie', 'scatter', 'effectScatter', 'radar', 'tree', 'treemap',
  'sunburst', 'boxplot', 'candlestick', 'heatmap', 'map', 'parallel', 'lines',
  'graph', 'sankey', 'funnel', 'gauge', 'pictorialBar', 'themeRiver', 'custom'
])

// series 合法性：数组每项 / 单对象都须是「含已知 type 的对象」才算真 ECharts 系列。
// 仅看存在性（旧逻辑）会把业务 JSON 里恰好叫 series 的字符串数组/无 type 对象误判为图表，
// 进而把不可渲染的 option 灌进 ECharts setOption 抛错（STREAM-2）。
function isValidEChartsSeries(series: unknown): boolean {
  const hasType = (s: unknown): boolean =>
    !!s && typeof s === 'object' && !Array.isArray(s) &&
    typeof (s as Record<string, unknown>).type === 'string' &&
    ECHARTS_SERIES_TYPES.has((s as Record<string, unknown>).type as string)
  if (Array.isArray(series)) return series.length > 0 && series.every(hasType)
  return hasType(series)
}

// 启发式：判断 JSON 是否为 ECharts option。要求 series 是「含已知 type 的对象（或其数组）」——
// 满足即视为图表（单 series 图如 pie/gauge 不需坐标轴，故不再强求坐标系/可视组件存在）。
// 用于容错 agent 误用 ```json 包图表 —— 应渲染为图表而非 JSON 代码块；同时避免误判致 setOption 崩。
function looksLikeEChartsOption(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return isValidEChartsSeries((v as Record<string, unknown>).series)
}
// ```json 围栏：内容是 ECharts option 时提升为图表，否则按 JSON 代码块。
function parseJsonFence(title: string, body: string): ArtifactBlock {
  const data = looseParseJson(body)
  if (looksLikeEChartsOption(data)) {
    return { kind: 'chart', title: title || '图表', option: data as Record<string, unknown> }
  }
  return codeBlock('json', title, body)
}

const ANALYSIS_CHART_TYPES = new Set<AnalysisChartType>([
  'line', 'bar', 'dual_axis', 'scatter', 'pie', 'table', 'kpi',
  'price_heatmap', 'duration_curve', 'spread_distribution',
  'deviation_band', 'correlation_matrix',
])

// AnalysisChartSpec（#32 契约）→ analysis-chart artifact；解析失败或 chartType 非法降级为 code。
function parseAnalysisChartFence(title: string, body: string): ArtifactBlock {
  const data = looseParseJson(body)
  if (
    data && typeof data === 'object' && !Array.isArray(data) &&
    ANALYSIS_CHART_TYPES.has((data as { chartType?: AnalysisChartType }).chartType as AnalysisChartType) &&
    typeof (data as { title?: unknown }).title === 'string'
  ) {
    return { kind: 'analysis-chart', spec: data as AnalysisChartSpec }
  }
  return codeBlock('json', title, body)
}

// AnalysisDashboard（#32/#38）→ analysis-dashboard artifact；结构非法降级为 code。
function parseAnalysisDashboardFence(title: string, body: string): ArtifactBlock {
  const data = looseParseJson(body)
  if (
    data && typeof data === 'object' && !Array.isArray(data) &&
    Array.isArray((data as { charts?: unknown }).charts) &&
    typeof (data as { title?: unknown }).title === 'string'
  ) {
    return { kind: 'analysis-dashboard', dashboard: data as AnalysisDashboard }
  }
  return codeBlock('json', title, body)
}

const CALLOUT_LEVELS: Record<string, CalloutLevel> = {
  info: 'info', note: 'info', callout: 'info',
  tip: 'tip',
  success: 'success', ok: 'success',
  warning: 'warning', warn: 'warning',
  danger: 'critical', critical: 'critical', error: 'critical'
}
const CALLOUT_DEFAULT_TITLE: Record<CalloutLevel, string> = {
  info: '提示', warning: '注意', critical: '警告', success: '完成', tip: '建议'
}
function parseCalloutFence(title: string, body: string, type: string): ArtifactBlock {
  let level: CalloutLevel = CALLOUT_LEVELS[type] ?? 'info'
  let heading = title
  // ```callout warning 标题 —— 允许 title 首词覆盖级别
  if (type === 'callout' || type === 'note') {
    const words = title.split(/\s+/).filter(Boolean)
    const lv = CALLOUT_LEVELS[(words[0] ?? '').toLowerCase()]
    if (lv) {
      level = lv
      heading = words.slice(1).join(' ')
    }
  }
  return {
    kind: 'callout',
    level,
    title: heading || CALLOUT_DEFAULT_TITLE[level],
    html: renderMarkdown(body)
  }
}

// ── B1 通用 artifact：表格 / 引用 / JSON 树 / 时间线 ──
function alignOf(v: unknown): TableColumn['align'] {
  const s = String(v ?? '').toLowerCase()
  if (s === 'left') return 'left'
  if (s === 'right') return 'right'
  if (s === 'center') return 'center'
  return undefined
}
function normalizeTable(data: unknown, title: string): TableArtifactBlock | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  let columns: TableColumn[] = []
  const colSrc = d.columns ?? d.headers ?? d.cols
  if (Array.isArray(colSrc)) {
    columns = colSrc.map((c, i) => {
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>
        return {
          key: str(o.key ?? o.field ?? o.label ?? i),
          label: str(o.label ?? o.title ?? o.key ?? o.field ?? i),
          align: alignOf(o.align)
        }
      }
      // 字符串列：key 用字符串本身，兼容对象行按列名取值(Codex P2)；数组行仍按 index 取。
      return { key: str(c), label: str(c) }
    })
  }
  const rowSrc = Array.isArray(d.rows)
    ? d.rows
    : Array.isArray(data)
      ? (data as unknown[])
      : Array.isArray(d.data)
        ? (d.data as unknown[])
        : []
  const rawRows = rowSrc as unknown[]
  if (!columns.length && rawRows[0] && typeof rawRows[0] === 'object' && !Array.isArray(rawRows[0])) {
    columns = Object.keys(rawRows[0] as Record<string, unknown>).map((k) => ({ key: k, label: k }))
  }
  if (!columns.length) return null
  const rows: string[][] = rawRows
    .filter((r): r is object => !!r && typeof r === 'object')
    .map((r) =>
      Array.isArray(r)
        ? columns.map((_, i) => str((r as unknown[])[i]))
        : columns.map((c) => str((r as Record<string, unknown>)[c.key]))
    )
  if (!rows.length) return null
  return { kind: 'table', title: title || str(d.title) || '数据表', columns, rows }
}
function normalizeCite(data: unknown): CiteArtifactBlock | null {
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).sources)
      ? ((data as Record<string, unknown>).sources as unknown[])
      : null
  if (!arr) return null
  const sources: Citation[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const title = str(o.title ?? o.name ?? o.source ?? o.url)
    if (!title) continue
    sources.push({
      title,
      url: safeHttpUrl(o.url ?? o.link),
      source: optStr(o.source ?? o.publisher ?? o.site),
      date: optStr(o.date ?? o.published ?? o.time),
      snippet: optStr(o.snippet ?? o.summary ?? o.desc ?? o.quote)
    })
  }
  return sources.length ? { kind: 'cite', sources } : null
}
function timelineTone(v: unknown): TimelineEvent['tone'] {
  const s = String(v ?? '').toLowerCase()
  if (s === 'up' || s === 'good' || s === 'done' || s === 'success') return 'up'
  if (s === 'down' || s === 'bad' || s === 'error' || s === 'fail') return 'down'
  if (s === 'active' || s === 'current' || s === 'running' || s === 'progress') return 'active'
  if (s === 'neutral') return 'neutral'
  return undefined
}
function normalizeTimeline(data: unknown, title: string): TimelineArtifactBlock | null {
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).events)
      ? ((data as Record<string, unknown>).events as unknown[])
      : null
  if (!arr) return null
  const events: TimelineEvent[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const tt = str(o.title ?? o.label ?? o.event ?? o.name)
    if (!tt) continue
    events.push({
      time: optStr(o.time ?? o.date ?? o.at),
      title: tt,
      desc: optStr(o.desc ?? o.detail ?? o.note ?? o.content),
      tone: timelineTone(o.tone ?? o.status)
    })
  }
  if (!events.length) return null
  const fallback = Array.isArray(data) ? '' : str((data as Record<string, unknown>).title)
  return { kind: 'timeline', title: title || fallback || '时间线', events }
}

function parseTableFence(title: string, body: string): ArtifactBlock {
  return normalizeTable(looseParseJson(body), title) ?? codeBlock('json', title, body)
}
function parseCiteFence(title: string, body: string): ArtifactBlock {
  return normalizeCite(looseParseJson(body)) ?? codeBlock('json', title, body)
}
function parseTimelineFence(title: string, body: string): ArtifactBlock {
  return normalizeTimeline(looseParseJson(body), title) ?? codeBlock('json', title, body)
}
function parseJsonViewFence(title: string, body: string): ArtifactBlock {
  const data = looseParseJson(body)
  return data === undefined ? codeBlock('json', title, body) : { kind: 'jsonview', title: title || 'JSON', data }
}

// ── B2 业务图表：语义 JSON 经 ./businessCharts 转 ECharts option，回落 chart kind ──
function bizChart(
  builder: (data: unknown) => Record<string, unknown> | null,
  defTitle: string
): FenceParser {
  return (title, body) => {
    const opt = builder(looseParseJson(body))
    return opt ? { kind: 'chart', title: title || defTitle, option: opt } : codeBlock('json', title, body)
  }
}

// ── B3 业务表格/对比：对账(差异染色) / 地区规则对比(复用 table) ──
function objOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function arrOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function numOf(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? NaN : n
}
function fmtNum(n: number): string {
  return n.toLocaleString('zh', { maximumFractionDigits: 2 })
}
function signedNum(n: number): string {
  return (n > 0 ? '+' : '') + fmtNum(n)
}
function normalizeSettlement(data: unknown, title: string): SettlementArtifactBlock | null {
  const d = objOf(data)
  const header = arrOf(d.header ?? d.columns ?? d.headers).map((h) => str(h))
  const rawRows = arrOf(d.rows ?? d.items ?? data)
  // 变体 A：通用矩阵 { header:[], rows:[{label,values:[]}], diffs:[{row,col,reason,color}], summary }
  if (header.length && rawRows.length && objOf(rawRows[0]).values !== undefined) {
    const rows: SettlementMatrixRow[] = rawRows
      .map((r) => objOf(r))
      .map((r) => ({
        label: str(r.label ?? r.item ?? r.name),
        values: arrOf(r.values ?? r.vals).map((v) => str(v))
      }))
      .filter((r) => r.label || r.values.length)
    if (!rows.length) return null
    const diffs: SettlementCellDiff[] = arrOf(d.diffs)
      .map((x) => objOf(x))
      .map((o) => ({ row: numOf(o.row), col: numOf(o.col), reason: optStr(o.reason ?? o.note), color: optStr(o.color) }))
      .filter((x) => !isNaN(x.row) && !isNaN(x.col))
    return { kind: 'settlement', title: title || str(d.title) || '结算对账', header, rows, diffs, summary: optStr(d.summary ?? d.note) }
  }
  // 变体 B（旧）：{ rows:[{item,expected,actual,diff?}] } → 转 4 列矩阵 + 差异列染色 + 合计
  if (!rawRows.length) return null
  const rows: SettlementMatrixRow[] = []
  const diffs: SettlementCellDiff[] = []
  let te = 0
  let ta = 0
  let td = 0
  for (const it of rawRows) {
    const o = objOf(it)
    const item = str(o.item ?? o.label ?? o.name ?? o.key)
    const exp = numOf(o.expected ?? o.should ?? o.plan ?? o.theory)
    const act = numOf(o.actual ?? o.real ?? o.settled)
    if (!item || (isNaN(exp) && isNaN(act))) continue
    const e = isNaN(exp) ? 0 : exp
    const a = isNaN(act) ? 0 : act
    const dRaw = o.diff !== undefined ? numOf(o.diff) : a - e
    const dv = isNaN(dRaw) ? a - e : dRaw
    if (dv !== 0) diffs.push({ row: rows.length, col: 2, color: dv > 0 ? '#dc2626' : '#16a34a' })
    rows.push({ label: item, values: [fmtNum(e), fmtNum(a), signedNum(dv)] })
    te += e
    ta += a
    td += dv
  }
  if (!rows.length) return null
  rows.push({ label: '合计', values: [fmtNum(te), fmtNum(ta), signedNum(td)] })
  return {
    kind: 'settlement',
    title: title || str(d.title) || '结算对账',
    header: ['项目', '应结算', '实际', '差异'],
    rows,
    diffs,
    summary: optStr(d.summary)
  }
}
function regionCompareToTable(data: unknown, title: string): TableArtifactBlock | null {
  const d = objOf(data)
  const rawRegions = arrOf(d.regions ?? d.areas)
  if (!rawRegions.length) return null
  // 变体 A：regions 为对象数组 [{name, rules:[{key,value}]}] → 转置为「维度 × 地区」表
  if (rawRegions.some((r) => r && typeof r === 'object')) {
    const regions = rawRegions.map((r) => objOf(r))
    const names = regions.map((r, i) => str(r.name ?? r.region ?? r.area) || `地区${i + 1}`)
    const dimKeys: string[] = []
    for (const r of regions) {
      for (const rule of arrOf(r.rules ?? r.items ?? r.dimensions)) {
        const k = str(objOf(rule).key ?? objOf(rule).name ?? objOf(rule).label ?? objOf(rule).dimension ?? objOf(rule).aspect ?? objOf(rule).item)
        if (k && !dimKeys.includes(k)) dimKeys.push(k)
      }
    }
    if (dimKeys.length) {
      const columns: TableColumn[] = [{ key: 'dim', label: '维度' }, ...names.map((n, i) => ({ key: `r${i}`, label: n }))]
      const rows: string[][] = dimKeys.map((k) => [
        k,
        ...regions.map((r) => {
          const rule = arrOf(r.rules ?? r.items ?? r.dimensions)
            .map(objOf)
            .find((x) => str(x.key ?? x.name ?? x.label ?? x.dimension ?? x.aspect ?? x.item) === k)
          return rule ? str(rule.value ?? rule.val ?? rule.text) : ''
        })
      ])
      return { kind: 'table', title: title || str(d.title) || '地区规则对比', columns, rows }
    }
  }
  // 变体 B（旧）：regions 字符串数组 + dimensions:[{name,values:[]}]
  const regions = rawRegions.map((r) => str(r)).filter(Boolean)
  const dims = arrOf(d.dimensions ?? d.rows)
  if (!regions.length || !dims.length) return null
  const columns: TableColumn[] = [
    { key: 'dim', label: '维度' },
    ...regions.map((r, i) => ({ key: `r${i}`, label: r }))
  ]
  const rows: string[][] = []
  for (const dm of dims) {
    const o = objOf(dm)
    const name = str(o.name ?? o.dimension ?? o.label ?? o.key)
    if (!name) continue
    const values = arrOf(o.values ?? o.vals)
    const cells = values.length ? regions.map((_, i) => str(values[i])) : regions.map((r) => str(o[r]))
    rows.push([name, ...cells])
  }
  if (!rows.length) return null
  return { kind: 'table', title: title || str(d.title) || '地区规则对比', columns, rows }
}

function parseSettlementFence(title: string, body: string): ArtifactBlock {
  return normalizeSettlement(looseParseJson(body), title) ?? codeBlock('json', title, body)
}
function parseRegionCompareFence(title: string, body: string): ArtifactBlock {
  const data = looseParseJson(body)
  return regionCompareToTable(data, title) ?? normalizeTable(data, title) ?? codeBlock('json', title, body)
}

// 出清博弈：agent 变体 { scenarios:[{name,probability,clearingPrice,yourBid:{price,quantity,result},description}], advice }
// 渲染为场景对比表（advice 作脚注）。
function scenariosToTable(data: unknown, title: string): TableArtifactBlock | null {
  const d = objOf(data)
  const scenarios = arrOf(d.scenarios ?? d.cases)
  if (!scenarios.length) return null
  const columns: TableColumn[] = [
    { key: 'name', label: '场景' },
    { key: 'prob', label: '概率', align: 'right' },
    { key: 'price', label: '出清价', align: 'right' },
    { key: 'bid', label: '你的报价' },
    { key: 'result', label: '结果' },
    { key: 'desc', label: '说明' }
  ]
  const rows: string[][] = scenarios.map((s) => {
    const o = objOf(s)
    const prob = numOf(o.probability ?? o.prob)
    const bid = objOf(o.yourBid ?? o.bid)
    const bidStr = bid.price !== undefined ? `${str(bid.price)}元×${str(bid.quantity ?? bid.qty ?? '')}MW` : str(o.yourBid ?? '')
    return [
      str(o.name ?? o.scenario ?? o.label),
      isNaN(prob) ? str(o.probability ?? '') : `${Math.round(prob * 100)}%`,
      str(o.clearingPrice ?? o.price ?? ''),
      bidStr,
      str(bid.result ?? o.result ?? ''),
      str(o.description ?? o.desc ?? o.competitorAnalysis ?? '')
    ]
  })
  return { kind: 'table', title: title || str(d.title) || '出清博弈场景', columns, rows, footnote: optStr(d.advice ?? d.summary) }
}
function parseClearingFence(title: string, body: string): ArtifactBlock {
  const data = looseParseJson(body)
  const table = scenariosToTable(data, title)
  if (table) return table
  const opt = buildClearingOption(data)
  return opt ? { kind: 'chart', title: title || '出清博弈', option: opt } : codeBlock('json', title, body)
}

// ── B4 公式 / 流程图：原文交给 katex / mermaid 组件渲染 ──
function parseMathFence(_title: string, body: string): ArtifactBlock {
  return { kind: 'math', code: body.trim() }
}
function parseMermaidFence(title: string, body: string): ArtifactBlock {
  return { kind: 'mermaid', title, code: body.trim() }
}

// ── B5 资产/交互：下载卡 / 表单回传 ──
function normalizeDownload(data: unknown, title: string): DownloadArtifactBlock | null {
  const d = objOf(data)
  const src = arrOf(d.files ?? d.items ?? data)
  const files: DownloadFile[] = []
  for (const it of src) {
    const o = objOf(it)
    const name = str(o.name ?? o.filename ?? o.title ?? o.label)
    const content = optStr(o.content ?? o.data ?? o.text)
    const url = safeHttpUrl(o.url ?? o.href ?? o.link)
    if (!name || (!content && !url)) continue
    files.push({
      name,
      content,
      url,
      mime: optStr(o.mime ?? o.type),
      bytes: typeof o.bytes === 'number' ? o.bytes : undefined
    })
  }
  return files.length ? { kind: 'download', title: title || str(d.title) || '附件', files } : null
}
function fieldType(v: unknown): FormFieldType {
  const s = String(v ?? '').toLowerCase()
  if (s === 'number') return 'number'
  if (s === 'select') return 'select'
  if (s === 'textarea') return 'textarea'
  return 'text'
}
function normalizeForm(data: unknown, title: string): FormArtifactBlock | null {
  const d = objOf(data)
  const src = arrOf(d.fields ?? d.inputs ?? data)
  const fields: FormField[] = []
  for (const it of src) {
    const o = objOf(it)
    const name = str(o.name ?? o.key ?? o.id ?? o.label)
    if (!name) continue
    fields.push({
      name,
      label: str(o.label ?? o.title ?? name),
      type: fieldType(o.type),
      placeholder: optStr(o.placeholder ?? o.hint),
      value: optStr(o.value ?? o.default),
      options: Array.isArray(o.options) ? (o.options as unknown[]).map((x) => str(x)) : undefined
    })
  }
  return fields.length
    ? { kind: 'form', title: title || str(d.title) || '参数表单', fields, submitLabel: optStr(d.submitLabel ?? d.submit) ?? '提交' }
    : null
}
function parseDownloadFence(title: string, body: string): ArtifactBlock {
  return normalizeDownload(looseParseJson(body), title) ?? codeBlock('json', title, body)
}
function parseFormFence(title: string, body: string): ArtifactBlock {
  return normalizeForm(looseParseJson(body), title) ?? codeBlock('json', title, body)
}

// ── B6 流程清单 / 文本对比 ──
function stepStatus(v: unknown): StepStatus | undefined {
  const s = String(v ?? '').toLowerCase().trim()
  if (!s) return undefined
  if (['done', 'complete', 'completed', 'finished', 'ok', 'success', '已完成', '完成', '通过'].includes(s)) return 'done'
  if (['doing', 'active', 'progress', 'in-progress', 'inprogress', 'running', 'current', '进行中', '处理中'].includes(s)) return 'doing'
  if (['blocked', 'error', 'failed', 'fail', 'reject', 'rejected', '阻塞', '失败', '驳回'].includes(s)) return 'blocked'
  if (['todo', 'pending', 'wait', 'waiting', 'planned', '待办', '待处理', '未开始'].includes(s)) return 'todo'
  return undefined
}
function normalizeSteps(data: unknown, title: string, type: string): StepsArtifactBlock | null {
  const d = objOf(data)
  const raw = Array.isArray(data) ? data : arrOf(d.steps ?? d.items ?? d.tasks ?? d.checklist)
  const steps: StepItem[] = []
  for (const it of raw) {
    if (typeof it === 'string') {
      const t = it.trim()
      if (t) steps.push({ title: t })
      continue
    }
    const o = objOf(it)
    const t = str(o.title ?? o.label ?? o.name ?? o.step ?? o.task ?? o.text)
    if (!t) continue
    steps.push({
      title: t,
      desc: optStr(o.desc ?? o.detail ?? o.note ?? o.description),
      status: stepStatus(o.status ?? o.state ?? o.done),
      time: optStr(o.time ?? o.at ?? o.eta ?? o.when)
    })
  }
  if (!steps.length) return null
  // checklist/tasks 默认勾选清单(不编号)，steps 默认有序编号；显式 ordered 优先。
  const ordered = d.ordered != null ? d.ordered !== false : type !== 'checklist' && type !== 'tasks'
  return {
    kind: 'steps',
    title: title || str(d.title) || (ordered ? '操作步骤' : '检查清单'),
    steps,
    ordered
  }
}
function parseStepsFence(title: string, body: string, type: string): ArtifactBlock {
  const data = looseParseJson(body)
  if (data === undefined) return codeBlock('json', title, body)
  return normalizeSteps(data, title, type) ?? codeBlock('json', title, body)
}
// 文本/方案对比：{ before, after, beforeLabel?, afterLabel?, language? }；逐行 diff 在组件内算。
function parseDiffFence(title: string, body: string): ArtifactBlock {
  const d = objOf(looseParseJson(body))
  const before = d.before ?? d.old ?? d.from ?? d.left ?? d.a
  const after = d.after ?? d.new ?? d.to ?? d.right ?? d.b
  if (before === undefined && after === undefined) return codeBlock('json', title, body)
  return {
    kind: 'diff',
    title: title || str(d.title) || '对比',
    before: str(before),
    after: str(after),
    beforeLabel: optStr(d.beforeLabel ?? d.oldLabel ?? d.leftLabel) ?? '修改前',
    afterLabel: optStr(d.afterLabel ?? d.newLabel ?? d.rightLabel) ?? '修改后',
    language: optStr(d.language ?? d.lang)
  }
}

const DLJY_UI_COMPONENTS = new Set([
  'StorageDecisionCard',
  'StorageDispatchTape',
  'StorageRevenueWaterfall',
  'StorageSensitivityMatrix',
  'StorageAssumptionPanel',
  'InvestmentDecisionCard',
  'ProjectFinanceSummary',
  'CashflowCurve',
  // common（跨板块复用）
  'DataQualityPanel',
  'RiskChecklist',
  // brief（交易晨报）
  'ForecastBandCard',
  'StrategyTable',
  'MorningBriefSummary',
  'MarketSnapshot'
])

function basisOf(v: unknown): DljyUiArtifactBlock['basis'] {
  const s = String(v ?? '').toLowerCase()
  if (s === 'real' || s === 'captured' || s === 'synthetic' || s === 'illustrative') return s
  return undefined
}

function parseDljyUiFence(title: string, body: string): ArtifactBlock {
  const d = objOf(looseParseJson(body))
  const component = str(d.component ?? d.name ?? d.type)
  if (!component || !DLJY_UI_COMPONENTS.has(component)) return codeBlock('json', title, body)
  const props = objOf(d.props ?? d.data ?? {})
  return {
    kind: 'dljy-ui',
    component,
    title: optStr(d.title ?? title),
    props,
    basis: basisOf(d.basis ?? props.basis),
    dataRef: optStr(d.dataRef ?? d.data_ref ?? d.ref)
  }
}

// ── 围栏注册表：新增 artifact 类型在此「填表」即可 ──
type FenceParser = (title: string, body: string, type: string) => ArtifactBlock
interface FenceSpec {
  types: string[]
  /** 流式未闭合时的「生成中」标签；纯 markdown 内容类不设（让 token 动画直显原文）。 */
  label?: string
  parse: FenceParser
}

const FENCE_REGISTRY: FenceSpec[] = [
  { types: ['chart', 'echarts', 'echart'], label: '图表', parse: parseChartFence },
  { types: ['analysis-chart', 'analysis_chart', 'chart-spec'], label: '数据分析图表', parse: parseAnalysisChartFence },
  { types: ['analysis-dashboard', 'dashboard'], label: '数据分析仪表盘', parse: parseAnalysisDashboardFence },
  { types: ['json', 'json5'], parse: parseJsonFence },
  { types: ['card', 'metric', 'metrics', 'kpi'], label: '测算卡片', parse: parseCardFence },
  { types: ['html'], label: '交互页面', parse: parseHtmlFence },
  {
    types: ['callout', 'note', 'tip', 'info', 'warning', 'warn', 'success', 'danger', 'critical', 'error'],
    parse: parseCalloutFence
  },
  { types: ['table', 'grid'], label: '数据表', parse: parseTableFence },
  { types: ['cite', 'sources', 'citation', 'citations'], label: '来源', parse: parseCiteFence },
  { types: ['jsonview', 'json-tree', 'jsontree'], label: 'JSON', parse: parseJsonViewFence },
  { types: ['timeline', 'events'], label: '时间线', parse: parseTimelineFence },
  { types: ['declaration', 'bid-curve'], label: '申报曲线', parse: bizChart(buildDeclarationOption, '申报曲线') },
  { types: ['forecast', 'price-band'], label: '预测带', parse: bizChart(buildForecastOption, '价格预测') },
  { types: ['position', 'exposure'], label: '敞口', parse: bizChart(buildPositionOption, '持仓敞口') },
  { types: ['arbitrage', 'spread'], label: '套利', parse: bizChart(buildArbitrageOption, '套利窗口') },
  { types: ['storage', 'soc'], label: '储能', parse: bizChart(buildStorageOption, '储能充放') },
  { types: ['gauge', 'risk-gauge'], label: '仪表', parse: bizChart(buildGaugeOption, '风险仪表') },
  { types: ['settlement', 'reconciliation'], label: '对账', parse: parseSettlementFence },
  { types: ['region-compare', 'compare-region', 'rule-compare'], label: '规则对比', parse: parseRegionCompareFence },
  { types: ['clearing', 'clearing-game', 'supply-curve'], label: '出清博弈', parse: parseClearingFence },
  { types: ['math', 'latex', 'tex', 'formula'], label: '公式', parse: parseMathFence },
  { types: ['mermaid', 'flowchart', 'sequence', 'gantt'], label: '流程图', parse: parseMermaidFence },
  { types: ['download', 'files', 'attachment'], label: '附件', parse: parseDownloadFence },
  { types: ['form', 'inputs'], label: '表单', parse: parseFormFence },
  { types: ['geo', 'map', 'scatter-geo'], label: '地理', parse: bizChart(buildGeoOption, '地理分布') },
  { types: ['heatmap', 'heat', 'time-heatmap'], label: '热力图', parse: bizChart(buildHeatmapOption, '分时热力') },
  { types: ['candlestick', 'kline', 'ohlc', 'candle'], label: 'K 线', parse: bizChart(buildCandleOption, '电价 K 线') },
  { types: ['waterfall', 'bridge'], label: '瀑布图', parse: bizChart(buildWaterfallOption, '瀑布分解') },
  { types: ['sankey', 'flow'], label: '流向图', parse: bizChart(buildSankeyOption, '流向图') },
  { types: ['pie', 'donut', 'share', 'breakdown'], label: '占比图', parse: bizChart(buildPieOption, '结构占比') },
  { types: ['steps', 'checklist', 'tasks', 'procedure'], label: '流程清单', parse: parseStepsFence },
  { types: ['diff', 'compare-text', 'textdiff'], label: '对比', parse: parseDiffFence },
  { types: ['dljy-ui', 'dljyui'], label: '业务组件', parse: parseDljyUiFence }
]

function specFor(type: string): FenceSpec | undefined {
  return FENCE_REGISTRY.find((s) => s.types.includes(type))
}

function classifyFence(info: string, body: string): ArtifactBlock {
  const { type, title } = splitInfo(info)
  const spec = specFor(type)
  return spec ? spec.parse(title, body, type) : codeBlock(type, title, body)
}

// 闭合围栏：同字符（` 或 ~）、长度 ≥ 开围栏、整行（允许前后空白）。
function isClosingFence(line: string, marker: string, minLen: number): boolean {
  return new RegExp(`^\\s*${marker}{${minLen},}\\s*$`).test(line)
}

/** 把 Markdown 文本解析为有序 artifact 块。流式与静态通用。 */
export function parseArtifactBlocks(src: string): ArtifactBlock[] {
  const blocks: ArtifactBlock[] = []
  if (!src) return blocks
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let text: string[] = []
  const flushText = () => {
    const joined = text.join('\n')
    if (joined.trim()) blocks.push({ kind: 'markdown', html: renderMarkdown(joined) })
    text = []
  }

  let i = 0
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i])
    if (open) {
      const marker = open[2][0]
      const minLen = open[2].length
      const info = open[3].trim()
      const body: string[] = []
      i++
      while (i < lines.length) {
        if (isClosingFence(lines[i], marker, minLen)) {
          i++
          break
        }
        // 健壮性：未闭合围栏遇到「新的带类型开围栏」时隐式结束(不消费该行)，避免漏写
        // 结束符的围栏吞掉后续 artifact(如 agent 的 ```math 漏闭合吞掉 ```timeline)。
        const reopen = FENCE_OPEN.exec(lines[i])
        if (reopen && reopen[2][0] === marker && reopen[3].trim()) break
        body.push(lines[i])
        i++
      }
      flushText()
      blocks.push(classifyFence(info, body.join('\n')))
      continue
    }
    text.push(lines[i])
    i++
  }
  flushText()
  return blocks
}

// 流式占位：若文本结尾存在未闭合的带 label 的 artifact 围栏，返回友好标签用于「生成中」
// 骨架；无 label（markdown 内容类）或普通代码围栏不打扰（返回 null）。
export function pendingArtifactLabel(src: string): string | null {
  if (!src) return null
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let openInfo: string | null = null
  let marker = ''
  let minLen = 0
  for (const line of lines) {
    if (openInfo === null) {
      const m = FENCE_OPEN.exec(line)
      if (m) {
        openInfo = m[3].trim()
        marker = m[2][0]
        minLen = m[2].length
      }
    } else if (isClosingFence(line, marker, minLen)) {
      openInfo = null
    }
  }
  if (openInfo === null) return null
  const { type } = splitInfo(openInfo)
  return specFor(type)?.label ?? null
}

/**
 * 流式增量切分：把已累积文本切成「已稳定段」与「在写尾部」，供对话框边流边渲染 artifact。
 * - `stable`：截至**最后一个闭合围栏**的全部内容；其内所有围栏均已闭合，可立即
 *   `parseArtifactBlocks(stable)` 渲染为正式 artifact。
 * - `tail`：最后一个闭合围栏之后仍在输入的纯文本，或一个尚未闭合的围栏；继续逐 token 渐显。
 * - `pendingLabel`：尾部若是未闭合的带 label 围栏（图表/卡片/流程清单…），返回其友好标签用于
 *   「正在生成…」骨架；纯 markdown 内容类（callout/math/mermaid）或普通代码围栏返回 null。
 * 纯函数、无副作用，组件可据 `stable` 是否变化决定是否重解析（避免每帧重建块致图表重挂）。
 */
export function splitStreamingArtifacts(src: string): {
  stable: string
  tail: string
  pendingLabel: string | null
} {
  if (!src) return { stable: '', tail: '', pendingLabel: null }
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let stableEnd = 0 // 稳定段结束行（不含）：最后一个闭合围栏之后
  let openInfo: string | null = null
  let marker = ''
  let minLen = 0
  for (let i = 0; i < lines.length; i++) {
    if (openInfo === null) {
      const m = FENCE_OPEN.exec(lines[i])
      if (m) {
        openInfo = m[3].trim()
        marker = m[2][0]
        minLen = m[2].length
      }
    } else if (isClosingFence(lines[i], marker, minLen)) {
      openInfo = null
      stableEnd = i + 1
    } else {
      // 与 parseArtifactBlocks 一致：未闭合围栏遇到新的带类型开围栏时隐式改判为新围栏，
      // 避免漏写闭合符的围栏把后续 artifact 吞进尾部。
      const reopen = FENCE_OPEN.exec(lines[i])
      if (reopen && reopen[2][0] === marker && reopen[3].trim()) {
        openInfo = reopen[3].trim()
        marker = reopen[2][0]
        minLen = reopen[2].length
      }
    }
  }
  const stable = lines.slice(0, stableEnd).join('\n')
  const tail = lines.slice(stableEnd).join('\n')
  const pendingLabel = openInfo !== null ? specFor(splitInfo(openInfo).type)?.label ?? null : null
  return { stable, tail, pendingLabel }
}
