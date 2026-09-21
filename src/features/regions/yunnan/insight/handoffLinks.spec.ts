/** @vitest-environment happy-dom */
// handoffLinks.spec.ts — 洞察四条链路集成用例（dljy#3104，任务 15.8）
// ----------------------------------------------------------------------------
// 守什么不变量（规格 insight-context-handoff CH06—CH08、design D11 表与 D11.2，验收 A18/A19）：
//   链路一（选区→AI）：图表选区/当前签名 → 语义选区（只含业务身份与结果版本引用）→ AI
//     按同一当前证据采集派发；切公司后旧选区作废、旧签名不采集（撤权拒绝、返回恢复）；
//   链路二（对象深链往返）：业务深链 query 白名单（只带期间/对象名/from，不带原始数据与
//     可写动词）→ 双保险出口 → 返回后共享四键还原重查（coverage 按返回窗口重做）；
//   链路三（材料保存）：同版本保存带期望版本+幂等键 → 重复保存幂等命中不重复入稿 →
//     源更新 409 诚实报错 → 重跑（新版本）后再保存成功、幂等键随期望版本变化；
//   链路四（下钻编码往返）：insightHandoff build/parse round-trip 在六页 pageId 上逐一
//     成立、返回状态可恢复；未知字段丢弃提示、超长按序丢弃、非法对象整参拒绝（能拒绝）。
// 每条链路断言「选区/来源/版本一致、返回恢复、撤权拒绝、幂等重试」对应的不变量。
// mock 边界：auth/governance 打桩测权限显隐；workpapers 打桩测幂等链；其余全走真模块。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { Router } from 'vue-router'
import { ApiError, idempotencyKeyOf } from '@/services/api'
import { ElMessage } from 'element-plus'
import {
  listWorkpapers,
  getWorkpaper,
  captureInsightMaterial,
  saveWorkpaper,
  type Workpaper,
} from '@/services/review/workpapers'
import { parseInsightQuery } from '@/composables/useInsightContext'
import {
  useInsightSelection,
  type InsightSelectionCurrent,
  type InsightSelectionHit,
} from '@/components/insight/chart/useInsightSelection'
import { insightAiBlockOf } from './useInsightAiPage'
import InsightMaterialDialog from '@/components/insight/InsightMaterialDialog.vue'
import {
  nodePriceResult,
  nodePriceSeries,
  RESULT_VERSION,
  READ_SET_REF,
} from '@/components/insight/insightFixtures'
import {
  buildInsightDrilldownQuery,
  parseInsightDrilldownQuery,
  returnStateOf,
  hasInsightDrilldownParams,
  INSIGHT_HANDOFF_PAGE_IDS,
  INSIGHT_HANDOFF_VIEW_IDS,
  type InsightHandoffPageId,
} from '@/services/region/insightHandoff'
import {
  DEEP_LINK_TARGETS,
  businessDeepLinkQuery,
  isDeepLinkQuery,
  deepLinkHasWriteVerb,
  canFollowDeepLink,
  openBusinessDeepLink,
  openDataMaintenanceLink,
} from './businessLinks'

// ── mock（auth 失败=登录态缺失；governance 白名单可变；底稿服务打桩）────────────────────

const state = vi.hoisted(() => ({
  allowedPaths: [] as string[],
  /** set true => getCurrentUser throws (login read failure treated as no access) */
  authThrows: false,
}))

vi.mock('@/services/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCurrentUser: vi.fn(() => {
      if (state.authThrows) throw new Error("login-missing")
      return { id: 'u-1', name: 'tester' }
    }),
  }
})

vi.mock('@/services/governance', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    canAccessPath: vi.fn((path: string) => state.allowedPaths.includes(path)),
  }
})

vi.mock('@/services/review/workpapers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listWorkpapers: vi.fn(),
    getWorkpaper: vi.fn(),
    captureInsightMaterial: vi.fn(),
    saveWorkpaper: vi.fn(),
  }
})

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  }
})

