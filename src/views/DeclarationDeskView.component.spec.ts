// 申报工作台风控检查的敞口口径（ChenShi-Tech/dljy#3475，套保 HA-02/HA-05）。
// 守什么：① 页面不再有「当月中长期合约总量」手填框，风控请求体不带任何手填敞口总量；
//        ② 风控结果处展示服务端给出的约束来源（套保服务、目标日）与未知时段说明，原样展示、不在前端重算。
// 坏掉的症状：风控又拿手填 20000 MWh 去算敞口（约束与套保结果脱节）；或页面自己拼覆盖数字，与服务端口径漂移。
// 只桩住 HTTP 层与外部服务：申报单客户端（请求体构造）用真实实现，断言落在真正发出去的请求体上。
import { flushPromises, mount, enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    apiGet: (...args: unknown[]) => http.get(...args),
    apiPost: (...args: unknown[]) => http.post(...args),
    apiPut: (...args: unknown[]) => http.put(...args),
  }
})

const fetchOverview = vi.hoisted(() => vi.fn())
vi.mock('@/services/hedge/hedgeApi', () => ({
  fetchOverview: (...args: unknown[]) => fetchOverview(...args),
}))

vi.mock('@/services/agent/agentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/agent/agentClient')>()
  return { ...actual, probeAgentService: vi.fn(async () => 'online') }
})

vi.mock('@/services/forecast/mlForecastClient', () => ({
  fetchCockpit: vi.fn(async () => null),
  fetchOptimizeBid: vi.fn(async () => null),
}))

vi.mock('@/services/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/auth')>()
  return { ...actual, getCurrentUser: () => ({ username: 'gen-trader', roleCode: 'TRADER', subjectType: 'GENERATOR' }) }
})

vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/region/regionContext')>()
  return { ...actual, currentRegion: { get value() { return { id: 'yunnan', name: '云南' } } } }
})

const routeState = vi.hoisted(() => ({ query: {} as Record<string, unknown>, path: '/xhjy/declaration', fullPath: '/xhjy/declaration' }))
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => routeState,
    useRouter: () => ({ push: vi.fn(async () => undefined), replace: vi.fn(async () => undefined) }),
  }
})

vi.mock('../composables/useEChart', () => ({
  useEChart: () => ({ setOption: vi.fn(), instance: () => null, resize: vi.fn(), loading: { value: false } }),
}))

import DeclarationDeskView from './DeclarationDeskView.vue'
import { fetchCockpit } from '@/services/forecast/mlForecastClient'

enableAutoUnmount(afterEach)

const TARGET_DATE = '2026-10-01'
const EXPOSURE_NOTE = '约束来源：套保服务（仅中长期口径，目标日 2026-10-01，生成于 2026-09-29T02:00:00.000Z）；已知 20/24 个时段，其余 4 个时段敞口未知（锁价分时未知 4），未施加约束'
const EXPOSURE_DETAIL = '已知 20/24 个时段：申报量 800 MWh / 仅中长期售出敞口 800 MWh（容忍 +10%）；其余 4 个时段敞口未知（锁价分时未知 4），这些时段的申报量 160 MWh 未施加约束'

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DECL-20261001-abc',
    targetDate: TARGET_DATE,
    deadline: '2026-09-30T02:30:00.000Z',
    status: 'DRAFT',
    mode: 'LIVE',
    companyId: 'c1',
    region: 'yunnan',
    subjectId: 'gen-trader',
    subjectType: 'GENERATOR',
    capacityMw: 100,
    energyCurveMwh96: Array.from({ length: 96 }, () => 10),
    priceCurve96: null,
    strategySource: 'manual',
    basis: 'captured',
    quoteRationale: '中长期均价 232',
    riskCheck: null,
    approvalRecord: [],
    audit: [],
    ...overrides,
  }
}

