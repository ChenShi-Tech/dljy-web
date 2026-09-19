/** @vitest-environment happy-dom */
// crossModuleRegression.spec.ts — 洞察跨模块回归：模型离线 / 专题不可用 / 私有撤权（dljy#3104，任务 15.6）
// ----------------------------------------------------------------------------
// 守什么不变量（规格 insight-context-handoff CH03/CH05、design D11.2，验收 A14）：
//   ① 模型离线（探活 offline 或 /assemble 503/网络失败）：AI 入口诚实不可用（不派发、
//      不静默），六页数据查询、同版本导出与材料保存照常工作——模型不是数据页的依赖；
//   ② 专题服务不可用（底稿 500 / 材料冻结 503 / 底稿冲突）：本窗口诚实报错、未保存绝不
//      提示成功，分析页其余功能不受影响（错误折叠到 InsightRequestError，不吞成空图）；
//   ③ 私有授权撤销（切公司 / 403）：旧证据不进 AI 上下文（签名纪律 + denied 整块退出，
//      不泄露私有资料存在性），材料保存 403 不静默、过期查询按原 status 抛出；
//   ④ 合法查询/导出在上述故障下保持可用（A14：错误不伪装成功，能力也不被故障株连）。
// 链路组织：错误折叠层（insightClient/insightAiContextClient 对 @/services/api 的真实
// 折叠）不 mock；/assemble、/query 走同一个 apiPost 桩按路径分岔；底稿服务打桩；
// AI 侧栏用真模块测派发。产品代码零改动。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount as mountWithUi } from '@/test/mount'
import { mount } from '@vue/test-utils'
import { ApiError } from '@/services/api'
import { ElMessage } from 'element-plus'
import {
  resetAiSidebarForTest,
  takeSliceFor,
  useAiSidebar,
} from '@/features/aiSidebar/useAiSidebar'
import {
  activeAiPage,
  deactivatePage,
} from '@/features/aiSidebar/pageRegistry'
import { selectedCompanyId } from '@/services/company/companyContext'
import { selectedRegionId } from '@/services/region/regionContext'
import {
  queryInsight,
  InsightRequestError,
  type InsightQueryRequest,
} from '@/services/insight/insightClient'
import {
  captureInsightMaterial,
  getWorkpaper,
  listWorkpapers,
  saveWorkpaper,
  type Workpaper,
} from '@/services/review/workpapers'
import InsightMaterialDialog from '@/components/insight/InsightMaterialDialog.vue'
import { buildInsightCsv } from '@/components/insight/insightCsv'
import {
  insightResult,
  nodePriceResult,
  RESULT_VERSION,
  READ_SET_REF,
} from '@/components/insight/insightFixtures'
import {
  insightAiBlockOf,
  useInsightAiPage,
  type InsightAiEvidenceBlock,
  type UseInsightAiPageReturn,
} from './useInsightAiPage'

// ── 可控 mock（vi.hoisted：mock 工厂与测试共享可变状态）──────────────────────────────────

const state = vi.hoisted(() => ({
  /** useAgentHealth 的离线态（getter 对象按 Ref 形状读取） */
  offline: false,
  /** /api/v1/* 调用记录（按路径前缀分岔的共享 apiPost/apiGet 桩） */
  calls: [] as Array<{ path: string }>,
  /** 各路径的响应实现；未登记路径默认抛 503 网络错误 */
  responders: {} as Record<string, (path: string, body: unknown) => Promise<unknown>>,
}))

function apiRespond(path: string, body: unknown): Promise<unknown> {
  state.calls.push({ path })
  const responder = state.responders[Object.keys(state.responders).find((key) => path.includes(key)) ?? '']
  if (!responder) {
    return Promise.reject(new TypeError('fetch failed（桩未登记该路径）'))
  }
  return responder(path, body)
}

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    apiGet: (path: string) => apiRespond(path, undefined),
    apiPost: (path: string, body: unknown) => apiRespond(path, body),
  }
})

vi.mock('@/composables/useAgentHealth', () => ({
  useAgentHealth: () => ({
    health: { value: state.offline ? 'offline' : 'online' },
    ready: { value: !state.offline },
    offline: { get value() { return state.offline } },
    check: async () => {},
  }),
}))

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
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

