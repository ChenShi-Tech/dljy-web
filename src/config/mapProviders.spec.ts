import { describe, expect, it } from 'vitest'
import {
  BASE_MAP_ERROR_THRESHOLD,
  BASE_MAP_PROVIDERS,
  DEFAULT_BASE_MAP_PROVIDER_ID,
  resolveBaseMapSequenceWithPreferred,
  resolvePreferredBaseMapId,
  listBaseMapProviders,
  resolveBaseMapFallbackSequence,
  resolveBaseMapProvider,
  shouldFallbackBaseMap,
} from './mapProviders'

describe('mapProviders 底图 Provider 配置层', () => {
  it('默认 Provider 为实测可达的免费网络源', () => {
    const def = resolveBaseMapProvider(DEFAULT_BASE_MAP_PROVIDER_ID)
    // 由 arcgis-imagery 换来：arcgisonline.com 整域对本项目出口 IP 恒 403，实机上永远降级成
    // OSM 街道图，三维地形被街道图盖住等于白开。carto-dark 实测 0.24-0.73s、上千次请求零失败。
    expect(def.id).toBe('carto-voyager')
    expect(def.kind).toBe('url-template')
    expect(def.tier).toBe('free')
    expect(def.requiresToken ?? false).toBe(false)
    // adjustment 全中性是本条的重点：默认底图不得再像 osm-dark 那样把亮度/饱和度压掉。
    expect(def.adjustment).toEqual({ brightness: 1, contrast: 1, saturation: 1, gamma: 1 })
  })

  it('保留的暗色底图仍是压暗参数，可显式选用', () => {
    const dark = resolveBaseMapProvider('osm-dark')
    expect(dark.adjustment).toEqual({ brightness: 0.34, contrast: 1.36, saturation: 0.26, gamma: 0.68 })
  })

  it('默认底图不压暗——回归护栏', () => {
    // 「地图暗淡」的根因就是默认底图 adjustment 把 brightness/saturation 压到 0.34/0.26。
    // 这条钉死：无论以后默认换成谁，都不许再带压暗参数上任。
    const def = resolveBaseMapProvider(DEFAULT_BASE_MAP_PROVIDER_ID)
    expect(def.adjustment.brightness).toBeGreaterThanOrEqual(1)
    expect(def.adjustment.saturation).toBeGreaterThanOrEqual(0.9)
  })

  it('未知/空/undefined id 一律回退默认 Provider', () => {
    for (const bad of [undefined, null, '', '   ', 'does-not-exist']) {
      expect(resolveBaseMapProvider(bad).id).toBe(DEFAULT_BASE_MAP_PROVIDER_ID)
    }
  })

  it('已知 id 解析到对应 Provider', () => {
    expect(resolveBaseMapProvider('carto-dark').id).toBe('carto-dark')
    expect(resolveBaseMapProvider('  carto-dark  ').id).toBe('carto-dark')
  })

  it('注册表全部为免费层级；需 token 的源必须声明 tokenEnvKey', () => {
    for (const provider of listBaseMapProviders()) {
      expect(provider.tier).toBe('free')
      // ion 影像走免费额度但需凭据；requiresToken 的源必须说明 token 从哪来，
      // 否则运行期只会抛一个没有指向的错误。
      if (provider.requiresToken) expect(provider.tokenEnvKey).toBeTruthy()
    }
  })

  it('自动降级链永不包含需 token 的源', () => {
    // 无 token 环境下反复重试必失败的源，只会拖慢真正可用底图的出现。
    for (const seed of [undefined, 'carto-dark', 'ion-aerial', 'does-not-exist']) {
      const ids = resolveBaseMapFallbackSequence(seed).map((item) => item.id)
      expect(ids).not.toContain('ion-aerial')
    }
  })

  it('首选底图：显式指定 > ion token > 免费默认', () => {
    expect(resolvePreferredBaseMapId({})).toBe(DEFAULT_BASE_MAP_PROVIDER_ID)
    expect(resolvePreferredBaseMapId({ hasIonToken: true })).toBe('ion-aerial')
    // 显式指定不被 token 状态篡改，这正是把它与 resolveBaseMapProvider 分开的理由
    expect(resolvePreferredBaseMapId({ explicitId: 'osm-dark', hasIonToken: true })).toBe('osm-dark')
    // 未知的显式值不该压过 token 判断
    expect(resolvePreferredBaseMapId({ explicitId: 'nope', hasIonToken: true })).toBe('ion-aerial')
    expect(resolvePreferredBaseMapId({ explicitId: '  ', hasIonToken: false })).toBe(DEFAULT_BASE_MAP_PROVIDER_ID)
  })

  it('需 token 的首选源置顶，其后仍接免费降级链并以内置底色收尾', () => {
    const ids = resolveBaseMapSequenceWithPreferred('ion-aerial').map((item) => item.id)
    expect(ids[0]).toBe('ion-aerial')
    expect(ids.slice(1)).not.toContain('ion-aerial')
    expect(ids[1]).toBe(DEFAULT_BASE_MAP_PROVIDER_ID)
    expect(ids.at(-1)).toBe('solid-grid')
    // 免费首选走原有逻辑，不因新函数改变行为
    expect(resolveBaseMapSequenceWithPreferred('carto-dark').map((i) => i.id))
      .toEqual(resolveBaseMapFallbackSequence('carto-dark').map((i) => i.id))
  })

  it('ion 影像源声明了 assetId 与凭据来源', () => {
    const ion = resolveBaseMapProvider('ion-aerial')
    expect(ion.kind).toBe('ion')
    expect(ion.ionAssetId).toBe(3)
    expect(ion.tokenEnvKey).toBe('VITE_CESIUM_ION_TOKEN')
    expect(ion.credit).toBeTruthy()
  })

  it('降级序列从指定免费源开始、去重，并以内置无网络底色收尾', () => {
    expect(resolveBaseMapFallbackSequence('carto-dark').map((item) => item.id)).toEqual([
      'carto-dark',
      'carto-voyager',
      'arcgis-imagery',
      'osm-bright',
      'osm-dark',
      'opentopo',
      'solid-grid',
    ])
    expect(resolveBaseMapFallbackSequence('does-not-exist').map((item) => item.id)).toEqual([
      'carto-voyager',
      'carto-dark',
      'arcgis-imagery',
      'osm-bright',
      'osm-dark',
      'opentopo',
      'solid-grid',
    ])
    expect(resolveBaseMapFallbackSequence('solid-grid').map((item) => item.id)).toEqual([
      'solid-grid',
    ])
  })

  it('默认底图必须是网络可达的瓦片源，不能是纯色兜底', () => {
    // 兜底源当默认 = 一进页面就是空地球；而默认源一旦不可达（arcgis-imagery 的 403），
    // 用户看到的永远是降级链第二档，默认配置形同虚设。
    const def = resolveBaseMapProvider(DEFAULT_BASE_MAP_PROVIDER_ID)
    expect(def.kind).not.toBe('solid-color')
    expect(def.url).toMatch(/^https:\/\//)
    expect(def.credit).toBeTruthy()
  })

  it('连续瓦片错误达到阈值才切换 Provider', () => {
    expect(shouldFallbackBaseMap(1)).toBe(false)
    expect(shouldFallbackBaseMap(2)).toBe(true)
    expect(shouldFallbackBaseMap(Number.NaN)).toBe(false)
  })

  it('listBaseMapProviders 返回全部登记 Provider', () => {
    expect(listBaseMapProviders().map((item) => item.id).sort()).toEqual(
      Object.keys(BASE_MAP_PROVIDERS).sort(),
    )
  })

  it('每个 Provider 携带 #940 视觉微调扩展位', () => {
    for (const provider of listBaseMapProviders()) {
      expect(provider.adjustment).toMatchObject({
        brightness: expect.any(Number),
        contrast: expect.any(Number),
        saturation: expect.any(Number),
        gamma: expect.any(Number),
      })
    }
  })

  it('url-template 类型 Provider 携带子域轮询配置', () => {
    const carto = resolveBaseMapProvider('carto-dark')
    expect(carto.kind).toBe('url-template')
    expect(carto.subdomains).toEqual(['a', 'b', 'c', 'd'])
    expect(carto.url).toContain('{z}/{x}/{y}')
  })
})

// #1346 视觉/性能/可访问性门禁：降级链有界终止与 Provider 失败组合边界。
describe('mapProviders 降级链有界终止与失败组合（#1346 视觉门禁）', () => {
  it('任意首选源（含未知/空 id）的降级序列必以不访问网络的 solid-color 收尾且无重复', () => {
    for (const preferred of ['osm-dark', 'carto-dark', 'solid-grid', '', 'does-not-exist', null, undefined]) {
      const seq = resolveBaseMapFallbackSequence(preferred)
      expect(seq.length).toBeGreaterThan(0)
      const terminal = seq.at(-1)!
      expect(terminal.kind).toBe('solid-color')
      expect(terminal.url).toBe('')
      expect(new Set(seq.map((item) => item.id)).size).toBe(seq.length)
    }
  })

  it('降级序列中 solid-color 仅出现在末位一次（网络源不被提前短路跳过）', () => {
    for (const preferred of ['osm-dark', 'carto-dark', '', 'does-not-exist']) {
      const seq = resolveBaseMapFallbackSequence(preferred)
      const solidCount = seq.filter((item) => item.kind === 'solid-color').length
      expect(solidCount).toBe(1)
      expect(seq.at(-1)?.kind).toBe('solid-color')
    }
  })

  it('所有网络源逐级失败时，序列仍以 solid-color 有界终止（不无限重试、不黑屏）', () => {
    const seq = resolveBaseMapFallbackSequence('osm-dark')
    let cursor = 0
    while (cursor < seq.length - 1) {
      expect(seq[cursor].kind).not.toBe('solid-color')
      // 模拟该源瓦片连续失败达阈值即降级
      expect(shouldFallbackBaseMap(BASE_MAP_ERROR_THRESHOLD)).toBe(true)
      cursor += 1
    }
    expect(seq.at(-1)?.kind).toBe('solid-color')
  })

  it('shouldFallbackBaseMap 边界：阈值两侧与非有限值', () => {
    expect(shouldFallbackBaseMap(0)).toBe(false)
    expect(shouldFallbackBaseMap(BASE_MAP_ERROR_THRESHOLD - 1)).toBe(false)
    expect(shouldFallbackBaseMap(BASE_MAP_ERROR_THRESHOLD)).toBe(true)
    expect(shouldFallbackBaseMap(BASE_MAP_ERROR_THRESHOLD + 1)).toBe(true)
    // 非有限值视为不应降级（防御错误计数溢出到 Infinity 误判）
    expect(shouldFallbackBaseMap(Number.POSITIVE_INFINITY)).toBe(false)
    expect(shouldFallbackBaseMap(Number.NaN)).toBe(false)
    expect(shouldFallbackBaseMap(Number.NEGATIVE_INFINITY)).toBe(false)
    expect(shouldFallbackBaseMap(-1)).toBe(false)
  })

  it('每个网络 Provider 携带非空 attribution（兜底源不请求网络）', () => {
    for (const provider of listBaseMapProviders()) {
      if (provider.kind === 'solid-color') {
        expect(provider.url).toBe('')
        continue
      }
      expect(typeof provider.credit === 'string' && provider.credit.length > 0).toBe(true)
      // 端点可以是瓦片 URL，也可以是 ion assetId；两者都没有就是不可定位的死配置。
      const locatable = provider.url.length > 0 || Number.isFinite(provider.ionAssetId)
      expect(locatable).toBe(true)
      if (provider.kind === 'ion') expect(Number.isFinite(provider.ionAssetId)).toBe(true)
      else expect(provider.url.length).toBeGreaterThan(0)
    }
  })

  it('solid-grid 终态不访问网络且自带中性视觉微调', () => {
    const terminal = BASE_MAP_PROVIDERS['solid-grid']
    expect(terminal.kind).toBe('solid-color')
    expect(terminal.url).toBe('')
    expect(terminal.tier).toBe('free')
    expect(terminal.adjustment).toEqual({ brightness: 1, contrast: 1, saturation: 1, gamma: 1 })
  })
})
