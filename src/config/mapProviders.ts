/**
 * 地图底图（imagery）Provider 配置层
 * ------------------------------------------------------------------
 * Epic #938 第一子（#939）：把原先硬编码在 `CesiumPlantMap.vue` 里的底图
 * Provider（URL、attribution、图层视觉微调）抽象为纯配置，支持通过环境变量
 * `VITE_GRID_GEO_BASEMAP` 在多个底图源（免费/付费）之间切换。
 *
 * 设计原则：
 * - 本模块不 import cesium，保持纯函数、可被 vitest 直接单测。
 *   由消费方（`CesiumPlantMap.vue` 内的工厂）把描述符翻译成真正的 Cesium ImageryProvider。
 * - 默认 Provider（`osm-dark`）与改造前行为逐字段一致：零回归。
 *
 * 为后续子任务预留的扩展位：
 * - #940 视觉基线：每个 Provider 自带 `adjustment`（brightness/contrast/saturation/gamma/alpha），
 *   视觉重塑只需调这里的数值或新增暗色底图，无需碰组件。
 * - #942 付费接缝：`tier`（free|paid）、`requiresToken`、`tokenEnvKey` 字段已就位；
 *   接入 Cesium Ion / Bing / 带 token 的 ArcGIS 影像时新增一条 `paid` 条目并在工厂里补 async 分支即可。
 * - #941 交互优化：底图列表可直接喂给底图选择器 UI（`listBaseMapProviders()`）。
 */

/** 底图源构造类型；决定工厂用哪个 Cesium ImageryProvider 构造。 */
export type BaseMapProviderKind = 'osm' | 'url-template' | 'arcgis' | 'ion' | 'solid-color'

/** 计费层级：#942 付费接缝的分类锚点。 */
export type BaseMapTier = 'free' | 'paid'

/** 底图图层视觉微调：#940 视觉基线的调参锚点。 */
export interface BaseMapLayerAdjustment {
  brightness: number
  contrast: number
  saturation: number
  gamma: number
  /** 图层透明度，未设则由消费方保留 Cesium 默认（1）。 */
  alpha?: number
}

/** 单个底图 Provider 的完整配置描述符。 */
export interface BaseMapProviderConfig {
  /** 稳定 id，同时作为 `VITE_GRID_GEO_BASEMAP` 的取值。 */
  id: string
  /** 人类可读标签，供底图选择器展示（#941）。 */
  label: string
  kind: BaseMapProviderKind
  tier: BaseMapTier
  /** 瓦片服务地址；`osm` 为目录 URL，`url-template` 为含 {z}/{x}/{y} 的模板。 */
  url: string
  /** 版权/归属声明。 */
  credit?: string
  /** `url-template` 的子域轮询（如 a,b,c,d），其它类型忽略。 */
  subdomains?: string[]
  /** 是否需要访问 token（付费/受限源）， #942 扩展位，默认 false。 */
  requiresToken?: boolean
  /** token 所在的环境变量名：#942 扩展位。 */
  tokenEnvKey?: string
  /** `ion` 专用：Cesium ion 资产 id（如 Bing 影像 = 3）。 */
  ionAssetId?: number
  /** 底图图层视觉微调：#940 扩展位。 */
  adjustment: BaseMapLayerAdjustment
}

export const BASE_MAP_ERROR_THRESHOLD = 2

/**
 * 底图 Provider 注册表。
 * 目前只登记免费、可同步构造、无需 token 的源；付费源（#942）后续追加。
 */