function checkedDeclaration() {
  return draft({
    status: 'RISK_CHECKED',
    riskCheck: {
      passed: false,
      blocked: false,
      gateLevel: 'L3',
      totalMwh: 960,
      maxMw: 40,
      evaluatedAt: '2026-09-29T02:00:01.000Z',
      checks: [
        { checkId: 'capacity', name: '功率约束', status: 'PASS', severity: 'hard', detail: '申报最大功率 40 MW / 可用容量 100 MW' },
        { checkId: 'exposure', name: '中长期敞口', status: 'PASS', severity: 'overridable', detail: EXPOSURE_DETAIL },
      ],
      inputs: {
        exposure: {
          available: true, source: 'hedge-service', basis: 'MIDLONG_ONLY', manual: false,
          knownIntervals: 20, unknownIntervals: 4, totalIntervals: 24, note: EXPOSURE_NOTE,
          constraintSource: { label: '套保服务', targetDate: TARGET_DATE, generatedAt: '2026-09-29T02:00:00.000Z', basis: 'MIDLONG_ONLY' },
        },
      },
    },
  })
}

beforeEach(() => {
  routeState.query = { targetDate: TARGET_DATE }
  http.get.mockReset()
  http.post.mockReset()
  http.put.mockReset()
  fetchOverview.mockReset()
  http.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/meta')) {
      return { data: { targetDate: TARGET_DATE, deadline: '2026-09-30T02:30:00.000Z', deadlineHHmm: '10:30', now: '2026-09-29T02:00:00.000Z', msRemaining: 3_600_000, expired: false } }
    }
    if (url.endsWith('/declarations')) {
      return { data: { rows: [draft()], total: 1, limit: 500, offset: 0, counts: { LIVE: 1, REHEARSAL: 0 } } }
    }
    return { data: {} }
  })
  http.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/risk-check')) return { data: checkedDeclaration() }
    return { data: {} }
  })
  fetchOverview.mockResolvedValue({
    asOf: '2026-09-29T02:00:00.000Z', view: 'CURRENT', intervals: [], legs: {}, gaps: [],
    ratio: { coverage: { coveredCount: 20, totalCount: 24 }, withMechanism: { value: null, status: 'NOT_COMPUTABLE' }, midlongOnly: { value: '0.6', status: 'OK' } },
  })
})

async function mountDesk() {
  const wrapper = mount(DeclarationDeskView, {
    global: {
      // 与本用例无关的重组件一律占位（DataBasisBadge 的 prefix 属性会撞 DOM 只读属性，不能用默认 stub）
      stubs: Object.fromEntries([
        'AgentChatPanel', 'AgentHistorySidebar', 'DeclarationForecastCompare', 'RegionDataBanner',
        'CapabilitySupportBadge', 'DataBasisBadge', 'TrustBadge',
      ].map((name) => [name, { template: '<span />' }])),
    },
  })
  await flushPromises()
  return wrapper
}

function runRiskButton(wrapper: Awaited<ReturnType<typeof mountDesk>>) {
  const button = wrapper.findAll('button').find((b) => b.text().includes('运行风控检查'))
  if (!button) throw new Error('未找到「运行风控检查」按钮（草稿未载入？）')
  return button
}

