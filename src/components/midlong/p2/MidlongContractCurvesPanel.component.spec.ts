// 合同详情分时分解区的交互不变量（dljy#2971，MP-04/MA-05）。
// 守什么：只有月量的月份显示「分时未知（只有月量）」；估算集单列为「不计入」；合同更正后电量未变的月份可沿用原曲线生成草稿，
// 电量已变的不给沿用；加载失败显示错误而不是空表。
// 坏掉的症状：更正后旧曲线静默沿用到新版本；电量变了还能一键沿用；估算混进正式列。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { ContractCurvesOverview } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({ fetchContractCurves: vi.fn(), createCurveDraft: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'STORAGE_UNAVAILABLE', message: (e as Error).message, details: null }) }))
vi.mock('@/services/midlong/midlongP2Api', () => ({ fetchContractCurves: hoisted.fetchContractCurves, createCurveDraft: hoisted.createCurveDraft, createCurveEstimate: vi.fn(), fetchCurveTemplate: vi.fn() }))

import MidlongContractCurvesPanel from './MidlongContractCurvesPanel.vue'

const STUBS = { 'router-link': { props: ['to'], template: '<a :data-to="to"><slot /></a>' }, MidlongCurveImportDialog: { template: '<div />' }, MidlongCurveEstimateDialog: { template: '<div />' } }