export const BASE_MAP_PROVIDERS: Record<string, BaseMapProviderConfig> = {
  // 矢量街道图（亮色）。快且稳，adjustment 全中性。曾在 2026-08 短暂作过默认，
  // 现降为 arcgis-imagery 之后的第一降级位——街道图贴在三维地形上读不出地貌，
  // 不该是一个「空间资产 + 地形」页面的首选底图。
  'carto-voyager': {
    id: 'carto-voyager',
    label: 'Carto · Voyager 亮色',
    kind: 'url-template',
    tier: 'free',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors © CARTO',
    subdomains: ['a', 'b', 'c', 'd'],
    adjustment: { brightness: 1, contrast: 1, saturation: 1, gamma: 1 },
  },
  // 暗色底图；不再作默认（压暗参数撞「默认底图不压暗」护栏），需要暗色调时显式选用。
  'carto-dark': {
    id: 'carto-dark',
    label: 'Carto · Dark Matter',
    kind: 'url-template',
    tier: 'free',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors © CARTO',
    subdomains: ['a', 'b', 'c', 'd'],
    adjustment: { brightness: 0.72, contrast: 1.12, saturation: 0.44, gamma: 0.9 },
  },
  // ArcGIS 世界影像（卫星）。免费、无需 token、瓦片本身就明亮，adjustment 全中性。
  //
  // 【2026-09-07 更正一条错误结论】此前注释断言「arcgisonline.com 整个域对本项目出口 IP
  // 返回 403」，据此把默认底图让给了矢量街道图。实测该结论只对 `services.` 子域成立：
  //   services.arcgisonline.com  → 连 MapServer?f=json 都 15s 超时无响应
  //   server.arcgisonline.com    → World_Imagery 瓦片 200，12 并发 0.71–1.87s 全通
  // 同一家 Esri，两个子域一堵一通，换个子域即可恢复。晕渲图层同理（见 CesiumPlantMap）。
  //
  // 之所以把它抬回默认：卫星影像是唯一能和三维地形互相成就的底图——放大时能从影像本身
  // 读出山脊、河谷与场站所处地貌；矢量街道图是平面绘制的地图画，铺在地形上等于地形白开。
  //
  // 注意 ArcGIS 瓦片路径是 {z}/{y}/{x}（先行后列），与常见的 {z}/{x}/{y} 相反。
  'arcgis-imagery': {
    id: 'arcgis-imagery',
    label: 'ArcGIS 世界影像 · 明亮',
    kind: 'url-template',
    tier: 'free',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri, Maxar, Earthstar Geographics',
    adjustment: { brightness: 1, contrast: 1, saturation: 1, gamma: 1 },
  },
  // OSM 原色：保留地名与道路标注，适合需要看行政/交通参照时切换。
  'osm-bright': {
    id: 'osm-bright',
    label: 'OpenStreetMap · 原色',
    kind: 'osm',
    tier: 'free',
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
    adjustment: { brightness: 1.02, contrast: 1.04, saturation: 0.95, gamma: 1 },
  },
  // 改造前的暗色基线；不再作默认，保留以便需要暗色调时显式选用。
  'osm-dark': {
    id: 'osm-dark',
    label: 'OpenStreetMap · 暗色调',
    kind: 'osm',
    tier: 'free',
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
    adjustment: { brightness: 0.34, contrast: 1.36, saturation: 0.26, gamma: 0.68 },
  },
  // OpenTopoMap 等高线+晕渲地形图。观感最配三维地形，但实测本机出口连续 15s 超时
  // （它的瓦片策略限流严格，Cesium 一屏几十上百张必然被限），因此只排在降级链末位，
  // 网络环境允许时可用 VITE_GRID_GEO_BASEMAP=opentopo 显式指定。
  'opentopo': {
    id: 'opentopo',
    label: 'OpenTopoMap · 地形图',
    kind: 'url-template',
    tier: 'free',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
    subdomains: ['a', 'b', 'c'],
    adjustment: { brightness: 1, contrast: 1, saturation: 1, gamma: 1 },
  },
  // Cesium ion 卫星影像（Bing Maps Aerial with Labels，ion asset 3）。需 ion token。
  //
  // 这是本项目网络下唯一可用的卫星影像源：Esri 影像整域 403、OpenTopoMap 限流，
  // 而 ion 只是 401（缺凭据而非拒绝）。配上 VITE_CESIUM_ION_TOKEN 后它会顶替
  // carto-voyager 成为首选底图，矢量街道图贴在三维地形上看不出地貌，卫星影像
  // 配 World Terrain 才能在放大时读出山脊、河谷与场站所处地形。
  //
  // requiresToken:true 使其被 resolveBaseMapFallbackSequence 排除在自动降级链外
  // （无 token 环境不该反复尝试必失败的源），改由 resolvePreferredBaseMapId 显式前置。
  'ion-aerial': {
    id: 'ion-aerial',
    label: 'Cesium ion · 卫星影像',
    kind: 'ion',
    tier: 'free',
    url: '',
    ionAssetId: 3,
    requiresToken: true,
    tokenEnvKey: 'VITE_CESIUM_ION_TOKEN',
    credit: '© Microsoft Bing Maps · Cesium ion',
    adjustment: { brightness: 1, contrast: 1, saturation: 1, gamma: 1 },
  },
  // 最终兜底不请求任何网络瓦片。Cesium globe baseColor、经纬网和业务图元仍可用，
  // 从而避免外部 Provider 同时失败时出现空白或黑屏。
  'solid-grid': {
    id: 'solid-grid',
    label: '内置地球底色 · 离线回退',
    kind: 'solid-color',
    tier: 'free',
    url: '',
    adjustment: { brightness: 1, contrast: 1, saturation: 1, gamma: 1 },
  },
}