describe('申报台风控检查：敞口约束来自套保服务（#3475）', () => {
  it('没有手填合同总量框；风控请求体不带手填总量', async () => {
    const wrapper = await mountDesk()
    expect(wrapper.text()).not.toContain('当月中长期合约总量')
    expect(wrapper.find('.risk-block input[type="number"]').exists()).toBe(false)

    await runRiskButton(wrapper).trigger('click')
    await flushPromises()

    const riskCalls = http.post.mock.calls.filter(([url]) => String(url).endsWith('/risk-check'))
    expect(riskCalls).toHaveLength(1)
    const [url, body] = riskCalls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/v1/trading/spot/declarations/DECL-20261001-abc/risk-check')
    expect(body).not.toHaveProperty('exposureTotalMwh')
    expect(body).not.toHaveProperty('exposure')
    expect(JSON.stringify(body)).not.toContain('20000')
  })

  it('风控结果处原样展示服务端的约束来源（套保服务、目标日）与未知时段说明', async () => {
    const wrapper = await mountDesk()
    expect(wrapper.find('[data-testid="risk-exposure-source"]').exists()).toBe(false)

    await runRiskButton(wrapper).trigger('click')
    await flushPromises()

    const source = wrapper.get('[data-testid="risk-exposure-source"]')
    expect(source.text()).toBe(`中长期敞口约束 · ${EXPOSURE_NOTE}`)
    expect(source.classes()).not.toContain('manual')
    const exposureItem = wrapper.findAll('.check-list li').find((li) => li.text().includes('中长期敞口'))
    expect(exposureItem?.text()).toContain(EXPOSURE_DETAIL)
  })

  it('预览区不再出现「人工」手填覆盖文案，敞口预览仍按目标日读套保（仅中长期）', async () => {
    const wrapper = await mountDesk()
    const hint = wrapper.get('.exposure-hint').text()
    // slim-spot-page-explainers：敞口说明压一行（已知 N/M 时段），约束口径收 ⓘ（text 含 tooltip 全文）
    expect(hint).toContain('已联动套保工作台')
    expect(hint).toContain('20/24')
    expect(hint).toContain('未知时段不施加约束')
    expect(hint).not.toContain('人工')
    expect(fetchOverview).toHaveBeenCalledWith(expect.objectContaining({ fromDate: TARGET_DATE, toDate: TARGET_DATE, scope: 'company' }))
  })
})

// dljy#3647：决策模型初值不再写死任何算法名（原先是 'xgboost'，下线后会变成必 400 的决策入口）。
// 守什么：对比区回吐前 decisionModel 为空且不能生成决策包；回吐什么模型，决策包就用什么模型。
describe('申报台决策模型不写死算法（#3647）', () => {
  const CompareProbe = {
    name: 'DeclarationForecastCompare',
    props: ['decisionModel', 'targetDate'],
    emits: ['update:decisionModel', 'batch-ready', 'summary', 'suggest-date', 'suggest-rehearsal'],
    template: '<span class="compare-probe" />',
  }
  async function mountWithProbe() {
    const wrapper = mount(DeclarationDeskView, {
      global: {
        stubs: {
          ...Object.fromEntries([
            'AgentChatPanel', 'AgentHistorySidebar', 'RegionDataBanner', 'CapabilitySupportBadge', 'DataBasisBadge', 'TrustBadge',
          ].map((name) => [name, { template: '<span />' }])),
          DeclarationForecastCompare: CompareProbe,
        },
      },
    })
    await flushPromises()
    return wrapper
  }
  const generateButton = (wrapper: Awaited<ReturnType<typeof mountWithProbe>>) => {
    const button = wrapper.findAll('button').find((b) => b.text() === '生成')
    if (!button) throw new Error('未找到「生成」决策包按钮')
    return button
  }

  it('对比区还没回吐模型时决策模型为空，生成按钮禁用，不发决策包请求', async () => {
    vi.mocked(fetchCockpit).mockClear()
    const wrapper = await mountWithProbe()
    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    expect(probe.props('decisionModel')).toBe('')
    probe.vm.$emit('batch-ready', true)          // 批次就绪但没有可作决策依据的模型
    await flushPromises()
    expect(generateButton(wrapper).attributes('disabled')).toBeDefined()
    await generateButton(wrapper).trigger('click')
    expect(fetchCockpit).not.toHaveBeenCalled()
  })

  it('对比区回吐的模型就是决策包实际使用的 model_type', async () => {
    vi.mocked(fetchCockpit).mockClear()
    const wrapper = await mountWithProbe()
    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    probe.vm.$emit('update:decisionModel', 'random_forest')
    probe.vm.$emit('batch-ready', true)
    await flushPromises()
    expect(probe.props('decisionModel')).toBe('random_forest')
    await generateButton(wrapper).trigger('click')
    await flushPromises()
    expect(fetchCockpit).toHaveBeenCalledWith(expect.objectContaining({ model_type: 'random_forest', target: 'price' }))
  })
})

