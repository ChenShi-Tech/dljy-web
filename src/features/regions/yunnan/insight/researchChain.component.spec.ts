// researchChain.spec.ts — 云南研究「定义→运行→材料→底稿→源更正→旧报告不变」集成链验收
// (dljy#3115，OpenSpec 任务 14.6；RS06、CH02、A13)
// ----------------------------------------------------------------------------
// 守什么不变量（对照 14.6 验收原文：完成定义→运行→材料→底稿→原源更正→旧报告不变的集成链；
// A13 和混合私有材料授权测试通过；未重复建设发布、批注或审批流程）：
//   链 A（定义→运行）：保存定义（服务端重算核验冻结）→ 已保存列表可见 → 按新源重算新版本
//     → 旧版本历史可查（runNo）；源未变化读回既有版本不重复建版；同口径重复保存幂等 replay。
//   链 B（运行→材料→底稿）：运行产物 → 加入专题材料（研究页接线 InsightMaterialDialog，与
//     #151 价格页同模式）→ 底稿入稿 → 重复入稿不重复创建不重复入稿；材料 409 不改底稿。
//   链 C（源更正）：保存后源更正 → 带旧期望版本保存 409 先重跑 → 重算成功新版本 → 历史
//     runNo 产物原样。
//   链 D（混合授权）：公共+公司私有混合来源在无写权限账号下保存被拒（入口不渲染）、查询
//     保留；服务端撤权 fail-closed 403 原文展示；公司切换隔离，冻结产物只读可见。
//   旧报告不变：链上任何操作不改变既有底稿/材料的内容 hash、版本引用与 revision。
// 集成级边界：研究页 + 已保存窗口 + 材料窗口 + 契约镜像全部真实实现；服务层（researchClient
// 五端点、workpapers 底稿/材料、能力目录、auth/governance）打桩——桩背后是一个按服务端契约
// 行为的最小内存后端（重算追加不可变版本、期望版本核对 409、幂等键去重、写权限 fail-closed），
// 让四条链在真实组件里走通，而不是逐函数各测各的。
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api'
import { selectedCompanyId } from '@/services/company/companyContext'
import { selectedRegionId } from '@/services/region/regionContext'
import { fetchInsightCapabilities, InsightRequestError } from '@/services/insight/insightClient'
import {
  getResearchDefinition,
  listResearchDefinitions,
  runResearchDefinition,
  runResearchPreview,
  saveResearchDefinition,
} from '@/services/insight/researchClient'
import {
  captureInsightMaterial,
  getWorkpaper,
  listWorkpapers,
  saveWorkpaper,
} from '@/services/review/workpapers'
import InsightMaterialDialog from '@/components/insight/InsightMaterialDialog.vue'
import InsightResearchSavedDialog from '@/components/insight/InsightResearchSavedDialog.vue'
import { mount as appMount } from '@/test/mount'
import YunnanResearchPage from './pages/YunnanResearchPage.vue'

// ── 可控桩状态（vi.hoisted：vi.mock 工厂提升后仍可引用）────────────────────────────────

const state = vi.hoisted(() => ({
  capabilities: null as unknown,
  /** 各服务端点的应答器（beforeEach 里接到内存后端；可单独替换为拒绝）。 */
  preview: null as ((request: any) => Promise<any>) | null,
  saveDef: null as ((request: any) => Promise<any>) | null,
  listDefs: null as ((options: any) => Promise<any>) | null,
  getDef: null as ((id: string, options: any) => Promise<any>) | null,
  runDef: null as ((id: string) => Promise<any>) | null,
  listPapers: null as ((company: string, region: string) => Promise<any>) | null,
  getPaper: null as ((company: string, region: string, id: string) => Promise<any>) | null,
  capture: null as ((company: string, region: string, input: any, expected: any, key: string) => Promise<any>) | null,
  savePaper: null as ((company: string, draft: any) => Promise<any>) | null,
  /** 前端写权限显隐（governance.hasCompanyAdmin 桩）。 */
  canWrite: true,
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
    runResearchPreview: vi.fn((request: any) => state.preview!(request)),
    saveResearchDefinition: vi.fn((request: any) => state.saveDef!(request)),
    listResearchDefinitions: vi.fn((options?: any) => state.listDefs!(options)),
    getResearchDefinition: vi.fn((id: string, options?: any) => state.getDef!(id, options)),
    runResearchDefinition: vi.fn((id: string) => state.runDef!(id)),
  }
})