// happy-dom（node 工程内 docblock 覆盖环境）缺少的浏览器 API shim：与 vitest.setup.dom.ts 同款，自包含。
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof (globalThis as { matchMedia?: unknown }).matchMedia === 'undefined') {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
  })
}

// ── 公共夹具 ─────────────────────────────────────────────────────────────────────────────

const PRICE = nodePriceSeries()
const RESULT = nodePriceResult(['300.125', '301.250'])
const VIEW = INSIGHT_HANDOFF_VIEW_IDS[0] as string

const TS_0000 = Date.parse('2026-09-10T00:00:00+08:00')
const TS_0015 = Date.parse('2026-09-10T00:15:00+08:00')

function currentOf(overrides: Partial<InsightSelectionCurrent> = {}): InsightSelectionCurrent {
  return { regionId: 'yunnan', companyId: 'c1', contextVersion: 3, resultVersion: RESULT_VERSION, ...overrides }
}

function hit(series = PRICE, ts = TS_0000, end = '2026-09-10T00:15:00+08:00'): InsightSelectionHit {
  return { series, point: { ts, end } }
}

const MATERIAL_REQUEST = {
  analysisId: 'prices.public-node-series',
  context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10', timeZone: 'Asia/Shanghai' }, sourceIds: [], mode: 'ex-post', asOf: null },
  filters: { view: 'series', objectIds: ['YN.KM.01'] },
}

function paperFixture(overrides: Record<string, unknown> = {}): Workpaper {
  return {
    id: 'p-1',
    title: '九月价格复盘',
    revision: 3,
    updatedAt: '2026-09-18T10:00:00+08:00',
    authorId: 'admin',
    canEdit: true,
    scope: { region: 'yunnan', view: 'generator', objectId: 'YN.KM.01', objectLabel: 'YN.KM.01', startDate: '2026-09-01', endDate: '2026-09-30' },
    blocks: [],
    summary: '',
    ...overrides,
  } as Workpaper
}

function materialFixture(id = 'ev-1', hash = 'h') {
  return {
    id,
    region: 'yunnan',
    authorId: 'admin',
    createdAt: '2026-09-19T10:00:00+08:00',
    sourceKind: 'business_source',
    contentHash: hash.repeat(64),
    content: {
      topic: 'market_insight',
      title: '公开历史节点价格序列',
      labels: ['公开历史节点价格序列'],
      capturedAt: '2026-09-19T10:00:00+08:00',
      sourceNotice: '服务器按登记分析重新读取并核对了版本。',
      input: {
        analysisId: MATERIAL_REQUEST.analysisId,
        analysisVersion: '1.0.0',
        context: MATERIAL_REQUEST.context,
        filters: MATERIAL_REQUEST.filters,
        expected: { resultVersion: RESULT_VERSION, readSetRef: READ_SET_REF },
      },
    },
  }
}

/** 预置一份「材料已在底稿中」的底稿（幂等命中场景）。 */
function paperAlreadyContainingMaterial() {
  const paper = paperFixture({
    blocks: [{ id: 'b-1', kind: 'chart', title: '公开历史节点价格序列', text: '', evidenceId: 'ev-1', evidenceRole: 'comparison' }],
  })
  vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paper], total: 1 } as never)
  vi.mocked(getWorkpaper).mockResolvedValue(paper)
  return paper
}

function apiError(status: number, msg: string): ApiError {
  return new ApiError(msg, { status, code: status, payload: { code: status, msg } })
}

let dialogWrapper: ReturnType<typeof mount> | null = null

async function mountDialog(result: typeof RESULT = RESULT) {
  dialogWrapper = mount(InsightMaterialDialog, {
    props: {
      modelValue: true,
      region: 'yunnan',
      companyId: 'c1',
      subject: '时段走势',
      request: MATERIAL_REQUEST,
      result,
    },
  })
  await flushPromises()
  return dialogWrapper
}

function dialogError(): string {
  const dialog = document.body.querySelector('[data-testid="insight-material-dialog"]')
  if (!dialog) throw new Error('弹窗未渲染')
  const el = dialog.querySelector('[data-testid="insight-material-error"]')
  return el ? el.textContent ?? '' : ''
}