/**
 * 默认 Provider id：ArcGIS 世界影像（卫星，实测快、稳、不压暗）。
 *
 * 历史：osm-dark（压暗到看不清）→ arcgis-imagery → carto-voyager（误判 arcgisonline.com
 * 整域 403）→ arcgis-imagery（改用可达的 `server.` 子域）。
 */
export const DEFAULT_BASE_MAP_PROVIDER_ID = 'arcgis-imagery'

/**
 * 解析底图 Provider。
 * @param providerId 通常来自 `import.meta.env.VITE_GRID_GEO_BASEMAP`；未知/空值回退默认。
 */
export function resolveBaseMapProvider(providerId?: string | null): BaseMapProviderConfig {
  const id = (providerId ?? '').trim()
  return BASE_MAP_PROVIDERS[id] ?? BASE_MAP_PROVIDERS[DEFAULT_BASE_MAP_PROVIDER_ID]
}

/** 列出全部底图 Provider（供底图选择器 UI 使用，#941）。 */
export function listBaseMapProviders(): BaseMapProviderConfig[] {
  return Object.values(BASE_MAP_PROVIDERS)
}

/** 当前选择优先，其次免费网络源，最后固定为不访问网络的内置底色。 */
export function resolveBaseMapFallbackSequence(providerId?: string | null): BaseMapProviderConfig[] {
  const requested = resolveBaseMapProvider(providerId)
  // 需 token 的源即便被显式传进来，也不能进自动降级链：无凭据时它必失败，
  // 只会白白拖慢真正可用底图的出现。要把它放首选走 resolveBaseMapSequenceWithPreferred。
  const preferred = requested.requiresToken ? BASE_MAP_PROVIDERS[DEFAULT_BASE_MAP_PROVIDER_ID] : requested
  if (preferred.kind === 'solid-color') return [preferred]
  const networkFallbacks = listBaseMapProviders()
    .filter((provider) => provider.id !== preferred.id && provider.kind !== 'solid-color')
    .filter((provider) => provider.tier === 'free' && !provider.requiresToken)
  return [preferred, ...networkFallbacks, BASE_MAP_PROVIDERS['solid-grid']]
}

/**
 * 首选底图 id：显式指定优先；否则有 ion token 时用卫星影像，无 token 回免费默认。
 *
 * 不把这个判断塞进 `resolveBaseMapProvider`，是因为它同时服务「解析任意 id」和
 * 「决定首选」两种语义，混在一起会让显式 `VITE_GRID_GEO_BASEMAP` 被 token 状态篡改。
 */
export function resolvePreferredBaseMapId(options: { explicitId?: string | null; hasIonToken?: boolean } = {}): string {
  const explicit = (options.explicitId ?? '').trim()
  if (explicit && BASE_MAP_PROVIDERS[explicit]) return explicit
  if (options.hasIonToken) return 'ion-aerial'
  return DEFAULT_BASE_MAP_PROVIDER_ID
}

/** 需要 token 的源不进自动降级链，但首选位置可以是它；后续降级仍走免费链。 */
export function resolveBaseMapSequenceWithPreferred(preferredId: string): BaseMapProviderConfig[] {
  const preferred = BASE_MAP_PROVIDERS[preferredId]
  if (!preferred || !preferred.requiresToken) return resolveBaseMapFallbackSequence(preferredId)
  return [preferred, ...resolveBaseMapFallbackSequence(DEFAULT_BASE_MAP_PROVIDER_ID)]
}

export function shouldFallbackBaseMap(consecutiveErrors: number): boolean {
  return Number.isFinite(consecutiveErrors) && consecutiveErrors >= BASE_MAP_ERROR_THRESHOLD
}
