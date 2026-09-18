import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalInsightRoutePath,
  insightLegacyLinks,
  legacyPathsForInsightPage,
  resolveLegacyInsightLink
} from './insightLegacyLinks'
import {
  INSIGHT_PAGE_PATHS,
  __resetInsightWorkspaces,
  registerInsightWorkspace
} from './insightWorkspace'

const stubLoad = () => Promise.resolve({})

// 目标页已交付的工作区 fixture（云南）：验证「启用后」的解析行为
function registerDeliveredYunnanWorkspace() {
  registerInsightWorkspace({
    workspaceId: 'test.yunnan-delivered',
    regionId: 'yunnan',
    version: 1,
    defaultPageId: 'overview',
    enabled: () => true,
    replacesNavigation: true,
    pages: [
      { pageId: 'overview', title: '市场总览', order: 1, load: stubLoad, delivered: true },
      { pageId: 'prices', title: '价格与价差', order: 2, load: stubLoad, delivered: true },
      { pageId: 'plants', title: '场站市场表现', order: 3, load: stubLoad, delivered: false },
      { pageId: 'research', title: '研究工作台', order: 4, load: stubLoad, delivered: true },
      { pageId: 'supply', title: '供需与水电', order: 5, load: stubLoad, delivered: true }
    ]
  })
}

// 测试里临时启用条目（enabledFor 是导出数组的可变字段）：用后恢复，不污染其他用例
function withEnabled(entryPath: string, regionId: string, run: () => void) {
  const entry = insightLegacyLinks.find((item) => item.legacyPath === entryPath)
  if (!entry) throw new Error(`fixture 缺少条目 ${entryPath}`)
  const original = entry.enabledFor.slice()
  entry.enabledFor.push(regionId)
  try {
    run()
  } finally {
    entry.enabledFor.length = 0
    entry.enabledFor.push(...original)
  }
}

describe('旧入口兼容映射登记表', () => {
  it('11 条登记与 D2 迁移表逐条对应', () => {
    expect(insightLegacyLinks).toHaveLength(11)
    expect(insightLegacyLinks.map((item) => item.legacyPath)).toEqual([
      '/insight/cockpit',
      '/sjfx/fshq',
      '/sjfx/zrsjg',
      '/sjfx/zcqxhdl',
      '/sjfx/zrxgx',
      '/sjfx/zrxgx2',
      '/sjfx/actualLoad',
      '/sjfx/singleZsjfx',
      '/sjfx/market-ops',
      '/xhjy/yunnan/node-price',
      '/xhjy/yunnan/settlement-price'
    ])
  })

  it('阶段 A：enabledFor 全为空数组——默认不启用任何重定向', () => {
    for (const entry of insightLegacyLinks) {
      expect(entry.enabledFor, entry.legacyPath).toEqual([])
    }
  })

  it('notice 型条目只有 fshq（撮合行情无云南来源，不建页面映射）', () => {
    const notices = insightLegacyLinks.filter((item) => item.target.kind === 'notice')
    expect(notices.map((item) => item.legacyPath)).toEqual(['/sjfx/fshq'])
  })
})