async function choosePaperAndSave(label: string) {
  const dialog = document.body.querySelector('[data-testid="insight-material-dialog"]')
  if (!dialog) throw new Error('弹窗未渲染')
  ;(dialog.querySelector('.el-select__wrapper') as HTMLElement).click()
  await flushPromises()
  const option = [...document.querySelectorAll('.el-select-dropdown__item')].find((el) => el.textContent?.includes(label))
  if (!option) throw new Error(`下拉里没有「${label}」`)
  ;(option as HTMLElement).click()
  await flushPromises()
  ;(dialog.querySelector('[data-testid="insight-material-save"]') as HTMLElement).click()
  await flushPromises()
}

// ── 链路一：图表选区 → AI 按同一当前证据采集 → 撤权作废与返回恢复（CH03/CH08）────────────

describe('链路一：图表选区 → AI 采集 → 撤权作废 → 返回恢复', () => {
  it('图表选区 → 合法语义选区：版本三元组与结果一致、来源一致、时段北京时间合并，无位置键', () => {
    const { build } = useInsightSelection(() => currentOf())
    const selection = build(RESULT, [hit(PRICE, TS_0000, '2026-09-10T00:15:00+08:00'), hit(PRICE, TS_0015, '2026-09-10T00:30:00+08:00')])
    expect(selection).not.toBeNull()
    expect(selection!.resultRef).toMatchObject({ queryId: RESULT.queryId, resultVersion: RESULT_VERSION, readSetRef: READ_SET_REF })
    expect(selection!.sourceIds).toEqual(['yn.price.node.public.day-ahead'])
    expect(selection!.timeIntervals).toEqual([{ start: '2026-09-10T00:00:00+08:00', end: '2026-09-10T00:30:00+08:00' }])
    const serialized = JSON.stringify(selection)
    for (const forbidden of ['dataIndex', 'seriesIndex', 'pixel', '"x"', '"y"']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('选区 → AI 采集：同一份结果与签名产出区块，证据带同一结果版本/读取集/来源（选区即 AI 证据）', () => {
    const { build } = useInsightSelection(() => currentOf())
    const selection = build(RESULT, [hit()])!
    const signature = JSON.stringify(selection)
    const block = insightAiBlockOf({
      blockId: 'series',
      title: '时段走势',
      analysisId: 'prices.public-node-series',
      view: 'series',
      currentKey: signature,
      queriedKey: signature, // 签名一致：选区所属的那一版就是当前这一版
      result: RESULT,
      objects: ['YN.KM.01'],
    })
    expect(block).not.toBeNull()
    const versionText = block!.evidence!.find((item) => item.id === 'series.result')!.text
    expect(versionText).toContain(RESULT_VERSION)
    expect(versionText).toContain(READ_SET_REF)
    expect(block!.sourceRefs).toEqual(['yn.price.node.public.day-ahead'])
  })

  it('切公司撤权：当前上下文已换（companyId/结果版本变），旧选区 build=null、旧签名采集=null（不派发旧证据）', () => {
    const { build } = useInsightSelection(() => currentOf({ companyId: 'c2-other', contextVersion: 4, resultVersion: 'rv2:next' }))
    expect(build(RESULT, [hit()])).toBeNull() // 迟到事件：选区属于上一公司的上一版
    expect(
      insightAiBlockOf({ blockId: 'series', title: '时段走势', analysisId: 'prices.public-node-series', view: 'series', currentKey: 'new-key', queriedKey: 'old-key', result: RESULT })
    ).toBeNull() // AI 侧同一机械落点：签名不一致的区块整块退出
  })

  it('返回恢复：带 from 的下钻上下文可还原发起页位置（path + start/end/objects 合法筛选）', () => {
    const { query } = buildInsightDrilldownQuery({
      start: '2026-09-10',
      end: '2026-09-11',
      objects: ['YN.KM.01', 'YN.KM.02'],
      sources: ['yn.price.node.public.day-ahead'],
      from: 'prices' as InsightHandoffPageId,
    })
    const { payload } = parseInsightDrilldownQuery(query)
    const returnState = returnStateOf(payload)
    expect(returnState).toMatchObject({ pageId: 'prices', path: '/insight/prices' })
    expect(returnState!.query).toEqual({
      start: '2026-09-10',
      end: '2026-09-11',
      objects: 'YN.KM.01,YN.KM.02',
      sources: 'yn.price.node.public.day-ahead',
    })
  })
})

// ── 链路二：对象深链 → 只读白名单 → 返回共享四键重查（CH04/CH05/CH08）────────────────────

describe('链路二：对象深链往返（白名单、双保险、返回重查）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.allowedPaths = []
  })

  it('深链 query 只含白名单键（期间/对象名/from）：值均为非空字符串，无数组、无写动词', () => {
    const query = businessDeepLinkQuery({ window: { start: '2026-09-10', end: '2026-09-11' }, from: 'insight-prices', objectId: 'YN.KM.01' })
    expect(Object.keys(query).sort()).toEqual(['end', 'from', 'object', 'start'])
    expect(isDeepLinkQuery(query)).toBe(true)
    const serialized = JSON.stringify(query)
    expect(serialized).not.toContain('[') // 原始数据数组不进 URL
    expect(serialized).not.toMatch(/submit|create|confirm|approve/) // 可写动词不进 URL
    expect(query.from).toBe('insight-prices') // 来源标记：接收方与排查用
  })

  it('双保险出口：合法 query 跳转一次且路径只读；脏 query（缺键/白名单外/数组值）直接不动', () => {
    const push = vi.fn()
    const router = { push } as unknown as Router
    const good = businessDeepLinkQuery({ window: { start: '2026-09-10', end: '2026-09-11' }, from: 'insight-plants', objectId: 'YN.KM.01' })
    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.settlementReview, query: good })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ path: DEEP_LINK_TARGETS.settlementReview, query: good })

    push.mockClear()
    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.midlongPositions, query: { start: '2026-09-10', from: 'insight-plants' } })
    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.settlementReview, query: { ...good, extra: 'x' } })
    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.settlementReview, query: { ...good, object: ['YN.KM.01'] as unknown as string } })
    openBusinessDeepLink(router, { path: DEEP_LINK_TARGETS.settlementReview, query: { ...good, object: 'submit' } })
    expect(push).not.toHaveBeenCalled()
    expect(deepLinkHasWriteVerb({ ...good, object: 'confirm' })).toBe(true)
    expect(deepLinkHasWriteVerb(good)).toBe(false)
  })

  it('权限显隐与只读目标：按 governance 既有口径判定（读取用户失败=无权限）；目标全为只读页面路径', () => {
    for (const target of Object.values(DEEP_LINK_TARGETS)) {
      expect(canFollowDeepLink(target)).toBe(false)
    }
    state.allowedPaths = [DEEP_LINK_TARGETS.dataMaintenance]
    expect(canFollowDeepLink(DEEP_LINK_TARGETS.dataMaintenance)).toBe(true)
    expect(Object.values(DEEP_LINK_TARGETS)).toEqual(['/xhjy/review', '/zcqjy/positions', '/data-ops/console'])
  })

  it('返回重查：返回后的地址 query 经共享四键还原（coverage 重查输入成立），hx_ 层还原发起页', () => {
    const returnedQuery = {
      start: '2026-09-12',
      end: '2026-09-13',
      objects: 'YN.KM.02',
      hx_from: 'plants',
    }
    expect(hasInsightDrilldownParams(returnedQuery)).toBe(true)
    const { parsed, ignored } = parseInsightQuery(returnedQuery)
    expect(ignored).toEqual([])
    expect(parsed.window).toEqual({ start: '2026-09-12', end: '2026-09-13' })
    expect(parsed.objects).toEqual(['YN.KM.02'])
    const { payload } = parseInsightDrilldownQuery(returnedQuery)
    expect(payload.from).toBe('plants')
    // 资料维护深链带 panel：返回后仍以 coverage 重查结果为准（离开页面不视为已补齐）
    const push = vi.fn()
    openDataMaintenanceLink({ push } as unknown as Router, { window: { start: '2026-09-12', end: '2026-09-13' }, from: 'insight-prices' })
    expect(vi.mocked(push).mock.calls[0][0]).toMatchObject({ path: '/data-ops/console', query: { panel: 'upload', from: 'insight-prices' } })
  })
})