vi.mock('@/services/review/workpapers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listWorkpapers: vi.fn((company: string, region: string) => state.listPapers!(company, region)),
    getWorkpaper: vi.fn((company: string, region: string, id: string) => state.getPaper!(company, region, id)),
    captureInsightMaterial: vi.fn((company: string, region: string, input: any, expected: any, key: string) =>
      state.capture!(company, region, input, expected, key)
    ),
    saveWorkpaper: vi.fn((company: string, draft: any) => state.savePaper!(company, draft)),
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

// ── 契约镜像能力目录（公共 + 公司私有混合来源；研究预设需要的两个分析已登记）────────────

const SOURCE_PUBLIC = 'yn.price.user.day-ahead'
const SOURCE_COMPANY = 'yn.system.new-energy.actual'

function caps(sourceScopes: Record<string, 'public' | 'company'>): any {
  return {
    regionId: 'yunnan',
    registered: true,
    analyses: ['prices.user-series', 'supply.system-series'].map((analysisId) => ({
      analysisId,
      version: '1.0.0',
      title: analysisId,
      pageIds: ['research'],
      access: 'public',
      sourceIds: [],
      limits: { maxDays: 366, maxObjects: 0, requiresObjects: false },
    })),
    sources: [
      { sourceId: SOURCE_PUBLIC, title: '云南用户侧日前价格', accessScope: sourceScopes[SOURCE_PUBLIC] ?? 'public', measureKind: 'price', fields: [], nativeResolutionMinutes: 60, priceObject: null, marketPhase: 'day-ahead', variant: null, freshness: 'historical-package', objectDimension: null, note: null },
      { sourceId: SOURCE_COMPANY, title: '云南新能源出力（实际）', accessScope: sourceScopes[SOURCE_COMPANY] ?? 'public', measureKind: 'power', fields: [], nativeResolutionMinutes: 60, priceObject: null, marketPhase: null, variant: null, freshness: 'historical-package', objectDimension: null, note: null },
    ],
    endpoints: {},
    mock: false,
    productionWrite: false,
  }
}

// ── 研究预览结果夹具（形状对照 dljy 仓 insight-research.mjs runResearchPreview）──────────
// v1/v2 可区分：样本数与版本指纹不同——「旧版本不变」的断言才有意义。

const hexOf = (version: number) => `f${String(version).padStart(2, '0')}${'a'.repeat(62)}`

function previewResult(version: number): Record<string, unknown> {
  const seriesId = 'correlation:research.price-new-energy-correlation'
  return {
    schemaVersion: 'insight-research/v1',
    queryId: `q-${version}`,
    presetId: 'research.price-new-energy-correlation',
    presetVersion: '1',
    methodVersion: 'research-kernel/1',
    regionId: 'yunnan',
    businessWindow: { start: '2026-09-01', end: '2026-09-10', timeZone: 'Asia/Shanghai', days: 10 },
    mode: 'ex-post',
    asOf: null,
    mock: false,
    productionWrite: false,
    generatedAt: `2026-09-19T10:00:0${version}+08:00`,
    sourceRefs: [
      { sourceId: SOURCE_PUBLIC, accessScope: 'public', versionToken: `v${version}` },
      { sourceId: SOURCE_COMPANY, accessScope: 'company', versionToken: `v${version}` },
    ],
    readSetRef: `rs${version}:${hexOf(version)}`,
    resultVersion: `rv${version}:${hexOf(version)}`,
    inputs: [
      { id: 'x', label: '用户侧日前价格', sourceIds: [SOURCE_PUBLIC], resolutionMinutes: 60, validSlots: 238, expectedSlots: 240, coverageRatio: '0.991666666666' },
      { id: 'y', label: '新能源出力（实际）', sourceIds: [SOURCE_COMPANY], resolutionMinutes: 60, validSlots: 236, expectedSlots: 240, coverageRatio: '0.983333333333' },
    ],
    sample: { conditions: { minSamples: 24, minCoverageRatio: '0.5' }, primarySamples: version === 1 ? 236 : 238, eligibilityMet: true, observed: version === 1 ? 472 : 476 },
    method: {
      kind: 'correlation',
      kernel: 'research-kernel/1',
      notes: [
        '统计关联不等于因果：结果只陈述观测，不解释成因、不构成交易建议或收益承诺。',
        '时序样本存在自相关，本内核未做自相关处理，不提供置信区间，只给出相关系数 r 与共同样本数。',
        '缺测不补零：只在双方都有效的对齐时段配对；分组分别计算、组间不合并。',
      ],
    },
    definitionDraft: { presetId: 'research.price-new-energy-correlation', note: '可保存的研究定义草稿：保存走材料通道，服务端重算核验后冻结。' },
    data: {
      schemaVersion: 'insight-result-data/v1',
      view: 'correlation',
      dimensions: [{ id: 'seriesId', kind: 'category' }, { id: 'metricId', kind: 'category' }, { id: 'group', kind: 'category' }],
      measures: [{ id: 'value', unit: 'by-metric' }],
      rows: [
        { seriesId, metricId: 'research.pearson-r', group: 'all', value: '-0.412335' },
        { seriesId, metricId: 'research.covariance', group: 'all', value: '-118.402' },
        { seriesId, metricId: 'sample.valid-count', group: 'all', value: String(version === 1 ? 236 : 238) },
      ],
      series: [
        {
          seriesId,
          kind: 'research-correlation',
          x: '用户侧日前价格',
          y: '新能源出力（实际）',
          groupBy: 'none',
          structuralDifference: false,
          coverage: { aValid: 238, bValid: 236, common: version === 1 ? 236 : 238, expectedSlots: 240 },
          overall: { samples: version === 1 ? 236 : 238, r: '-0.412335', covariance: '-118.402', coverageRatio: '0.983333333333', window: { start: '2026-09-01', end: '2026-09-10' } },
        },
      ],
    },
  }
}

const PRESET_TITLE = '云南价格 × 新能源出力（共同样本相关）'
const PRESET_ID = 'research.price-new-energy-correlation'
const DEFINITION_ID = '5f0c9e64-1a2b-4c3d-8e4f-001122334455'

function apiError(status: number, msg: string): ApiError {
  return new ApiError(msg, { status, code: status, payload: { code: status, msg } })
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

// ── 最小内存后端（按服务端契约行为打桩：核验冻结、幂等、版本追加、权限）────────────────
// 对照 dljy 仓 insight-research-definitions.mjs（任务 14.3）与 insight-material.mjs（#3020）：
//   - 保存/材料只接受「定义与源引用 + 期望版本」，服务端按当前源重算核对一致才冻结；不一致 409。
//   - 重算：源已变化追加不可变新版本；源未变化 changed=false 读回；无写权限 fail-closed 403。
//   - 材料：内容派生幂等键，同键返回同一份冻结材料；底稿 revision 冲突 409。
type RunRecord = {
  runNo: number
  resultVersion: string
  readSetRef: string
  createdAt: string
  createdBy: string | null
  sourceVersion: number
  content: Record<string, unknown>
}

function makeBackend() {
  const b = {
    /** 当前「源」的版本号：+1 即模拟源更正（保存/重算的核验基准）。 */
    sourceVersion: 1,
    /** 前后端权限分离：serverCanWrite 是后端 fail-closed 闸门（权威）。 */
    serverCanWrite: true,
    /** 材料冻结强制 409（源更新）模拟开关。 */
    materialConflict: false,
    runs: [] as RunRecord[],
    replayKey: '',
    captureCalls: 0,
    savePaperCalls: 0,
    getDefCalls: [] as Array<{ id: string; runNo: number | null | undefined }>,
    materialsByKey: new Map<string, any>(),
    papers: new Map<string, any>(),
  }

  // 底稿种子（与 #151 价格页材料窗口同一份列表协议；主笔 admin 可编辑）
  b.papers.set('p-1', {
    id: 'p-1',
    title: '九月价格复盘',
    revision: 3,
    updatedAt: '2026-09-18T10:00:00+08:00',
    authorId: 'u-admin',
    canEdit: true,
    scope: { region: 'yunnan', view: 'generator', objectId: 'YN.KM.01', objectLabel: 'YN.KM.01', startDate: '2026-09-01', endDate: '2026-09-30' },
    blocks: [],
    summary: '',
  })

  const paperSnapshot = (id: string) => deepClone(b.papers.get(id))

  function runMeta(run: RunRecord) {
    return { runNo: run.runNo, resultVersion: run.resultVersion, readSetRef: run.readSetRef, createdBy: run.createdBy, createdAt: run.createdAt }
  }

  function freezeRun(version: number, runNo: number): RunRecord {
    const frozenAt = `2026-09-19T1${runNo}:00:00+08:00`
    return {
      runNo,
      resultVersion: `rv${version}:${hexOf(version)}`,
      readSetRef: `rs${version}:${hexOf(version)}`,
      createdAt: frozenAt,
      createdBy: 'u-admin',
      sourceVersion: version,
      content: deepFreeze(
        deepClone({
          schemaVersion: 'insight-research-run/v1',
          topic: 'market_insight_research',
          title: PRESET_TITLE,
          frozenAt,
          definition: { presetId: PRESET_ID, regionId: 'yunnan', mode: 'ex-post', sourceVersion: version },
          note: '研究运行产物：服务端按定义用研究内核重新计算并核对期望版本后冻结；查看保存结果与按新源重算是两回事，旧版本不再改变。',
          result: previewResult(version),
        })
      ),
    }
  }

  function detailOf(runNo: number | null | undefined) {
    const runs = b.runs
    const target = runNo === null || runNo === undefined ? runs[runs.length - 1] : runs.find((run) => run.runNo === runNo)
    return {
      definitionId: DEFINITION_ID,
      regionId: 'yunnan',
      presetId: PRESET_ID,
      presetVersion: '1',
      title: PRESET_TITLE,
      businessWindow: { start: '2026-09-01', end: '2026-09-10' },
      mode: 'ex-post',
      methodVersion: 'research-kernel/1',
      runCount: runs.length,
      runs: runs.map(runMeta),
      latestRun: target ? { ...runMeta(target), content: deepClone(target.content) } : null,
      mock: false,
      productionWrite: false,
    }
  }

  // 方法直接挂到状态对象上返回：测试里对 backend.sourceVersion 等的改动与方法内部读到的 b 一致。
  return Object.assign(b, {
    // POST research/preview：只读预览，结果版本跟随当前源版本（源更正 → 新版本指纹）
    async preview(): Promise<unknown> {
      return previewResult(b.sourceVersion)
    },
    // POST research/definitions：服务端按当前源重算核对期望版本一致才冻结；同幂等键 replay
    async saveDefinition(request: any): Promise<unknown> {
      const currentVersion = `rv${b.sourceVersion}:${hexOf(b.sourceVersion)}`
      if (request.expected?.resultVersion !== currentVersion) {
        throw new InsightRequestError({
          status: 409,
          errorCode: 'VERSION_CONFLICT',
          message: '源资料已更新：重新核验的读取版本与你看到的不一致，请先重新运行再保存',
        })
      }
      if (b.replayKey === request.idempotencyKey) {
        return { ...detailOf(null), replay: true, note: '该定义此前已保存，未重复创建' }
      }
      b.replayKey = request.idempotencyKey
      b.runs.push(freezeRun(b.sourceVersion, b.runs.length + 1))
      return detailOf(null)
    },
    // GET research/definitions：公司隔离由会话决定（这里按 selectedCompanyId 区分）
    async listDefinitions(): Promise<unknown> {
      if (selectedCompanyId.value !== 'c1' || !b.runs.length) {
        return { rows: [], hasMore: false, offset: 0, mock: false, productionWrite: false }
      }
      const latest = b.runs[b.runs.length - 1]
      return {
        rows: [
          {
            definitionId: DEFINITION_ID,
            regionId: 'yunnan',
            presetId: PRESET_ID,
            title: PRESET_TITLE,
            businessWindow: { start: '2026-09-01', end: '2026-09-10' },
            mode: 'ex-post',
            runCount: b.runs.length,
            latestRun: { runNo: latest!.runNo, resultVersion: latest!.resultVersion, createdAt: latest!.createdAt },
            createdBy: 'u-admin',
            createdAt: '2026-09-19T10:00:00+08:00',
            updatedAt: latest!.createdAt,
          },
        ],
        hasMore: false,
        offset: 0,
        mock: false,
        productionWrite: false,
      }
    },
    // GET research/definitions/{id}：带 runNo 取回历史版本（旧版本原样返回，永不改写）
    async getDefinition(id: string, options?: { runNo?: number | null }): Promise<unknown> {
      b.getDefCalls.push({ id, runNo: options?.runNo })
      return detailOf(options?.runNo ?? null)
    },
    // POST research/definitions/{id}/run：写权限 fail-closed；源已变化追加不可变版本
    async runDefinition(): Promise<unknown> {
      if (!b.serverCanWrite) {
        throw new InsightRequestError({
          status: 403,
          errorCode: 'FORBIDDEN',
          message: '当前账号没有所选公司的写权限：可以分析与查看已保存研究，但不能按新源重算',
        })
      }
      const last = b.runs[b.runs.length - 1]
      if (last && last.sourceVersion === b.sourceVersion) {
        return { definitionId: DEFINITION_ID, regionId: 'yunnan', title: PRESET_TITLE, changed: false, run: null, runs: b.runs.map(runMeta), note: '源资料未变化：返回既有版本，未生成新版本', mock: false, productionWrite: false }
      }
      const run = freezeRun(b.sourceVersion, b.runs.length + 1)
      b.runs.push(run)
      return { definitionId: DEFINITION_ID, regionId: 'yunnan', title: PRESET_TITLE, changed: true, run: { ...runMeta(run), content: deepClone(run.content) }, runs: b.runs.map(runMeta), mock: false, productionWrite: false }
    },
    // GET/PATCH workpapers 与 POST evidence（kind: market_insight，#3020 协议）
    async listPapers(): Promise<unknown> {
      const paper = paperSnapshot('p-1')
      return { rows: paper ? [paper] : [], hasMore: false, offset: 0 }
    },
    async getPaper(): Promise<unknown> {
      return paperSnapshot('p-1')
    },
    async captureMaterial(_company: string, region: string, input: any, expected: any, key: string): Promise<unknown> {
      b.captureCalls += 1
      if (b.materialConflict) {
        throw apiError(409, '资料已更新：保存前核对到的版本与你看到的不一致，请刷新查看新版本后再保存')
      }
      const existing = b.materialsByKey.get(key)
      if (existing) return existing
      const material = {
        id: `ev-${b.captureCalls}`,
        region,
        authorId: 'u-admin',
        createdAt: '2026-09-19T11:00:00+08:00',
        sourceKind: 'business_source',
        contentHash: `mat${b.captureCalls}${'c'.repeat(60)}`,
        content: {
          topic: 'market_insight',
          title: PRESET_TITLE,
          labels: [PRESET_TITLE],
          capturedAt: '2026-09-19T11:00:00+08:00',
          sourceNotice: '服务器按登记分析重新读取并核对了读取版本与结果版本；统计由服务端计算，浏览器提交的数值不参与。',
          input: {
            analysisId: input.analysisId,
            analysisVersion: '1.0.0',
            context: { regionId: 'yunnan', businessWindow: { start: '2026-09-01', end: '2026-09-10' }, sourceIds: [], mode: 'ex-post', asOf: null },
            filters: input.filters ?? {},
            expected: { resultVersion: expected.resultVersion, readSetRef: expected.readSetRef },
          },
        },
      }
      b.materialsByKey.set(key, material)
      return material
    },
    async savePaper(_company: string, draft: any): Promise<unknown> {
      b.savePaperCalls += 1
      const stored = b.papers.get(draft.id)
      if (!stored) throw apiError(404, '当前公司和地区内没有找到这份报告。')
      if (stored.revision !== draft.revision) throw apiError(409, '正文已更新，请阅读新版本后再保存')
      stored.blocks = deepClone(draft.blocks)
      stored.summary = draft.summary
      stored.revision += 1
      stored.updatedAt = '2026-09-19T11:00:00+08:00'
      return deepClone(stored)
    },
  })
}

type Backend = ReturnType<typeof makeBackend>
let backend: Backend

// ── 挂载与交互辅助 ───────────────────────────────────────────────────────────────────────

let router: Router
let wrapper: VueWrapper<any> | null = null

async function mountPage(): Promise<VueWrapper<any>> {
  wrapper = appMount(YunnanResearchPage, {
    global: {
      plugins: [router],
      stubs: { ResearchStatFacet: true }, // 分面单图（useEChart）与集成链无关，打桩
    },
  })
  await flushPromises()
  return wrapper
}

/** 弹窗 append-to-body：在弹窗子树里按标识查元素（找不到抛错，不静默返回 null）。 */
function bodyFind(selector: string, dialogTestId: string): Element {
  const dialog = document.body.querySelector(`[data-testid="${dialogTestId}"]`)
  if (!dialog) throw new Error(`弹窗 ${dialogTestId} 未渲染`)
  const el = dialog.querySelector(selector)
  if (!el) throw new Error(`弹窗 ${dialogTestId} 里没有 ${selector}`)
  return el
}

function bodyDialog(dialogTestId: string): Element {
  const dialog = document.body.querySelector(`[data-testid="${dialogTestId}"]`)
  if (!dialog) throw new Error(`弹窗 ${dialogTestId} 未渲染`)
  return dialog
}

async function selectPreset(presetId: string): Promise<void> {
  await wrapper!.find('[data-testid="yr-preset-select"]').setValue(presetId)
  await flushPromises()
}

async function runPreview(): Promise<void> {
  await wrapper!.find('[data-testid="yr-run"]').trigger('click')
  await flushPromises()
}

async function saveDefinition(): Promise<void> {
  await wrapper!.find('[data-testid="yr-save"]').trigger('click')
  await flushPromises()
}

async function openSaved(): Promise<void> {
  await wrapper!.find('[data-testid="yr-saved-open"]').trigger('click')
  await flushPromises()
}

async function closeSaved(): Promise<void> {
  wrapper!.findComponent(InsightResearchSavedDialog).vm.$emit('update:modelValue', false)
  await flushPromises()
}

async function openDetail(): Promise<void> {
  bodyFind('[data-testid="irs-view"]', 'insight-research-saved-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

async function clickRerun(): Promise<void> {
  bodyFind('[data-testid="irs-rerun"]', 'insight-research-saved-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

async function chooseRun(runNo: number): Promise<void> {
  const buttons = [...bodyDialog('insight-research-saved-dialog').querySelectorAll('[data-testid="irs-run"]')]
  const target = buttons.find((button) => button.textContent?.includes(`版本 ${runNo} ·`))
  if (!target) throw new Error(`版本清单里没有版本 ${runNo}`)
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

async function addMaterialToPaper(paperLabel: string): Promise<void> {
  await wrapper!.find('[data-testid="yr-add-material"]').trigger('click')
  await flushPromises()
  bodyFind('.el-select__wrapper', 'insight-material-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  const item = [...document.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find((el) => el.textContent?.includes(paperLabel))
  if (!item) throw new Error(`下拉里没有「${paperLabel}」选项`)
  item.click()
  await flushPromises()
  bodyFind('[data-testid="insight-material-save"]', 'insight-material-dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/** 链 A 前置：运行预览并保存定义（冻结版本 1）。 */
async function savedDefinitionV1(): Promise<void> {
  await mountPage()
  await selectPreset(PRESET_ID)
  await runPreview()
  await saveDefinition()
}

beforeEach(async () => {
  localStorage.clear()
  document.body.innerHTML = ''
  selectedRegionId.value = 'yunnan'
  selectedCompanyId.value = 'c1'
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')

  backend = makeBackend()
  state.capabilities = caps({ [SOURCE_PUBLIC]: 'public', [SOURCE_COMPANY]: 'company' })
  state.preview = () => backend.preview()
  state.saveDef = (request) => backend.saveDefinition(request)
  state.listDefs = () => backend.listDefinitions()
  state.getDef = (id, options) => backend.getDefinition(id, options)
  state.runDef = () => backend.runDefinition()
  state.listPapers = () => backend.listPapers()
  state.getPaper = () => backend.getPaper()
  state.capture = (company, region, input, expected, key) => backend.captureMaterial(company, region, input, expected, key)
  state.savePaper = (company, draft) => backend.savePaper(company, draft)
  state.canWrite = true

  vi.mocked(fetchInsightCapabilities).mockClear()
  vi.mocked(runResearchPreview).mockClear()
  vi.mocked(saveResearchDefinition).mockClear()
  vi.mocked(listResearchDefinitions).mockClear()
  vi.mocked(getResearchDefinition).mockClear()
  vi.mocked(runResearchDefinition).mockClear()
  vi.mocked(listWorkpapers).mockClear()
  vi.mocked(getWorkpaper).mockClear()
  vi.mocked(captureInsightMaterial).mockClear()
  vi.mocked(saveWorkpaper).mockClear()
  vi.spyOn(ElMessage, 'success').mockImplementation((() => ({})) as any)
})

afterEach(() => {
  vi.mocked(ElMessage.success).mockRestore()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

// ── 链 A：定义 → 运行 → 版本历史（RS06）────────────────────────────────────────────────

describe('链 A：定义 → 运行 → 版本历史', () => {
  it('保存定义（服务端重算核验冻结）→ 已保存列表可见：标题/窗口/版本数/最新版本', async () => {
    await savedDefinitionV1()
    // 保存提交的是定义与期望版本，不是结果本身
    const request = vi.mocked(saveResearchDefinition).mock.calls[0]![0] as Record<string, any>
    expect(request.presetId).toBe(PRESET_ID)
    expect(request.expected).toEqual({ resultVersion: `rv1:${hexOf(1)}`, readSetRef: `rs1:${hexOf(1)}` })
    expect(request.context.contextVersion).toBeUndefined() // 代次不进保存请求（幂等键稳定）
    expect(String(request.idempotencyKey)).toMatch(/^research-definition-/)
    expect(backend.runs).toHaveLength(1)
    expect(wrapper!.find('[data-testid="yr-save-success"]').text()).toContain('已保存（版本 1）')

    await openSaved()
    expect(vi.mocked(listResearchDefinitions)).toHaveBeenCalledTimes(1)
    const rows = [...bodyDialog('insight-research-saved-dialog').querySelectorAll('[data-testid="irs-row"]')]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain(PRESET_TITLE)
    expect(rows[0]!.textContent).toContain('2026-09-01 ~ 2026-09-10')
    expect(rows[0]!.textContent).toContain('1 个版本')
    expect(rows[0]!.textContent).toContain('最新版本 1')
  })

  it('按新源重算追加新版本（旧版本不变）→ 历史 runNo 取回原样可查', async () => {
    await savedDefinitionV1()
    const run1Content = deepClone(backend.runs[0]!.content)

    await openSaved()
    await openDetail()
    expect(vi.mocked(getResearchDefinition)).toHaveBeenCalledWith(DEFINITION_ID, undefined)
    // 最新版本（1）冻结产物只读可见
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 236 条')

    backend.sourceVersion = 2 // 模拟源更正
    await clickRerun()
    expect(vi.mocked(runResearchDefinition)).toHaveBeenCalledWith(DEFINITION_ID)
    expect(backend.runs).toHaveLength(2)
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(expect.stringContaining('已按新源重算：新增版本 2（旧版本不变）'))
    // 重算后详情刷新到最新版本：v2 样本数
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 238 条')
    // 旧版本在服务端从未被改写
    expect(JSON.stringify(backend.runs[0]!.content)).toBe(JSON.stringify(run1Content))

    // 历史 runNo 原样可查
    await chooseRun(1)
    expect(vi.mocked(getResearchDefinition)).toHaveBeenLastCalledWith(DEFINITION_ID, { runNo: 1 })
    expect(bodyFind('[data-testid="irs-detail-summary"]', 'insight-research-saved-dialog').textContent).toContain('当前查看版本 1')
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 236 条')
    expect(JSON.stringify(backend.runs[0]!.content)).toBe(JSON.stringify(run1Content))
  })

  it('源未变化重算读回既有版本：不重复建版本、如实提示（不冒充新算）', async () => {
    await savedDefinitionV1()
    vi.mocked(ElMessage.success).mockClear() // 前置里的保存成功提示不算数，只看重算动作
    await openSaved()
    await openDetail()

    await clickRerun() // 源版本仍是 1
    expect(backend.runs).toHaveLength(1)
    expect(bodyFind('[data-testid="irs-rerun-notice"]', 'insight-research-saved-dialog').textContent).toContain('源资料未变化')
    expect(vi.mocked(ElMessage.success)).not.toHaveBeenCalled()
  })

  it('同口径重复保存：幂等键稳定、服务端 replay 未重复创建', async () => {
    await mountPage()
    await selectPreset(PRESET_ID)
    await runPreview()
    await saveDefinition()
    await saveDefinition()

    const calls = vi.mocked(saveResearchDefinition).mock.calls
    expect(calls).toHaveLength(2)
    expect((calls[0]![0] as Record<string, unknown>).idempotencyKey).toBe((calls[1]![0] as Record<string, unknown>).idempotencyKey)
    expect(backend.runs).toHaveLength(1) // 服务端幂等：未重复创建版本
    // 保存动作仍以真实成功反馈（replay 语义不冒充首次创建也不报错）
    expect(wrapper!.find('[data-testid="yr-save-success"]').text()).toContain('已保存（版本 1）')
  })
})

// ── 链 B：运行产物 → 专题材料 → 底稿入稿（CH02，#151 价格页同模式）──────────────────────

describe('链 B：运行产物 → 专题材料 → 底稿入稿', () => {
  it('运行产物加入专题材料：冻结带期望版本与幂等键 → 图表块入稿（市场级材料为比较依据）', async () => {
    await savedDefinitionV1()
    await addMaterialToPaper('九月价格复盘')

    // 先读底稿（主笔校验在冻结之前），再冻结，再入稿
    const order = {
      paper: vi.mocked(getWorkpaper).mock.invocationCallOrder[0]!,
      capture: vi.mocked(captureInsightMaterial).mock.invocationCallOrder[0]!,
      save: vi.mocked(saveWorkpaper).mock.invocationCallOrder[0]!,
    }
    expect(order.paper).toBeLessThan(order.capture)
    expect(order.capture).toBeLessThan(order.save)

    const [company, region, request, expected, key] = vi.mocked(captureInsightMaterial).mock.calls[0]!
    expect(company).toBe('c1')
    expect(region).toBe('yunnan')
    expect(request.analysisId).toBe(PRESET_ID)
    expect(request.context.contextVersion).toBeUndefined() // 代次不进材料请求（幂等键稳定）
    expect(expected).toEqual({ resultVersion: `rv1:${hexOf(1)}`, readSetRef: `rs1:${hexOf(1)}` })
    expect(String(key)).toMatch(/^insight-material-/)

    expect(backend.savePaperCalls).toBe(1)
    const stored = backend.papers.get('p-1')
    expect(stored.blocks).toHaveLength(1)
    expect(stored.blocks[0]).toMatchObject({ kind: 'chart', evidenceId: 'ev-1' })
    // 市场级研究材料（无对象维度）只能作比较依据，不能当复盘对象的本次依据
    expect(stored.blocks[0]).toMatchObject({ evidenceRole: 'comparison' })
    expect(stored.revision).toBe(4)
    // 窗口关闭
    const closes = wrapper!.findComponent(InsightMaterialDialog).emitted('update:modelValue') ?? []
    expect(closes.at(-1)![0]).toBe(false)
  })

  it('重复入稿：同幂等键命中同一份材料，不重复创建、不重复入稿', async () => {
    await savedDefinitionV1()
    await addMaterialToPaper('九月价格复盘')
    const revisionAfterFirst = backend.papers.get('p-1')!.revision
    const materialAfterFirst = deepClone([...backend.materialsByKey.values()][0]!)

    await addMaterialToPaper('九月价格复盘')
    // 同一运行产物两次保存：内容派生幂等键相同 → 服务端返回同一份冻结材料
    const keys = vi.mocked(captureInsightMaterial).mock.calls.map((call) => call[4])
    expect(keys[0]).toBe(keys[1])
    expect(backend.materialsByKey.size).toBe(1)
    expect([...backend.materialsByKey.values()][0]).toEqual(materialAfterFirst)
    // 窗口发现该材料已在底稿中：不加块、不重存底稿
    expect(backend.savePaperCalls).toBe(1)
    const stored = backend.papers.get('p-1')
    expect(stored.blocks).toHaveLength(1)
    expect(stored.revision).toBe(revisionAfterFirst)
    expect(vi.mocked(ElMessage.success)).toHaveBeenLastCalledWith(expect.stringContaining('未重复创建'))
  })

  it('材料冻结 409（源已更新）：底稿不被改写、不称已保存', async () => {
    await savedDefinitionV1()
    backend.materialConflict = true
    await addMaterialToPaper('九月价格复盘')

    expect(bodyFind('[data-testid="insight-material-error"]', 'insight-material-dialog').textContent).toContain('资料已更新，请先重新运行再保存')
    expect(backend.savePaperCalls).toBe(0)
    const stored = backend.papers.get('p-1')
    expect(stored.blocks).toHaveLength(0)
    expect(stored.revision).toBe(3)
  })
})

// ── 链 C：源更正 → 先重跑 → 旧报告不变（RS06、A13）─────────────────────────────────────

describe('链 C：源更正 → 先重跑 → 旧报告不变', () => {
  it('源更正后带旧期望版本保存 → 409 提示先重跑：未保存、不产生新版本', async () => {
    await savedDefinitionV1()
    backend.sourceVersion = 2 // 保存之后源资料被更正

    await saveDefinition() // 用户拿旧预览直接再保存
    const error = wrapper!.find('[data-testid="yr-save-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('资料已更新，请先重新运行再保存')
    expect(wrapper!.find('[data-testid="yr-save-success"]').exists()).toBe(false)
    expect(backend.runs).toHaveLength(1) // 未悄悄接受新值、未产生新版本
  })

  it('按新源重算成功新版本 → 历史 runNo 产物与冻结时逐字一致', async () => {
    await savedDefinitionV1()
    const run1Frozen = deepClone(backend.runs[0]!.content)
    backend.sourceVersion = 2

    await openSaved()
    await openDetail()
    await clickRerun()
    expect(backend.runs).toHaveLength(2)
    expect(backend.runs[1]!.sourceVersion).toBe(2)
    expect((backend.runs[1]!.content.result as Record<string, unknown>).resultVersion).toBe(`rv2:${hexOf(2)}`)

    await chooseRun(1)
    expect(vi.mocked(getResearchDefinition)).toHaveBeenLastCalledWith(DEFINITION_ID, { runNo: 1 })
    // 历史版本产物：冻结后任何一个字节都没有变（含方法口径与来源引用原文）
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 236 条')
    expect(JSON.stringify(backend.runs[0]!.content)).toBe(JSON.stringify(run1Frozen))
    // 新旧版本内容确然不同（「不变」不是「没算出新东西」）
    expect(JSON.stringify(backend.runs[1]!.content)).not.toBe(JSON.stringify(run1Frozen))
  })

  it('全链回归：链上任何操作不改变既有底稿与材料的内容 hash、版本引用与 revision', async () => {
    await savedDefinitionV1()
    await addMaterialToPaper('九月价格复盘')

    const paperAfterMaterial = deepClone(backend.papers.get('p-1'))
    const materialAfterCapture = deepClone([...backend.materialsByKey.values()][0]!)
    const run1Frozen = deepClone(backend.runs[0]!.content)

    // 源更正 → 旧期望保存被拒 → 重算新版本 → 同材料重复入稿（幂等命中）
    backend.sourceVersion = 2
    await saveDefinition()
    await openSaved()
    await openDetail()
    await clickRerun()
    await addMaterialToPaper('九月价格复盘')

    expect(backend.papers.get('p-1')).toEqual(paperAfterMaterial) // 底稿未被第二次入稿改写
    expect([...backend.materialsByKey.values()][0]).toEqual(materialAfterCapture) // 材料 contentHash/内容不变
    expect(JSON.stringify(backend.runs[0]!.content)).toBe(JSON.stringify(run1Frozen)) // 旧版本产物不变
    expect(backend.runs).toHaveLength(2) // 新版本是追加，不是改写
  })
})

// ── 链 D：混合范围授权（CH02、CH05）────────────────────────────────────────────────────

describe('链 D：混合范围授权', () => {
  it('公共+公司混合来源：无写权限账号保存与材料入口不渲染，预览查询与只读查看保留', async () => {
    // 先由有写权限账号保存一份定义（冻结产物是查看保留的前提）
    await savedDefinitionV1()
    wrapper?.unmount()
    wrapper = null
    // 公共读者重新进入：可以分析与查看，不能保存
    state.canWrite = false
    await mountPage()
    await selectPreset(PRESET_ID)
    await runPreview()

    // 查询保留：混合来源预览照常出结果
    expect(wrapper!.find('[data-testid="yr-result"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="yr-sample"]').text()).toContain('样本 236 条')
    // 保存被拒的前端形态：入口不渲染（后端 fail-closed 闸门才是权威）
    expect(wrapper!.find('[data-testid="yr-save-area"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="yr-add-material"]').exists()).toBe(false)

    // 只读查看保留：已保存列表与冻结产物可看
    await openSaved()
    const rows = [...bodyDialog('insight-research-saved-dialog').querySelectorAll('[data-testid="irs-row"]')]
    expect(rows).toHaveLength(1)
    await openDetail()
    expect(bodyFind('[data-testid="irs-evidence-inputs"]', 'insight-research-saved-dialog').textContent).toContain('用户侧日前价格')
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 236 条')
  })

  it('服务端撤权 fail-closed：重算 403 原因原文展示，冻结产物仍只读可见、版本不增', async () => {
    await savedDefinitionV1()
    await openSaved()
    await openDetail()

    backend.serverCanWrite = false // 服务端闸门先行生效（前端显隐只是预判）
    await clickRerun()
    const error = bodyFind('[data-testid="irs-rerun-error"]', 'insight-research-saved-dialog')
    expect(error.textContent).toContain('当前账号没有所选公司的写权限')
    expect(backend.runs).toHaveLength(1)
    // 冻结产物没有因为失败而消失：仍只读可见
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 236 条')
  })

  it('撤权与公司切换：隔离公司看不到旧条目，切回后旧产物原样只读可见、未被清除', async () => {
    await savedDefinitionV1()
    const run1Frozen = deepClone(backend.runs[0]!.content)

    // 撤权后重新进入（账号状态变化经刷新生效）：重算入口消失，查看保留
    state.canWrite = false
    wrapper?.unmount()
    wrapper = null
    await mountPage()
    await openSaved()
    await openDetail()
    expect(bodyDialog('insight-research-saved-dialog').querySelector('[data-testid="irs-rerun"]')).toBeNull()
    expect(bodyFind('[data-testid="irs-evidence-sample"]', 'insight-research-saved-dialog').textContent).toContain('样本 236 条')

    // 公司切换：c2 看不到 c1 的条目（公司隔离由后端会话决定，重开窗口重新取数）
    await closeSaved()
    selectedCompanyId.value = 'c2'
    await openSaved()
    expect([...bodyDialog('insight-research-saved-dialog').querySelectorAll('[data-testid="irs-row"]')]).toHaveLength(0)

    // 切回 c1：旧条目与冻结产物原样还在（未被撤权或切换清除）
    await closeSaved()
    selectedCompanyId.value = 'c1'
    await openSaved()
    const rows = [...bodyDialog('insight-research-saved-dialog').querySelectorAll('[data-testid="irs-row"]')]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain(PRESET_TITLE)
    expect(JSON.stringify(backend.runs[0]!.content)).toBe(JSON.stringify(run1Frozen))
  })
})
