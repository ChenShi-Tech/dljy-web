// InsightResearchSavedDialog.component.spec.ts — 已保存研究窗口回归（dljy#3094 任务 14.4）
// 守什么不变量（对照 OpenSpec 14.4 与后端 insight-research-definitions 契约；RS06、D9 保存方式段）：
//   ① 打开即取本公司列表：初始不带分页参数（公司/地区范围由会话与统一地区头决定，前端不伪造）；
//     行展示标题/业务窗/版本数/最新版本；「只显示本公司」隔离说明可见；
//   ② 列表失败诚实报错（不冒充空列表成功）；空列表明说「还没有保存过」；
//   ③ 「查看」走 GET definitions/{id}：定义摘要 + 版本清单 + 冻结产物只读展示
//     （来源引用与样本说明原文、方法口径原文），查看不产生任何写动作；
//   ④ 版本切换带 runNo 取回历史版本（旧版本永不改写、可回看）；
//   ⑤ 按新源重算（写权限）：changed=true 新版本追加并刷新详情；changed=false 如实提示
//     「源未变化」不冒充新算；失败按后端原因原文展示；
//   ⑥ 无写权限：重算入口不渲染，列表与查看保留（权限语义分离，同 #151 材料口径）；
//   ⑦ 界面只出现业务语言：不出现定义标识/预设标识/版本指纹/请求字段名。
// 窗口 append-to-body：内容经 document 查找（同 InsightMaterialDialog spec 的写法）。
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getResearchDefinition,
  listResearchDefinitions,
  runResearchDefinition,
} from '@/services/insight/researchClient'
import { mount } from '@/test/mount'
import InsightResearchSavedDialog from './InsightResearchSavedDialog.vue'

vi.mock('@/services/insight/researchClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listResearchDefinitions: vi.fn(),
    getResearchDefinition: vi.fn(),
    runResearchDefinition: vi.fn(),
  }
})

const HEX64 = 'a'.repeat(64)

// ── 夹具（形状对照 dljy 仓 insight-research-definitions.mjs 的列表/取回/重算响应）─────────

function rowFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: 'd-row-1',
    regionId: 'yunnan',
    presetId: 'research.price-new-energy-correlation',
    title: '云南价格 × 新能源出力（共同样本相关）',
    businessWindow: { start: '2026-09-01', end: '2026-09-10' },
    mode: 'ex-post',
    runCount: 2,
    latestRun: { runNo: 2, resultVersion: `rv2:${HEX64}`, createdAt: '2026-09-19T10:00:00+08:00' },
    createdBy: 'u-admin',
    createdAt: '2026-09-18T09:00:00+08:00',
    updatedAt: '2026-09-19T10:00:00+08:00',
    ...overrides,
  }
}

function listFixture(rows: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { rows, hasMore: false, offset: 0, mock: false, productionWrite: false, ...overrides }
}

/** 预览结果最小形状（窗口只读消费：inputs/sample/method/methodVersion）。 */
function previewResultFixture(): Record<string, unknown> {
  return {
    schemaVersion: 'insight-research/v1',
    methodVersion: 'research-kernel/1',
    inputs: [
      { id: 'x', label: '用户侧日前价格', sourceIds: ['yn.price.user.day-ahead'], resolutionMinutes: 60, validSlots: 238, expectedSlots: 240, coverageRatio: '0.9917' },
      { id: 'y', label: '新能源出力（实际）', sourceIds: ['yn.system.new-energy.actual'], resolutionMinutes: 60, validSlots: 236, expectedSlots: 240, coverageRatio: '0.9833' },
    ],
    sample: { conditions: { minSamples: 24, minCoverageRatio: '0.5' }, primarySamples: 236, eligibilityMet: true, observed: 474 },
    method: {
      kind: 'correlation',
      kernel: 'research-kernel/1',
      notes: ['时序样本存在自相关，本内核未做自相关处理，不提供置信区间，只给出相关系数 r 与共同样本数。'],
    },
  }
}