// ── 链路三：材料保存（同版本保存 → 幂等 → 409 → 重跑后再保存，CH02/CH07）────────────────

describe('链路三：材料保存的幂等与版本冲突链', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('同版本保存 → 幂等重试不重复：同一份材料已在底稿 → 提示未重复创建，不二次入稿', async () => {
    const paper = paperAlreadyContainingMaterial()
    vi.mocked(captureInsightMaterial).mockResolvedValue(materialFixture('ev-1') as never)
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')
    expect(vi.mocked(saveWorkpaper)).not.toHaveBeenCalled()
    expect(paper.blocks).toHaveLength(1)
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    const text = vi.mocked(ElMessage.success).mock.calls[0][0]
    expect(String(text)).toContain('未重复创建')
  })

  it('源更新 409 → 诚实报错未保存；重跑（新结果版本）后再保存：期望版本换成新值，幂等键随之变化', async () => {
    const paper = paperFixture()
    vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paper], total: 1 } as never)
    vi.mocked(getWorkpaper).mockResolvedValue(paper)
    vi.mocked(captureInsightMaterial).mockRejectedValueOnce(apiError(409, '源已更新'))
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')
    expect(dialogError()).toContain('重新运行') // 服务端口径：先重新运行再保存
    expect(dialogWrapper!.emitted('saved')).toBeUndefined()
    expect(ElMessage.success).not.toHaveBeenCalled()

    // 重跑：页面以新结果版本重新查询，材料窗口拿到新版本结果后再保存
    const nextVersion = `rv2:${'c'.repeat(64)}`
    const nextReadSet = `rs2:${'d'.repeat(64)}`
    const rerunResult = nodePriceResult(['300.125'], { queryId: 'q-test-2', resultVersion: nextVersion, readSetRef: nextReadSet })
    await dialogWrapper!.setProps({ result: rerunResult })
    vi.mocked(captureInsightMaterial).mockResolvedValueOnce(materialFixture('ev-2', 'n') as never)
    vi.mocked(saveWorkpaper).mockResolvedValueOnce(undefined as never)
    await choosePaperAndSave('九月价格复盘')
    // 第二次冻结带的是重跑后的期望版本（不拿旧版本冒充新读取）
    expect(vi.mocked(captureInsightMaterial).mock.calls[1][3]).toEqual({ resultVersion: nextVersion, readSetRef: nextReadSet })
    expect(String(vi.mocked(captureInsightMaterial).mock.calls[1][4])).not.toBe(String(vi.mocked(captureInsightMaterial).mock.calls[0][4]))
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(dialogWrapper!.emitted('saved')).toHaveLength(1)
  })

  it('幂等键口径：同口径重复保存同键（换底稿也不换键）；期望版本变化则键变化', () => {
    const base = { region: 'yunnan', analysisId: MATERIAL_REQUEST.analysisId, filters: MATERIAL_REQUEST.filters ?? null }
    const expectedV1 = { resultVersion: RESULT_VERSION, readSetRef: READ_SET_REF }
    const key1 = idempotencyKeyOf('insight-material', { ...base, expected: expectedV1 })
    const key2 = idempotencyKeyOf('insight-material', { ...base, expected: expectedV1 })
    const key3 = idempotencyKeyOf('insight-material', { ...base, expected: { resultVersion: 'rv2:other', readSetRef: READ_SET_REF } })
    expect(key1).toBe(key2)
    expect(key1).not.toBe(key3)
  })
})

