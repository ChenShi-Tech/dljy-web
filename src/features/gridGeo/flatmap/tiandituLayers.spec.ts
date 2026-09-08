import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TIANDITU_LAYER,
  TIANDITU_SUBDOMAINS,
  buildTiandituTileUrl,
  listTiandituLayers,
  resolveTiandituLayer,
} from './tiandituLayers'

describe('天地图图层注册表', () => {
  it('未知/空 id 回落默认图层', () => {
    for (const bad of [undefined, null, '', '  ', 'gaode']) {
      expect(resolveTiandituLayer(bad).id).toBe(DEFAULT_TIANDITU_LAYER)
    }
  })

  it('每个图层都配了注记层代号', () => {
    // 底图与注记是两个独立服务，漏配注记会让地名整层消失而不报错。
    for (const layer of listTiandituLayers()) {
      expect(layer.code).toBeTruthy()
      expect(layer.annotationCode).toBeTruthy()
      expect(layer.annotationCode).not.toBe(layer.code)
    }
  })

  it('默认是卫星影像——与三维页底图口径一致', () => {
    expect(resolveTiandituLayer(DEFAULT_TIANDITU_LAYER).code).toBe('img')
  })
})

describe('天地图瓦片 URL', () => {
  const TK = 'test-token'

  it('拼出合法的 WMTS 请求', () => {
    const url = buildTiandituTileUrl('img', 8, 200, 109, TK)
    expect(url).toBeTruthy()
    const parsed = new URL(url as string)
    expect(parsed.hostname).toMatch(/^t[0-7]\.tianditu\.gov\.cn$/)
    expect(parsed.pathname).toBe('/img_w/wmts')
    expect(parsed.searchParams.get('SERVICE')).toBe('WMTS')
    expect(parsed.searchParams.get('REQUEST')).toBe('GetTile')
    expect(parsed.searchParams.get('LAYER')).toBe('img')
    expect(parsed.searchParams.get('TILEMATRIXSET')).toBe('w')
    expect(parsed.searchParams.get('TILEMATRIX')).toBe('8')
    expect(parsed.searchParams.get('TILECOL')).toBe('200')
    expect(parsed.searchParams.get('TILEROW')).toBe('109')
    expect(parsed.searchParams.get('tk')).toBe(TK)
  })

  // 这条是性能护栏：无 tk 时天地图对每张瓦片返回 418，一屏几十张全是失败请求，
  // 既拖慢页面又把失败计数刷满。所以缺凭据必须在拼 URL 这一步就短路。
  it('无 tk 直接返回 null，不发必然被拒的请求', () => {
    expect(buildTiandituTileUrl('img', 8, 200, 109, '')).toBeNull()
    expect(buildTiandituTileUrl('img', 8, 200, 109, '   ')).toBeNull()
    expect(buildTiandituTileUrl('img', 8, 200, 109, undefined as unknown as string)).toBeNull()
  })

  it('非法瓦片坐标返回 null', () => {
    expect(buildTiandituTileUrl('img', Number.NaN, 200, 109, TK)).toBeNull()
    expect(buildTiandituTileUrl('img', 8, Number.POSITIVE_INFINITY, 109, TK)).toBeNull()
  })

  it('子域按瓦片坐标轮询，分散单域名并发上限', () => {
    const hosts = new Set<string>()
    for (let x = 0; x < 16; x += 1) hosts.add(new URL(buildTiandituTileUrl('img', 8, x, 109, TK) as string).hostname)
    expect(hosts.size).toBe(TIANDITU_SUBDOMAINS.length)
    // 同一张瓦片必须永远落在同一子域，否则缓存命中率归零
    const once = buildTiandituTileUrl('img', 8, 200, 109, TK)
    expect(buildTiandituTileUrl('img', 8, 200, 109, TK)).toBe(once)
  })

  it('tk 做 URL 编码，含特殊字符也不破坏 query', () => {
    const url = buildTiandituTileUrl('img', 8, 200, 109, 'a&b=c d') as string
    expect(url).not.toContain('a&b=c d')
    expect(new URL(url).searchParams.get('tk')).toBe('a&b=c d')
  })
})
