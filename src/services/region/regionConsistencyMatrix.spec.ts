// @vitest-environment happy-dom
// ↑ 勿删：矩阵⑦ 的用例要在组件 setup 里挂 useInsightContext（useRoute/useRouter 依赖
//   注入），regionContext 顶层也读 window/localStorage——需要 DOM 环境。
//
// 跨地区一致性矩阵（dljy#3103，OpenSpec build-yunnan-regional-market-insight 任务 16.2）
// ----------------------------------------------------------------------------
// 定位：design.md D2「跨地区一致性矩阵」六行的逐行验收 + RW01/RW03/RW04/RW06 负例。
// 既有用例只各自证明一个面（regionIsolation 证请求/缓存隔离、insightWorkspace 证注册
// 契约、regionNavigation.insight 证切区落点、navigation.insight-assembly 证导航装配、
// governance.insight-aliases 证权限等价）；本矩阵把它们钉在**同一张真包（真云南 +
// 真山西工作区）装配**上，逐行核对 D2 表格，任何一行实现退化都让测试失败：
//   ① 同地址异省：/insight/prices 在云南/山西各解析到各自工作区的页（组件由各自包 load）
//   ② 云南专属页切已登记不支持地区：回**目标地区登记的默认入口**，不套云南页面
//   ③ 切到未登记洞察地区：六页全 not-registered、导航不替换、无借数入口
//   ④ 山西业务布局/口径不变：兼容登记不换导航、只登记两页、旧 /sjfx/* 入口不重定向
//   ⑤ 非洞察模块切地区：洞察装配不碰其他分组，非洞察路径切区行为不变
//   ⑥ 跨省 import 负例（静态源码断言）：省包互不 import，内核不 import 省包
//   ⑦ 请求负例：切省后洞察 query 上下文（x-region-id 的来源）随全局地区，不沿用旧地区
//   ⑧ 旧深链：/sjfx/zrsjg 等 11 条兼容映射表回归（RW03）
//
// 全部用例走 installRegionPackages() 装配的真注册表（不造 fixture 工作区），云南开关用
// vi.stubEnv 逐用例控制——开关是 UI 装配开关，矩阵行为必须与开关状态无关（RW06）。

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { resolveRegionSwitchRoute } from './regionNavigation'
import {
  INSIGHT_PAGE_IDS,
  INSIGHT_PAGE_PATHS,
  getInsightWorkspace,
  listInsightNavigation,
  resolveInsightPage,
  type InsightPageId
} from './insightWorkspace'
import { canonicalInsightRoutePath, insightLegacyLinks, legacyPathsForInsightPage, resolveLegacyInsightLink } from './insightLegacyLinks'
import { applyInsightWorkspaceNavigation, navigation } from '@/data/navigation'
import { currentRegion, selectedRegionId } from './regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { useInsightContext, type InsightContextState } from '@/composables/useInsightContext'

const YUNNAN_SWITCH = 'VITE_YUNNAN_INSIGHT_WORKSPACE'
const trader = { roleCode: 'TRADE_LEAD' } as const

