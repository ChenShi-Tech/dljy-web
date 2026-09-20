// 外部账单详情抽屉（dljy#3016，MR-02/03）。
// 守什么：当前有效版本口径金额（两版不双计）、版本链旧版保留可查（含各版分项）、无凭证不显示到账、
//         综合账单只归档标未分项、修订与凭证入口；差异计数含「需重新核对」提示。
// 坏掉的症状：两版金额相加显示；无凭证账单显示已到账；综合账单出现推算的中长期分项金额。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { BillDetailDto } from '@/services/midlong/midlongP5Types'
import type { MidlongSubject } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchBill: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({ fetchBill: hoisted.fetchBill }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import BillDetailDrawer from './BillDetailDrawer.vue'
import { SETTLEMENT_NOTICES } from '@/services/midlong/midlongP5Types'

const DRAWER_TIMEOUT = 20000
const bodyText = () => document.body.textContent ?? ''
const subjects: MidlongSubject[] = [] as unknown as MidlongSubject[]

function detail(overrides: Record<string, unknown> = {}): BillDetailDto {
  return {
    id: 9, companyId: 'comp-a', regionId: 'yunnan', subjectId: 3, subjectName: '云南中广核一号',
    sourceNamespace: '昆明交易中心', externalBillNo: 'B-2026-001',
    currentRevisionNo: 2, revisionCount: 2, rowVersion: 5,
    billKind: 'ITEMIZED', sourceName: null, externalRevisionLabel: 'R2',
    periodStartMonth: '2026-08', periodEndMonth: '2026-08', currency: 'CNY', taxBasis: 'TAX_INCLUDED',
    amount: '144000', lineItemCount: 1, lineItemQuantity: '960', lineItemAmount: '288000',
    voucherCount: 0, voucherAmount: null, openDiscrepancyCount: 1, recheckDiscrepancyCount: 1,
    createdAt: '', updatedAt: '',
    revisions: [
      {
        id: 1, revisionNo: 1, supersedesRevisionNo: null, billKind: 'ITEMIZED', sourceName: null, externalRevisionLabel: null,
        periodStartMonth: '2026-08', periodEndMonth: '2026-08', currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'UNVERIFIED',
        amount: '291000', note: null, changeReason: null, attachmentId: null, lineItemQuantity: '970', lineItemAmount: '291000',
        lineItems: [{ id: 1, deliveryMonth: '2026-08', quantity: '970', price: '300', amount: '291000', note: null }],
        recordedAt: '2026-09-01T00:00:00Z', recordedBy: 'u1',
      },
      {
        id: 2, revisionNo: 2, supersedesRevisionNo: 1, billKind: 'ITEMIZED', sourceName: null, externalRevisionLabel: 'R2',
        periodStartMonth: '2026-08', periodEndMonth: '2026-08', currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'UNVERIFIED',
        amount: '144000', note: null, changeReason: '收到更正版本 R2', attachmentId: null, lineItemQuantity: '960', lineItemAmount: '288000',
        lineItems: [{ id: 2, deliveryMonth: '2026-08', quantity: '960', price: '300', amount: '288000', note: null }],
        recordedAt: '2026-09-05T00:00:00Z', recordedBy: 'u1',
      },
    ],
    vouchers: [],
    discrepancies: [
      { id: 5, status: 'RECHECK_REQUIRED', deliveryMonth: '2026-08', quantityDelta: '-20', priceDelta: '0' },
    ],
    events: [], notices: [],
    ...overrides,
  } as unknown as BillDetailDto
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open(d: BillDetailDto = detail()) {
  hoisted.fetchBill.mockResolvedValue(d)
  const w = mount(BillDetailDrawer, {
    props: { modelValue: true, billId: 9, canWrite: true, subjects },
    attachTo: document.body,
    global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

describe('外部账单详情抽屉', () => {
  it('当前有效版本口径：金额取 v2 分项（144,000 整单 / 288,000 分项），无凭证不显示到账；差异需重核提示', async () => {
    await open()
    const amounts = document.body.querySelector('[data-test="bill-current-amounts"]')?.textContent ?? ''
    expect(amounts).toContain('144,000')
    expect(amounts).toContain('288,000')
    expect(amounts).toContain('无凭证（未显示到账）')
    expect(document.body.querySelector('[data-test="bill-discrepancy-counts"]')?.textContent).toContain('需重新核对 1')
    expect(bodyText()).not.toContain('435,000')
  }, DRAWER_TIMEOUT)

  it('版本链旧版保留：v1（291,000）与 v2 都可查，当前有效只标 v2；两版金额不相加', async () => {
    await open()
    const text = bodyText()
    expect(text).toContain('v1')
    expect(text).toContain('v2')
    expect(text).toContain('291,000')
    expect(text).toContain('当前有效')
    expect(text).toContain('收到更正版本 R2')
  }, DRAWER_TIMEOUT)

  it('综合账单（UNITEMIZED）：标未分项归档、版本行注明不推算分项；不显示中长期分项金额', async () => {
    await open(detail({
      billKind: 'UNITEMIZED', amount: '500000', lineItemCount: 0, lineItemQuantity: null, lineItemAmount: null,
      notices: [SETTLEMENT_NOTICES.unitemizedArchive, SETTLEMENT_NOTICES.noVoucherNoReceipt],
      revisions: [{
        id: 1, revisionNo: 1, supersedesRevisionNo: null, billKind: 'UNITEMIZED', sourceName: null, externalRevisionLabel: null,
        periodStartMonth: '2026-08', periodEndMonth: '2026-08', currency: 'CNY', taxBasis: 'UNKNOWN', priceComponent: 'UNVERIFIED',
        amount: '500000', note: null, changeReason: null, attachmentId: null, lineItemQuantity: '0', lineItemAmount: null,
        lineItems: [], recordedAt: '', recordedBy: null,
      }],
    }))
    const text = bodyText()
    expect(text).toContain('综合账单（未分项，仅归档）')
    expect(text).toContain('不对综合总额做任何比例拆分或推算')
    expect(text).toContain('整单归档，未分项不进中长期金额')
  }, DRAWER_TIMEOUT)

  it('写入口：修订与登记收款凭证按钮（canWrite）；金额口径提示单列', async () => {
    await open()
    expect(Boolean(document.body.querySelector('[data-test="revise-bill"]'))).toBe(true)
    expect(Boolean(document.body.querySelector('[data-test="add-voucher"]'))).toBe(true)
    expect(bodyText()).toContain('288,000 元分项 / 整单 144,000 元')
  }, DRAWER_TIMEOUT)
})
