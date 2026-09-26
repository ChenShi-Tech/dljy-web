// 市场洞察公共件文案与格式化中枢（dljy#2996，OpenSpec 任务 5.5）
// ----------------------------------------------------------------------------
// 全部「业务话术」集中在这里，供区块、证据抽屉、历史候选、图表与表格共用：
//   - 界面只出现业务语言，不出现 sourceId / family / datasetKey / SQL / 表名 / schema 原文
//     （红线见工作区 CLAUDE.md「通用红线」与 #2991 修正记录）；
//   - 真实零与缺测必须可区分："0" 显示 0，缺测显示「—」（图上断开、导出 CSV 写「缺测」）；
//   - 数值只在显示层 Number()：本模块不做任何统计，浮点不回流计算（DE12）。
// 文案与 docs/market-insight-common-components.md 的对照表一一对应，改这里要同步文档。

import { getInsightSource } from 'shared/insight/sources.mjs'
import type { InsightSeriesMeta } from '@/services/insight/insightClient'

// ── 错误状态文案（InsightRequestError.status → 用户可读话术）────────────────────────────

export type InsightErrorCopy = {
  /** 主文案（标题） */
  title: string
  /** 是否提供「刷新」按钮（版本冲突：由用户决定是否换到新版本，不静默替换） */
  action: 'refresh' | 'retry' | 'none'
}

/**
 * 错误信封 → 业务话术。403 只说「没有权限」，不透露资料是否存在；
 * 409 只说「已更新」，把换版本的决定权留给用户；400/422 直接显示后端
 * 给出的原因（范围过大、需先选对象等都是业务可行动的话）。
 */
export function insightErrorCopy(error: { status: number; message: string }): InsightErrorCopy {
  switch (error.status) {
    case 403:
      return { title: '当前公司没有这类资料的查看权限', action: 'none' }
    case 409:
      return { title: '资料已更新，当前看到的不是最新版本', action: 'refresh' }
    case 404:
      return { title: '该地区暂未开通这项分析', action: 'none' }
    case 400:
    case 422:
      return { title: error.message || '请求条件不被接受', action: 'retry' }
    default:
      // 503 / 网络失败 / 未知：统一「读取失败」+ 重试。
      return { title: '资料读取失败', action: 'retry' }
  }
}

// ── 可用性原因文案（runtime.availability.reason，DE02）──────────────────────────────────

export const AVAILABILITY_REASON_TEXT: Record<string, string> = {
  'not-enabled': '功能未开通',
  'not-applicable': '该地区不适用',
  'not-onboarded': '来源里没有所选对象或尚未接入',
  'not-published': '尚未发布',
  'beyond-coverage': '所选日期没有已入库资料',
  'partial-missing': '部分时段或来源缺数',
  'quality-rejected': '质量不合格已剔除',
  'source-disabled': '来源尚未启用',
  'upstream-failure': '上游故障',
}

export function availabilityReasonText(reason: string | null | undefined): string {
  if (!reason) return '暂无资料'
  return AVAILABILITY_REASON_TEXT[reason] ?? '暂无资料'
}

// ── 证据口径文案 ─────────────────────────────────────────────────────────────────────────

/** 派生程度（derivation）：说明「看到的值离原始观测有多远」。 */
export const DERIVATION_TEXT: Record<string, string> = {
  source: '原样',
  aligned: '仅对齐',
  aggregated: '汇总',
  derived: '计算',
}

/** 市场阶段 / 价格对象 / 访问范围（图例、tooltip、证据抽屉共用）。 */
export const MARKET_PHASE_TEXT: Record<string, string> = {
  'day-ahead': '日前',
  'real-time': '实时',
}

export const PRICE_OBJECT_TEXT: Record<string, string> = {
  'user-price': '用户侧价格',
  'public-node': '公开历史节点价',
  'company-node': '获权厂侧节点价',
  'plant-node': '场站关联节点价',
  'settlement-price': '场站已结算价格引用',
}

export const ACCESS_SCOPE_TEXT: Record<string, string> = {
  public: '公开',
  company: '获权',
}

