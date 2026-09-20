// 中长期售电 P4 接口客户端（dljy#3014，MT-02..06 / MA-01..05）。
// 守什么：登记/修订/撤销/关联/调整/映射全部写请求带内容派生幂等键（附件只按指纹参与）；未选公司不发请求；
//        列表与详情是只读 GET（待核对筛选走 query），不会顺带改状态。
// 坏掉的症状：修订过的依据文件被当成重复请求重放旧文件；切公司后请求落到会话主公司；待核对筛选被丢掉。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), unselected: false }))

vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }), currentRegionId: (await import('vue')).ref('yunnan') }))
vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiGet: hoisted.apiGet, apiPost: hoisted.apiPost }))
vi.mock('@/services/company/companyApi', () => ({ companyUnselected: () => hoisted.unselected }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp') }))

import { CompanyNotSelectedError } from './midlongApi'
import { fetchExecutions, linkConfirmationContract, registerAdjustment, registerConfirmation, revokeConfirmation } from './midlongP4Api'

const keyOf = (call: unknown[]) => ((call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'])

const confirmationBase = {
  subjectId: 3, sourceNamespace: '交易中心', confirmationNo: 'C-2026-001', resultStatus: 'CLEARED' as const,
  segments: [{ deliveryMonth: '2026-10', quantity: '150', price: '300' }],
}

beforeEach(() => {
  hoisted.apiGet.mockReset().mockResolvedValue({ data: { rows: [], total: 0, page: 1, pageSize: 50 } })
  hoisted.apiPost.mockReset().mockResolvedValue({ data: { confirmationId: 1, revisionNo: 1 } })
  hoisted.unselected = false
})

describe('确认单登记幂等键', () => {
  const withFile = (content: string) => ({ ...confirmationBase, file: { fileName: '确认单.pdf', contentBase64: `${'A'.repeat(300)}${content}${'Z'.repeat(300)}` } })

  it('依据文件只改中间内容得到不同的键；同一内容重试得到同一个键', async () => {
    await registerConfirmation(withFile('v1'))
    await registerConfirmation(withFile('v2'))
    await registerConfirmation(withFile('v1'))
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/executions/confirmations?company=comp')
  })

  it('外部撤销冲正与关联既有合同同样带幂等键与公司参数', async () => {
    await revokeConfirmation(9, { expectedRowVersion: 2, reason: '平台撤销', externalRevokedAt: '2026-09-01 10:00' })
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/executions/confirmations/9/revoke?company=comp')
    expect(keyOf(hoisted.apiPost.mock.calls[0])).toBeTruthy()
    await linkConfirmationContract(9, { contractId: 7, note: '补纸质合同' })
    expect(hoisted.apiPost.mock.calls[1][0]).toBe('/api/v1/midlong/executions/confirmations/9/link?company=comp')
    expect(keyOf(hoisted.apiPost.mock.calls[1])).toBeTruthy()
  })
})

describe('调整登记幂等键与请求形状', () => {
  it('独立价款只按金额/币种/口径/备注参与键；同内容重试同键', async () => {
    const base = {
      contractId: 7, sourceNamespace: 'MANUAL', externalAdjustmentNo: 'T-1', adjustmentType: 'TRANSFER' as const,
      reason: '转让', direction: null, segments: [{ deliveryMonth: '2026-10', quantity: '200' }],
      prices: { transferPrice: { amount: '50000', currency: 'CNY', taxBasis: 'TAX_INCLUDED' as const, note: null } },
    }
    await registerAdjustment(base)
    await registerAdjustment({ ...base, prices: { transferPrice: { ...base.prices.transferPrice, amount: '60000' } } })
    await registerAdjustment(base)
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/adjustments?company=comp')
    expect(hoisted.apiPost.mock.calls[0][1]).toMatchObject({ direction: null, adjustmentType: 'TRANSFER' })
  })
})

describe('列表读取与公司选择', () => {
  it('确认单列表带公司参数与待核对/结果状态筛选，只发 GET', async () => {
    await fetchExecutions({ page: 2, resultStatus: 'CLEARED', pendingReview: true })
    expect(hoisted.apiGet).toHaveBeenCalledWith('/api/v1/midlong/executions', { company: 'comp', page: 2, resultStatus: 'CLEARED', pendingReview: true })
    expect(hoisted.apiPost).not.toHaveBeenCalled()
  })

  it('未选有效公司时不发请求，直接报未选择公司', async () => {
    hoisted.unselected = true
    await expect(fetchExecutions()).rejects.toBeInstanceOf(CompanyNotSelectedError)
    await expect(registerConfirmation(confirmationBase)).rejects.toBeInstanceOf(CompanyNotSelectedError)
    await expect(registerAdjustment({ contractId: 1, sourceNamespace: 'MANUAL', externalAdjustmentNo: 'T-1', adjustmentType: 'ADJUSTMENT', reason: 'r', segments: [] })).rejects.toBeInstanceOf(CompanyNotSelectedError)
    expect(hoisted.apiGet).not.toHaveBeenCalled()
    expect(hoisted.apiPost).not.toHaveBeenCalled()
  })
})
