// InsightMaterialDialog.component.spec.ts — 洞察材料窗口回归（dljy#3078 任务 14.5）
// 守什么不变量（对照 OpenSpec 14.5 与后端 insight-material 契约 dljy#3020）：
//   ① 打开才读底稿列表；列表读取失败诚实报错（不阻断、不假成功）；
//   ② 冻结请求带期望版本（resultVersion/readSetRef）与幂等键；先读底稿，非主笔不冻结；
//   ③ 源更新 409：提示「资料已更新，请先重新运行再保存」，不入稿、不提示成功；
//   ④ 保存成功：材料以图表块入稿（范围覆盖复盘对象=本次依据），窗口关闭并 emit saved；
//   ⑤ 幂等：同一份材料已在所选底稿中 → 提示未重复创建，不重复入稿；
//   ⑥ 底稿版本冲突（入稿 409）：如实说明材料已冻结但未加入，不称已保存。
// 窗口 append-to-body：内容经 document 查找（同 MidlongPositionsView spec 的下拉写法）。
import { enableAutoUnmount } from '@vue/test-utils'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import { ApiError } from '@/services/api'
import { nodePriceResult, READ_SET_REF, RESULT_VERSION } from './insightFixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureInsightMaterial,
  getWorkpaper,
  listWorkpapers,
  saveWorkpaper,
} from '@/services/review/workpapers'
import InsightMaterialDialog from './InsightMaterialDialog.vue'

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

const RESULT = nodePriceResult(['300.125'])

const REQUEST = {
  analysisId: 'prices.public-node-series',
  context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10', timeZone: 'Asia/Shanghai' }, sourceIds: [], mode: 'ex-post', asOf: null },
  filters: { view: 'series', objectIds: ['YN.KM.01'] },
}

function paperFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    title: '九月价格复盘',
    revision: 3,
    updatedAt: '2026-09-18T10:00:00+08:00',
    authorId: 'admin',
    canEdit: true,
    scope: { region: 'yunnan', view: 'generator', objectId: 'YN.KM.01', objectLabel: 'YN.KM.01', startDate: '2026-09-01', endDate: '2026-09-30' },
    blocks: [] as Array<Record<string, unknown>>,
    summary: '',
    ...overrides,
  }
}

function materialFixture() {
  return {
    id: 'ev-1',
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
        analysisId: REQUEST.analysisId,
        analysisVersion: '1.0.0',
        context: { regionId: 'yunnan', businessWindow: { start: '2026-09-10', end: '2026-09-10' }, sourceIds: [], mode: 'ex-post', asOf: null },
        filters: REQUEST.filters,
        expected: { resultVersion: RESULT_VERSION, readSetRef: READ_SET_REF },
      },
    },
  }
}

function apiError(status: number, msg: string): ApiError {
  return new ApiError(msg, { status, code: status, payload: { code: status, msg } })
}

let wrapper: ReturnType<typeof mount> | null = null

async function mountDialog() {
  wrapper = mount(InsightMaterialDialog, {
    props: {
      modelValue: true,
      region: 'yunnan',
      companyId: 'c1',
      subject: '时段走势',
      request: REQUEST,
      result: RESULT,
    },
  })
  await flushPromises()
  return wrapper
}

/** 弹窗挂在 body 下（append-to-body），在弹窗子树里按标识查元素。 */
function bodyFind(selector: string): DOMWrapper<Element> {
  const dialog = document.body.querySelector('[data-testid="insight-material-dialog"]')
  if (!dialog) throw new Error('弹窗未渲染')
  const el = dialog.querySelector(selector)
  if (!el) throw new Error(`弹窗里没有 ${selector}`)
  return new DOMWrapper(el)
}

function errorText(): string {
  return bodyFind('[data-testid="insight-material-error"]').text()
}

async function choosePaperAndSave(label: string) {
  // 打开下拉并按业务文案点选底稿（下拉同样 teleport 到 body）
  bodyFind('.el-select__wrapper').trigger('click')
  await flushPromises()
  const item = [...document.querySelectorAll<HTMLElement>('.el-select-dropdown__item')].find((el) => el.textContent?.includes(label))
  if (!item) throw new Error(`下拉里没有「${label}」选项`)
  item.click()
  await flushPromises()
  await bodyFind('[data-testid="insight-material-save"]').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paperFixture()], hasMore: false, offset: 0 } as never)
  vi.mocked(getWorkpaper).mockResolvedValue(paperFixture() as never)
  vi.mocked(captureInsightMaterial).mockResolvedValue(materialFixture() as never)
  vi.mocked(saveWorkpaper).mockResolvedValue(paperFixture() as never)
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  // 模块级 vi.fn() 只清调用记录与实现；默认返回值在 beforeEach 里重设
  vi.clearAllMocks()
})
enableAutoUnmount(afterEach)

describe('底稿列表', () => {
  it('打开即读底稿列表；读取失败诚实报错，不假装可保存', async () => {
    vi.mocked(listWorkpapers).mockRejectedValue(new Error('network down'))
    await mountDialog()

    expect(listWorkpapers).toHaveBeenCalledWith('c1', 'yunnan')
    expect(errorText()).toContain('底稿列表读取失败')
    expect(errorText()).toContain('不影响分析页其余功能')
  })
})

