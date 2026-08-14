export type UiData = Record<string, unknown>

export function obj(v: unknown): UiData {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as UiData) : {}
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function str(v: unknown, fallback = ''): string {
  if (v === undefined || v === null || v === '') return fallback
  return String(v)
}

export function fmt(v: unknown, digits = 2): string {
  const n = num(v, NaN)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function basisLabel(v?: string): string {
  if (v === 'real') return '真实接口'
  if (v === 'captured') return '真实采集'
  if (v === 'synthetic') return '模拟数据'
  if (v === 'illustrative') return '示意测算'
  return '未标注'
}
