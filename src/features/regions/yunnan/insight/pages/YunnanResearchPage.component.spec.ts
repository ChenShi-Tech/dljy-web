// YunnanResearchPage.component.spec.ts — 云南研究工作台页回归（dljy#3080 任务 13.5/13.6）
// 守什么不变量（对照 specs insight-research-workbench RS01—RS07 与 design D6）：
//   ① 预设是唯一入口：名称/问题/缺口原因原文可见；未登记地区无预设且不发任何请求；
//   ② 输入资格不足的预设可见但不可运行（能力目录缺分析/读取失败都标「输入不足」）；
//   ③ 运行请求形状固定：presetId + context（mode/asOf 住在 context）+ filters + transformations，
//     滞后/窗口/阈值/目标日全部显式给出；
//   ④ 事前模式必须显式给截止时点，四类事前拒绝按后端原因原文展示；事后带「事后对照」标注；
//   ⑤ 受控自定义没有自由文本输入面：指标下拉只列预设登记项；
//   ⑥ 切换任意参数旧结果立即失效（清空展示、不自动重跑）；
//   ⑦ 超限前置拦截按上限提示，后端拒绝按原因原文展示——不截断冒充完整；
//   ⑧ 合法大值（>14000）原样渲染，不裁剪；
//   ⑨ 样本说明（n/覆盖率/最低条件/方法版本）与方法口径原文（无置信区间、无因果）透出；
//   ⑩ 同类日候选表带逐特征贡献、排除候选原因与不足原因原文；
//   ⑪ 保存分析（任务 14.4）：只提交定义与期望版本；409 提示先重跑不保存；无写权限入口不渲染
//     而预览与已保存查看保留；幂等键按内容派生；未成功绝不提示已保存；
//   ⑫ 界面只出现业务语言，不出现预设标识/来源标识/模式枚举原文。
// mock 边界：researchClient/insightClient 打桩（保留类型与错误类）；useInsightContext 用真
// composable（真 router + 全局地区/公司 ref）；shared/insight 契约镜像用真模块（指标/精度取登记）。
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElDatePicker } from 'element-plus'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fetchInsightCapabilities, InsightRequestError } from '@/services/insight/insightClient'
import { runResearchPreview, saveResearchDefinition } from '@/services/insight/researchClient'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { mount as appMount } from '@/test/mount'
import { activeAiPage, resolveInterpret } from '@/features/aiSidebar/pageRegistry'
import YunnanResearchPage from './YunnanResearchPage.vue'

const HEX64 = 'a'.repeat(64)

// ── 可控 mock 状态（vi.hoisted：vi.mock 工厂提升后仍可引用）────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  /** research/preview 应答器：默认成功返回 state.result；可替换为拒绝。 */
  responder: null as ((request: any) => Promise<any>) | null,
  result: null as unknown,
  /** 研究定义保存应答器（任务 14.4）：默认成功返回 state.saveDetail；可替换为拒绝。 */
  saveResponder: null as ((request: any) => Promise<any>) | null,
  saveDetail: null as unknown,
  /** 公司写权限显隐（governance.hasCompanyAdmin 打桩）。 */
  canWrite: true,
}))

vi.mock('@/composables/useAgentHealth', () => ({
  // 页面 AI 入口的探活打桩：不发起真实网络连接；AI 入口可见性按在线处理。
  useAgentHealth: () => ({ health: { value: 'online' }, ready: { value: true }, offline: { value: false }, check: async () => {} }),
}))

vi.mock('@/services/insight/insightClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    fetchInsightCapabilities: vi.fn(() => Promise.resolve(state.capabilities)),
  }
})

vi.mock('@/services/insight/researchClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    runResearchPreview: vi.fn((request: any) => state.responder!(request)),
    saveResearchDefinition: vi.fn((request: any) => state.saveResponder!(request)),
  }
})

vi.mock('@/services/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCurrentUser: vi.fn(() => ({ userId: 'u-admin', roleCode: 'company-admin' })),
  }
})

vi.mock('@/services/governance', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    hasCompanyAdmin: vi.fn(() => state.canWrite),
  }
})

// ── 能力目录夹具（云南研究预设需要的两个公开分析）────────────────────────────────────────

const PRICE_SERIES = 'prices.user-series'
const SUPPLY_SERIES = 'supply.system-series'

function caps(analysisIds: string[]): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: analysisIds.map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['research'],
      access: 'public',
      sourceIds: [],
      limits: { maxDays: 366, maxObjects: 0, requiresObjects: false },
    })),
    sources: [
      { sourceId: 'yn.price.user.day-ahead', title: '云南用户侧日前价格', accessScope: 'public', measureKind: 'price', fields: [], nativeResolutionMinutes: 60, priceObject: null, marketPhase: 'day-ahead', variant: null, freshness: 'historical-package', objectDimension: null, note: null },
      { sourceId: 'yn.system.new-energy.actual', title: '云南新能源出力（实际）', accessScope: 'public', measureKind: 'power', fields: [], nativeResolutionMinutes: 60, priceObject: null, marketPhase: null, variant: null, freshness: 'historical-package', objectDimension: null, note: null },
    ],
    endpoints: {},
    mock: false,
    productionWrite: false,
  }
}

// ── 研究结果夹具（形状对照 dljy 仓 insight-research.mjs 的 runResearchPreview）───────────

function baseResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'insight-research/v1',
    queryId: 'q1',
    presetId: 'research.price-new-energy-correlation',
    presetVersion: '1',
    methodVersion: 'research-kernel/1',
    regionId: 'yunnan',
    businessWindow: { start: '2026-09-01', end: '2026-09-10', timeZone: 'Asia/Shanghai', days: 10 },
    mode: 'ex-post',
    asOf: null,
    mock: false,
    productionWrite: false,
    generatedAt: '2026-09-19T10:00:00+08:00',
    sourceRefs: [
      { sourceId: 'yn.price.user.day-ahead', accessScope: 'public', versionToken: 'v1' },
      { sourceId: 'yn.system.new-energy.actual', accessScope: 'public', versionToken: 'v1' },
    ],
    readSetRef: `rs1:${HEX64}`,
    resultVersion: `rv1:${HEX64}`,
    inputs: [
      { id: 'x', label: '用户侧日前价格', sourceIds: ['yn.price.user.day-ahead'], resolutionMinutes: 60, validSlots: 238, expectedSlots: 240, coverageRatio: '0.991666666666' },
      { id: 'y', label: '新能源出力（实际）', sourceIds: ['yn.system.new-energy.actual'], resolutionMinutes: 60, validSlots: 236, expectedSlots: 240, coverageRatio: '0.983333333333' },
    ],
    sample: { conditions: { minSamples: 24, minCoverageRatio: '0.5' }, primarySamples: 236, eligibilityMet: true, observed: 472 },
    method: {
      kind: 'correlation',
      kernel: 'research-kernel/1',
      notes: [
        '用户侧价与新能源实际来自不同披露通道：任一侧缺时段或整日缺数，共同样本就按双方都有效的对齐时段收缩，不补零。',
        '时序样本存在自相关，本内核未做自相关处理，不提供置信区间，只给出相关系数 r 与共同样本数。',
        '缺测不补零：只在双方都有效的对齐时段配对；分组（如选择）分别计算、组间不合并，汇总与分组同时给出。',
      ],
    },
    definitionDraft: { presetId: 'research.price-new-energy-correlation', note: '可保存的研究定义草稿：保存走材料通道，服务端重算核验后冻结。' },
    ...overrides,
  }
}

function correlationResult(): Record<string, unknown> {
  const seriesId = 'correlation:research.price-new-energy-correlation'
  return baseResult({
    data: {
      schemaVersion: 'insight-result-data/v1',
      view: 'correlation',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }, { id: 'group', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { seriesId, metricId: 'research.pearson-r', group: 'all', value: '-0.412335' },
        { seriesId, metricId: 'research.covariance', group: 'all', value: '-118.402' },
        { seriesId, metricId: 'sample.valid-count', group: 'all', value: '236' },
        { seriesId, metricId: 'research.pearson-r', group: '2026-09', value: '-0.402144' },
        { seriesId, metricId: 'research.covariance', group: '2026-09', value: '-110.21' },
        { seriesId, metricId: 'sample.valid-count', group: '2026-09', value: '236' },
      ],
      series: [
        {
          seriesId,
          kind: 'research-correlation',
          x: '用户侧日前价格',
          y: '新能源出力（实际）',
          groupBy: 'month',
          structuralDifference: false,
          coverage: { aValid: 238, bValid: 236, common: 236, expectedSlots: 240 },
          overall: { samples: 236, r: '-0.412335', covariance: '-118.402', coverageRatio: '0.983333333333', window: { start: '2026-09-01', end: '2026-09-10' } },
        },
      ],
    },
  })
}

/** 同类日夹具：目标日特征值里有超过旧散点 14000 固定上限的合法出力值（RS02 场景）。 */
function similarDayResult(opts?: { sufficient?: boolean }): Record<string, unknown> {
  const sufficient = opts?.sufficient ?? false
  return baseResult({
    presetId: 'research.load-similar-day',
    method: {
      kind: 'similar-day',
      kernel: 'research-kernel/1',
      notes: ['候选日缺任一必需特征即整日排除（不补值）；标准化参数只在候选集合内计算，不以相似度承诺价格预测。'],
    },
    inputs: [
      { id: 'feature:load-mean', label: '负荷日均出力', sourceIds: ['yn.system.load.actual'], resolutionMinutes: 60, validSlots: 240, expectedSlots: 240, coverageRatio: '1' },
    ],
    sample: { conditions: { minSamples: 8, minCoverageRatio: '0' }, primarySamples: 3, eligibilityMet: sufficient, observed: 240 },
    data: {
      schemaVersion: 'insight-result-data/v1',
      view: 'similar-day',
      dimensions: [{ id: 'candidateDate', kind: 'date' }, { id: 'metricId', kind: 'category' }, { id: 'featureId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { candidateDate: '2026-09-03', metricId: 'research.similar-day-distance', featureId: 'distance', value: '0.512300' },
        { candidateDate: '2026-09-03', metricId: 'research.feature-contribution', featureId: 'load-mean', value: '0.512300' },
        { candidateDate: '2026-09-07', metricId: 'research.similar-day-distance', featureId: 'distance', value: '0.744100' },
        { candidateDate: '2026-09-07', metricId: 'research.feature-contribution', featureId: 'load-mean', value: '0.744100' },
      ],
      series: [
        {
          seriesId: 'similar:research.load-similar-day',
          kind: 'research-similar-day',
          targetDate: '2026-09-05',
          targetValues: { 'load-mean': '14320.5' },
          sufficient,
          availableCandidates: 3,
          minCandidates: 8,
          excluded: [{ date: '2026-09-02', reason: 'missing-feature:load-mean', detail: '候选日缺必需特征「负荷日均出力」，不自动补值' }],
          features: [{ id: 'load-mean', weight: '1', mean: '11008.25', std: '2044.5', zeroVariance: false, completeCandidates: 3 }],
          candidateWindow: { first: '2026-09-01', last: '2026-09-10' },
          insufficientReason: '满足全部特征的候选日只有 3 个，少于最小候选数 8：不复制日期、不填补特征，请扩大候选窗或减少特征',
          method: { standardization: 'z-score：均值与标准差只在完整候选集合内计算（总体标准差，除以 n）', distance: '加权绝对距离 Σ wᵢ·|z目标,ᵢ − z候选,ᵢ|（权重显式且和为 1）' },
        },
      ],
    },
  })
}

/** 异常窗口夹具：窗口均值含超过 14000 的合法值（RS02 大值不裁剪）。 */
function anomalyResult(): Record<string, unknown> {
  return baseResult({
    presetId: 'research.price-anomaly-window',
    inputs: [{ id: 'series', label: '用户侧实时价格', sourceIds: ['yn.price.user.real-time'], resolutionMinutes: 15, validSlots: 960, expectedSlots: 960, coverageRatio: '1' }],
    sample: { conditions: { minSamples: 2, minCoverageRatio: '0' }, primarySamples: 830, eligibilityMet: true, observed: 960 },
    data: {
      schemaVersion: 'insight-result-data/v1',
      view: 'anomaly-window',
      dimensions: [{ id: 'windowStart', kind: 'time' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { windowStart: '2026-09-03T18:00:00+08:00', metricId: 'research.anomaly-window-mean', value: '14211.25' },
        { windowStart: '2026-09-03T18:15:00+08:00', metricId: 'research.anomaly-window-mean', value: '138.5' },
      ],
      series: [
        {
          seriesId: 'anomaly:research.price-anomaly-window',
          kind: 'research-anomaly-window',
          windowSlots: 4,
          threshold: { kind: 'absolute', value: '120', resolvedValue: '120' },
          scannedWindows: 830,
          anomalousWindows: 2,
        },
      ],
      sampling: { method: '全量窗口扫描，无抽样', population: 830 },
    },
  })
}

const DEFAULT_RESULT = () => correlationResult()

/** 同进度夹具：统计行含三个不同量纲（% / MW / 条数），分面按量纲拆三面。 */
function progressResult(): Record<string, unknown> {
  const seriesId = 'progress:research.load-progress-comparison:2026-09-09'
  return baseResult({
    presetId: 'research.load-progress-comparison',
    businessWindow: { start: '2026-09-09', end: '2026-09-09', timeZone: 'Asia/Shanghai', days: 1 },
    inputs: [
      { id: 'series', label: '统调负荷（实际）', sourceIds: ['yn.system.load.actual'], resolutionMinutes: 60, validSlots: 18, expectedSlots: 24, coverageRatio: '0.75' },
    ],
    sample: { conditions: { minSamples: 4, minCoverageRatio: '0' }, primarySamples: 18, eligibilityMet: true, observed: 18 },
    method: {
      kind: 'progress-comparison',
      kernel: 'research-kernel/1',
      notes: ['同进度比较是描述性观察：前一日同段齐全才比较，不推断日内走势。'],
    },
    data: {
      schemaVersion: 'insight-result-data/v1',
      view: 'progress-comparison',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { seriesId, metricId: 'supply.progress-change', value: '12.5' },
        { seriesId, metricId: 'supply.mean-power', value: '4310.25' },
        { seriesId, metricId: 'sample.valid-count', value: '18' },
      ],
      series: [
        {
          seriesId,
          kind: 'research-progress',
          date: '2026-09-09',
          referenceDate: '2026-09-08',
          publishedSlots: 18,
          comparedSlots: 18,
          missingReferenceSlots: 0,
          referenceMean: '3837.5',
        },
      ],
    },
  })
}

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanResearchPage, {
    global: {
      plugins: [router],
      stubs: { teleport: true, ResearchStatFacet: { template: '<div data-testid="yr-facet-chart" />' } },
    },
  })
  await flushPromises()
  return wrapper
}