describe('申报台价格预测摘要空占位（fix-spot-degradation-honesty）', () => {
  // 无可用预测（summary=null）时均价/价差显示「—」：缺失值不得渲染成真实数字 0——
  // 现货市场 0 元是合法价（负电价日常态），「均价 0」会被读成真实预测。
  const CompareProbe = {
    name: 'DeclarationForecastCompare',
    props: ['decisionModel', 'targetDate'],
    emits: ['update:decisionModel', 'batch-ready', 'summary', 'suggest-date', 'suggest-rehearsal'],
    template: '<span class="compare-probe" />',
  }
  async function mountWithProbe() {
    const wrapper = mount(DeclarationDeskView, {
      global: {
        stubs: {
          ...Object.fromEntries([
            'AgentChatPanel', 'AgentHistorySidebar', 'RegionDataBanner', 'CapabilitySupportBadge', 'DataBasisBadge', 'TrustBadge',
          ].map((name) => [name, { template: '<span />' }])),
          DeclarationForecastCompare: CompareProbe,
        },
      },
    })
    await flushPromises()
    return wrapper
  }
  const chips = (wrapper: Awaited<ReturnType<typeof mountWithProbe>>) => {
    const el = wrapper.find('.stat-chips')
    if (!el.exists()) throw new Error('未找到价格预测摘要区')
    return el.text()
  }

  it('无可用预测（summary=null）：均价/价差显示「—」，不出现 0', async () => {
    const wrapper = await mountWithProbe()
    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    probe.vm.$emit('summary', null)
    await flushPromises()
    const text = chips(wrapper)
    expect(text).toContain('均价 —')
    expect(text).toContain('价差 —')
    expect(text).not.toContain('均价 0')
    expect(text).not.toContain('价差 0')
    wrapper.unmount()
  })

  it('有预测统计（含真实 0 值）：照常显示数字，0 不被「—」吞掉', async () => {
    const wrapper = await mountWithProbe()
    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    probe.vm.$emit('summary', { basis: 'captured', stats: { mean: 0, spread: -12 } })
    await flushPromises()
    const text = chips(wrapper)
    expect(text).toContain('均价 0')
    expect(text).toContain('价差 -12')
    expect(text).not.toContain('—')
    wrapper.unmount()
  })
})

// slim-spot-page-explainers：申报台常驻说明清场（spec spot-page-hint-density
// 「申报工作台常驻说明清场」）。守什么：迁移公告与未实现功能 TODO 不再常驻渲染；
// 教学句收 ⓘ；窗口关闭提示压一行；智能体工作区入口不受公告下线影响。
describe('申报台常驻说明清场（slim-spot-page-explainers）', () => {
  it('迁移公告与「导入预测曲线」TODO 文案不渲染', async () => {
    const wrapper = await mountDesk()
    expect(wrapper.text()).not.toContain('已移至页面底部')
    expect(wrapper.text()).not.toContain('「智能体工作区」')
    expect(wrapper.text()).not.toContain('还没做')
    // 智能体工作区本体入口仍在（折叠头）
    expect(wrapper.text()).toContain('智能体工作区')
  })

  it('窗口已过提示压一行：保留事实与去处，不再有成段解释', async () => {
    // 无单态才渲染创建表单（提示在表单内）；目标日 2026-10-01 早于本机今日 → warn 态
    http.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/meta')) {
        return { data: { targetDate: TARGET_DATE, deadline: '2026-09-30T02:30:00.000Z', deadlineHHmm: '10:30', now: '2026-09-29T02:00:00.000Z', msRemaining: 3_600_000, expired: false } }
      }
      if (url.endsWith('/declarations')) {
        return { data: { rows: [], total: 0, limit: 500, offset: 0, counts: { LIVE: 0, REHEARSAL: 0 } } }
      }
      return { data: {} }
    })
    const wrapper = await mountDesk()
    // 目标日已过 → 表单预选 REHEARSAL（draftMode watcher），显示的是历史模拟提示的一行形态
    const hint = wrapper.find('.rehearsal-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('不受截止约束')
    expect(hint.text()).toContain('Mock 网关')
    expect(hint.text()).toContain('非真实申报')
    // 完整口径（可自批走完整流程等）收 ⓘ
    const info = hint.findComponent({ name: 'InfoHint' })
    expect(info.exists()).toBe(true)
    expect(info.props('text')).toContain('可自批走完整流程')
  })

  it('无单态：创建教学句收 ⓘ，常驻段落不再出现', async () => {
    http.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/meta')) {
        return { data: { targetDate: TARGET_DATE, deadline: '2026-09-30T02:30:00.000Z', deadlineHHmm: '10:30', now: '2026-09-29T02:00:00.000Z', msRemaining: 3_600_000, expired: false } }
      }
      if (url.endsWith('/declarations')) {
        return { data: { rows: [], total: 0, limit: 500, offset: 0, counts: { LIVE: 0, REHEARSAL: 0 } } }
      }
      return { data: {} }
    })
    const wrapper = await mountDesk()
    const launchRow = wrapper.find('.launch-row')
    expect(launchRow.exists()).toBe(true)
    const hint = launchRow.findComponent({ name: 'InfoHint' })
    expect(hint.exists()).toBe(true)
    // 教学句全文收进 ⓘ（text() 会带出 tooltip 全文，故断言 props 而非常驻段落形态）
    expect(hint.props('text')).toContain('再走风控检查 → 审批 → 截止前提交')
    expect(wrapper.findAll('p.muted').some((p) => p.text().includes('再走风控检查'))).toBe(false)
  })
})

