// 中长期售电 P3 接口客户端（dljy#2973，MT-02）。
// 守什么：导出申报材料只发只读 GET、不发任何写请求；提交登记的幂等键覆盖回执文件完整内容；未选公司不发请求。
// 坏掉的症状：导出被实现成 POST 顺带改方案状态；修订过的回执文件被当成重复请求重放旧文件；切公司后请求落到会话主公司。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), unselected: false }))

vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }), currentRegionId: (await import('vue')).ref('yunnan') }))
vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiGet: hoisted.apiGet, apiPost: hoisted.apiPost, apiPatch: hoisted.apiPatch }))
vi.mock('@/services/company/companyApi', () => ({ companyUnselected: () => hoisted.unselected }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp') }))

import { CompanyNotSelectedError } from './midlongApi'
import { exportProposal, fetchPlanProgress, registerSubmission } from './midlongP3Api'

const keyOf = (call: unknown[]) => ((call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'])

beforeEach(() => {
  hoisted.apiGet.mockReset().mockResolvedValue({ data: { fileName: 'a.csv', content: 'x', proposalRowVersion: 3, rows: [] } })
  hoisted.apiPost.mockReset().mockResolvedValue({ data: { proposalId: 1 } })
  hoisted.apiPatch.mockReset()
  hoisted.unselected = false
})

describe('申报材料导出', () => {
  it('只发只读 GET（带公司），不发任何写请求', async () => {
    const file = await exportProposal(42)
    expect(hoisted.apiGet).toHaveBeenCalledWith('/api/v1/midlong/proposals/42/export', { company: 'comp' })
    expect(hoisted.apiPost).not.toHaveBeenCalled()
    expect(hoisted.apiPatch).not.toHaveBeenCalled()
    expect(file.proposalRowVersion).toBe(3)
  })
})

describe('外部提交登记幂等键', () => {
  const base = { expectedRowVersion: 2, submittedAt: '2026-09-01 10:00', submittedByName: '测试交易员' }
  const withFile = (content: string) => ({ ...base, receipt: { file: { fileName: '回执.png', contentBase64: `${'A'.repeat(300)}${content}${'Z'.repeat(300)}` } } })

  it('回执文件只改中间内容得到不同的键；同一内容重试得到同一个键', async () => {
    await registerSubmission(7, withFile('v1'))
    await registerSubmission(7, withFile('v2'))
    await registerSubmission(7, withFile('v1'))
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/proposals/7/submissions?company=comp')
  })
})

describe('公司选择', () => {
  it('未选有效公司时不发请求，直接报未选择公司', async () => {
    hoisted.unselected = true
    await expect(fetchPlanProgress({})).rejects.toBeInstanceOf(CompanyNotSelectedError)
    await expect(registerSubmission(1, { expectedRowVersion: 1, submittedAt: 'x', submittedByName: 'y' })).rejects.toBeInstanceOf(CompanyNotSelectedError)
    expect(hoisted.apiGet).not.toHaveBeenCalled()
    expect(hoisted.apiPost).not.toHaveBeenCalled()
  })
})