describe('resolveLegacyInsightLink', () => {
  beforeEach(() => {
    __resetInsightWorkspaces()
    registerDeliveredYunnanWorkspace()
  })
  afterEach(() => __resetInsightWorkspaces())

  it('阶段 A：enabledFor 为空 → 任何旧路径对任何地区都返回 null（旧入口原样保留）', () => {
    for (const entry of insightLegacyLinks) {
      expect(resolveLegacyInsightLink(entry.legacyPath, { date: '2026-09-17' }, 'yunnan'), entry.legacyPath).toBeNull()
      expect(resolveLegacyInsightLink(entry.legacyPath, {}, 'shanxi'), entry.legacyPath).toBeNull()
    }
  })

  it('启用后：合法公共参数保留并落到规范页（含目标页指定的 tab/preset）', () => {
    withEnabled('/sjfx/zrsjg', 'yunnan', () => {
      expect(resolveLegacyInsightLink('/sjfx/zrsjg', { date: '2026-09-17', market: 'da' }, 'yunnan')).toEqual({
        path: INSIGHT_PAGE_PATHS.prices,
        query: { date: '2026-09-17', market: 'da', tab: 'periods' },
        notices: []
      })
    })
  })

  it('启用后：目标页指定的参数优先于旧入口透传的同名参数', () => {
    withEnabled('/xhjy/yunnan/node-price', 'yunnan', () => {
      const resolved = resolveLegacyInsightLink('/xhjy/yunnan/node-price', { date: '2026-09-17', tab: 'legacy-tab' }, 'yunnan')
      expect(resolved?.query.tab).toBe('nodes')
      expect(resolved?.query.source).toBe('company-node')
    })
  })

  it('启用后：目标页不支持的参数被丢弃并给出一次性提示', () => {
    withEnabled('/xhjy/yunnan/node-price', 'yunnan', () => {
      const resolved = resolveLegacyInsightLink('/xhjy/yunnan/node-price', { date: '2026-09-17', node: 'YN001', foo: 'bar' }, 'yunnan')
      expect(resolved?.query).toEqual({ date: '2026-09-17', node: 'YN001', tab: 'nodes', source: 'company-node' })
      expect(resolved?.notices).toHaveLength(1)
      expect(resolved?.notices[0]).toContain('节点电价')
    })
  })

  it('启用后：enabledFor 不含当前地区 → null（山西旧书签在山西保持原页面）', () => {
    // 山西无任何登记条目：即便某条对云南启用，山西访问旧路径也保持原样
    withEnabled('/sjfx/zrsjg', 'yunnan', () => {
      expect(resolveLegacyInsightLink('/sjfx/zrsjg', { date: '2026-09-17' }, 'shanxi')).toBeNull()
    })
  })

  it('启用后：目标页在该地区未交付 → null（RW03：不把旧书签重定向到占位页）', () => {
    // plants 在 fixture 中 delivered:false
    withEnabled('/xhjy/yunnan/settlement-price', 'yunnan', () => {
      expect(
        resolveLegacyInsightLink('/xhjy/yunnan/settlement-price', { date: '2026-09-17' }, 'yunnan')
      ).toBeNull()
    })
  })

  it('启用后：notice 型条目恒 null（fshq 不映射页面，由旧入口自行说明）', () => {
    withEnabled('/sjfx/fshq', 'yunnan', () => {
      expect(resolveLegacyInsightLink('/sjfx/fshq', {}, 'yunnan')).toBeNull()
    })
  })

  it('未登记路径 → null', () => {
    expect(resolveLegacyInsightLink('/sjfx/tqyb', {}, 'yunnan')).toBeNull()
    expect(resolveLegacyInsightLink('/dashboard', {}, 'yunnan')).toBeNull()
  })
})

describe('canonicalInsightRoutePath（页面身份）', () => {
  it('六条规范路径原样返回（含剥掉 query/hash）', () => {
    expect(canonicalInsightRoutePath('/insight/prices')).toBe('/insight/prices')
    expect(canonicalInsightRoutePath('/insight/prices?date=2026-09-17')).toBe('/insight/prices')
    expect(canonicalInsightRoutePath('insight/research#tab')).toBe('/insight/research')
  })

  it('旧入口映射到目标规范页——新旧路径识别为同一页面身份（供已保存分析检索与 AI 来源识别）', () => {
    expect(canonicalInsightRoutePath('/sjfx/zrsjg')).toBe(INSIGHT_PAGE_PATHS.prices)
    expect(canonicalInsightRoutePath('/insight/cockpit')).toBe(INSIGHT_PAGE_PATHS.overview)
    expect(canonicalInsightRoutePath('/sjfx/zrxgx')).toBe(INSIGHT_PAGE_PATHS.research)
    expect(canonicalInsightRoutePath('/xhjy/yunnan/settlement-price')).toBe(INSIGHT_PAGE_PATHS.plants)
  })

  it('notice 型旧入口与无关路径原样返回', () => {
    expect(canonicalInsightRoutePath('/sjfx/fshq')).toBe('/sjfx/fshq')
    expect(canonicalInsightRoutePath('/dashboard')).toBe('/dashboard')
  })
})

describe('legacyPathsForInsightPage（反查旧入口）', () => {
  it('research 对应三条旧入口；grid-boundaries 无旧入口', () => {
    expect(legacyPathsForInsightPage('research')).toEqual(['/sjfx/zrxgx', '/sjfx/zrxgx2', '/sjfx/singleZsjfx'])
    expect(legacyPathsForInsightPage('prices')).toEqual(['/sjfx/zrsjg', '/xhjy/yunnan/node-price'])
    expect(legacyPathsForInsightPage('grid-boundaries')).toEqual([])
  })
})
