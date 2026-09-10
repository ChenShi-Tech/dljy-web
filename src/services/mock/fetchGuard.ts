// Mock 演示 fetch 守卫（PRD §4.3 的单点拦截实现）。
//
// 为什么是全局 fetch 守卫而不是逐客户端补丁：本仓 services 层有 30+ 个客户端绕过 api.ts
// 直接 fetch（quant/forecast/agent/复盘/天气等），逐个补丁漏一个就破坏「mock 不出网」的
// 硬隔离（PRD R1）。同源 fetch 是全部业务后端的必经之路（dev 走 vite 代理、生产走 nginx
// 同源反代），在 window.fetch 上按「mock 会话 + 同源」分流即可单点覆盖全部现存与未来代码。
//
// 分流规则：
//   * 非 mock 会话 → 原生 fetch，逐字节等价（真实账号零改动，PRD R2/R3）；
//   * mock 会话 + 跨源 → 仅放行渲染资产白名单（Cesium 底图/地形等，PRD §4.3 渲染资产例外），
//     其余外部数据源一律拒绝（演示账号不接任何真实数据，含 LLM 直连/天气回退）；
//   * mock 会话 + 同源 → /auth 直通（登录/会话必须真实），其余全部走 mock 路由表。

import { isMockActive } from './session'
import { resolveMockRequest } from './router'
import { EXTERNAL_WEATHER_HOSTS, mockExternalWeatherResponse } from './externalWeather'

// /auth 通道直通：登录、会话恢复、改密、登出走真实后端（PRD §4.1——mock 账号唯一触碰后端的环节）。
const PASS_THROUGH_PATHS = [
  '/auth/login',
  '/auth/login-options',
  '/auth/info',
  '/auth/logout',
  '/auth/change-password'
]

// 渲染资产白名单：跨源地图/地形/瓦片资源不属业务数据（PRD §4.3 约定 mock 账号照常加载）。
const RENDER_ASSET_HOSTS = [
  'api.cesium.com',
  'assets.ion.cesium.com',
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
  'services.arcgisonline.com',
  'basemaps.cartocdn.com'
]

// 站点配置的底图/地形/山体阴影 URL（.env VITE_GRID_GEO_*），按 host 并入白名单。
const CONFIGURED_ASSET_HOSTS = [
  import.meta.env.VITE_GRID_GEO_BASEMAP,
  import.meta.env.VITE_GRID_GEO_ARCGIS_TERRAIN_URL,
  import.meta.env.VITE_GRID_GEO_HILLSHADE_URL
]
  .filter((v): v is string => typeof v === 'string' && v.length > 0)
  .map((v) => {
    try {
      return new URL(v).hostname
    } catch {
      return ''
    }
  })
  .filter(Boolean)

function isRenderAssetHost(hostname: string): boolean {
  const candidates = [...RENDER_ASSET_HOSTS, ...CONFIGURED_ASSET_HOSTS]
  return candidates.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

function isPassThroughPath(pathname: string): boolean {
  return PASS_THROUGH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function mockExternalBlock(): Response {
  return new Response(JSON.stringify({ code: 502, msg: '演示模式：外部数据源已拦截（不接任何真实数据）' }), {
    status: 502,
    headers: { 'content-type': 'application/json', 'x-data-mock': 'true' }
  })
}

/**
 * 业务路径的"逻辑形态"：api.ts 的 pathBase 会给裸路径拼 /api 前缀
 * （`apiGet('/auth/info')` 实际请求 `/api/auth/info`），直通判定必须同时
 * 匹配两种形态，否则登录态维护请求会被 mock 兜底拦截，身份存档被默认档案
 * 覆盖 → mock 判定整体失效（第一轮人工验收问题 2/3/4 的根因）。
 */
function logicalPathname(pathname: string): string {
  if (pathname === '/api') return '/'
  return pathname.replace(/^\/api(?=\/)/, '')
}

let installed = false

/**
 * 安装 mock fetch 守卫。幂等；无论当前是否 mock 会话都可安装——守卫内部按请求动态判定
 * isMockActive()，真实账号的每次请求走原生 fetch（一次 memo 化的用户名读取，开销可忽略）。
 */
export function installMockFetchGuard(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isMockActive()) return nativeFetch(input, init)
    let target: URL
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      target = new URL(raw, window.location.origin)
    } catch {
      return nativeFetch(input, init)
    }
    if (target.origin !== window.location.origin) {
      if (isRenderAssetHost(target.hostname)) return nativeFetch(input, init)
      // 气象公开源（Open-Meteo / bigdatacloud）：外部辅助数据（PRD C.24），演示会话
      // 按原始形状确定性供数而不是拦截——天气预报页/回退链路才出得来数据
      if (EXTERNAL_WEATHER_HOSTS.includes(target.hostname)) {
        return mockExternalWeatherResponse(target) ?? mockExternalBlock()
      }
      return mockExternalBlock()
    }
    if (isPassThroughPath(target.pathname) || isPassThroughPath(logicalPathname(target.pathname))) {
      return nativeFetch(input, init)
    }
    const method = (init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET') ?? 'GET').toUpperCase()
    return resolveMockRequest(method, target, init)
  }
}
