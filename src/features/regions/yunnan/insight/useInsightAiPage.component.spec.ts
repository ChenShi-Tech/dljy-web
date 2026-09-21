// useInsightAiPage.spec.ts — 洞察六页统一 AI 侧栏注册的取材纪律（dljy#3100，任务 15.3）
// 守什么不变量（规格 insight-context-handoff CH03、design D9 AI 边界段）：
//   ① 签名纪律：queriedKey !== currentKey 的过期区块绝不进上下文；无结果/无权区块整块退出；
//   ② 只传摘要与版本引用：payload 无 rows/data 等原始行痕迹，体积不随结果行数增长；
//   ③ 注册生命周期：挂载/激活生效、失活/卸载只清自己（KeepAlive 语义）；
//   ④ interpret 流程：先 /assemble 约束组装，成功才派发（blocks + insight_ai_context 同发）；
//      无证据、模型离线、组装失败、组装期间签名变化/页面失活——一律不派发并诚实反馈；
//      组装失败单击只尝试一次，无重试风暴。
// mock 边界：/assemble 客户端与 useAgentHealth 打桩；ElMessage 打桩；侧栏用真模块（测派发）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref, type Component } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { resetAiSidebarForTest, takeSliceFor, useAiSidebar } from '@/features/aiSidebar/useAiSidebar'
import { activeAiPage, deactivatePage, resolveInterpret } from '@/features/aiSidebar/pageRegistry'
import { insightResult, RESULT_VERSION, READ_SET_REF } from '@/components/insight/insightFixtures'
import {
  insightAiBlockOf,
  insightInterpretQuestion,
  useInsightAiPage,
  type InsightAiEvidenceBlock,
  type UseInsightAiPageReturn,
} from './useInsightAiPage'

// ── 可控 mock（vi.hoisted：mock 工厂与测试共享可变状态）──────────────────────────────────

const state = vi.hoisted(() => ({
  /** useAgentHealth 的离线态（getter 对象按 Ref 形状读取） */
  offline: false,
  /** /assemble 调用记录 */
  assembleCalls: [] as unknown[],
  /** /assemble 行为：null = 默认成功（返回合法信封）；否则按注入实现执行 */
  assembleImpl: null as null | ((message: unknown) => Promise<unknown>),
  assembleCallsLimit: Infinity,
}))

function defaultEnvelope() {
  return {
    schemaVersion: 'insight-ai-context/v1',
    page_context: {},
    evidence_registry: {},
    known_objects: [] as string[],
    source_missing: [] as unknown[],
    freshness_notes: [] as unknown[],
    disciplines: {},
    output_contract: { segments: ['facts', 'possible_factors', 'confirmed_objects', 'open_questions'], shape: {} },
    prompt: '纪律文本',
    tools: [] as unknown[],
  }
}

vi.mock('@/composables/useAgentHealth', () => ({
  useAgentHealth: () => ({
    health: { value: state.offline ? 'offline' : 'online' },
    ready: { value: !state.offline },
    offline: { get value() { return state.offline } },
    check: async () => {},
  }),
}))

vi.mock('@/services/insight/insightAiContextClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    assembleInsightAiContext: (message: unknown) => {
      if (state.assembleCalls.length >= state.assembleCallsLimit) throw new Error('不应再调用 /assemble')
      state.assembleCalls.push(message)
      return state.assembleImpl ? state.assembleImpl(message) : Promise.resolve(defaultEnvelope())
    },
  }
})

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { ElMessage } from 'element-plus'

// ── 夹具与挂载辅助 ───────────────────────────────────────────────────────────────────────