async function selectPreset(presetId: string) {
  await wrapper!.find('[data-testid="yr-preset-select"]').setValue(presetId)
  await flushPromises()
}

async function setWindow(start: string, end: string) {
  const dateRange = wrapper!.getComponent({ name: 'InsightDateRange' })
  dateRange.vm.$emit('update:modelValue', { start, end })
  await flushPromises()
}

/** 按测试标识取子组件（Element Plus 组件经 vm.$emit 模拟用户输入）。 */
function componentOf(testId: string): VueWrapper<any> {
  return wrapper!.findAllComponents(`[data-testid="${testId}"]`)[0] as unknown as VueWrapper<any>
}

async function setMode(mode: 'ex-post' | 'ex-ante') {
  const group = wrapper!.find('[data-testid="yr-mode"]').findComponent({ name: 'ElRadioGroup' })
  group.vm.$emit('update:modelValue', mode)
  await flushPromises()
}

async function setAsOf(value: string) {
  const picker = wrapper!.find('[data-testid="yr-asof"]').findComponent(ElDatePicker)
  picker.vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function setTargetDate(value: string) {
  const picker = wrapper!.find('[data-testid="yr-target-date"]').findComponent(ElDatePicker)
  picker.vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function setNumber(testId: string, value: number | null) {
  componentOf(testId).vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function run() {
  await wrapper!.find('[data-testid="yr-run"]').trigger('click')
  await flushPromises()
}

function previewCalls() {
  return vi.mocked(runResearchPreview).mock.calls
}

/** 保存响应夹具：形状对照 dljy 仓 insight-research-definitions.mjs 的 formatDetail。 */
function saveDetailFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const result = state.result as Record<string, unknown>
  return {
    definitionId: '5f0c9e64-1a2b-4c3d-8e4f-001122334455',
    regionId: 'yunnan',
    presetId: 'research.price-new-energy-correlation',
    title: '云南价格 × 新能源出力（共同样本相关）',
    businessWindow: { start: '2026-09-01', end: '2026-09-10' },
    mode: 'ex-post',
    runCount: 1,
    runs: [
      { runNo: 1, resultVersion: `rv1:${HEX64}`, readSetRef: `rs1:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-19T10:00:00+08:00' },
    ],
    latestRun: {
      runNo: 1,
      resultVersion: `rv1:${HEX64}`,
      readSetRef: `rs1:${HEX64}`,
      createdBy: 'u-admin',
      createdAt: '2026-09-19T10:00:00+08:00',
      content: {
        schemaVersion: 'insight-research-run/v1',
        topic: 'market_insight_research',
        title: '云南价格 × 新能源出力（共同样本相关）',
        frozenAt: '2026-09-19T10:00:00+08:00',
        definition: {},
        note: '研究运行产物：服务端按定义用研究内核重新计算并核对期望版本后冻结；查看保存结果与按新源重算是两回事，旧版本不再改变。',
        result,
      },
    },
    mock: false,
    productionWrite: false,
    ...overrides,
  }
}

async function save() {
  await wrapper!.find('[data-testid="yr-save"]').trigger('click')
  await flushPromises()
}

beforeEach(async () => {
  localStorage.clear()
  selectedRegionId.value = 'yunnan'
  selectedCompanyId.value = 'c1'
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')
  state.capabilities = caps([PRICE_SERIES, SUPPLY_SERIES])
  state.result = DEFAULT_RESULT()
  state.responder = () => Promise.resolve(state.result)
  state.saveDetail = saveDetailFixture()
  state.saveResponder = () => Promise.resolve(state.saveDetail)
  state.canWrite = true
  vi.mocked(fetchInsightCapabilities).mockClear()
  vi.mocked(runResearchPreview).mockClear()
  vi.mocked(saveResearchDefinition).mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// ── 预设入口（RS01）──────────────────────────────────────────────────────────────────────

describe('预设入口', () => {
  it('九个预设全部可见：名称、类型、缺口原因原文与样本条件齐备', async () => {
    await mountPage()
    const list = wrapper!.find('[data-testid="yr-preset-list"]')
    expect(list.findAll('.yr__preset')).toHaveLength(9)
    const text = list.text()
    expect(text).toContain('云南价格 × 新能源出力（共同样本相关）')
    expect(text).toContain('负荷同类日（供需特征加权距离）')
    expect(text).toContain('共同样本相关')
    expect(text).toContain('同类日')
    // 缺口原因原文（不转述）：任一侧缺时段共同样本就收缩 / 缺特征整日排除
    expect(text).toContain('任一侧缺时段或整日缺数，共同样本就按双方都有效的对齐时段收缩，不补零')
    expect(text).toContain('候选日缺任一必需特征即整日排除（不补值）')
    expect(text).toContain('最低样本 24 条')
    expect(text).toContain('最低覆盖率 50.0%')
  })

  it('能力目录缺分析：该预设标「输入不足」、按钮禁用、顶部选择器不可选，不发任何请求', async () => {
    state.capabilities = caps([])
    await mountPage()

    const badges = wrapper!.findAll('[data-testid="yr-preset-ineligible"]')
    expect(badges.length).toBe(9)
    expect(badges[0]!.text()).toContain('输入不足：该预设需要的分析当前不可用')
    const disabledButtons = wrapper!.findAll('[data-testid="yr-preset-list"] button').filter((button) => button.attributes('disabled') !== undefined)
    expect(disabledButtons.length).toBe(9)

    await wrapper!.find('[data-testid="yr-preset-select"]').setValue('research.price-new-energy-correlation')
    await flushPromises()
    // 选择被拒绝：不进入运行面板，给「输入不足」提示
    expect(wrapper!.text()).toContain('输入不足')
    expect(wrapper!.find('[data-testid="yr-run"]').exists()).toBe(false)
    expect(previewCalls()).toHaveLength(0)
  })

  it('能力目录读取失败：按「输入不足」处理，不把失败吞成可运行', async () => {
    vi.mocked(fetchInsightCapabilities).mockRejectedValueOnce(
      new InsightRequestError({ status: 503, errorCode: 'UNAVAILABLE', message: '资料读取失败，请稍后重试' })
    )
    await mountPage()
    expect(wrapper!.text()).toContain('输入不足：能力目录读取失败，暂不能运行')
    expect(wrapper!.find('[data-testid="yr-run"]').exists()).toBe(false)
  })

  it('未登记地区（广东）：无预设空态、不发任何请求', async () => {
    selectedRegionId.value = 'guangdong'
    await mountPage()
    expect(wrapper!.find('[data-testid="yr-no-preset"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="yr-preset-list"]').exists()).toBe(false)
    expect(previewCalls()).toHaveLength(0)
    // 没有预设就没有输入资格面：能力目录也不必读
    expect(vi.mocked(fetchInsightCapabilities)).not.toHaveBeenCalled()
  })
})

// ── 运行请求形状（RS02、RS04、RS07）──────────────────────────────────────────────────────

describe('运行请求形状', () => {
  it('相关预设默认请求：presetId/context/filters（groupBy=none）齐备，不携带变换参数', async () => {
    await mountPage()
    await setWindow('2026-09-01', '2026-09-10')
    await selectPreset('research.price-new-energy-correlation')
    await run()

    expect(previewCalls()).toHaveLength(1)
    const request = previewCalls()[0]![0] as any
    expect(request.presetId).toBe('research.price-new-energy-correlation')
    expect(request.context.regionId).toBe('yunnan')
    expect(request.context.businessWindow).toMatchObject({ start: '2026-09-01', end: '2026-09-10', timeZone: 'Asia/Shanghai' })
    expect(request.context.mode).toBe('ex-post')
    expect(request.context.asOf).toBeNull()
    expect(request.context.contextVersion).toBeGreaterThanOrEqual(1)
    expect(request.filters).toEqual({ groupBy: 'none' })
    expect(request.transformations).toBeUndefined()
  })

  it('分组维度 month 显式进 filters；结果按月分组列出（组间不合并）', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await wrapper!.find('[data-testid="yr-groupby"]').setValue('month')
    await run()

    expect((previewCalls()[0]![0] as any).filters).toEqual({ groupBy: 'month' })
    const table = wrapper!.find('[data-testid="yr-correlation-groups"]')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('2026-09')
    expect(table.text()).toContain('-0.402144')
  })

  it('滞后比较：滞后未给出时前置拦截不发请求；显式给 -12 后按原值进 transformations', async () => {
    await mountPage()
    await selectPreset('research.price-load-lag-comparison')

    expect(wrapper!.text()).toContain('滞后槽位必须显式给出非零整数（含方向）')
    await run()
    expect(previewCalls()).toHaveLength(0)

    await setNumber('yr-lag', -12)
    state.result = baseResult({
      presetId: 'research.price-load-lag-comparison',
      method: { kind: 'lag-comparison', kernel: 'research-kernel/1', notes: ['明确滞后由请求显式给出，内核不搜索最优滞后；滞后差是描述性观察，不构成领先滞后或交易结论。', '统计关联不等于因果：滞后结果只陈述观测，不解释成因、不构成交易建议或收益承诺。'] },
      data: {
        schemaVersion: 'insight-result-data/v1',
        view: 'lag-comparison',
        dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }],
        measures: [{ id: 'value', unit: 'by-metric' }],
        rows: [{ seriesId: 'lag:x', metricId: 'research.lag-mean-difference', value: '-6.5' }],
        series: [{ seriesId: 'lag:x', kind: 'research-lag', lagSlots: -12, direction: 'y 比 x 晚 12 个槽位', window: null }],
      },
    })
    await run()

    expect(previewCalls()).toHaveLength(1)
    expect((previewCalls()[0]![0] as any).transformations).toEqual({ lagSlots: -12 })
    expect(wrapper!.text()).toContain('y 比 x 晚 12 个槽位')
    expect(wrapper!.find('[data-testid="yr-method-notes"]').text()).toContain('统计关联不等于因果')
  })

  it('异常窗口：绝对阈值与自身分位数阈值两种显式形状', async () => {
    await mountPage()
    await selectPreset('research.price-anomaly-window')
    await setNumber('yr-window-slots', 4)
    await setNumber('yr-threshold-value', 120)

    await run()
    expect(previewCalls()).toHaveLength(1)
    expect((previewCalls()[0]![0] as any).transformations).toEqual({ windowSlots: 4, threshold: { kind: 'absolute', value: '120' } })

    await wrapper!.find('[data-testid="yr-threshold-kind"]').setValue('quantile')
    await setNumber('yr-threshold-p', 0.95)
    await run()
    expect(previewCalls()).toHaveLength(2)
    expect((previewCalls()[1]![0] as any).transformations).toEqual({ windowSlots: 4, threshold: { kind: 'quantile', p: '0.95' } })
  })

  it('同类日：目标日在窗外被拦截；窗内则 targetDate/minCandidates 显式进 transformations', async () => {
    await mountPage()
    await setWindow('2026-09-01', '2026-09-10')
    await selectPreset('research.load-similar-day')

    await setTargetDate('2026-09-20')
    await flushPromises()
    expect(wrapper!.text()).toContain('目标日必须在业务日期范围内')
    await run()
    expect(previewCalls()).toHaveLength(0)

    await setTargetDate('2026-09-05')
    await flushPromises()
    state.result = similarDayResult({ sufficient: false })
    await run()

    expect(previewCalls()).toHaveLength(1)
    expect((previewCalls()[0]![0] as any).transformations).toEqual({ targetDate: '2026-09-05', minCandidates: 8 })
  })
})

// ── 事前/事后模式（RS04）─────────────────────────────────────────────────────────────────

describe('事前与事后模式', () => {
  it('事前模式没有截止时点：前置拦截（与后端同文案），不发请求', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await setMode('ex-ante')

    expect(wrapper!.text()).toContain('事前分析必须给出截止时点')
    await run()
    expect(previewCalls()).toHaveLength(0)
  })

  it('给出截止时点后：mode/asOf 按契约住在 context；结果带事前口径说明与逐来源排除', async () => {
    state.result = {
      ...correlationResult(),
      mode: 'ex-ante',
      asOf: '2026-09-05T08:30:00+08:00',
      exAnte: {
        basis: 'capture-ingested-at',
        perSource: {
          'yn.system.new-energy.actual': { basis: 'capture-ingested-at', usableRows: 96, excludedAfterAsOf: 40, missingKnownAt: 0 },
        },
        note: '已知时间取资料行的入库时间：只能说明系统在该时刻已取得，不能证明市场发布时间；截止时点之后取得的行未参与本次研究。',
      },
    }
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await setMode('ex-ante')
    await setAsOf('2026-09-05 08:30')
    await run()

    const request = previewCalls()[0]![0] as any
    expect(request.context.mode).toBe('ex-ante')
    expect(request.context.asOf).toBe('2026-09-05T08:30:00+08:00')
    expect(request.context).not.toHaveProperty('exPostAlias')

    expect(wrapper!.find('[data-testid="yr-mode-badge"]').text()).toContain('事前')
    expect(wrapper!.find('[data-testid="yr-exante-note"]').text()).toContain('不能证明市场发布时间')
    expect(wrapper!.text()).toContain('截止时点之后取得的 40 行未参与')
  })

  it('事前拒绝按后端原因原文展示（不运行后补标事前）', async () => {
    state.responder = () =>
      Promise.reject(
        new InsightRequestError({
          status: 400,
          errorCode: 'BAD_REQUEST',
          message: '来源 yn.system.new-energy.actual 没有可用的已知时间，不能做严格事前研究',
        })
      )
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await setMode('ex-ante')
    await setAsOf('2026-09-05 08:30')
    await run()

    expect(wrapper!.find('[data-testid="yr-error-reason"]').text()).toBe(
      '来源 yn.system.new-energy.actual 没有可用的已知时间，不能做严格事前研究'
    )
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(false)
  })

  it('事后模式带「事后对照」标注，不出现事前口径说明', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()

    expect(wrapper!.find('[data-testid="yr-mode-badge"]').text()).toBe('事后对照')
    expect(wrapper!.find('[data-testid="yr-exante-note"]').exists()).toBe(false)
  })
})

// ── 代次作废 / 超限 / 大值（RS02、RS07）──────────────────────────────────────────────────

describe('参数作废与超限纪律', () => {
  it('切换参数后旧结果立即失效：结果区清空、不自动重跑', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(true)
    expect(previewCalls()).toHaveLength(1)

    await wrapper!.find('[data-testid="yr-groupby"]').setValue('month')
    await flushPromises()
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(false)
    expect(previewCalls()).toHaveLength(1) // 不自动重跑，等用户显式再运行
  })

  it('超限前置拦截：同进度预设只允许单日窗口，超窗按上限提示且不发请求', async () => {
    await mountPage()
    await setWindow('2026-09-01', '2026-09-10')
    await selectPreset('research.load-progress-comparison')

    expect(wrapper!.text()).toContain('该研究预设一次最多 1 天，请缩小日期范围')
    await run()
    expect(previewCalls()).toHaveLength(0)

    await setWindow('2026-09-09', '2026-09-09')
    expect(wrapper!.text()).not.toContain('该研究预设一次最多 1 天，请缩小日期范围')
  })

  it('后端超限按原因原文展示（不截断冒充完整、不出部分结果）', async () => {
    state.responder = () =>
      Promise.reject(
        new InsightRequestError({
          status: 400,
          errorCode: 'LIMIT_EXCEEDED',
          message: '有效观测超过 100000，请缩小日期范围或研究对象',
        })
      )
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()

    expect(wrapper!.find('[data-testid="yr-error-reason"]').text()).toContain('有效观测超过 100000，请缩小日期范围或研究对象')
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(false)
  })

  it('合法大值（>14000）原样渲染：同类日特征值与异常窗口均值都不裁剪', async () => {
    state.result = anomalyResult()
    await mountPage()
    await selectPreset('research.price-anomaly-window')
    await setNumber('yr-window-slots', 4)
    await setNumber('yr-threshold-value', 120)
    await run()

    const text = wrapper!.text()
    expect(text).toContain('14211.25')
    expect(text).toContain('138.5')

    state.result = similarDayResult({ sufficient: true })
    await selectPreset('research.load-similar-day')
    await setWindow('2026-09-01', '2026-09-10')
    await setTargetDate('2026-09-05')
    await flushPromises()
    await run()

    expect(wrapper!.find('[data-testid="yr-similar-summary"]').exists()).toBe(true)
    expect(wrapper!.text()).toContain('14320.5')
  })
})

// ── 样本说明、同类日解释与保存占位（RS02、RS03、RS05）────────────────────────────────────

describe('样本说明与结果解释', () => {
  it('样本说明与方法版本透出：n/最低条件/方法版本/无置信区间与无因果原文', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()

    const sample = wrapper!.find('[data-testid="yr-sample"]').text()
    expect(sample).toContain('样本 236 条')
    expect(sample).toContain('最低要求 24 条')
    expect(sample).toContain('最低覆盖率 50.0%')
    expect(sample).toContain('方法版本 research-kernel/1')

    const notes = wrapper!.find('[data-testid="yr-method-notes"]').text()
    expect(notes).toContain('不提供置信区间')
    expect(notes).toContain('缺测不补零')

    expect(wrapper!.find('[data-testid="yr-correlation-r"]').text()).toContain('-0.412335')
    expect(wrapper!.text()).toContain('覆盖 98.3%')
  })

  it('同类日：候选表带逐特征贡献，不足与排除候选原因按原文展示，样本不足给资格提示', async () => {
    state.result = similarDayResult({ sufficient: false })
    await mountPage()
    await setWindow('2026-09-01', '2026-09-10')
    await selectPreset('research.load-similar-day')
    await setTargetDate('2026-09-05')
    await flushPromises()
    await run()

    const table = wrapper!.find('[data-testid="yr-similar-table"]')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('2026-09-03')
    expect(table.text()).toContain('0.5123')

    expect(wrapper!.find('[data-testid="yr-similar-insufficient"]').text()).toContain(
      '满足全部特征的候选日只有 3 个，少于最小候选数 8：不复制日期、不填补特征，请扩大候选窗或减少特征'
    )
    const excluded = wrapper!.find('[data-testid="yr-similar-excluded"]').text()
    expect(excluded).toContain('候选日缺必需特征「负荷日均出力」，不自动补值')
    expect(wrapper!.find('[data-testid="yr-eligibility"]').exists()).toBe(true)
  })

  it('无公司写权限：保存入口不渲染，运行预览与已保存查看入口保留（权限语义分离）', async () => {
    state.canWrite = false
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    expect(wrapper!.find('[data-testid="yr-save-area"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="yr-save"]').exists()).toBe(false)
    // 查询不受影响：预览照常可运行；已保存列表入口保留（查看是只读动作）
    await run()
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="yr-saved-open"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="yr-save-success"]').exists()).toBe(false)
  })

  it('有写权限：保存提交定义与期望版本（含幂等键、剥掉代次），成功显示「已保存（版本 1）」', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()
    // 没有结果时不可保存；有结果后可保存
    await save()
    const request = vi.mocked(saveResearchDefinition).mock.calls[0]![0] as Record<string, any>
    expect(request.presetId).toBe('research.price-new-energy-correlation')
    expect(request.expected).toEqual({ resultVersion: `rv1:${HEX64}`, readSetRef: `rs1:${HEX64}` })
    expect(request.idempotencyKey).toEqual(expect.stringMatching(/^research-definition-/))
    expect(request.context.mode).toBe('ex-post')
    expect(request.context.contextVersion).toBeUndefined() // 代次不进保存请求（幂等键稳定）
    const success = wrapper!.find('[data-testid="yr-save-success"]')
    expect(success.exists()).toBe(true)
    expect(success.text()).toContain('已保存（版本 1）')
  })

  it('资料已更新（409）：提示先重新运行再保存，不出现「已保存」、不假装成功', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()
    state.saveResponder = () =>
      Promise.reject(new InsightRequestError({ status: 409, errorCode: 'VERSION_CONFLICT', message: '源资料已更新：重新核验的读取版本与你看到的不一致' }))
    await save()
    const error = wrapper!.find('[data-testid="yr-save-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('资料已更新，请先重新运行再保存')
    expect(wrapper!.find('[data-testid="yr-save-success"]').exists()).toBe(false)
  })

  it('其他拒绝（403 等）：展示后端原因原文，不冒充成功', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()
    state.saveResponder = () =>
      Promise.reject(new InsightRequestError({ status: 403, errorCode: 'FORBIDDEN', message: '当前账号没有所选公司的写权限：可以分析与查看已保存研究，但不能保存' }))
    await save()
    const error = wrapper!.find('[data-testid="yr-save-error"]')
    expect(error.text()).toContain('当前账号没有所选公司的写权限')
    expect(wrapper!.find('[data-testid="yr-save-success"]').exists()).toBe(false)
  })

  it('没有可保存结果时保存按钮禁用，且任何时刻不出现虚假的已保存提示', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    expect(wrapper!.find('[data-testid="yr-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper!.find('[data-testid="yr-save-success"]').exists()).toBe(false)
  })

  it('幂等：同口径重复保存使用同一幂等键（服务端可去重，不重复创建）', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()
    await save()
    await save()
    const calls = vi.mocked(saveResearchDefinition).mock.calls
    expect(calls.length).toBe(2)
    expect((calls[0]![0] as Record<string, unknown>).idempotencyKey).toBe((calls[1]![0] as Record<string, unknown>).idempotencyKey)
    // 幂等命中（replay）也如实说明未重复创建
    expect(wrapper!.find('[data-testid="yr-save-success"]').text()).toContain('已保存（版本 1）')
  })
})

// ── 输入面与业务语言纪律（RS02、D9）──────────────────────────────────────────────────────

describe('受控输入面与业务语言', () => {
  it('没有自由文本输入：指标下拉只列预设登记项（选项=白名单本身），源码不出现自由 el-input', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')

    const metricSelects = wrapper!.findAll('select[data-testid^="yr-input-"]')
    expect(metricSelects.length).toBe(2)
    for (const select of metricSelects) {
      expect(select.attributes('disabled')).toBeDefined()
      const options = select.findAll('option')
      expect(options).toHaveLength(1)
    }
    expect(metricSelects[0]!.text()).toContain('用户侧日前价格')
    expect(metricSelects[1]!.text()).toContain('新能源出力（实际）')

    const source = readFileSync('src/features/regions/yunnan/insight/pages/YunnanResearchPage.vue', 'utf8')
    expect(source).not.toMatch(/<el-input[\s>]/) // 只有数字步进器/日期选择器，没有自由文本框
  })

  it('界面只出现业务语言：不出现预设标识、来源标识、模式枚举与请求字段名', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()

    const text = wrapper!.text()
    expect(text).not.toContain('research.price')
    expect(text).not.toContain('presetId')
    expect(text).not.toContain('transformations')
    expect(text).not.toContain('ex-post')
    expect(text).not.toContain('ex-ante')
    expect(text).not.toContain('correlation')
    expect(text).not.toContain('lag-comparison')
    expect(text).not.toContain('similar-day')
    expect(text).not.toContain('contextVersion')
    expect(text).not.toContain('rs1:')
    expect(text).not.toContain('rv1:')
    expect(text).not.toContain('yn.price')
    expect(text).not.toContain('yn.system')
  })
})

// ── AI 解读注册（dljy#3100，任务 15.3）：六页注册覆盖之研究工作台页 ───────────────────────

describe('研究页 · AI 解读注册（15.3）', () => {
  it('注册统一侧栏声明并挂入口按钮：运行后采集当前签名结果，payload 无 rows 且带版本引用', async () => {
    await mountPage()
    await setWindow('2026-09-01', '2026-09-10')
    await selectPreset('research.price-new-energy-correlation')
    await run()
    expect(wrapper!.find('[data-testid="yr-ai-entry"]').exists()).toBe(true)
    const def = activeAiPage().value
    expect(def?.label).toBe('云南研究工作台')
    const slice = resolveInterpret(def!)!.context?.() as { blocks: Array<Record<string, unknown>> } | null
    expect(slice).not.toBeNull()
    expect(slice!.blocks).toHaveLength(1)
    const text = JSON.stringify(slice)
    expect(text).not.toMatch(/"rows"/)
    expect(text).toContain('rv1:')
    expect(text).toContain('rs1:')
    expect(text).toContain('事后对照')
  })

  it('切换预设（配置签名变化）后旧结果作废：采集为空（过期研究不进上下文）', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()
    const def = activeAiPage().value!
    expect((resolveInterpret(def)!.context?.() as { blocks: unknown[] }).blocks).toHaveLength(1)
    await selectPreset('research.price-load-lag-comparison') // 签名变化即清空旧结果
    await flushPromises()
    const slice = resolveInterpret(def)!.context?.() as { blocks: unknown[] } | null
    expect(slice?.blocks ?? []).toHaveLength(0)
// ── 多指标量纲分面与视图选择（任务 13.7，RS08、D6.1）────────────────────────────────────

describe('量纲分面与视图选择', () => {
  it('同进度结果按登记量纲拆三面并列（%/MW/样本计数），各面标题带量纲说明', async () => {
    state.result = progressResult()
    await mountPage()
    await setWindow('2026-09-09', '2026-09-09')
    await selectPreset('research.load-progress-comparison')
    await run()

    const facets = wrapper!.findAll('[data-testid="yr-facet"]')
    expect(facets).toHaveLength(3)
    expect(facets[0]!.text()).toContain('百分比（%）')
    expect(facets[1]!.text()).toContain('功率（MW）')
    expect(facets[2]!.text()).toContain('样本计数')
  })

  it('相关结果同样按量纲分面（r/随输入量纲/样本计数），并给出视图选择边界说明', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    await run()

    const facets = wrapper!.findAll('[data-testid="yr-facet"]')
    expect(facets).toHaveLength(3)
    const note = wrapper!.find('[data-testid="yr-view-scope-note"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('仅本会话')
    expect(note.text()).toContain('不包含视图选择')
  })

  it('序列显隐只改当前视图：隐藏唯一序列后该面不出图但控件保留，可勾回；结果不重查、不清空', async () => {
    state.result = progressResult()
    await mountPage()
    await setWindow('2026-09-09', '2026-09-09')
    await selectPreset('research.load-progress-comparison')
    await run()
    expect(previewCalls()).toHaveLength(1)
    expect(wrapper!.findAll('[data-testid="yr-facet-chart"]')).toHaveLength(3)

    const mwToggle = () => wrapper!.find('[data-testid="yr-facet-series-supply-mean-power"]')
    await mwToggle().setValue(false)
    await flushPromises()
    // 控制面永远在场：分面骨架不随显隐消失（唯一序列被隐藏也能勾回），只是不再出图
    expect(wrapper!.findAll('[data-testid="yr-facet"]')).toHaveLength(3)
    expect(wrapper!.findAll('[data-testid="yr-facet-chart"]')).toHaveLength(2)
    expect(mwToggle().exists()).toBe(true)
    expect((mwToggle().element as HTMLInputElement).checked).toBe(false)
    await mwToggle().setValue(true)
    await flushPromises()
    expect(wrapper!.findAll('[data-testid="yr-facet-chart"]')).toHaveLength(3)
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(true)
    expect(previewCalls()).toHaveLength(1) // 同签名不重查：视图操作不发请求
  })

  it('新一次运行回到默认视图（序列显隐不跨运行残留）', async () => {
    state.result = progressResult()
    await mountPage()
    await setWindow('2026-09-09', '2026-09-09')
    await selectPreset('research.load-progress-comparison')
    await run()
    await wrapper!.find('[data-testid="yr-facet-series-supply-mean-power"]').setValue(false)
    expect(wrapper!.findAll('[data-testid="yr-facet-chart"]')).toHaveLength(2)

    await run()
    expect(wrapper!.findAll('[data-testid="yr-facet-chart"]')).toHaveLength(3)
  })

  it('分面顺序可在会话内调整（上移/下移），同样不触发请求', async () => {
    state.result = progressResult()
    await mountPage()
    await setWindow('2026-09-09', '2026-09-09')
    await selectPreset('research.load-progress-comparison')
    await run()

    await wrapper!.findAll('[data-testid="yr-facet-move-down"]')[0]!.trigger('click')
    await flushPromises()
    const afterMove = wrapper!.findAll('[data-testid="yr-facet"]')
    expect(afterMove[0]!.text()).toContain('功率（MW）')
    expect(previewCalls()).toHaveLength(1)
  })
})

// ── 参考日明示（任务 13.7）：同类日目标日显式给、同进度参考日按登记固定并明示 ─────────────

describe('参考日明示', () => {
  it('同进度比较运行前明示参考日 = 业务日前一日（登记固定，不自动另选、不发明变换字段）', async () => {
    await mountPage()
    await setWindow('2026-09-09', '2026-09-09')
    await selectPreset('research.load-progress-comparison')

    const reference = wrapper!.find('[data-testid="yr-reference-day"]')
    expect(reference.exists()).toBe(true)
    expect(reference.text()).toContain('参考日 2026-09-08')
    expect(reference.text()).toContain('按登记固定为业务日前一日')
    // 明示在运行前就有：不发请求也已可见
    expect(previewCalls()).toHaveLength(0)
  })

  it('同类日的目标日保持显式日期选择；非同进度预设不出现参考日行', async () => {
    await mountPage()
    await selectPreset('research.price-new-energy-correlation')
    expect(wrapper!.find('[data-testid="yr-reference-day"]').exists()).toBe(false)
  })
})

// ── 承接洞察选区（任务 13.7，RS08、DE10）─────────────────────────────────────────────────

describe('承接洞察选区', () => {
  it('价格页选区 → 预设预填 + 范围说明 + 返回原页（窗口/对象/来源随返回恢复）', async () => {
    router.addRoute({ path: '/insight/prices', component: { render: () => null } })
    await router.push({
      path: '/',
      query: {
        from: 'prices',
        start: '2026-09-01',
        end: '2026-09-10',
        objects: encodeURIComponent('node-A'),
        sources: encodeURIComponent('yn.price.user.day-ahead'),
      },
    })
    await mountPage()

    const banner = wrapper!.find('[data-testid="yr-handoff"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('已承接「价格与价差」的选区范围')
    expect(banner.text()).toContain('窗口 2026-09-01 ~ 2026-09-10')
    expect(banner.text()).toContain('对象 1 个')
    expect(banner.text()).toContain('研究预设已按承接来源预填')
    // 预设按承接来源预填（能力目录就绪后），可更换
    const select = wrapper!.find('[data-testid="yr-preset-select"]').element as HTMLSelectElement
    expect(select.value).toBe('research.price-new-energy-correlation')

    await wrapper!.find('[data-testid="yr-handoff-return"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/insight/prices')
    expect(router.currentRoute.value.query.start).toBe('2026-09-01')
    expect(router.currentRoute.value.query.end).toBe('2026-09-10')
    expect(router.currentRoute.value.query.objects).toBe('node-A')
    expect(router.currentRoute.value.query.sources).toBe('yn.price.user.day-ahead')
  })

  it('承接来源未对应已登记预设：范围照常承接，预设不预填、如实说明', async () => {
    await router.push({
      path: '/',
      query: {
        from: 'grid-boundaries',
        start: '2026-09-01',
        end: '2026-09-10',
        sources: encodeURIComponent('yn.transfer.tie-line.flow'),
      },
    })
    await mountPage()

    const banner = wrapper!.find('[data-testid="yr-handoff"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('已承接「跨省与电网边界」的选区范围')
    expect(banner.text()).toContain('承接来源未对应已登记预设')
    const select = wrapper!.find('[data-testid="yr-preset-select"]').element as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('不认识的来源页参数：不承接、无横幅（不假装知道范围从哪来）', async () => {
    await router.push({ path: '/', query: { from: 'unknown-page' } })
    await mountPage()
    expect(wrapper!.find('[data-testid="yr-handoff"]').exists()).toBe(false)
    const select = wrapper!.find('[data-testid="yr-preset-select"]').element as HTMLSelectElement
    expect(select.value).toBe('')
  })
})

// ── 红线（任务 13.7，RS08）：价格响应缺模型输入明确不可用；代理不冒充官方竞价空间 ─────────

describe('价格响应红线', () => {
  it('价格响应类预设未登记开放：页面常驻说明缺模型输入/方法/验证结果不可用，代理不是官方竞价空间', async () => {
    await mountPage()
    const note = wrapper!.find('[data-testid="yr-price-response-note"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('价格响应类研究预设未登记开放')
    expect(note.text()).toContain('需要已登记的模型输入、方法与验证结果')
    expect(note.text()).toContain('不是官方竞价空间')
    // 因果边界同时在场：统计关联不等于因果
    expect(wrapper!.text()).toContain('统计关联不等于因果')
  })
})