// ── 报价优化竞态含模型维度（dljy#3731 遗留缺陷③ · yunnan-launch-readiness
// stale-response-guards delta「世代号含模型维度」）──
// 守什么：optimize 在途时切决策模型，旧模型的迟到结果不落屏、错误不上屏、
//        loading 不悬挂；不切模型时结果照常采纳。
// 坏掉的症状：旧模型的 frontier 曲线被当成新模型结论展示，报价水位判断输入被换。
describe('申报台报价优化竞态含模型维度（缺陷③）', () => {
  const CompareProbe = {
    name: 'DeclarationForecastCompare',
    props: ['decisionModel', 'targetDate'],
    emits: ['update:decisionModel', 'batch-ready', 'summary', 'suggest-date', 'suggest-rehearsal'],
    template: '<span class="compare-probe" />',
  }
  async function mountWithProbe() {
    const wrapper = mount(DeclarationDeskView, {
      global: {
        stubs: {
          ...Object.fromEntries([
            'AgentChatPanel', 'AgentHistorySidebar', 'RegionDataBanner', 'CapabilitySupportBadge', 'DataBasisBadge', 'TrustBadge',
          ].map((name) => [name, { template: '<span />' }])),
          DeclarationForecastCompare: CompareProbe,
        },
      },
    })
    await flushPromises()
    return wrapper
  }
  const cockpitFixture = () => ({
    basis: 'captured',
    price_forecast: {
      points: [210, 220, 230, 240],
      lower: [200, 210, 220, 230],
      upper: [220, 230, 240, 250],
      unit: '元/MWh',
      basis: 'captured',
      source_type: 'db',
      mock: false,
    },
    bid_advice: { subject_type: 'generator', retailer: null, storage: null, generator: { total_declared_mwh: 960 } },
    deviation_risk: { expected_penalty_yuan: 0, worst_penalty_yuan: 0, high_risk_slots: 0, source_type: 'db', mock: false },
    midterm_trend: { daily_avg_price: [210, 215], horizon_days: 2, source_type: 'db', mock: false },
  })
  const optimizeFixture = () => ({
    source_type: 'db',
    mock: false,
    optimize_bid: {
      solver: 'cvar',
      note: 'fixture',
      frontier: [
        { lambda: 0, risk_level: 'aggressive', bid_mw: 80, expected_profit_yuan: 1000 },
        { lambda: 3, risk_level: 'conservative', bid_mw: 60, expected_profit_yuan: 800 },
      ],
    },
    forecast: { basis: 'captured', points: [1, 2], lower: [1, 2], upper: [1, 2], unit: '' },
  })

  async function prepare(wrapper: Awaited<ReturnType<typeof mountWithProbe>>) {
    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    probe.vm.$emit('update:decisionModel', 'model_a')
    probe.vm.$emit('batch-ready', true)
    await flushPromises()
    const generate = wrapper.findAll('button').find((b) => b.text() === '生成')
    await generate!.trigger('click')
    await flushPromises()
  }

  it('不切模型：结果照常采纳（frontier 列表出现）', async () => {
    vi.mocked(fetchCockpit).mockResolvedValueOnce(cockpitFixture() as never)
    const optimize = vi.mocked(await import('@/services/forecast/mlForecastClient')).fetchOptimizeBid
    optimize.mockResolvedValueOnce(optimizeFixture() as never)
    const wrapper = await mountWithProbe()
    await prepare(wrapper)

    const btn = wrapper.findAll('button').find((b) => b.text().includes('一键生成最优申报曲线'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.frontier-list').exists()).toBe(true)
  })

  it('在途切模型：旧模型迟到结果不落屏、按钮锁不悬挂', async () => {
    vi.mocked(fetchCockpit).mockResolvedValueOnce(cockpitFixture() as never)
    const optimize = vi.mocked(await import('@/services/forecast/mlForecastClient')).fetchOptimizeBid
    let resolveOptimize!: (v: unknown) => void
    optimize.mockImplementationOnce(() => new Promise((res) => { resolveOptimize = res as unknown as (v: unknown) => void }))
    const wrapper = await mountWithProbe()
    await prepare(wrapper)

    const btn = wrapper.findAll('button').find((b) => b.text().includes('一键生成最优申报曲线'))
    await btn!.trigger('click')
    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    probe.vm.$emit('update:decisionModel', 'model_b')
    await flushPromises()
    resolveOptimize(optimizeFixture())
    await flushPromises()

    expect(wrapper.find('.frontier-list').exists()).toBe(false)
    // 模型切换的 resetDecisionPackage 已接手解锁：不因旧请求 finally 按世代跳过而悬挂
    expect((wrapper.vm as unknown as Record<string, unknown>).optimizeLoading ?? true).not.toBe(true)
  })
})

// ── 情报清单随上下文重置（dljy#3731 遗留缺陷④ · stale-response-guards delta
// 「情报清单跨面板缓存隔离」）──
// 守什么：情报清单三态（竞价空间/检修披露/持仓敞口）是按目标日算的结论，切标的日后
//        旧结论必须清回 idle，不得顶着旧日的 done/failed 充当新日报价依据。
// 坏掉的症状：换了目标日，清单还显示「已核查」，报价水位判断用了旧日结论。
describe('申报台情报清单随标的日重置（缺陷④）', () => {
  const CompareProbe = {
    name: 'DeclarationForecastCompare',
    props: ['decisionModel', 'targetDate'],
    emits: ['update:decisionModel', 'batch-ready', 'summary', 'suggest-date', 'suggest-rehearsal'],
    template: '<span class="compare-probe" />',
  }
  async function mountWithProbe() {
    const wrapper = mount(DeclarationDeskView, {
      global: {
        stubs: {
          ...Object.fromEntries([
            'AgentChatPanel', 'AgentHistorySidebar', 'RegionDataBanner', 'CapabilitySupportBadge', 'DataBasisBadge', 'TrustBadge',
          ].map((name) => [name, { template: '<span />' }])),
          DeclarationForecastCompare: CompareProbe,
        },
      },
    })
    await flushPromises()
    return wrapper
  }

  it('切标的日后清单三态清回 idle，不残留旧日结论', async () => {
    const wrapper = await mountWithProbe()
    const setup = (wrapper.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState as {
      intelChecklist: Array<{ status: string }>
    }
    setup.intelChecklist[0].status = 'done'
    setup.intelChecklist[1].status = 'failed'
    await flushPromises()
    expect(wrapper.findAll('.check-item.done').length).toBe(1)

    const probe = wrapper.getComponent({ name: 'DeclarationForecastCompare' })
    probe.vm.$emit('suggest-date', '2026-10-02')
    await flushPromises()

    expect(setup.intelChecklist.every((item) => item.status === 'idle')).toBe(true)
    expect(wrapper.findAll('.check-item.done').length).toBe(0)
    expect(wrapper.findAll('.check-item.failed').length).toBe(0)
  })
})
