// 合同调整详情抽屉（dljy#3014，MA-02..05）。
// 守什么：影响对比逐月 before/after/delta、asOf 视角说明与已结束片段提示；独立价款单列；
//        方向待核对阻止确认生效；确认带 expectedRowVersion，并发同基线 409 引导修订重对基线；已生效后不可再改。
// 坏掉的症状：待核对的调整被确认生效改了持仓；基线移动后旧确认覆盖他人变更；转让价款混进均价展示。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { AdjustmentDetailDto, AdjustmentImpactReport } from '@/services/midlong/midlongP4Types'

const hoisted = vi.hoisted(() => ({ fetchAdjustment: vi.fn(), fetchAdjustmentImpact: vi.fn(), confirmAdjustment: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP4Api', () => ({
  fetchAdjustment: hoisted.fetchAdjustment, fetchAdjustmentImpact: hoisted.fetchAdjustmentImpact, confirmAdjustment: hoisted.confirmAdjustment,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: vi.fn(async () => 'Zg==') }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import AdjustmentDetailDrawer from './AdjustmentDetailDrawer.vue'
import { ADJUSTMENT_NOTICES } from '@/services/midlong/midlongP4Types'

const DRAWER_TIMEOUT = 20000
const bodyText = () => document.body.textContent ?? ''

function detail(overrides: Record<string, unknown> = {}): AdjustmentDetailDto {
  return {
    id: 31, companyId: 'comp-a', regionId: 'yunnan', contractId: 7, contractNo: 'M-7', contractName: '月度合同',
    subjectId: 1, subjectName: '云南中广核一号', sourceNamespace: '昆明交易中心', externalAdjustmentNo: 'T-2026-01', externalRevisionNo: 1,
    status: 'DRAFT', currentRevisionNo: 1, rowVersion: 2, adjustmentType: 'TRANSFER', direction: 'OBLIGATION_DECREASE',
    directionSource: 'DOCUMENT_FIELD', pendingReason: null, baseRevisionNo: 3, totalQuantity: '200',
    prices: { transferPrice: { amount: '50000', currency: 'CNY', taxBasis: 'TAX_INCLUDED', note: null }, compensation: { amount: '3000', currency: 'CNY', taxBasis: 'UNKNOWN', note: '违约补偿' } },
    effective: null, createdAt: '', createdBy: null, updatedAt: '',
    revisions: [{
      id: 1, revisionNo: 1, supersedesRevisionNo: null, adjustmentType: 'TRANSFER', direction: 'OBLIGATION_DECREASE',
      directionSource: 'DOCUMENT_FIELD', directionSourceLabel: '核验单据明确字段', pendingReason: null, externalProductCode: null,
      counterpartyName: '受让方甲', baseContractRevisionNo: 3, businessEffectiveAt: null, reason: '经平台转让 10—11 月电量',
      note: null,
      prices: { transferPrice: { amount: '50000', currency: 'CNY', taxBasis: 'TAX_INCLUDED', note: null }, compensation: { amount: '3000', currency: 'CNY', taxBasis: 'UNKNOWN', note: '违约补偿' } },
      evidenceIds: [11], recordedAt: '', recordedBy: null,
      segments: [{ id: 1, deliveryMonth: '2026-10', quantity: '200' }],
    }],
    effectuation: null, notices: [],
    ...overrides,
  } as AdjustmentDetailDto
}

function impact(overrides: Record<string, unknown> = {}): AdjustmentImpactReport {
  return {
    adjustmentId: 31, status: 'DRAFT', adjustmentType: 'TRANSFER', direction: 'OBLIGATION_DECREASE',
    contractId: 7, contractNo: 'M-7', contractName: '月度合同',
    externalKey: { sourceNamespace: '昆明交易中心', externalAdjustmentNo: 'T-2026-01', externalRevisionNo: 1 },
    months: ['2026-10', '2026-11'],
    snapshot: {
      frozen: false,
      months: [
        { deliveryMonth: '2026-10', before: '1000', after: '800', delta: '-200' },
        { deliveryMonth: '2026-11', before: '500', after: '500', delta: '0' },
      ],
      totalDelta: null, beforeRevisionNo: 3, afterRevisionNo: null, beforeTotalQuantity: '1500', afterTotalQuantity: null,
    },
    prices: {}, affectedPlans: [{ planId: 1, periodType: 'YEAR', periodKey: '2026', revisionNo: 2, targetQuantity: '12000' }],
    affectedProposals: [{ proposalId: 8, status: 'SUBMITTED', ownerName: null, months: [{ deliveryMonth: '2026-10', occupiedQuantity: '200', openQuantity: '50' }] }],
    asOfExplanation: ADJUSTMENT_NOTICES.retroactive, endedMonths: ['2026-04'], notices: [],
    ...overrides,
  } as AdjustmentImpactReport
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open(r: AdjustmentImpactReport = impact()) {
  // 不在此处设置 fetchAdjustment 实现：部分用例需要 Once/默认序列（如确认成功后重载为已生效）。
  hoisted.fetchAdjustmentImpact.mockResolvedValue(r)
  const w = mount(AdjustmentDetailDrawer, {
    props: { modelValue: true, adjustmentId: 31, canWrite: true },
    attachTo: document.body,
    global: { stubs: { 'router-link': { props: ['to'], template: '<a :data-to="String(to)"><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

describe('合同调整详情抽屉', () => {
  it('影响对比逐月 before/after/delta、受影响计划与方案只读、已结束片段与 asOf 说明', async () => {
    hoisted.fetchAdjustment.mockResolvedValue(detail())
    await open()
    const text = bodyText()
    expect(text).toContain('2026-10：1,000 → 800（-200 MWh）')
    expect(text).toContain('受影响售电目标：2026 目标 12,000 MWh')
    expect(text).toContain('受影响方案 #8')
    expect(text).toContain(ADJUSTMENT_NOTICES.retroactive)
    expect(text).toContain('已结束片段：2026-04')
    expect(text).toContain('拟变更（未生效）')
  }, DRAWER_TIMEOUT)

  it('独立价款单列展示（转让价款/补偿），不与售电价合并', async () => {
    hoisted.fetchAdjustment.mockResolvedValue(detail())
    await open()
    const lines = [...document.body.querySelectorAll('[data-test="price-lines"]')].map((el) => el.textContent)
    expect(lines.join(' / ')).toContain('转让价款：50,000 CNY（含税）')
    expect(lines.join(' / ')).toContain('补偿价款：3,000 CNY（含税口径未知 · 违约补偿）')
    expect(bodyText()).toContain(ADJUSTMENT_NOTICES.priceIndependent)
  }, DRAWER_TIMEOUT)

  it('方向待核对：确认按钮不可用并提示修订补方向；修订入口保留', async () => {
    hoisted.fetchAdjustment.mockResolvedValue(detail({ status: 'PENDING_VERIFICATION', direction: null, directionSource: null, pendingReason: 'NO_DIRECTION' }))
    await open()
    expect(document.body.querySelector('[data-test="direction-pending"]')?.textContent).toContain(ADJUSTMENT_NOTICES.directionPending)
    const confirmButton = document.body.querySelector('[data-test="confirm-adjustment"]') as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)
    expect(bodyText()).toContain('修订补明确方向')
    expect(Boolean(document.body.querySelector('[data-test="revise-adjustment"]'))).toBe(true)
  }, DRAWER_TIMEOUT)

  it('确认生效：带 expectedRowVersion；并发同基线 409 提示重对基线并引导修订', async () => {
    hoisted.fetchAdjustment.mockResolvedValue(detail())
    hoisted.confirmAdjustment.mockRejectedValueOnce({
      failure: { status: 409, errorCode: 'VERSION_CONFLICT', message: '合同已被变更', details: { reason: 'BASE_REVISION_MOVED', baseRevisionNo: 3, currentRevisionNo: 5 } },
    })
    await open()
    ;(document.body.querySelector('[data-test="confirm-adjustment"]') as HTMLButtonElement).click()
    await flushPromises()
    // 既有依据（evidenceIds=[11]）时可直接确认：文件可空。
    const submit = () => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '确认生效（原子）') as HTMLButtonElement
    submit().click()
    await flushPromises()
    expect(hoisted.confirmAdjustment).toHaveBeenCalledWith(31, expect.objectContaining({ expectedRowVersion: 2 }))
    const error = document.body.querySelector('[data-test="drawer-action-error"]')
    expect(error?.textContent).toContain('已被他人变更')
    expect(error?.textContent).toContain('重新对准最新基线')
  }, DRAWER_TIMEOUT)

  it('确认成功：显示逐月 before/after/delta、总差量与调整后总量；已生效调整不再提供确认/修订', async () => {
    hoisted.confirmAdjustment.mockResolvedValue({
      adjustmentId: 31, revisionNo: 1, status: 'EFFECTIVE', contractId: 7, contractRevisionNo: 4, baseRevisionNo: 3,
      direction: 'OBLIGATION_DECREASE',
      months: [{ deliveryMonth: '2026-10', before: '1000', after: '800', delta: '-200' }],
      totalDelta: '-200', totalQuantityAfter: '1300', prices: {}, effectuationId: 1, effectiveAt: '', rowVersion: 3,
      notices: [ADJUSTMENT_NOTICES.segmentScopeOnly],
    })
    // 确认前 DRAFT（可确认）；确认后重载为 EFFECTIVE（终态）。
    const beforeConfirm = detail()
    const afterConfirm = detail({
      status: 'EFFECTIVE', rowVersion: 3,
      effective: { contractRevisionNo: 4, totalDelta: '-200', effectiveAt: '' },
      effectuation: { id: 1, revisionNo: 1, contractId: 7, baseRevisionNo: 3, newRevisionNo: 4, direction: 'OBLIGATION_DECREASE', totalDelta: '-200', impact: {}, effectiveAt: '', effectedBy: 'u' },
    })
    hoisted.fetchAdjustment.mockResolvedValueOnce(beforeConfirm).mockResolvedValue(afterConfirm)
    await open(impact({
      status: 'EFFECTIVE',
      snapshot: { frozen: true, months: [{ deliveryMonth: '2026-10', before: '1000', after: '800', delta: '-200' }], totalDelta: '-200', beforeRevisionNo: 3, afterRevisionNo: 4, beforeTotalQuantity: '1500', afterTotalQuantity: '1300' },
    }))
    ;(document.body.querySelector('[data-test="confirm-adjustment"]') as HTMLButtonElement).click()
    await flushPromises()
    const submit = [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === '确认生效（原子）') as HTMLButtonElement
    submit.click()
    await flushPromises()
    const result = document.body.querySelector('[data-test="confirm-result"]')
    expect(result?.textContent).toContain('2026-10：1,000 → 800（-200 MWh）')
    expect(result?.textContent).toContain('调整后总量 1,300 MWh')
    // 已生效：确认/修订入口消失（后续变化登记新的外部调整）。
    expect(Boolean(document.body.querySelector('[data-test="confirm-adjustment"]'))).toBe(false)
    expect(Boolean(document.body.querySelector('[data-test="revise-adjustment"]'))).toBe(false)
  }, DRAWER_TIMEOUT)
})
