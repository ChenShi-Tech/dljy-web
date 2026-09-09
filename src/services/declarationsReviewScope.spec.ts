import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from '@/services/api'
import { getDeclaration, listDeclarationsPage } from './declarations'
vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }))
beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiGet).mockResolvedValue({ data: { rows: [] } } as never) })
describe('复盘申报读取公司范围', () => {
  it('分页和单笔读取显式携带已选公司，不依赖默认公司', async () => {
    await listDeclarationsPage({ date: '2026-06-06' }, 'selected-company')
    expect(apiGet).toHaveBeenLastCalledWith(expect.any(String), { date: '2026-06-06' }, { headers: { 'x-company-id': 'selected-company', 'x-tenant-id': 'selected-company' } })
    await getDeclaration('one', 'selected-company')
    expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('/one'), undefined, { headers: { 'x-company-id': 'selected-company', 'x-tenant-id': 'selected-company' } })
  })
})