function runContentFixture(runNo: number, frozenAt: string): Record<string, unknown> {
  return {
    runNo,
    resultVersion: `rv${runNo}:${HEX64}`,
    readSetRef: `rs${runNo}:${HEX64}`,
    createdBy: 'u-admin',
    createdAt: frozenAt,
    content: {
      schemaVersion: 'insight-research-run/v1',
      topic: 'market_insight_research',
      title: '云南价格 × 新能源出力（共同样本相关）',
      frozenAt,
      definition: {},
      note: '研究运行产物：服务端按定义用研究内核重新计算并核对期望版本后冻结；查看保存结果与按新源重算是两回事，旧版本不再改变。',
      result: previewResultFixture(),
    },
  }
}

function detailFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: 'd-row-1',
    regionId: 'yunnan',
    presetId: 'research.price-new-energy-correlation',
    title: '云南价格 × 新能源出力（共同样本相关）',
    businessWindow: { start: '2026-09-01', end: '2026-09-10' },
    mode: 'ex-post',
    methodVersion: 'research-kernel/1',
    runCount: 2,
    runs: [
      { runNo: 2, resultVersion: `rv2:${HEX64}`, readSetRef: `rs2:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-19T10:00:00+08:00' },
      { runNo: 1, resultVersion: `rv1:${HEX64}`, readSetRef: `rs1:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-18T09:00:00+08:00' },
    ],
    latestRun: runContentFixture(2, '2026-09-19T10:00:00+08:00'),
    mock: false,
    productionWrite: false,
    ...overrides,
  }
}

const ROWS = () => [
  rowFixture(),
  rowFixture({
    definitionId: 'd-row-2',
    title: '负荷同类日（供需特征加权距离）',
    presetId: 'research.load-similar-day',
    mode: 'ex-ante',
    runCount: 1,
    latestRun: { runNo: 1, resultVersion: `rv1:${HEX64}`, createdAt: '2026-09-18T09:00:00+08:00' },
    updatedAt: '2026-09-18T09:00:00+08:00',
  }),
]

let wrapper: VueWrapper<any> | null = null
let successSpy: ReturnType<typeof vi.spyOn>

async function mountDialog(props: Record<string, unknown> = {}): Promise<VueWrapper<any>> {
  wrapper = mount(InsightResearchSavedDialog, {
    props: { modelValue: true, canWrite: true, ...props },
  })
  await flushPromises()
  return wrapper
}

/** 弹窗挂在 body 下（append-to-body），在弹窗子树里按标识查元素。 */
function bodyFind(selector: string) {
  const dialog = document.body.querySelector('[data-testid="insight-research-saved-dialog"]')
  if (!dialog) throw new Error('弹窗未渲染')
  const el = dialog.querySelector(selector)
  if (!el) throw new Error(`弹窗里没有 ${selector}`)
  return el
}

function bodyText(): string {
  const dialog = document.body.querySelector('[data-testid="insight-research-saved-dialog"]')
  return dialog?.textContent ?? ''
}

function rows(): Element[] {
  return [...document.body.querySelectorAll('[data-testid="insight-research-saved-dialog"] [data-testid="irs-row"]')]
}

