// 收益三层拆解面板组件测试（#2043 主路径：瀑布真数据 / 分时段 / 环比强制归因 / Top5 人填；
// 入案例库接线：勾选即落库、空壳前置拦截、失败重试、端点缺席本地勾选；
// 案例回读水合：已登记行恢复案号+勾选态+锁行，防重复登记；「不落库」文案主语限定）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/review/reviewPeriodClient', () => ({ fetchReviewRange: vi.fn() }))
vi.mock('@/services/review/reviewStoreClient', () => ({
  fetchCases: vi.fn(),
  registerCase: vi.fn()
}))
vi.mock('@/services/review/templateInstanceClient', () => ({
  fetchTemplateInstanceFeed: vi.fn(),
  patchTemplateInstance: vi.fn()
}))

import { fetchReviewRange, type PeriodReviewDay } from '@/services/review/reviewPeriodClient'
import { fetchCases, registerCase } from '@/services/review/reviewStoreClient'
import { fetchTemplateInstanceFeed, patchTemplateInstance } from '@/services/review/templateInstanceClient'
import PnlDecomposePanel from './PnlDecomposePanel.vue'
import { mount } from '@/test/mount'
import type { SettlementRuleSpec } from '@/rules/types'

const spec = {
  regionId: 'test', version: 'v0', effectiveness: 'trial', deviationTolerancePct: 3,
  assessmentPriceBasis: 'da', assessmentPriceFloor: 0,
  timeSegmentFactors: [{ segment: '峰', hours: [11], factor: 1.2 }],
  recycleSubjects: [], notes: [], references: []
} as unknown as SettlementRuleSpec

function okDay(date: string, da: number, rt: number): PeriodReviewDay {
  return {
    ok: true as const, date, declaredTotalMwh: 10, causeId: null, causeLabel: null,
    result: {
      date,
      source: 'platform',
      deviation: { points: 1, total_abs_deviation_mwh: 1, assessed_mwh: 0, estimated_penalty_yuan: 0, tolerance_pct: 3, worst_point: { datetime: date, deviation: 0 } },
      detail: [
        { datetime: `${date} 00:15`, declared: 10, actual: 10, da_price: da, rt_price: rt },
        { datetime: `${date} 11:15`, declared: 5, actual: 5, da_price: da, rt_price: rt }
      ]
    }
  } as unknown as PeriodReviewDay
}

beforeEach(() => {
  vi.mocked(fetchReviewRange).mockReset()
  vi.mocked(fetchCases).mockReset()
  vi.mocked(fetchCases).mockResolvedValue({ available: true, cases: [] })
  vi.mocked(registerCase).mockReset()
  vi.mocked(fetchTemplateInstanceFeed).mockReset()
  vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
  vi.mocked(patchTemplateInstance).mockReset()
})

async function settle(wrapper: ReturnType<typeof mount>) {
  for (let i = 0; i < 6; i++) await nextTick()
  return wrapper
}

