// 省级边界 GeoJSON 懒加载器。
//
// 数据由 `GET /api/v1/geo/boundary/:adcode` 提供（server/geo-boundary-api.mjs），
// 落在 data/geo/boundary/，不进前端构建产物。34 省全量约 3 MB，单省 4 KB–190 KB，
// 只加载当前地区那一份。
//
// 为什么不放 Vite 的 public/：那里的文件会无条件复制进 dist，部署后即成为无需鉴权的
// 公开下载链接。本数据集无审图号背书、仅限内部使用，公开提供会构成「未经审图向公众
// 提供地图服务」，静态目录里的 manifest 声明约束不了这件事，必须由接口鉴权兜住。
//
// 数据来源与合规：阿里云 DataV.GeoAtlas，仅限内部使用。

import * as echarts from 'echarts'
import { getToken } from '@/services/auth'
import { adcodeForRegion } from './regionAdcode'

/** GeoJSON 要素属性（DataV 口径，已在构建期裁剪为必要字段）。 */
export type BoundaryFeatureProperties = {
  adcode: number
  name: string
  /** 标注点（省会/驻地近似），可直接用于标签摆位与视角居中。 */
  center?: [number, number]
  /** 几何重心，与 center 略有差异。 */
  centroid?: [number, number]
  level?: string
  parent?: { adcode: number }
  childrenNum?: number
  /** 上级链路，如 [100000, 530000]，用于下钻返回。 */
  acroutes?: number[]
}

export type BoundaryFeature = {
  type: 'Feature'
  properties: BoundaryFeatureProperties
  geometry: { type: string; coordinates: unknown }
}

export type BoundaryGeoJson = {
  type: 'FeatureCollection'
  features: BoundaryFeature[]
}

/** 已解析的 GeoJSON 缓存：adcode → 数据。 */
const cache = new Map<string, BoundaryGeoJson>()
/** 在途请求，避免同一 adcode 并发重复 fetch。 */
const inflight = new Map<string, Promise<BoundaryGeoJson>>()
/** 已向 ECharts 注册过的地图名，避免重复 registerMap。 */
const registered = new Set<string>()

/** ECharts 地图注册名。用 adcode 保证全局唯一且稳定。 */
export function mapNameForAdcode(adcode: string): string {
  return `boundary-${adcode}`
}

function boundaryUrl(adcode: string): string {
  return `/api/v1/geo/boundary/${adcode}`
}

function isBoundaryGeoJson(value: unknown): value is BoundaryGeoJson {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BoundaryGeoJson>
  return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)
}

/**
 * 按 adcode 取边界 GeoJSON（带缓存与并发去重）。
 * 失败抛错，由调用方决定降级展示，不返回空 FeatureCollection 冒充成功。
 */
export async function loadBoundaryByAdcode(adcode: string): Promise<BoundaryGeoJson> {
  const cached = cache.get(adcode)
  if (cached) return cached

  const pending = inflight.get(adcode)
  if (pending) return pending

  const task = (async () => {
    const token = getToken()
    const response = await fetch(boundaryUrl(adcode), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (response.status === 401) {
      throw new Error('边界数据需要登录后访问')
    }
    if (!response.ok) {
      throw new Error(`边界数据加载失败：${adcode}（HTTP ${response.status}）`)
    }
    // 统一 BaseResponse 信封 {code,msg,data}，与仓库其余接口一致。
    const envelope = (await response.json()) as { data?: unknown }
    const payload = envelope?.data
    if (!isBoundaryGeoJson(payload)) {
      throw new Error(`边界数据格式非法：${adcode}`)
    }
    cache.set(adcode, payload)
    return payload
  })()

  inflight.set(adcode, task)
  try {
    return await task
  } finally {
    inflight.delete(adcode)
  }
}

/**
 * 取边界并注册到 ECharts，返回可用于 `geo.map` / `series.map` 的地图名。
 * 重复调用同一 adcode 只注册一次。
 */
export async function ensureBoundaryRegistered(adcode: string): Promise<string> {
  const mapName = mapNameForAdcode(adcode)
  if (registered.has(mapName)) return mapName

  const geoJson = await loadBoundaryByAdcode(adcode)
  // registerMap 的类型签名要求 GeoJSON 结构体，此处形状已由 isBoundaryGeoJson 校验。
  echarts.registerMap(mapName, geoJson as unknown as Parameters<typeof echarts.registerMap>[1])
  registered.add(mapName)
  return mapName
}

/**
 * 按地区 id 取边界并注册。模板地区/未登记地区返回 null，调用方须显示空态，
 * 不得回退到其他省的地图（地区隔离纪律）。
 */
export async function ensureBoundaryForRegion(regionId: string | null | undefined): Promise<
  { adcode: string; mapName: string; geoJson: BoundaryGeoJson } | null
> {
  const adcode = adcodeForRegion(regionId)
  if (!adcode) return null
  const mapName = await ensureBoundaryRegistered(adcode)
  const geoJson = cache.get(adcode)
  if (!geoJson) return null
  return { adcode, mapName, geoJson }
}

/** 取已缓存的边界（不触发网络）；未缓存返回 null。 */
export function peekCachedBoundary(adcode: string): BoundaryGeoJson | null {
  return cache.get(adcode) ?? null
}

/** 仅供测试：清空缓存与注册记录。 */
export function __resetBoundaryCacheForTest(): void {
  cache.clear()
  inflight.clear()
  registered.clear()
}