/** 带大量原始行的合法结果：用于断言 payload 不随行数增长。 */
function resultWithManyRows() {
  const rows = Array.from({ length: 300 }, (_, i) => ({
    seriesId: 'ser-1',
    intervalStart: `2026-09-10T${String(i % 24).padStart(2, '0')}:00:00+08:00`,
    intervalEnd: `2026-09-10T${String(i % 24).padStart(2, '0')}:15:00+08:00`,
    value: String(i),
  }))
  return insightResult({
    data: {
      schemaVersion: 'insight-result-data/v1',
      dimensions: [],
      measures: [],
      rows,
      series: [{
        seriesId: 'ser-1', sourceId: 'yn.system.load.actual', fieldId: 'totalEnergy', unit: 'MW', measureKind: 'power',
        dimensions: {}, businessScope: 'yunnan', resolutionMinutes: 15, nativeResolutionMinutes: 15,
        priceObject: null, marketPhase: null, variant: 'actual',
      }],
    },
  })
}

async function makeRouter(): Promise<Router> {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/insight/overview', component: { template: '<div/>' } }] })
  router.push('/insight/overview')
  await router.isReady()
  return router
}

/** 调 useInsightAiPage 的宿主组件；返回值记入 latest，供测试走与页面按钮相同的 interpret 入口。 */
let latest: UseInsightAiPageReturn | null = null

function harness(opts: { collect: () => InsightAiEvidenceBlock[]; signature?: () => string }): Component {
  return defineComponent({
    name: 'AiHarness',
    setup() {
      latest = useInsightAiPage({ pageId: 'overview', label: '云南市场总览', collect: opts.collect, currentSignature: opts.signature })
      return () => h('div', 'harness')
    },
  })
}

async function mountHarness(opts: { collect: () => InsightAiEvidenceBlock[]; signature?: () => string }) {
  const router = await makeRouter()
  const wrapper = mount(harness(opts), { global: { plugins: [router] } })
  await nextTick()
  return { wrapper, router }
}

/** interpret 入口（与页面按钮 onAiInterpret 同一路径）。 */
async function interpret(): Promise<boolean> {
  if (!latest) throw new Error('harness 未注册')
  return latest.interpret()
}

function blockFrom(result: ReturnType<typeof insightResult> | null, queriedKey: string, currentKey = queriedKey): InsightAiEvidenceBlock | null {
  return insightAiBlockOf({
    blockId: 'series',
    title: '时段走势',
    analysisId: 'prices.user-series',
    view: 'series',
    currentKey,
    queriedKey,
    result,
  })
}

const readyCollect = () => [blockFrom(insightResult(), 'k1')!] as InsightAiEvidenceBlock[]

// ── insightAiBlockOf：签名纪律与摘要形状 ─────────────────────────────────────────────────

describe('insightAiBlockOf · 取材纪律', () => {
  it('当前签名一致的结果产出区块：证据带结果版本/读取版本集/窗口，runtime 六维原样回标', () => {
    const block = blockFrom(insightResult(), 'k1')
    expect(block).not.toBeNull()
    expect(block!.blockId).toBe('series')
    expect(block!.title).toBe('时段走势')
    expect(block!.sourceRefs).toEqual(['yn.price.node.public.day-ahead'])
    expect(block!.runtime).toEqual({
      access: 'granted',
      availability: { state: 'complete' },
      freshness: { state: 'fresh' },
    })
    const resultEvidence = block!.evidence!.find((item) => item.id === 'series.result')
    expect(resultEvidence?.text).toContain(RESULT_VERSION)
    expect(resultEvidence?.text).toContain(READ_SET_REF)
    expect(resultEvidence?.text).toContain('2026-09-10~2026-09-10')
  })

  it('过期区块（签名不一致）返回 null：切页/切公司/keep-alive 后的旧资料绝不进上下文', () => {
    expect(blockFrom(insightResult(), 'old-key', 'current-key')).toBeNull()
  })

  it('无结果区块返回 null', () => {
    expect(blockFrom(null, 'k1')).toBeNull()
  })

  it('无权（denied）区块返回 null：整块退出，不泄露私有资料存在性', () => {
    const denied = insightResult({
      runtime: { access: 'denied', availability: { state: 'empty', reason: 'not-enabled' }, freshness: { state: 'unknown' }, comparability: { status: 'compatible', reasons: [] } },
    })
    expect(blockFrom(denied, 'k1')).toBeNull()
  })

  it('payload 只有摘要与版本引用：无 rows/data 痕迹，体积不随原始行数增长', () => {
    const small = JSON.stringify(blockFrom(insightResult(), 'k1'))
    const big = JSON.stringify(blockFrom(resultWithManyRows(), 'k1'))
    expect(small).not.toMatch(/"rows"/)
    expect(big).not.toMatch(/"rows"/)
    expect(small).not.toMatch(/"data"/)
    // 300 行 vs 0 行：payload 体积几乎不变（只有序列目录一条身份摘要，无数值）
    expect(big.length).toBeLessThan(small.length + 400)
  })
})