beforeAll(async () => {
  // 按应用启动路径装配真包（云南 + 山西两个工作区），全文件共用、不清空
  const { installRegionPackages } = await import('@/features/regions')
  installRegionPackages()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── 矩阵① 同地址异省（RW01「他省共享页保留业务实现」「同一业务路径响应地区切换」）──

describe('矩阵① 同地址异省：/insight/<pageId> 按当前地区解析到各自工作区', () => {
  it('云南开关打开：overview/prices 在两省都解析为 page，但 workspaceId 不同（同 pageId 两省各自实现）', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    for (const pageId of ['overview', 'prices'] as const) {
      const yunnan = resolveInsightPage('yunnan', pageId)
      const shanxi = resolveInsightPage('shanxi', pageId)
      expect(yunnan.kind === 'page' && yunnan.page.pageId, `yunnan/${pageId}`).toBe(pageId)
      expect(shanxi.kind === 'page' && shanxi.page.pageId, `shanxi/${pageId}`).toBe(pageId)
      const yunnanWs = getInsightWorkspace('yunnan')
      const shanxiWs = getInsightWorkspace('shanxi')
      expect(yunnanWs?.workspaceId).toBe('yunnan.insight')
      expect(shanxiWs?.workspaceId).toBe('shanxi.insight')
      expect(yunnanWs?.workspaceId).not.toBe(shanxiWs?.workspaceId)
    }
  })

  it('同地址异省加载不同组件：山西 overview/prices 指向既有驾驶舱/价格分析组件，云南指向本省六页组件', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    const shanxiPages = getInsightWorkspace('shanxi')?.pages ?? []
    const yunnanPages = getInsightWorkspace('yunnan')?.pages ?? []
    const loadTarget = (pages: { pageId: InsightPageId; load: () => unknown }[], pageId: InsightPageId) =>
      pages.find((page) => page.pageId === pageId)?.load.toString() ?? ''

    // 矩阵① 第 1/2 行：云南价格页（或总览）切到山西 ⇒ 同一规范地址加载山西现有组件
    expect(loadTarget(shanxiPages, 'overview')).toContain('MarketInsightCockpitView.vue')
    expect(loadTarget(shanxiPages, 'prices')).toContain('PriceAnalysisView.vue')
    // 云南同名页指向云南实现——组件由各自包 load 决定，不存在「他省套云南组件」
    expect(loadTarget(yunnanPages, 'overview')).toContain('YunnanOverviewPage.vue')
    expect(loadTarget(yunnanPages, 'prices')).toContain('YunnanPricesPage.vue')
  })

  it('RW06 回退视角：云南开关关闭时云南六页全部 not-registered，山西同地址解析原样可用', () => {
    vi.unstubAllEnvs()
    for (const pageId of INSIGHT_PAGE_IDS) {
      expect(resolveInsightPage('yunnan', pageId), pageId).toEqual({ kind: 'not-registered' })
    }
    expect(resolveInsightPage('shanxi', 'overview')).toMatchObject({ kind: 'page' })
    expect(resolveInsightPage('shanxi', 'prices')).toMatchObject({ kind: 'page' })
  })
})

// ── 矩阵② 云南专属页切到已登记但不支持此页的地区 ──────────────────────────────

describe('矩阵② 云南专属页切山西：回该地区登记的默认入口，不套云南页面', () => {
  it('山西对 supply/grid-boundaries/plants/research 全部 page-not-supported，落点是山西默认入口', () => {
    const shanxiDefault = INSIGHT_PAGE_PATHS[getInsightWorkspace('shanxi')!.defaultPageId]
    for (const pageId of ['supply', 'grid-boundaries', 'plants', 'research'] as const) {
      const resolved = resolveInsightPage('shanxi', pageId)
      expect(resolved, pageId).toMatchObject({ kind: 'fallback', reason: 'page-not-supported', to: shanxiDefault })
    }
    // 落点是山西登记的默认入口（/insight/overview），不是云南任何专属页路径
    expect(shanxiDefault).toBe('/insight/overview')
    expect(['/insight/grid-boundaries', '/insight/plants', '/insight/research']).not.toContain(shanxiDefault)
  })

  it('切区落点：/insight/grid-boundaries 切山西 → 山西默认入口 + 仅白名单 query（date 留、market 丢）', () => {
    const target = resolveRegionSwitchRoute('shanxi', trader, '/insight/grid-boundaries', {
      date: '2026-09-17',
      market: 'da'
    })
    expect(target).toEqual({ path: '/insight/overview', query: { date: '2026-09-17' } })
  })

  it('切区落点逐页核对：云南四个专属页切山西全部回山西默认入口，两省共享页原地停留', () => {
    for (const pageId of ['supply', 'grid-boundaries', 'plants', 'research'] as const) {
      expect(
        resolveRegionSwitchRoute('shanxi', trader, INSIGHT_PAGE_PATHS[pageId], { date: '2026-09-17', market: 'da' }),
        `切山西：${pageId}`
      ).toEqual({ path: INSIGHT_PAGE_PATHS.overview, query: { date: '2026-09-17' } })
    }
    for (const pageId of ['overview', 'prices'] as const) {
      expect(
        resolveRegionSwitchRoute('shanxi', trader, INSIGHT_PAGE_PATHS[pageId]),
        `切山西：${pageId}`
      ).toEqual({ path: INSIGHT_PAGE_PATHS[pageId] })
      expect(
        resolveRegionSwitchRoute('yunnan', trader, INSIGHT_PAGE_PATHS[pageId], { date: '2026-09-17' }),
        `切云南：${pageId}`
      ).toEqual({ path: INSIGHT_PAGE_PATHS[pageId], query: { date: '2026-09-17' } })
    }
  })
})