describe('PnlDecomposePanel', () => {
  it('月度主路径：瀑布出真数（日前/实时增量）、分时段表、Top5 表（人填栏）', async () => {
    // 第一次调用=本月，第二次=上月（环比基线）
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 310), okDay('2026-08-02', 500, 480)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    const text = wrapper.text()
    expect(text).toContain('收益三层拆解 · 分品种')
    expect(text).toContain('现货·日前')       // PnLWaterfall 真数据段
    expect(text).toContain('现货·实时增量')
    expect(text).toContain('中长期')           // 未接入标注行
    expect(text).toContain('分时段')
    expect(text).toContain('峰')
    expect(text).toContain('单笔 Top5 盈亏榜')
    expect(text).toContain('以日为笔')
    expect(text).toContain('主要成因')         // 人填栏
    expect(text).toContain('决策参考，非结算依据')
    // 中长期层的大白话口径说明（F3 升级：等计算方法拍板，数据在合同库里）
    expect(text).toContain('暂时算不了')
    // F4：无模板单时「不落库」文案必须限定主语——手填文字的自动保存，与案例入库链路区分
    expect(text).toContain('成因/经验不会自动保存，仅本机暂存')
    expect(text).toContain('仍会立即登记入库')
  })

  it('环比超 20% → 强制归因提示；上期无数据 → 不强制', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 500, 500)], missingDays: [] })      // 本月 7500×2=15000×…大幅
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 100, 100)], missingDays: [] })      // 上月小
    let wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('变动超 20%')
    expect(wrapper.text()).toContain('必填')

    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 310)], missingDays: [] })
      .mockResolvedValueOnce({ days: [], missingDays: [] })                                    // 上期无数据
    wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('上期无数据（不强制归因）')
  })

  it('本月无数据日 → 诚实空态', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [], missingDays: [] })
      .mockResolvedValueOnce({ days: [], missingDays: [] })
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('无可用数据日')
  })

  it('入案例库：勾选即 registerCase（deviation 四要素）；空壳前置拦截不落库', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 250)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    vi.mocked(registerCase).mockResolvedValue({
      id: '1', caseNo: 'AL-20260902-001', caseType: 'deviation', title: 't', visibility: 'internal', lessons: 'l', createdAt: null
    })
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    const row = wrapper.find('.pdp-top-table tbody tr')
    // 空壳前置拦截：未填成因/经验勾选 → 不落库 + 行内红字 + 取消勾选
    await row.find('input[type="checkbox"]').setValue(true)
    await settle(wrapper)
    expect(registerCase).not.toHaveBeenCalled() // 空壳不落库
    expect(wrapper.text()).toContain('不接受空壳沉淀')
    // 填齐四要素人填栏后勾选 → registerCase(deviation) 落库，行内回 case_no
    const inputs = row.findAll('.pdp-input')
    await inputs[0].setValue('负荷预测偏差放大')
    await inputs[1].setValue('次日引入温度修正因子')
    await row.find('.pdp-retry').trigger('click') // 填齐后经重试按钮再次提交
    await settle(wrapper)
    expect(registerCase).toHaveBeenCalledTimes(1)
    const caseDraft = vi.mocked(registerCase).mock.calls[0][0]
    expect(caseDraft.caseType).toBe('deviation')
    expect(caseDraft.title).toContain('偏差Top5')
    expect(caseDraft.conclusion).toBe('负荷预测偏差放大')
    expect(caseDraft.lessons).toBe('次日引入温度修正因子')
    expect(wrapper.text()).toContain('AL-20260902-001')
    // 档案纪律：已入库行勾选框禁用（沉淀后不可撤回）
    expect((row.find('input[type="checkbox"]').element as HTMLInputElement).disabled).toBe(true)
    // F1：入库后行内成因/经验一并锁死——页面不得与不可改写档案分叉
    expect((inputs[0].element as HTMLInputElement).disabled).toBe(true)
    expect((inputs[1].element as HTMLInputElement).disabled).toBe(true)
  })

  it('已登记案例回读水合：案号回显、勾选框回显且禁用、空经验栏回填、不产生新登记', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 250)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    vi.mocked(fetchCases).mockResolvedValue({
      available: true,
      cases: [{
        id: '9', caseNo: 'AL-20260801-007', caseType: 'deviation',
        title: '偏差Top5：2026-08-01 盈利 12,345 元', visibility: 'internal', lessons: '已入库的经验', createdAt: null
      }]
    })
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    const row = wrapper.find('.pdp-top-table tbody tr')
    expect(wrapper.text()).toContain('AL-20260801-007') // 案号回显
    const checkbox = row.find('input[type="checkbox"]').element as HTMLInputElement
    expect(checkbox.checked).toBe(true)   // 已入库状态回显
    expect(checkbox.disabled).toBe(true)
    const inputs = row.findAll('.pdp-input')
    expect((inputs[0].element as HTMLInputElement).disabled).toBe(true)
    expect((inputs[1].element as HTMLInputElement).disabled).toBe(true)
    expect((inputs[1].element as HTMLInputElement).value).toBe('已入库的经验') // 空栏回填案例经验
    expect((inputs[0].element as HTMLInputElement).value).toBe('')            // 成因列表接口不返回，留空如实
    expect(registerCase).not.toHaveBeenCalled()                               // 水合不产生新登记
  })

  it('人填内容自动存模板三草稿（payload.pnlTop5）并保留实例既有结构化键', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 250)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    vi.mocked(fetchTemplateInstanceFeed).mockResolvedValue({
      available: true,
      instances: [{ id: '33', templateId: 'T03', periodKey: '2026-09', status: 'draft', dueAt: null, updatedAt: null, payload: { existing: { a: 1 } } }]
    })
    vi.mocked(patchTemplateInstance).mockResolvedValue()
    const wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    expect(wrapper.text()).toContain('模板三实例 #33')
    const row = wrapper.find('.pdp-top-table tbody tr')
    await row.findAll('.pdp-input')[0].setValue('测试成因')
    for (let i = 0; i < 10 && vi.mocked(patchTemplateInstance).mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 300))
    }
    await settle(wrapper)
    expect(patchTemplateInstance).toHaveBeenCalledTimes(1)
    const patch = vi.mocked(patchTemplateInstance).mock.calls[0][1] as { payload: Record<string, unknown>; status: string }
    expect(patch.status).toBe('draft')
    expect((patch.payload as Record<string, unknown>).pnlTop5).toMatchObject({
      '2026-08-01': { mainCause: '测试成因' }
    })
    expect((patch.payload as Record<string, unknown>).existing).toEqual({ a: 1 }) // 既有键原样保留
  })

  it('入案例库失败：红字 + 重试按钮（写路径不静默）；端点缺席保持本地勾选如实标注', async () => {
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 250)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    vi.mocked(registerCase).mockRejectedValue(new Error('案例登记失败（HTTP 503）'))
    let wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    const row = wrapper.find('.pdp-top-table tbody tr')
    const inputs = row.findAll('.pdp-input')
    await inputs[0].setValue('成因')
    await inputs[1].setValue('经验')
    await row.find('input[type="checkbox"]').setValue(true)
    await settle(wrapper)
    expect(wrapper.text()).toContain('案例登记失败')
    expect(wrapper.text()).toContain('重试')
    // 重试成功 → case_no 回执
    vi.mocked(registerCase).mockResolvedValue({
      id: '2', caseNo: 'AL-20260902-002', caseType: 'deviation', title: 't', visibility: 'internal', lessons: 'l', createdAt: null
    })
    await row.find('.pdp-retry').trigger('click')
    await settle(wrapper)
    expect(wrapper.text()).toContain('AL-20260902-002')
    // 端点缺席环境：勾选保持本地、如实标注「本地」不落库
    vi.mocked(fetchCases).mockResolvedValue({ available: false, reason: 'endpoint-absent' })
    const callsBeforeRemount = vi.mocked(registerCase).mock.calls.length
    vi.mocked(fetchReviewRange)
      .mockResolvedValueOnce({ days: [okDay('2026-08-01', 300, 250)], missingDays: [] })
      .mockResolvedValueOnce({ days: [okDay('2026-07-01', 300, 310)], missingDays: [] })
    wrapper = await settle(mount(PnlDecomposePanel, { props: { spec, tolerancePct: 3, penaltyPrice: 100 } }))
    const localRow = wrapper.find('.pdp-top-table tbody tr')
    await localRow.find('input[type="checkbox"]').setValue(true)
    await settle(wrapper)
    expect(registerCase).toHaveBeenCalledTimes(callsBeforeRemount) // 端点缺席：勾选不落库
    expect(wrapper.text()).toContain('本地')
  })
})
