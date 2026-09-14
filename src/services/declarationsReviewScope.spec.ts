import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '@/services/api'
import { getDeclaration, listDeclarationsPage } from './declarations'
vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }))
beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiGet).mockResolvedValue({ data: { rows: [] } } as never) })
describe('复盘申报读取公司范围', () => {
  it('周期回查显式绑定地区，不受默认地区变更影响', async () => {
    await listDeclarationsPage({ dateFrom: '2026-05-25', dateTo: '2026-05-31' }, 'selected-company', 'yunnan')
    expect(apiGet).toHaveBeenLastCalledWith(expect.any(String), expect.any(Object), { headers: { 'x-company-id': 'selected-company', 'x-tenant-id': 'selected-company', 'x-region-id': 'yunnan' } })
  })
  it('分页和单笔读取显式携带已选公司，不依赖默认公司', async () => {
    await listDeclarationsPage({ date: '2026-06-06' }, 'selected-company')
    expect(apiGet).toHaveBeenLastCalledWith(expect.any(String), { date: '2026-06-06' }, { headers: { 'x-company-id': 'selected-company', 'x-tenant-id': 'selected-company' } })
    await getDeclaration('one', 'selected-company')
    expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('/one'), undefined, { headers: { 'x-company-id': 'selected-company', 'x-tenant-id': 'selected-company' } })
  })
})