// ── 矩阵③ 切到未登记洞察的地区（RW01「地区未登记」）───────────────────────────

describe('矩阵③ 未登记地区（广东/四川）：六页全 not-registered、导航不替换、无借数', () => {
  it('广东、四川六页全量 not-registered（含 grid-boundaries/plants/research），无 page 对象可渲染', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    for (const regionId of ['guangdong', 'sichuan']) {
      for (const pageId of INSIGHT_PAGE_IDS) {
        const resolved = resolveInsightPage(regionId, pageId)
        expect(resolved, `${regionId}/${pageId}`).toEqual({ kind: 'not-registered' })
        // not-registered ⇒ 无 load 句柄 ⇒ 宿主无从借他省数据发请求
        expect(resolved.kind === 'page').toBe(false)
      }
      expect(getInsightWorkspace(regionId)).toBeNull()
    }
  })

  it('未登记地区导航不替换：工作区导航为 null，全局导航装配返回原数组引用', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    for (const regionId of ['guangdong', 'sichuan']) {
      expect(listInsightNavigation(regionId), regionId).toBeNull()
      expect(applyInsightWorkspaceNavigation(navigation, regionId), regionId).toBe(navigation)
    }
  })

  it('未登记地区六条规范路径切区原地停留（宿主显示未开通，不跳走、不借他省数据）', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    for (const pageId of INSIGHT_PAGE_IDS) {
      expect(
        resolveRegionSwitchRoute('guangdong', trader, INSIGHT_PAGE_PATHS[pageId], { date: '2026-09-17' }),
        `切广东：${pageId}`
      ).toEqual({ path: INSIGHT_PAGE_PATHS[pageId], query: { date: '2026-09-17' } })
    }
  })
})

// ── 矩阵④ 山西业务布局/口径不变（RW01「他省共享页保留业务实现」）───────────────

describe('矩阵④ 山西业务布局不变：兼容登记只服务地址解析，不重排山西产品', () => {
  it('山西兼容登记不替换导航：replacesNavigation 为假，侧边栏沿用旧 /sjfx/*、/insight/cockpit 入口', () => {
    const shanxiWs = getInsightWorkspace('shanxi')
    expect(shanxiWs?.replacesNavigation).toBeFalsy()
    expect(listInsightNavigation('shanxi')).toBeNull()
    expect(applyInsightWorkspaceNavigation(navigation, 'shanxi')).toBe(navigation)
  })

  it('山西只登记 overview/prices 两页（不套云南六页结构），/sjfx/zrsjg 旧入口对山西不重定向', () => {
    const shanxiWs = getInsightWorkspace('shanxi')
    expect(shanxiWs?.pages.map((page) => page.pageId).sort()).toEqual(['overview', 'prices'])
    // 矩阵⑤「山西旧 /sjfx/zrsjg 链接……其他旧页面保留原适用行为」：兼容映射只登记给
    // 云南、且阶段 A 未启用——山西访问旧路径恒 null（旧页面原样可用，不批量重定向）
    expect(resolveLegacyInsightLink('/sjfx/zrsjg', { date: '2026-09-17' }, 'shanxi')).toBeNull()
    expect(resolveLegacyInsightLink('/insight/cockpit', {}, 'shanxi')).toBeNull()
  })
})

// ── 矩阵⑤ 非市场洞察模块切地区：完全沿用当前行为 ──────────────────────────────