import { ElMessage as ElMessageMock } from 'element-plus'

// ── 公共夹具与挂载辅助 ───────────────────────────────────────────────────────────────────

enableAutoUnmount(afterEach)

const RESULT = nodePriceResult(['300.125', '301.250'])

/** 登记一个 /query 成功响应（默认登记，测试可覆盖）。 */
function serveQueryResult(result: ReturnType<typeof insightResult> = RESULT): void {
  state.responders['/market-insight/query'] = async () => ({ data: result })
}

/** 请求一个区块查询（与页面同一路径），返回 promise 供断言错误形状。 */
function runQuery(): Promise<unknown> {
  const request: InsightQueryRequest = {
    analysisId: 'prices.public-node-series',
    context: {
      regionId: 'yunnan',
      businessWindow: { start: '2026-09-10', end: '2026-09-10', timeZone: 'Asia/Shanghai' },
      sourceIds: [],
      mode: 'ex-post',
      asOf: null,
    },
    filters: { view: 'series' },
  }
  return queryInsight(request)
}

/** /assemble 恒成功时返回的合法信封（与 #3097 约束层同形状）。 */
function defaultEnvelope() {
  return {
    schemaVersion: 'insight-ai-context/v1',
    page_context: {},
    evidence_registry: {},
    known_objects: [] as string[],
    source_missing: [],
    freshness_notes: [],
    disciplines: {},
    output_contract: { segments: ['facts', 'possible_factors', 'confirmed_objects', 'open_questions'], shape: {} },
    prompt: '纪律文本',
    tools: [] as unknown[],
  }
}

/** 默认 /assemble 成功；测试可覆盖为抛错或挂起。 */
function serveAssembleOk(): void {
  state.responders['/insight-ai-context/assemble'] = async () => ({ data: defaultEnvelope() })
}

// ── AI 取材纪律桩（与 useInsightAiPage.component.spec 同一套签名纪律用法）──────────────

function blockFrom(
  result: ReturnType<typeof insightResult> | null,
  queriedKey: string,
  currentKey = queriedKey
): InsightAiEvidenceBlock | null {
  return insightAiBlockOf({
    blockId: 'series',
    title: '时段走势',
    analysisId: 'prices.public-node-series',
    view: 'series',
    currentKey,
    queriedKey,
    result,
  })
}

let latest: UseInsightAiPageReturn | null = null

function harness(opts: { collect: () => InsightAiEvidenceBlock[]; signature?: () => string }): Component {
  return defineComponent({
    name: 'AiHarness',
    setup() {
      latest = useInsightAiPage({ pageId: 'prices', label: '云南价格分析', collect: opts.collect, currentSignature: opts.signature })
      return () => h('div', 'harness')
    },
  })
}

async function mountHarness(opts: { collect: () => InsightAiEvidenceBlock[]; signature?: () => string }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/insight/prices', component: { template: '<div/>' } }] })
  router.push('/insight/prices')
  await router.isReady()
  const wrapper = mount(harness(opts), { global: { plugins: [router] } })
  await nextTick()
  return { wrapper, router }
}

async function interpret(): Promise<boolean> {
  if (!latest) throw new Error('harness 未注册')
  return latest.interpret()
}

// ── 材料窗口桩 ───────────────────────────────────────────────────────────────────────────

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