// ── 链路四：下钻编码往返（CH06：有版本的交接、未知字段明确提示、能拒绝）──────────────────

describe('链路四：insightHandoff build/parse 往返与边界', () => {
  it('六页 pageId 逐一 round-trip：build → parse 完整还原，返回状态可恢复到发起页', () => {
    for (const pageId of INSIGHT_HANDOFF_PAGE_IDS) {
      const { query, dropped } = buildInsightDrilldownQuery({
        start: '2026-09-10',
        end: '2026-09-11',
        objects: ['YN.KM.01'],
        sources: ['yn.price.node.public.day-ahead'],
        priceObject: 'public-node',
        marketPhase: 'day-ahead',
        view: VIEW,
        from: pageId as InsightHandoffPageId,
      })
      expect(dropped).toEqual([])
      expect(query.hx_from).toBe(pageId)
      const { payload, ignored } = parseInsightDrilldownQuery(query)
      expect(ignored).toEqual([])
      expect(payload).toMatchObject({
        start: '2026-09-10',
        end: '2026-09-11',
        objects: ['YN.KM.01'],
        sources: ['yn.price.node.public.day-ahead'],
        priceObject: 'public-node',
        marketPhase: 'day-ahead',
        view: VIEW,
        from: pageId,
      })
      const returnState = returnStateOf(payload)
      expect(returnState!.pageId).toBe(pageId)
      expect(returnState!.path).toBe(`/insight/${pageId}`)
    }
  })

  it('未知字段丢弃提示（不静默忽略影响口径的键）：未登记 hx_ 键与命名空间重复键都进 ignored，其余照常还原', () => {
    const { payload, ignored } = parseInsightDrilldownQuery({
      start: '2026-09-10',
      end: '2026-09-11',
      hx_from: 'prices',
      hx_view: VIEW,
      hx_bot: '1', // 未登记键
      hx_start: '2020-01-01', // 与共享四键重名的重复键：四键语义为准，提示丢弃
    })
    expect(ignored).toEqual(['hx_bot', 'hx_start'])
    expect(payload).toMatchObject({ start: '2026-09-10', from: 'prices', view: VIEW })
  })

  it('超长按序丢弃并给出 dropped 清单：view → marketPhase → priceObject → objects → sources；窗口与 from 必需不丢', () => {
    const manyObjects = Array.from({ length: 120 }, (_, i) => `obj-${String(i).padStart(3, '0')}-long-object-name-for-length`)
    const { query, dropped } = buildInsightDrilldownQuery({
      start: '2026-09-10',
      end: '2026-09-11',
      objects: manyObjects,
      sources: ['yn.price.node.public.day-ahead'],
      priceObject: 'public-node',
      marketPhase: 'day-ahead',
      view: VIEW,
      from: 'prices',
    })
    expect(dropped).not.toContain('sources')
    expect(query.start).toBe('2026-09-10')
    expect(query.end).toBe('2026-09-11')
    expect(query.hx_from).toBe('prices')
    // 丢弃顺序与 D11.1 约定一致：先丢 view，最后丢 sources
    for (const earlier of ['view', 'marketPhase', 'priceObject', 'objects'] as const) {
      if (dropped.includes('sources') && dropped.includes(earlier)) {
        expect(dropped.indexOf(earlier)).toBeLessThan(dropped.indexOf('sources'))
      }
    }
    expect(dropped.indexOf('view')).toBeLessThan(dropped.indexOf('objects'))
  })

  it('能拒绝：非法对象标识 build 抛契约错误；parse 对非法 objects 整参丢弃进 ignored（不静默缩窄）', () => {
    expect(() =>
      buildInsightDrilldownQuery({ start: '2026-09-10', end: '2026-09-11', objects: ['不是合法标识!'], from: 'prices' as InsightHandoffPageId })
    ).toThrow(/对象/)
    const { payload, ignored } = parseInsightDrilldownQuery({
      start: '2026-09-10',
      end: '2026-09-11',
      objects: 'bad%zz,id2',
    })
    expect(ignored).toContain('objects')
    expect(payload.objects).toBeNull()
  })
})

enableAutoUnmount(afterEach)