function overview(o: Partial<ContractCurvesOverview> = {}): ContractCurvesOverview {
  return {
    contractId: 7, companyId: 'comp-a', regionId: 'yunnan', externalContractNo: 'TEST-7', contractName: '【测试数据】', documentKind: 'OBLIGATION', confirmationStatus: 'CONFIRMED',
    currentRevisionNo: 2, deliveryStart: '2027-10-01', deliveryEnd: '2027-12-31', canCreate: true, sets: [], templates: [],
    months: [
      { month: '2027-10', monthlyFormalQuantity: '24', timeStatus: 'TIME_UNKNOWN', formalCurve: null, estimateCurve: null, estimateCorrectionImpact: null,
        correctionImpact: { status: 'RECONFIRM_REQUIRED', previousRevisionNo: 1, previousCurveSetId: 11, previousSetNo: 1, previousMonthlyQuantity: '24', previousCurveQuantity: '24', currentMonthlyQuantity: '24', monthAffectedByCorrection: true, canCopy: true } },
      { month: '2027-11', monthlyFormalQuantity: '30', timeStatus: 'TIME_UNKNOWN', formalCurve: null, estimateCurve: { curveSetId: 40, setNo: 4, granularityMinutes: 60, curveQuantity: '30', inheritedFromRevisionNo: null },
        correctionImpact: { status: 'QUANTITY_CHANGED', previousRevisionNo: 1, previousCurveSetId: 12, previousSetNo: 2, previousMonthlyQuantity: '24', previousCurveQuantity: '24', currentMonthlyQuantity: '30', monthAffectedByCorrection: true, canCopy: false },
        estimateCorrectionImpact: null },
      { month: '2027-12', monthlyFormalQuantity: null, timeStatus: 'MONTH_UNKNOWN', formalCurve: null, estimateCurve: null, correctionImpact: null, estimateCorrectionImpact: null },
    ],
    ...o,
  }
}

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('合同分时分解区', () => {
  it('分时未知与月量未知分开显示；估算单列为不计入；更正影响只对电量未变的月份提供沿用', async () => {
    hoisted.fetchContractCurves.mockResolvedValue(overview())
    const w = mount(MidlongContractCurvesPanel, { props: { contractId: 7, canWrite: true, evidence: [] }, global: { stubs: STUBS } })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('分时未知（只有月量）')
    expect(text).toContain('月量未知（未分解）')
    expect(text).toContain('估算 #4')
    expect(text).toContain('合同已更正，原数据绑定旧版本，需重新确认')
    expect(text).toContain('电量已变，请重新导入')
    const copyButtons = w.findAll('button').filter((b) => b.text() === '沿用原曲线生成草稿')
    expect(copyButtons).toHaveLength(1)
    hoisted.createCurveDraft.mockResolvedValue({ curveSetId: 50, setNo: 5, status: 'DRAFT', revisionNo: 2, validation: { blocking: false, blockingCount: 0, warningCount: 0, summary: [], completeness: 'COMPLETE' } })
    await copyButtons[0].trigger('click')
    await flushPromises()
    expect(hoisted.createCurveDraft).toHaveBeenCalledWith(7, { expectedRevisionNo: 2, evidenceBasis: 'FORMAL', coverageFromMonth: '2027-10', coverageToMonth: '2027-10', copyFromCurveSetId: 11 })
  })

  it('未受更正影响的月份标「沿用 v1」；内部估算受影响时单独提示，不给正式沿用按钮', async () => {
    hoisted.fetchContractCurves.mockResolvedValue(overview({
      months: [
        { month: '2027-09', monthlyFormalQuantity: '24', timeStatus: 'CURVE', correctionImpact: null, estimateCorrectionImpact: null,
          formalCurve: { curveSetId: 10, setNo: 1, granularityMinutes: 60, curveQuantity: '24', inheritedFromRevisionNo: 1 },
          estimateCurve: { curveSetId: 20, setNo: 2, granularityMinutes: 60, curveQuantity: '24', inheritedFromRevisionNo: 1 } },
        { month: '2027-10', monthlyFormalQuantity: '30', timeStatus: 'CURVE', correctionImpact: null, estimateCurve: null,
          formalCurve: { curveSetId: 30, setNo: 3, granularityMinutes: 60, curveQuantity: '30', inheritedFromRevisionNo: null },
          estimateCorrectionImpact: { status: 'QUANTITY_CHANGED', previousRevisionNo: 1, previousCurveSetId: 21, previousSetNo: 2, previousMonthlyQuantity: '24', previousCurveQuantity: '24', currentMonthlyQuantity: '30', monthAffectedByCorrection: true, canCopy: false } },
      ],
    }))
    const w = mount(MidlongContractCurvesPanel, { props: { contractId: 7, canWrite: true, evidence: [] }, global: { stubs: STUBS } })
    await flushPromises()
    const rows = w.findAll('.el-table__body').at(0)!.findAll('tr')
    expect(rows[0].findAll('td')[3].text()).toContain('沿用 v1')
    expect(rows[0].findAll('td')[4].text()).toContain('沿用 v1')
    expect(rows[1].findAll('td')[3].text()).not.toContain('沿用')
    const text = w.text()
    expect(text).toContain('合同更正影响：内部估算（不计入正式口径）')
    expect(text).toContain('v1 估算 #2')
    expect(text).not.toContain('以下月份受这次更正影响，原有的已确认曲线不再沿用')
    expect(w.findAll('button').filter((b) => b.text() === '沿用原曲线生成草稿')).toHaveLength(0)
  })

  it('只读用户看不到导入、估算与沿用操作', async () => {
    hoisted.fetchContractCurves.mockResolvedValue(overview())
    const w = mount(MidlongContractCurvesPanel, { props: { contractId: 7, canWrite: false, evidence: [] }, global: { stubs: STUBS } })
    await flushPromises()
    const labels = w.findAll('button').map((b) => b.text())
    expect(labels).not.toContain('导入曲线')
    expect(labels).not.toContain('沿用原曲线生成草稿')
  })

  it('加载失败显示错误，不显示空表冒充无曲线', async () => {
    hoisted.fetchContractCurves.mockRejectedValue(new Error('合同存储暂不可用'))
    const w = mount(MidlongContractCurvesPanel, { props: { contractId: 7, canWrite: true, evidence: [] }, global: { stubs: STUBS } })
    await flushPromises()
    expect(w.text()).toContain('分时分解加载失败')
    expect(w.text()).not.toContain('尚未登记任何分时分解')
  })
})