describe('矩阵⑤ 非洞察模块导航与切区行为不变', () => {
  it('云南装配六页后：洞察分组 children 恰为六条规范路径，其余分组对象引用与路径集合不变', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    const assembled = applyInsightWorkspaceNavigation(navigation, 'yunnan')
    expect(assembled).not.toBe(navigation)
    const insightIndex = navigation.findIndex((item) => item.path === '/insight')
    expect(assembled[insightIndex]?.children?.map((child) => child.path)).toEqual(
      INSIGHT_PAGE_IDS.map((pageId) => INSIGHT_PAGE_PATHS[pageId])
    )
    // 非洞察分组：引用不变（标题/图标/children 全部原样）
    navigation.forEach((item, index) => {
      if (index === insightIndex) return
      expect(assembled[index], item.path).toBe(item)
    })
    // 分组数量不变：洞察装配不增删任何顶级分组
    expect(assembled).toHaveLength(navigation.length)
  })

  it('六页工作区在场时，非洞察路径切区行为与既有回归一致：系统页原地、普通页落地区 landing', () => {
    vi.stubEnv(YUNNAN_SWITCH, '1')
    const admin = { roleCode: 'ADMIN' } as const
    expect(resolveRegionSwitchRoute('yunnan', admin, '/system/accounts')).toEqual({ path: '/system/accounts' })
    expect(resolveRegionSwitchRoute('shanxi', admin, '/system/accounts')).toEqual({ path: '/system/accounts' })
    expect(resolveRegionSwitchRoute('guangdong', trader, '/sdzl/region-rules')).toEqual({ path: '/sdzl/region-rules' })
    // /sjfx/zrsjg 不是六条规范路径（insightPageIdFromPath 为 null），不进洞察分支，
    // 仍走通用 landing 逻辑（与没有洞察工作区时的既有回归逐字一致）
    expect(resolveRegionSwitchRoute('yunnan', trader, '/sjfx/zrsjg')).toEqual({ path: '/xhjy/yunnan' })
    expect(resolveRegionSwitchRoute('guangdong', admin, '/sjfx/zrsjg')).toEqual({ path: '/xhjy/region' })
    expect(resolveRegionSwitchRoute('shanxi', admin, '/sjfx/zrsjg')).toEqual({ path: '/xhjy/region' })
  })
})

// ── 矩阵⑥ 跨省 import 负例（静态源码断言，与 regionIsolation「内核不 import 省包」同范式）──

/** 递归收集目录下全部源码文件（.ts/.vue；含 spec 与 SFC）。 */
function walkSources(dir: string, { includeSpecs = true } = {}): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walkSources(full, { includeSpecs })
    if (!/\.(ts|vue)$/.test(entry.name)) return []
    // includeSpecs=false：内核产码扫描（spec 文件为验证可能合法 import 省包，如本文件的
    // 检测器自检样例）；省包内部扫描仍全量含 spec——省包自己的测试也在省包边界内。
    if (!includeSpecs && /\.spec\.ts$/.test(entry.name)) return []
    return [full]
  })
}

/** 抽取静态/动态/副作用 import 的模块说明符（export * from 由 from 分支覆盖）。 */
function importSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g), (match) => match[1])
}

function specifierViolations(fromSrcSubdir: string, forbidden: RegExp, includeSpecs = true): string[] {
  const root = join(process.cwd(), 'src', fromSrcSubdir)
  return walkSources(root, { includeSpecs }).flatMap((file) =>
    importSpecifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => forbidden.test(specifier))
      .map((specifier) => `${file}: ${specifier}`)
  )
}

describe('矩阵⑥ 跨省 import 负例（静态源码断言）', () => {
  it('检测器自检：import 说明符抽取对静态/动态/副作用 import 都命中（防恒绿假负例）', () => {
    expect(importSpecifiers("import x from '../shanxi/register'")).toEqual(['../shanxi/register'])
    expect(importSpecifiers("const m = await import('@/features/regions/shanxi/insight/workspace')")).toEqual([
      '@/features/regions/shanxi/insight/workspace'
    ])
    expect(importSpecifiers("import '../shanxi/profile'")).toEqual(['../shanxi/profile'])
    expect(importSpecifiers("// 注释里提到 ../shanxi/ 不算引用\nexport const id = 'shanxi'")).toEqual([])
  })

  it('yunnan 包任何源文件不得 import 山西（含 ../shanxi/ 相对路径与 features/regions/shanxi 别名）', () => {
    const violations = specifierViolations('features/regions/yunnan', /shanxi/)
    expect(violations).toEqual([])
  })

  it('shanxi 包任何源文件不得 import 云南（反向同罪）', () => {
    const violations = specifierViolations('features/regions/shanxi', /yunnan/)
    expect(violations).toEqual([])
  })

  it('内核 services/region 产码不得 import 任何具体省包——装配只经 features/regions 聚合入口', () => {
    // 只扫产码：spec 为验证目的可经聚合入口/自检样例引用省包字面量（见上方自检）
    const violations = specifierViolations('services/region', /features\/regions\/(yunnan|shanxi)/, false)
    expect(violations).toEqual([])
  })
})

// ── 矩阵⑦ 请求负例（RW04）：切省后洞察请求上下文随全局地区 ──────────────────────

let router: Router

async function mountInsightContext(): Promise<InsightContextState> {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  let handle: InsightContextState | null = null
  const Comp = defineComponent({
    setup() {
      handle = useInsightContext()
      return () => h('div')
    }
  })
  mount(Comp, { global: { plugins: [router] } })
  return handle!
}

