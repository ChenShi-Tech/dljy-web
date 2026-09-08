/**
 * 天地图（国家地理信息公共服务平台）瓦片图层注册表
 * ------------------------------------------------------------------
 * 二维平面图的底图源。选它而不是高德/百度/腾讯，理由是三条同时成立：
 *
 * 1. **坐标系不用纠偏**。天地图是 CGCS2000，与 WGS84 差异小于 1 米，可直接当
 *    WGS84 用；高德/腾讯是 GCJ-02、百度是 BD-09，场站点位（WGS84）叠上去偏
 *    300–600 米，正好把本页「不确定性光圈」那套精度语义作废。
 * 2. **服务器在境内**。《地图管理条例》第三十四条要求互联网地图服务的地图数据
 *    服务器设在境内；本系统是交付央企的，这条不是可选项。
 * 3. **条款上是正路**。它是标准 WMTS，用任意支持 WMTS 的客户端消费都是设计内
 *    用法；高德条款 4.12.2 明确禁止「非经授权的第三方工具或服务接入本服务」。
 *
 * 瓦片方案用 `w` 系列（EPSG:3857 / GoogleMapsCompatible），与 `webMercator.ts`
 * 的投影同一套，贴图时是轴对齐矩形。`c` 系列（EPSG:4490 经纬度）本项目不用。
 */

export type TiandituLayerId = 'img' | 'vec' | 'ter'

export interface TiandituLayerConfig {
  id: TiandituLayerId
  label: string
  /** 底图服务代号（`{code}_w`）。 */
  code: string
  /** 配套注记层代号；影像/矢量/地形各有各的注记，不通用。 */
  annotationCode: string
  /** 该底图适合的文字/线条配色倾向，供上层决定覆盖物对比度。 */
  tone: 'dark' | 'light'
}

export const TIANDITU_LAYERS: Record<TiandituLayerId, TiandituLayerConfig> = {
  // 默认：卫星影像。深色驾驶舱主题下观感最好，且与三维页的卫星底图口径一致，
  // 用户在 2D / 3D 之间切换时不会有「换了个星球」的割裂感。
  img: { id: 'img', label: '天地图 · 卫星影像', code: 'img', annotationCode: 'cia', tone: 'dark' },
  // 矢量政区路网。要看行政边界与道路参照时用；亮底，深色主题下需压暗。
  vec: { id: 'vec', label: '天地图 · 矢量政区', code: 'vec', annotationCode: 'cva', tone: 'light' },
  // 地形晕渲。看地貌起伏用，是二维下最接近三维观感的一档。
  ter: { id: 'ter', label: '天地图 · 地形晕渲', code: 'ter', annotationCode: 'cta', tone: 'light' },
}

export const DEFAULT_TIANDITU_LAYER: TiandituLayerId = 'img'

/** 子域轮询：天地图开放 t0–t7，分散浏览器对单域名的并发连接数上限。 */
export const TIANDITU_SUBDOMAINS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] as const

export function resolveTiandituLayer(id?: string | null): TiandituLayerConfig {
  const key = String(id ?? '').trim() as TiandituLayerId
  return TIANDITU_LAYERS[key] ?? TIANDITU_LAYERS[DEFAULT_TIANDITU_LAYER]
}

export function listTiandituLayers(): TiandituLayerConfig[] {
  return Object.values(TIANDITU_LAYERS)
}

/**
 * 拼一张瓦片的 WMTS 请求地址。
 *
 * @param code   服务代号（底图用 `config.code`，注记用 `config.annotationCode`）
 * @param token  天地图 tk；**空串直接返回 null**，让调用方走降级而不是发一个必然
 *               被拒的请求——无 tk 时天地图返回 418，一屏几十张全是 418 只会拖慢页面
 */
export function buildTiandituTileUrl(
  code: string,
  z: number,
  x: number,
  y: number,
  token: string,
): string | null {
  const tk = String(token ?? '').trim()
  if (!tk) return null
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const subdomain = TIANDITU_SUBDOMAINS[Math.abs(x + y) % TIANDITU_SUBDOMAINS.length]
  const query = [
    'SERVICE=WMTS',
    'REQUEST=GetTile',
    'VERSION=1.0.0',
    `LAYER=${encodeURIComponent(code)}`,
    'STYLE=default',
    'TILEMATRIXSET=w',
    'FORMAT=tiles',
    `TILEMATRIX=${Math.floor(z)}`,
    `TILEROW=${Math.floor(y)}`,
    `TILECOL=${Math.floor(x)}`,
    `tk=${encodeURIComponent(tk)}`,
  ].join('&')
  return `https://${subdomain}.tianditu.gov.cn/${code}_w/wmts?${query}`
}