/**
 * 宽行来源按字段拆序列（日结的电量/电费、损失归因的三类损失）：
 * 字段的中文名只在这里登记；'value' 是唯一数值字段时不占业务名。
 * 价差 / 基差是视图合成的序列（没有来源字段），同样在这里登记业务名，
 * 供图表图例与 tooltip 拼序列名（dljy#3007 价格页）。
 */
export const FIELD_TEXT: Record<string, string> = {
  totalEnergy: '电量',
  totalFee: '电费',
  strategyLossTotal: '策略损失',
  forecastLossTotal: '预测损失',
  gridLossTotal: '电网损失',
  spread: '日前−实时价差',
  basis: '节点基差',
}

export function fieldText(fieldId: string): string {
  return FIELD_TEXT[fieldId] ?? ''
}

/**
 * 序列业务名（图例 / tooltip / 表格「字段」列共用）：对象维度值 + 字段 + 市场阶段。
 * 对象维度取来源登记的 objectDimension（nodeName / plantName 等），没有对象维度的
 * 序列（如云南统调负荷）只用字段与阶段表达。
 */
export function insightSeriesName(series: InsightSeriesMeta): string {
  const source = getInsightSource(series.sourceId)
  const objectDimension = source?.objectDimension ?? null
  const parts: string[] = []
  if (objectDimension) {
    const objectName = series.dimensions[objectDimension]
    if (objectName) parts.push(objectName)
  } else {
    // 无对象维度时用其余维度值（如省间送受的通道名）兜底，不暴露维度键名。
    const values = Object.values(series.dimensions ?? {}).filter((value) => value !== null && value !== undefined && value !== '')
    if (values.length) parts.push(values.join('·'))
  }
  const field = fieldText(series.fieldId)
  if (field) parts.push(field)
  if (series.marketPhase) parts.push(MARKET_PHASE_TEXT[series.marketPhase] ?? series.marketPhase)
  return parts.join(' ') || '数据序列'
}

// ── 来源标题（capabilities 优先，契约镜像兜底）──────────────────────────────────────────

export type InsightSourceTitle = { title: string; accessScope: 'public' | 'company' }

/** 来源 → 业务标题与访问范围。页面可传 capabilities 的 sources 目录；未传时回落共享契约镜像。 */
export function insightSourceTitle(
  sourceId: string,
  catalog?: Record<string, InsightSourceTitle>
): InsightSourceTitle | null {
  const fromCatalog = catalog?.[sourceId]
  if (fromCatalog) return fromCatalog
  const source = getInsightSource(sourceId)
  if (!source) return null
  return { title: source.title, accessScope: source.accessScope }
}

// ── 值显示（真实零与缺测可区分）─────────────────────────────────────────────────────────

/** 缺测占位：表格与图表图例统一「—」。 */
export const MISSING_TEXT = '—'

/**
 * 显示层格式化：十进制字符串 → 按 source precision 显示；null/空为缺测。
 * 只做显示，不参与任何统计（统计一律在共享内核用十进制完成）。
 */
export function formatInsightValue(value: string | number | null | undefined, places = 3): string {
  if (value === null || value === undefined || value === '') return MISSING_TEXT
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(places) : MISSING_TEXT
}

/** 来源的显示精度（小数位）；契约镜像拿不到时默认 3 位（来源登记的默认值）。 */
export function insightPrecision(sourceId: string): number {
  return getInsightSource(sourceId)?.precision.places ?? 3
}

// ── 时间显示（北京时间）──────────────────────────────────────────────────────────────────

/** 带时区 ISO → 「YYYY-MM-DD HH:mm」（北京时间）。 */
export function formatBeijingDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const beijing = new Date(ms + 8 * 3_600_000).toISOString()
  return `${beijing.slice(0, 10)} ${beijing.slice(11, 16)}`
}

/** 长版本引用（rv1:/rs1: 64 位摘要）→ 短码（前 12 位），完整值供复制。 */
export function shortRef(ref: string | null | undefined, length = 12): string {
  if (!ref) return '—'
  return ref.length <= length ? ref : ref.slice(0, length)
}