async function openDetail(): Promise<void> {
  bodyFind('[data-testid="irs-view"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

beforeEach(() => {
  vi.mocked(listResearchDefinitions).mockReset().mockResolvedValue(listFixture(ROWS()) as any)
  vi.mocked(getResearchDefinition).mockReset().mockResolvedValue(detailFixture() as any)
  vi.mocked(runResearchDefinition).mockReset().mockResolvedValue({
    definitionId: 'd-row-1', regionId: 'yunnan', title: '云南价格 × 新能源出力（共同样本相关）',
    changed: true, run: runContentFixture(3, '2026-09-19T11:00:00+08:00'),
    runs: [
      { runNo: 3, resultVersion: `rv3:${HEX64}`, readSetRef: `rs3:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-19T11:00:00+08:00' },
      { runNo: 2, resultVersion: `rv2:${HEX64}`, readSetRef: `rs2:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-19T10:00:00+08:00' },
      { runNo: 1, resultVersion: `rv1:${HEX64}`, readSetRef: `rs1:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-18T09:00:00+08:00' },
    ],
    mock: false,
    productionWrite: false,
  } as any)
  successSpy = vi.spyOn(ElMessage, 'success').mockImplementation((() => ({})) as any)
})

afterEach(() => {
  vi.mocked(ElMessage.success).mockRestore()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

// ── 列表（公司隔离、分页）────────────────────────────────────────────────────────────────

describe('已保存列表', () => {
  it('打开即取本公司列表：不带分页参数（公司/地区范围由会话与地区头决定），条目带标题/窗口/版本数与隔离说明', async () => {
    await mountDialog()
    expect(vi.mocked(listResearchDefinitions)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(listResearchDefinitions)).toHaveBeenCalledWith(undefined)
    const list = rows()
    expect(list).toHaveLength(2)
    expect(list[0]!.textContent).toContain('云南价格 × 新能源出力（共同样本相关）')
    expect(list[0]!.textContent).toContain('2026-09-01 ~ 2026-09-10')
    expect(list[0]!.textContent).toContain('2 个版本')
    expect(list[0]!.textContent).toContain('最新版本 2')
    expect(list[1]!.textContent).toContain('事前 · 截至时点')
    expect(bodyFind('[data-testid="irs-hint"]').textContent).toContain('只显示本公司')
  })

  it('列表读取失败：诚实报错，不渲染条目、不假装空列表成功', async () => {
    vi.mocked(listResearchDefinitions).mockRejectedValue(new Error('研究定义服务暂不可用'))
    await mountDialog()
    const error = bodyFind('[data-testid="irs-list-error"]')
    expect(error.textContent).toContain('研究定义服务暂不可用')
    expect(rows()).toHaveLength(0)
    expect(document.body.querySelector('[data-testid="irs-empty"]')).toBeNull()
  })

  it('空列表：明说「还没有保存过」，指引先运行预览再保存', async () => {
    vi.mocked(listResearchDefinitions).mockResolvedValue(listFixture([]) as any)
    await mountDialog()
    expect(bodyFind('[data-testid="irs-empty"]').textContent).toContain('还没有保存过')
  })

  it('分页：hasMore 时出现加载更多，点击带 offset=2 继续取数', async () => {
    vi.mocked(listResearchDefinitions).mockResolvedValue(listFixture(ROWS(), { hasMore: true }) as any)
    await mountDialog()
    bodyFind('[data-testid="irs-more"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(vi.mocked(listResearchDefinitions)).toHaveBeenLastCalledWith({ offset: 2 })
  })
})

// ── 查看（只读：定义摘要 + 版本清单 + 冻结产物原文）──────────────────────────────────────

describe('查看已保存研究', () => {
  it('「查看」取回定义与最新版本冻结产物：摘要、版本清单、来源引用与样本说明原文只读展示', async () => {
    await mountDialog()
    await openDetail()
    expect(vi.mocked(getResearchDefinition)).toHaveBeenCalledWith('d-row-1', undefined)
    expect(bodyFind('[data-testid="irs-detail-title"]').textContent).toContain('云南价格 × 新能源出力（共同样本相关）')
    const runs = [...document.body.querySelectorAll('[data-testid="irs-run"]')]
    expect(runs).toHaveLength(2)
    expect(runs[0]!.textContent).toContain('版本 2')
    expect(runs[1]!.textContent).toContain('版本 1')
    expect(bodyFind('[data-testid="irs-frozen-note"]').textContent).toContain('查看保存结果与按新源重算是两回事')
    expect(bodyFind('[data-testid="irs-evidence-inputs"]').textContent).toContain('用户侧日前价格')
    expect(bodyFind('[data-testid="irs-evidence-inputs"]').textContent).toContain('新能源出力（实际）')
    expect(bodyFind('[data-testid="irs-evidence-sample"]').textContent).toContain('样本 236 条')
    expect(bodyFind('[data-testid="irs-evidence-notes"]').textContent).toContain('不提供置信区间')
  })

  it('版本切换：点历史版本带 runNo 取回，旧版本原样可看（当前查看版本切换为 1）', async () => {
    vi.mocked(getResearchDefinition).mockResolvedValue(
      detailFixture({ latestRun: runContentFixture(1, '2026-09-18T09:00:00+08:00') }) as any
    )
    await mountDialog()
    await openDetail()
    const runs = [...document.body.querySelectorAll('[data-testid="irs-run"]')]
    runs[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(vi.mocked(getResearchDefinition)).toHaveBeenLastCalledWith('d-row-1', { runNo: 1 })
    expect(bodyFind('[data-testid="irs-detail-summary"]').textContent).toContain('当前查看版本 1')
    expect(bodyFind('[data-testid="irs-evidence-sample"]').textContent).toContain('样本 236 条')
  })
})

// ── 按新源重算（写权限；旧版本不变；源未变化如实说）──────────────────────────────────────

describe('按新源重算', () => {
  it('源已变化：重算请求发出，新增版本并刷新详情（重新取回最新版本），提示成功', async () => {
    await mountDialog()
    await openDetail()
    bodyFind('[data-testid="irs-rerun"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(vi.mocked(runResearchDefinition)).toHaveBeenCalledWith('d-row-1')
    expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('已按新源重算'))
    // 详情刷新：重新取回最新版本（不带 runNo）
    expect(vi.mocked(getResearchDefinition)).toHaveBeenLastCalledWith('d-row-1', undefined)
    expect(document.body.querySelector('[data-testid="irs-rerun-error"]')).toBeNull()
  })

  it('源未变化（changed:false）：如实提示「源未变化」后端原文，不冒充新算、不提示新增版本', async () => {
    vi.mocked(runResearchDefinition).mockResolvedValue({
      definitionId: 'd-row-1', regionId: 'yunnan', title: '云南价格 × 新能源出力（共同样本相关）',
      changed: false, run: runContentFixture(2, '2026-09-19T10:00:00+08:00'),
      runs: [
        { runNo: 2, resultVersion: `rv2:${HEX64}`, readSetRef: `rs2:${HEX64}`, createdBy: 'u-admin', createdAt: '2026-09-19T10:00:00+08:00' },
      ],
      note: '源资料未变化：本次重算与最新版本结果一致，没有生成新版本。',
      mock: false,
      productionWrite: false,
    } as any)
    await mountDialog()
    await openDetail()
    bodyFind('[data-testid="irs-rerun"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(bodyFind('[data-testid="irs-rerun-notice"]').textContent).toContain('源资料未变化')
    expect(successSpy).not.toHaveBeenCalledWith(expect.stringContaining('已按新源重算'))
  })

  it('重算失败（403）：展示后端原因原文，不冒充新算成功', async () => {
    vi.mocked(runResearchDefinition).mockRejectedValue(new Error('当前账号没有所选公司的写权限：可以分析与查看已保存研究，但不能按新源重算'))
    await mountDialog()
    await openDetail()
    bodyFind('[data-testid="irs-rerun"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(bodyFind('[data-testid="irs-rerun-error"]').textContent).toContain('当前账号没有所选公司的写权限')
    expect(successSpy).not.toHaveBeenCalledWith(expect.stringContaining('已按新源重算'))
  })

  it('无写权限：重算入口不渲染，查看入口与详情保留（查看是只读动作）', async () => {
    await mountDialog({ canWrite: false })
    expect(document.body.querySelector('[data-testid="irs-rerun"]')).toBeNull()
    expect(rows()).toHaveLength(2)
    await openDetail()
    expect(vi.mocked(getResearchDefinition)).toHaveBeenCalled()
    expect(bodyFind('[data-testid="irs-detail"]')).toBeTruthy()
    expect(vi.mocked(runResearchDefinition)).not.toHaveBeenCalled()
  })
})

// ── 业务语言纪律 ─────────────────────────────────────────────────────────────────────────

describe('业务语言', () => {
  it('列表与查看不出现定义标识、预设标识、版本指纹与请求字段名', async () => {
    await mountDialog()
    await openDetail()
    const text = bodyText()
    expect(text).not.toContain('d-row-1')
    expect(text).not.toContain('research.')
    expect(text).not.toContain('rs1:')
    expect(text).not.toContain('rv1:')
    expect(text).not.toContain('presetId')
    expect(text).not.toContain('definitionId')
    expect(text).not.toContain('ex-post')
    expect(text).not.toContain('readSetRef')
    expect(text).not.toContain('resultVersion')
  })
})
