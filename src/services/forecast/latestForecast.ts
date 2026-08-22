// 已落库预测曲线的读取（#2392）。
//
// 与 mlForecastClient 的 `/predict` 分工：那条是现算，要在后端训练模型、秒级返回，适合
// 工作台里点一次「预测」；这条是纯读 `forecast.latest_curve`，给驾驶舱首屏这类「打开就
// 要有图」的场景——首屏不能等模型训练。
import { identityHeaders } from '@/services/agent/agentClient'
import { AGENT_API_BASE_ROOT, applyRegionHeaders, timeoutSignal } from '@/services/api'
import { currentRegion } from '@/services/region/regionContext'

const TIMEOUT_MS = 10000

export interface LatestForecastRun {
  modelId: string
  modelVersion: string | null
  /** 后端原样透传，不只有 'ok'：目标日只跑出 skipped/error 也如实返回，绝不用旧的 ok 曲线顶上。 */
  status: string
  points: number[]
  lower: number[] | null
  upper: number[] | null
  predictedAt: string | null
  basis: string | null
  mock: boolean
}

export interface LatestForecast {
  available: boolean
  targetDate: string | null
  runs: LatestForecastRun[]
  reason?: string
}

interface RawRun {
  model_id?: string
  model_version?: string | null
  status?: string
  points?: unknown
  lower?: unknown
  upper?: unknown
  predicted_at?: string | null
  basis?: string | null
  mock?: boolean
}

const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isFinite(x)) : []

/**
 * 取某地区某目标日**已落库**的预测曲线。
 *
 * `targetDate` 必传：省略时后端返回的是库内最新目标日，而那一天很可能只有一条尚未算完的
 * skipped 空曲线（实测 2026-08-23 即如此）——调用方拿到空 points 却以为"就是没预测"。
 */
export async function fetchLatestForecast(
  regionId: string,
  target: string,
  targetDate: string,
): Promise<LatestForecast> {
  const qs = new URLSearchParams({ region_id: regionId, target, target_date: targetDate })
  try {
    const res = await fetch(`${AGENT_API_BASE_ROOT}/v1/forecast/latest?${qs}`, {
      headers: { 'x-region-id': currentRegion.value.id, ...identityHeaders() },
      signal: timeoutSignal(TIMEOUT_MS),
    })
    if (!res.ok) return { available: false, targetDate: null, runs: [], reason: `请求失败: ${res.status}` }
    applyRegionHeaders(res)
    const body = (await res.json()) as { available?: boolean; target_date?: string | null; runs?: RawRun[]; reason?: string }
    const runs = (body.runs ?? []).map((r) => ({
      modelId: String(r.model_id ?? ''),
      modelVersion: r.model_version ?? null,
      status: String(r.status ?? ''),
      points: numbers(r.points),
      lower: Array.isArray(r.lower) ? numbers(r.lower) : null,
      upper: Array.isArray(r.upper) ? numbers(r.upper) : null,
      predictedAt: r.predicted_at ?? null,
      basis: r.basis ?? null,
      mock: Boolean(r.mock),
    }))
    return { available: Boolean(body.available), targetDate: body.target_date ?? null, runs, reason: body.reason }
  } catch (e) {
    return { available: false, targetDate: null, runs: [], reason: e instanceof Error ? e.message : '预测曲线读取失败' }
  }
}