describe('矩阵⑦ 请求负例：洞察 query 上下文的 regionId 跟随全局地区', () => {
  afterEach(() => {
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
  })

  it('云南→山西切省后 toQueryContext().regionId 跟随全局地区，代次递增、对象清空（不跨省沿用）', async () => {
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
    const state = await mountInsightContext()

    state.setObjectIds(['yn.price.node.public.day-ahead'])
    expect(state.toQueryContext().regionId).toBe('yunnan')
    const versionBefore = state.contextVersion.value

    // 全局地区切到山西（api.ts 的 x-region-id 头正来自这里导出的同一来源）
    selectedRegionId.value = 'shanxi'
    await flushPromises()
    await nextTick()

    expect(state.toQueryContext().regionId).toBe('shanxi')
    expect(state.contextVersion.value).toBeGreaterThan(versionBefore)
    // 对象属于原地区：切省即清空，不带云南对象发山西请求（不借数）
    expect(state.objectIds.value).toEqual([])
  })

  it('x-region-id 请求头的来源（api.ts 读 currentRegion.id）与全局地区同步，切省后不残留旧值', async () => {
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
    await mountInsightContext()
    expect(currentRegion.value.id).toBe('yunnan')

    selectedRegionId.value = 'shanxi'
    await flushPromises()

    expect(currentRegion.value.id).toBe('shanxi')
    // 反向核对：currentRegion 与 selectedRegionId 是同一份状态的两个视图
    expect(currentRegion.value.id).toBe(selectedRegionId.value)
  })
})

// ── 矩阵⑧ 山西旧 /sjfx/* 链接与全部旧深链映射回归（RW03）────────────────────────

describe('矩阵⑧ 旧深链兼容映射回归（11 条 = D2 迁移表）', () => {
  it('canonicalInsightRoutePath 全表回归：每条旧入口映射到 D2 表指定的规范页（fshq 只留说明不映射）', () => {
    const expectedIdentity: Array<[string, string]> = [
      ['/insight/cockpit', '/insight/overview'],
      ['/sjfx/fshq', '/sjfx/fshq'],
      ['/sjfx/zrsjg', '/insight/prices'],
      ['/sjfx/zcqxhdl', '/insight/plants'],
      ['/sjfx/zrxgx', '/insight/research'],
      ['/sjfx/zrxgx2', '/insight/research'],
      ['/sjfx/actualLoad', '/insight/supply'],
      ['/sjfx/singleZsjfx', '/insight/research'],
      ['/sjfx/market-ops', '/insight/overview'],
      ['/xhjy/yunnan/node-price', '/insight/prices'],
      ['/xhjy/yunnan/settlement-price', '/insight/plants']
    ]
    expect(insightLegacyLinks).toHaveLength(expectedIdentity.length)
    for (const [legacyPath, canonicalPath] of expectedIdentity) {
      expect(canonicalInsightRoutePath(legacyPath), legacyPath).toBe(canonicalPath)
    }
  })

  it('反查回归：每个规范页的旧入口集合与映射表一致（旧书签 ⇄ 规范页双向可互认）', () => {
    expect(legacyPathsForInsightPage('overview')).toEqual(['/insight/cockpit', '/sjfx/market-ops'])
    expect(legacyPathsForInsightPage('prices')).toEqual(['/sjfx/zrsjg', '/xhjy/yunnan/node-price'])
    expect(legacyPathsForInsightPage('supply')).toEqual(['/sjfx/actualLoad'])
    expect(legacyPathsForInsightPage('plants')).toEqual(['/sjfx/zcqxhdl', '/xhjy/yunnan/settlement-price'])
    expect(legacyPathsForInsightPage('research')).toEqual(['/sjfx/zrxgx', '/sjfx/zrxgx2', '/sjfx/singleZsjfx'])
    expect(legacyPathsForInsightPage('grid-boundaries')).toEqual([])
  })

  it('阶段 A 口径回归：所有条目 enabledFor 为空——任何旧链接对任何地区都不产生重定向', () => {
    for (const entry of insightLegacyLinks) {
      expect(entry.enabledFor, entry.legacyPath).toEqual([])
      expect(resolveLegacyInsightLink(entry.legacyPath, { date: '2026-09-17' }, 'yunnan'), entry.legacyPath).toBeNull()
    }
  })
})

afterAll(() => {
  vi.unstubAllEnvs()
})