function materialFixture(id = 'ev-1') {
  return {
    id,
    region: 'yunnan',
    authorId: 'admin',
    createdAt: '2026-09-19T10:00:00+08:00',
    sourceKind: 'business_source',
    contentHash: 'h'.repeat(64),
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

function apiError(status: number, msg: string): ApiError {
  return new ApiError(msg, { status, code: status, payload: { code: status, msg } })
}

let dialogWrapper: ReturnType<typeof mountWithUi> | null = null

async function mountDialog(result: ReturnType<typeof insightResult> = RESULT) {
  document.body.innerHTML = ''; // 清掉上一用例 append-to-body 的残留弹窗
  dialogWrapper = mountWithUi(InsightMaterialDialog, {
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
  const select = dialog.querySelector('.el-select__wrapper') as HTMLElement
  select.click()
  await flushPromises()
  const option = [...document.querySelectorAll('.el-select-dropdown__item')].find((el) => el.textContent?.includes(label))
  if (!option) throw new Error(`下拉里没有「${label}」`)
  ;(option as HTMLElement).click()
  await flushPromises()
  ;(dialog.querySelector('[data-testid="insight-material-save"]') as HTMLElement).click()
  await flushPromises()
}

// ── ① 模型离线：AI 诚实不可用，数据页完整工作（CH03 / D9）────────────────────────────────

describe('模型离线：AI 入口诚实不可用，六页能力完整保留', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.offline = false
    state.calls = []
    state.responders = {}
    serveQueryResult()
    serveAssembleOk()
    resetAiSidebarForTest()
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
  })

  it('探活 offline：aiAvailable=false、interpret 拒绝并明说；同刻数据查询、CSV 导出、材料保存全部照常', async () => {
    state.offline = true
    const { wrapper } = await mountHarness({ collect: () => [blockFrom(RESULT, 'k1')!] })

    // AI 入口：诚实不可用（不派发、不假装解读）
    expect(latest!.aiAvailable.value).toBe(false)
    await expect(interpret()).resolves.toBe(false)
    expect(ElMessage.warning).toHaveBeenCalled()
    const ai = useAiSidebar()
    expect(ai.state.request).toBeNull()

    // 同刻：数据查询照常（公开源合法结果）
    await expect(runQuery()).resolves.toMatchObject({ analysisId: 'test.analysis' })
    // 同刻：导出照常（纯前端同版本导出，不依赖模型）
    const csv = buildInsightCsv(RESULT)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('值')
    // 同刻：材料保存照常（底稿服务可用时冻结成功并入稿）
    vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paperFixture()], total: 1 } as never)
    vi.mocked(getWorkpaper).mockResolvedValue(paperFixture())
    vi.mocked(captureInsightMaterial).mockResolvedValue(materialFixture() as never)
    vi.mocked(saveWorkpaper).mockResolvedValue(undefined as never)
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')
    expect(ElMessage.success).toHaveBeenCalled()
    expect(dialogWrapper!.emitted('saved')).toHaveLength(1)
  })

  it('/assemble 返回 503：组装失败诚实报错（原因原文上抛），本次解读不发起；单击只尝试一次', async () => {
    state.responders['/insight-ai-context/assemble'] = async () => {
      throw apiError(503, 'AI 组装服务暂不可用')
    }
    const ai = useAiSidebar()
    await mountHarness({ collect: () => [blockFrom(RESULT, 'k1')!] })
    await expect(interpret()).resolves.toBe(false)
    await expect(interpret()).resolves.toBe(false)
    // 两次点击各一次尝试：没有重试风暴；每次都把 503 原因诚实报出（不伪装成功）
    expect(state.calls.filter((call) => call.path.includes('/assemble'))).toHaveLength(2)
    expect(ElMessageMock.error).toHaveBeenCalledTimes(2)
    const text = vi.mocked(ElMessageMock.error).mock.calls[0][0]
    expect(text).toContain('AI 组装服务暂不可用')
    expect(ai.state.request).toBeNull()
    // 模型故障不株连数据页：查询照常成功
    await expect(runQuery()).resolves.toMatchObject({ queryId: 'q-test-1' })
  })

  it('/assemble 网络失败（fetch failed）：折叠为 503 UNAVAILABLE 诚实报错，不吞成成功', async () => {
    delete state.responders['/insight-ai-context/assemble'] // 未登记路径 → 网络失败
    await mountHarness({ collect: () => [blockFrom(RESULT, 'k1')!] })
    await expect(interpret()).resolves.toBe(false)
    expect(ElMessageMock.error).toHaveBeenCalled()
    expect(useAiSidebar().state.request).toBeNull()
  })

  it('模型离线时数据查询与导出可用（A14：AI 故障不阻断合法导出）', async () => {
    state.offline = true
    // 远端只挂 AI；查询照常
    await expect(runQuery()).resolves.toMatchObject({ resultVersion: RESULT_VERSION })
    const csv = buildInsightCsv(RESULT)
    expect(csv.split('\n').filter((line) => line.includes('2026-09-10')).length).toBeGreaterThan(0)
  })
})

// ── ② 专题服务不可用：窗口诚实报错，未保存不提示成功（CH02 / D11.2）──────────────────────