// ── 注册生命周期与 interpret 流程 ─────────────────────────────────────────────────────────

describe('useInsightAiPage · 注册与 interpret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.offline = false
    state.assembleCalls = []
    state.assembleImpl = null
    state.assembleCallsLimit = Infinity
    resetAiSidebarForTest()
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
    selectedRegionId.value = 'yunnan'
    selectedCompanyId.value = 'dljy-demo'
  })

  it('注册声明：挂载即生效（label/promptKey/解读问题带四段结构）；卸载只清自己', async () => {
    const { wrapper } = await mountHarness({ collect: readyCollect })
    expect(activeAiPage().value?.label).toBe('云南市场总览')
    expect(activeAiPage().value?.promptKey).toBe(PAGE_PROMPT_KEYS.marketDataAnalysis)
    const plan = resolveInterpret(activeAiPage().value!)
    expect(plan?.question).toContain('事实→可能因素→已明确相关对象→待核实项')
    expect(plan?.context).not.toBeNull()
    wrapper.unmount()
    expect(activeAiPage().value).toBeNull()
  })

  it('KeepAlive：失活后声明让位、激活恢复——注册始终跟随用户眼前的页面', async () => {
    const router = await makeRouter()
    const current = ref<'A' | 'B'>('A')
    const pageA = harness({ collect: readyCollect })
    const pageB = defineComponent({ name: 'OtherPage', setup: () => () => h('div', 'other') })
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, [h(current.value === 'A' ? pageA : pageB, { key: current.value })]),
      }),
      { global: { plugins: [router] } }
    )
    await nextTick()
    expect(activeAiPage().value?.label).toBe('云南市场总览')
    current.value = 'B'
    await nextTick()
    expect(activeAiPage().value).toBeNull()
    current.value = 'A'
    await nextTick()
    expect(activeAiPage().value?.label).toBe('云南市场总览')
    wrapper.unmount()
    expect(activeAiPage().value).toBeNull()
  })

  it('悬浮球路径的 interpret context：有就绪结果给协议切片、无结果给 null（不自动发问）', () => {
    const plan = resolveInterpret({
      label: '云南市场总览',
      promptKey: PAGE_PROMPT_KEYS.marketDataAnalysis,
      interpret: { context: () => null, question: insightInterpretQuestion('云南市场总览') },
    })
    expect(plan?.context?.()).toBeNull()
  })

  it('无已就绪区块：只诚实提示、不派发', async () => {
    const ai = useAiSidebar()
    await mountHarness({ collect: () => [] })
    await expect(interpret()).resolves.toBe(false)
    expect(ai.state.request).toBeNull()
    expect(ElMessage.info).toHaveBeenCalled()
    expect(state.assembleCalls).toHaveLength(0)
  })

  it('模型离线：诚实提示、不派发、不发 /assemble（AI 入口降级不关数据页）', async () => {
    state.offline = true
    const ai = useAiSidebar()
    await mountHarness({ collect: readyCollect })
    expect(latest?.aiAvailable.value).toBe(false)
    await expect(interpret()).resolves.toBe(false)
    expect(ai.state.request).toBeNull()
    expect(ElMessage.warning).toHaveBeenCalled()
    expect(state.assembleCalls).toHaveLength(0)
  })

  it('解读成功：先 /assemble（携带 page_context 与 slice.blocks），派发问题带四段、上下文同时带证据正文与约束信封', async () => {
    const ai = useAiSidebar()
    await mountHarness({ collect: readyCollect, signature: () => 'sig-1' })
    await expect(interpret()).resolves.toBe(true)
    expect(state.assembleCalls).toHaveLength(1)
    const message = state.assembleCalls[0] as { page_context: Record<string, unknown>; slice: { blocks: InsightAiEvidenceBlock[] } }
    expect(message.page_context).toMatchObject({ page_label: '云南市场总览', region: { id: 'yunnan' }, company: { id: 'dljy-demo' } })
    expect(message.slice.blocks).toHaveLength(1)
    expect(message.slice.blocks[0].blockId).toBe('series')
    expect(ai.state.request).not.toBeNull()
    expect(ai.state.request!.promptKey).toBe(PAGE_PROMPT_KEYS.marketDataAnalysis)
    expect(ai.state.request!.label).toBe('云南市场总览')
    expect(ai.state.request!.question).toContain('事实→可能因素→已明确相关对象→待核实项')
    const slice = takeSliceFor(ai.state.request!.question) as {
      blocks: InsightAiEvidenceBlock[]
      insight_ai_context: { schemaVersion: string; tools: unknown[]; output_contract: { segments: string[] } }
    } | null
    expect(slice).not.toBeNull()
    expect(slice!.blocks).toHaveLength(1)
    expect(slice!.insight_ai_context.schemaVersion).toBe('insight-ai-context/v1')
    expect(slice!.insight_ai_context.tools).toEqual([])
    expect(slice!.insight_ai_context.output_contract.segments).toEqual(['facts', 'possible_factors', 'confirmed_objects', 'open_questions'])
  })

  it('/assemble 失败：诚实报错、不派发；两次点击各只尝试一次（无重试风暴）', async () => {
    state.assembleImpl = async () => { throw Object.assign(new Error('资料读取失败，请稍后重试'), { status: 503 }) }
    const ai = useAiSidebar()
    await mountHarness({ collect: readyCollect })
    await expect(interpret()).resolves.toBe(false)
    await expect(interpret()).resolves.toBe(false)
    expect(state.assembleCalls).toHaveLength(2)
    expect(ai.state.request).toBeNull()
    expect(ElMessage.error).toHaveBeenCalledTimes(2)
  })

  it('组装期间签名变化（如切换公司）：作废本次解读，不带旧资料派发', async () => {
    let signature = 'company-A'
    state.assembleImpl = async () => {
      signature = 'company-B' // 往返期间公司切换
      return defaultEnvelope()
    }
    const ai = useAiSidebar()
    await mountHarness({ collect: readyCollect, signature: () => signature })
    await expect(interpret()).resolves.toBe(false)
    expect(ai.state.request).toBeNull()
    expect(ElMessage.info).toHaveBeenCalled()
  })

  it('组装期间页面失活（keep-alive 切走）：作废本次解读', async () => {
    const ai = useAiSidebar()
    const router = await makeRouter()
    const current = ref<'A' | 'B'>('A')
    const pageA = harness({ collect: readyCollect, signature: () => 's' })
    const pageB = defineComponent({ name: 'OtherPage', setup: () => () => h('div', 'other') })
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, [h(current.value === 'A' ? pageA : pageB, { key: current.value })]),
      }),
      { global: { plugins: [router] } }
    )
    await nextTick()
    state.assembleImpl = () => new Promise((resolve) => setTimeout(() => resolve(defaultEnvelope()), 5))
    const pending = interpret()
    current.value = 'B' // 组装未返回时切走：失活钩子置 pageActive=false
    await nextTick()
    await pending
    expect(ai.state.request).toBeNull()
    wrapper.unmount()
  })
})
