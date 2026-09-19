// 中长期售电 P5 接口客户端（dljy#3016，MR-02..05）。
// 守什么：账单登记/修订/凭证/差异登记/补充/关闭/生成报告全部写请求带内容派生幂等键（附件只按指纹参与）；
//         未选公司不发请求；列表与详情是只读 GET（筛选走 query），不会顺带改状态；导出走 GET 不写。
// 坏掉的症状：修订过的账单原件被当成重复请求重放旧文件；切公司后请求落到会话主公司；状态筛选被丢掉。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn(), unselected: false }))

vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref('yunnan'), currentRegionId: (await import('vue')).ref('yunnan') }))
vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiGet: hoisted.apiGet, apiPatch: hoisted.apiPatch, apiPost: hoisted.apiPost }))
vi.mock('@/services/company/companyApi', () => ({ companyUnselected: () => hoisted.unselected }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp') }))

import { CompanyNotSelectedError } from './midlongApi'
import { addVoucher, fetchBills, fetchDiscrepancies, fetchReportVersion, generateReport, p5ModuleOn, registerBill, registerDiscrepancy, resolveDiscrepancy, reviseBill, updateDiscrepancy } from './midlongP5Api'

const keyOf = (call: unknown[]) => ((call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'])

const billBase = {
  subjectId: 3, sourceNamespace: '昆明交易中心', externalBillNo: 'B-2026-001', billKind: 'ITEMIZED' as const,
  periodStartMonth: '2026-08', periodEndMonth: '2026-08', amount: '144000',
  lineItems: [{ deliveryMonth: '2026-08', quantity: '980', price: '300', amount: '294000' }],
}

beforeEach(() => {
  hoisted.apiGet.mockReset().mockResolvedValue({ data: { rows: [], total: 0, page: 1, pageSize: 50 } })
  hoisted.apiPatch.mockReset().mockResolvedValue({ data: { id: 1 } })
  hoisted.apiPost.mockReset().mockResolvedValue({ data: { billId: 1, revisionNo: 1 } })
  hoisted.unselected = false
})

describe('P5 能力开关读取', () => {
  it('p5ModuleOn 按名称读取 modules，缺省视为未开通', () => {
    const caps = { enabled: true, regionSupported: true, modules: { review: true } } as never
    expect(p5ModuleOn(caps, 'review')).toBe(true)
    expect(p5ModuleOn(caps, 'bills')).toBe(false)
    expect(p5ModuleOn({ enabled: true, regionSupported: true, modules: {} } as never, 'review')).toBe(false)
    expect(p5ModuleOn(null, 'review')).toBe(false)
  })
})

describe('账单写请求幂等键', () => {
  const withFile = (content: string) => ({ ...billBase, file: { fileName: '账单.pdf', contentBase64: `${'A'.repeat(300)}${content}${'Z'.repeat(300)}` } })

  it('账单原件只改中间内容得到不同的键；同一内容重试得到同一个键', async () => {
    await registerBill(withFile('v1'))
    await registerBill(withFile('v2'))
    await registerBill(withFile('v1'))
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/bills?company=comp')
  })

  it('修订带 expectedRowVersion 与 changeReason；凭证与差异登记同样带幂等键与公司参数', async () => {
    await reviseBill(9, { ...billBase, expectedRowVersion: 2, changeReason: '收到更正版本' })
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/bills/9/revisions?company=comp')
    expect(hoisted.apiPost.mock.calls[0][1]).toMatchObject({ expectedRowVersion: 2, changeReason: '收到更正版本' })
    expect(keyOf(hoisted.apiPost.mock.calls[0])).toBeTruthy()

    await addVoucher(9, { voucherNo: 'V-1', amount: '1000', receivedAt: '2026-09-10' })
    expect(hoisted.apiPost.mock.calls[1][0]).toBe('/api/v1/midlong/bills/9/vouchers?company=comp')
    expect(keyOf(hoisted.apiPost.mock.calls[1])).toBeTruthy()

    await registerDiscrepancy({ subjectId: 3, deliveryMonth: '2026-08', billId: 9, evidence: [{ fileName: 'e.pdf', contentBase64: 'Zg==' }] })
    expect(hoisted.apiPost.mock.calls[2][0]).toBe('/api/v1/midlong/discrepancies?company=comp')
    expect(keyOf(hoisted.apiPost.mock.calls[2])).toBeTruthy()
  })

  it('差异证据内容参与键；同内容重试同键', async () => {
    const base = { subjectId: 3, deliveryMonth: '2026-08', billId: 9 }
    await registerDiscrepancy({ ...base, evidence: [{ fileName: 'e.pdf', contentBase64: 'AAA' }] })
    await registerDiscrepancy({ ...base, evidence: [{ fileName: 'e.pdf', contentBase64: 'BBB' }] })
    await registerDiscrepancy({ ...base, evidence: [{ fileName: 'e.pdf', contentBase64: 'AAA' }] })
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
  })
})

describe('差异闭环与报告写请求', () => {
  it('补充差异走 PATCH 并带行版本；关闭走 resolve 并带处理说明', async () => {
    await updateDiscrepancy(5, { expectedRowVersion: 3, reason: '计量周期差异', ownerName: '张三' })
    expect(hoisted.apiPatch).toHaveBeenCalledWith('/api/v1/midlong/discrepancies/5?company=comp', expect.objectContaining({ expectedRowVersion: 3 }), expect.objectContaining({ headers: expect.anything() }))

    await resolveDiscrepancy(5, { expectedRowVersion: 4, resolutionNote: '与交易中心核对后按台账量确认' })
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/discrepancies/5/resolve?company=comp')
    expect(hoisted.apiPost.mock.calls[0][1]).toMatchObject({ expectedRowVersion: 4, resolutionNote: '与交易中心核对后按台账量确认' })
    expect(keyOf(hoisted.apiPost.mock.calls[0])).toBeTruthy()
  })

  it('生成报告带幂等键；同内容重试同键、换说明换键', async () => {
    await generateReport({ month: '2026-08', subjectId: 3, note: null })
    await generateReport({ month: '2026-08', subjectId: 3, note: '复评' })
    await generateReport({ month: '2026-08', subjectId: 3, note: null })
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
  })
})

describe('列表读取与公司选择', () => {
  it('账单与差异列表带公司参数与筛选，只发 GET', async () => {
    await fetchBills({ page: 2, subjectId: 3, billKind: 'UNITEMIZED', month: '2026-08', externalBillNo: 'B-1' })
    expect(hoisted.apiGet).toHaveBeenCalledWith('/api/v1/midlong/bills', { company: 'comp', page: 2, subjectId: 3, billKind: 'UNITEMIZED', month: '2026-08', externalBillNo: 'B-1' })
    await fetchDiscrepancies({ status: 'OPEN', month: '2026-08' })
    expect(hoisted.apiGet).toHaveBeenCalledWith('/api/v1/midlong/discrepancies', { company: 'comp', status: 'OPEN', month: '2026-08' })
    expect(hoisted.apiPost).not.toHaveBeenCalled()
  })

  it('报告版本快照与导出走 GET（版本号进 query/路径，不触发写）', async () => {
    await fetchReportVersion(7, 1)
    expect(hoisted.apiGet).toHaveBeenCalledWith('/api/v1/midlong/reports/7/versions/1', expect.objectContaining({ company: 'comp' }))
  })

  it('未选有效公司时不发请求，直接报未选择公司', async () => {
    hoisted.unselected = true
    await expect(fetchBills()).rejects.toBeInstanceOf(CompanyNotSelectedError)
    await expect(registerBill(billBase)).rejects.toBeInstanceOf(CompanyNotSelectedError)
    await expect(registerDiscrepancy({ subjectId: 3, deliveryMonth: '2026-08', billId: 9 })).rejects.toBeInstanceOf(CompanyNotSelectedError)
    await expect(generateReport({ month: '2026-08' })).rejects.toBeInstanceOf(CompanyNotSelectedError)
    expect(hoisted.apiGet).not.toHaveBeenCalled()
    expect(hoisted.apiPost).not.toHaveBeenCalled()
  })
})