describe('冻结与入稿', () => {
  it('保存成功：先读底稿；冻结请求带期望版本与幂等键；材料以图表块入稿为「本次依据」；emit saved 并关窗', async () => {
    const mounted = await mountDialog()
    await choosePaperAndSave('九月价格复盘')

    // 先读底稿（主笔校验在冻结之前），再冻结，再入稿
    expect(getWorkpaper).toHaveBeenCalledWith('c1', 'yunnan', 'p-1')
    expect(captureInsightMaterial).toHaveBeenCalledTimes(1)
    const [, region, request, expected, key] = vi.mocked(captureInsightMaterial).mock.calls[0]
    expect(region).toBe('yunnan')
    expect(request).toEqual(REQUEST) // props 经响应式代理，同内容不同引用
    expect(expected).toEqual({ resultVersion: RESULT_VERSION, readSetRef: READ_SET_REF })
    expect(String(key)).toMatch(/^insight-material-/)

    expect(saveWorkpaper).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(saveWorkpaper).mock.calls[0][1]
    expect(saved.blocks).toHaveLength(1)
    expect(saved.blocks[0]).toMatchObject({
      kind: 'chart',
      evidenceId: 'ev-1',
      // 材料对象含复盘对象且窗口在底稿周期内 → 本次依据（与服务端核对口径一致）
      evidenceRole: 'primary',
    })

    expect(mounted.emitted('saved')).toHaveLength(1)
    const closes = mounted.emitted('update:modelValue') ?? []
    expect(closes.at(-1)?.[0]).toBe(false)
  })

  it('材料范围不含复盘对象或窗口不符 → 标为「比较依据」（与服务端 validateMaterialReferences 同口径）', async () => {
    vi.mocked(getWorkpaper).mockResolvedValue(
      paperFixture({ scope: { region: 'yunnan', view: 'generator', objectId: 'YN.OTHER.99', objectLabel: '别的对象', startDate: '2026-10-01', endDate: '2026-10-31' } }) as never
    )
    await mountDialog()
    await choosePaperAndSave('九月价格复盘')

    const saved = vi.mocked(saveWorkpaper).mock.calls[0][1]
    expect(saved.blocks[0].evidenceRole).toBe('comparison')
  })

  it('非主笔底稿：不发起冻结，说明只有主笔可修改，未保存', async () => {
    vi.mocked(getWorkpaper).mockResolvedValue(paperFixture({ canEdit: false, authorId: 'colleague' }) as never)
    const mounted = await mountDialog()
    await choosePaperAndSave('九月价格复盘')

    expect(captureInsightMaterial).not.toHaveBeenCalled()
    expect(saveWorkpaper).not.toHaveBeenCalled()
    expect(errorText()).toContain('colleague 主笔')
    expect(errorText()).toContain('本次未保存')
    expect(mounted.emitted('saved')).toBeUndefined()
  })

  it('同一份材料已在所选底稿中：提示未重复创建（幂等），不再入稿', async () => {
    vi.mocked(getWorkpaper).mockResolvedValue(
      paperFixture({ blocks: [{ id: 'b-1', kind: 'chart', title: '公开历史节点价格序列', text: '', evidenceId: 'ev-1', evidenceRole: 'primary' }] }) as never
    )
    const mounted = await mountDialog()
    await choosePaperAndSave('九月价格复盘')

    // 冻结幂等命中（服务端返回同一份材料），但不再重复加块
    expect(saveWorkpaper).not.toHaveBeenCalled()
    expect(mounted.emitted('saved')).toHaveLength(1)
  })
})

describe('失败语义（未成功绝不提示成功）', () => {
  it('源更新 409：提示「资料已更新，请先重新运行再保存」，不入稿不关窗', async () => {
    const mounted = await mountDialog()
    vi.mocked(captureInsightMaterial).mockRejectedValue(apiError(409, '资料已更新：保存前核对到的版本与你看到的不一致'))
    await choosePaperAndSave('九月价格复盘')

    expect(errorText()).toContain('资料已更新，请先重新运行再保存')
    expect(saveWorkpaper).not.toHaveBeenCalled()
    expect(mounted.emitted('saved')).toBeUndefined()
    const closes = mounted.emitted('update:modelValue') ?? []
    expect(closes.filter((entry) => entry[0] === false)).toHaveLength(0)
  })

  it('材料服务不可用：诚实说明未保存，分析页其余功能不受影响的口径在场', async () => {
    await mountDialog()
    vi.mocked(captureInsightMaterial).mockRejectedValue(new Error('timeout'))
    await choosePaperAndSave('九月价格复盘')

    expect(errorText()).toContain('材料服务暂不可用')
    expect(errorText()).toContain('本次未保存')
    expect(saveWorkpaper).not.toHaveBeenCalled()
    expect(wrapper!.emitted('saved')).toBeUndefined()
  })

  it('入稿时底稿刚被他人保存（PATCH 409）：说明材料已冻结但未加入，不称已保存', async () => {
    const mounted = await mountDialog()
    vi.mocked(saveWorkpaper).mockRejectedValue(apiError(409, '正文已更新，请阅读新版本后再保存'))
    await choosePaperAndSave('九月价格复盘')

    expect(captureInsightMaterial).toHaveBeenCalledTimes(1)
    expect(errorText()).toContain('底稿刚被更新')
    expect(errorText()).toContain('材料已冻结保存')
    expect(errorText()).toContain('没有加入这份底稿')
    expect(mounted.emitted('saved')).toBeUndefined()
  })
})