describe('专题服务不可用：保存诚实报错，分析页不受影响', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.offline = false
    state.calls = []
    state.responders = {}
    serveQueryResult()
    serveAssembleOk()
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
  })

  it('材料冻结 503（专题服务挂）：窗口报「本次未保存」，无 saved、无成功提示；分析页查询照常', async () => {
    vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paperFixture()], total: 1 } as never)
    vi.mocked(getWorkpaper).mockResolvedValue(paperFixture())
    vi.mocked(captureInsightMaterial).mockRejectedValue(apiError(503, '材料服务暂不可用'))
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')
    expect(dialogError()).toContain('材料服务暂不可用') // 服务端原因原样透传（有原因不给兜底文案）
    expect(dialogWrapper!.emitted('saved')).toBeUndefined()
    expect(ElMessage.success).not.toHaveBeenCalled()
    // 分析页其余功能不受影响：同刻区块查询成功返回
    await expect(runQuery()).resolves.toMatchObject({ analysisId: 'test.analysis' })
  })

  it('底稿列表读失败（500）：窗口诚实报错不阻断；区块查询与导出照常（合法查询/导出保持可用）', async () => {
    vi.mocked(listWorkpapers).mockRejectedValue(apiError(500, '底稿服务维护中'))
    await mountDialog()
    expect(dialogError()).toContain('底稿服务维护中') // 服务端原因原样透传
    // 不影响分析页其余功能：查询与导出照常
    await expect(runQuery()).resolves.toMatchObject({ queryId: 'q-test-1' })
    const csv = buildInsightCsv(RESULT)
    expect(csv).toContain('300.125')
  })
})

// ── ③ 私有授权撤销：旧证据不进 AI、保存 403 不静默、403 查询按原样上抛（CH03 / CH05）────

describe('私有授权撤销：证据与保存的双向边界', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.offline = false
    state.calls = []
    state.responders = {}
    serveQueryResult()
    serveAssembleOk()
    resetAiSidebarForTest()
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
  })

  it('切公司后旧结果签名过期：区块不进 AI 上下文（hasEvidence=false → 悬浮球不派发，不带旧公司证据）', async () => {
    const ai = useAiSidebar()
    await mountHarness({ collect: () => [] }) // 切公司后全部旧结果属于上一公司 → 采集为空
    expect(latest!.hasEvidence.value).toBe(false)
    await expect(interpret()).resolves.toBe(false)
    expect(ElMessage.info).toHaveBeenCalled()
    expect(ai.state.request).toBeNull()
    // 机械落点：queriedKey ≠ currentKey 的过期区块，取材函数直接丢弃
    expect(blockFrom(RESULT, 'old-company-key', 'current-company-key')).toBeNull()
  })

  it('denied（撤权）区块整块退出：不泄露私有资料存在性；公开区块仍可解读且 payload 不含私有块', async () => {
    const denied = insightResult({
      analysisId: 'plants.private-series',
      runtime: { access: 'denied', availability: { state: 'empty', reason: 'not-enabled' }, freshness: { state: 'unknown' }, comparability: { status: 'compatible', reasons: [] } },
      data: { schemaVersion: 'insight-result-data/v1', dimensions: [], measures: [], rows: [], series: [] },
    })
    const publicBlock = blockFrom(RESULT, 'k1')!
    const collect = [blockFrom(denied, 'k1'), publicBlock].filter(Boolean) as InsightAiEvidenceBlock[]
    const { wrapper: deniedWrapper } = await mountHarness({ collect: () => collect, signature: () => 'sig-1' })
    await expect(interpret()).resolves.toBe(true)
    const slice = takeSliceFor(useAiSidebar().state.request!.question) as { blocks: InsightAiEvidenceBlock[] } | null
    expect(slice!.blocks).toHaveLength(1)
    expect(slice!.blocks[0].blockId).toBe('series')
    deniedWrapper.unmount()
    const serialized = JSON.stringify(slice)
    expect(serialized).not.toContain('plants.private-series')
    expect(serialized).not.toContain('"denied"')
  })

  it('撤权后保存材料 403：不静默——服务端中文原因透传到窗口，无 saved、无成功提示', async () => {
    vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paperFixture()], total: 1 } as never)
    vi.mocked(getWorkpaper).mockResolvedValue(paperFixture())
    vi.mocked(captureInsightMaterial).mockRejectedValue(apiError(403, '没有该公司的资料保存权限'))
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')
    expect(dialogError()).toContain('没有该公司的资料保存权限')
    expect(dialogWrapper!.emitted('saved')).toBeUndefined()
    expect(ElMessage.success).not.toHaveBeenCalled()
    // 幂等键未复用为「成功」：冻结调用确实发生且被拒绝（错误不伪装成功）
    expect(vi.mocked(captureInsightMaterial)).toHaveBeenCalledTimes(1)
  })

  it('私有查询 403（撤权后的过期查询）：按原 status 403 抛 InsightRequestError，不吞成空图', async () => {
    state.responders['/market-insight/query'] = async () => {
      throw apiError(403, '没有该公司授权')
    }
    const error = await runQuery().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InsightRequestError)
    expect((error as InsightRequestError).status).toBe(403)
    expect((error as InsightRequestError).message).toContain('没有该公司授权')
  })

  it('网络失败折叠为 503 UNAVAILABLE；AbortError 原样透传（切页取消不是失败）', async () => {
    delete state.responders['/market-insight/query']
    const networkError = await runQuery().catch((e: unknown) => e)
    expect(networkError).toBeInstanceOf(InsightRequestError)
    expect((networkError as InsightRequestError).status).toBe(503)
    expect((networkError as InsightRequestError).errorCode).toBe('UNAVAILABLE')

    const abort = Object.assign(new Error('canceled'), { name: 'AbortError' })
    state.responders['/market-insight/query'] = async () => {
      throw abort
    }
    await expect(runQuery()).rejects.toBe(abort)
  })
})

// ── ④ 合法能力保持：版本一致的查询/导出/保存路径在故障下仍可走通（A14）─────────────────

describe('合法查询、导出与保存保持可用（A14）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.offline = false
    state.calls = []
    state.responders = {}
    serveQueryResult()
    serveAssembleOk()
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'c1'
  })

  it('查询结果的版本三元组完整（resultVersion/readSetRef/expiresAt），导出与之同版本', async () => {
    const result = (await runQuery()) as { resultVersion: string; readSetRef: string; expiresAt: string | null }
    expect(result.resultVersion).toBe(RESULT_VERSION)
    expect(result.readSetRef).toBe(READ_SET_REF)
    expect(result.expiresAt).toBeTruthy()
    const csv = buildInsightCsv(RESULT)
    expect(csv.split('\n')[0]).toContain('来源')
  })

  it('AI 不可用（/assemble 503）时保存链路完整走通：冻结带期望版本与幂等键并成功入稿', async () => {
    state.responders['/insight-ai-context/assemble'] = async () => {
      throw apiError(503, 'AI 组装服务暂不可用')
    }
    vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paperFixture()], total: 1 } as never)
    vi.mocked(getWorkpaper).mockResolvedValue(paperFixture())
    vi.mocked(captureInsightMaterial).mockResolvedValue(materialFixture() as never)
    vi.mocked(saveWorkpaper).mockResolvedValue(undefined as never)
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')
    const [company, region, input, expected, key] = vi.mocked(captureInsightMaterial).mock.calls[0]
    expect(company).toBe('c1')
    expect(region).toBe('yunnan')
    expect(expected).toEqual({ resultVersion: RESULT_VERSION, readSetRef: READ_SET_REF })
    expect(String(key)).toMatch(/^insight-material-/)
    expect(input.analysisId).toBe(MATERIAL_REQUEST.analysisId)
    expect(ElMessage.success).toHaveBeenCalled()
    expect(dialogWrapper!.emitted('saved')).toHaveLength(1)
  })

  it('私有序列目录只进摘要不进行值：采集 payload 无 rows 原始行（保存与 AI 不泄漏私有证据）', () => {
    const block = blockFrom(RESULT, 'k1')!
    const serialized = JSON.stringify(block)
    expect(serialized).not.toMatch(/"rows"/)
    expect(serialized).toContain(RESULT_VERSION)
    expect(serialized).toContain(READ_SET_REF)
    expect(block.sourceRefs).toEqual(['yn.price.node.public.day-ahead'])
  })
})
