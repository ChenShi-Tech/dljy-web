// 守卫周期范围与返回上下文；防止跨地区串单及丢失原统计筛选。#2875
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDeclarationsPage, type DeclarationOrder } from '@/services/declarations'
import { loadPeriodDecisions, safeAnalysisReturn } from './periodDecisions'
vi.mock('@/services/declarations', () => ({ listDeclarationsPage: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
const period = { start: '2026-05-25', end: '2026-05-31' }
const row = (id: string, companyId = 'a', region: string | null = 'yunnan', targetDate = period.start) => ({ id, companyId, region, targetDate } as DeclarationOrder)
describe('周期申报回查', () => {
  it('按完整周期请求，只接纳同公司地区的端点内申报，剔除记录后仍保留后续分页', async () => {
    vi.mocked(listDeclarationsPage).mockResolvedValue({ rows: [row('first'), row('last', 'a', 'yunnan', period.end), row('other', 'b'), row('null', 'a', null), row('out', 'a', 'yunnan', '2026-06-01')], total: 45, limit: 20, offset: 0 } as never)
    const result = await loadPeriodDecisions('a', 'yunnan', period, 0, 'REHEARSAL')
    expect(listDeclarationsPage).toHaveBeenCalledWith({ dateFrom: period.start, dateTo: period.end, offset: 0, limit: 20, mode: 'REHEARSAL' }, 'a', 'yunnan')
    expect(result.rows.map(r => r.id)).toEqual(['first', 'last'])
    expect(result).toMatchObject({ omitted: 3, nextOffset: 20 })
  })
  it('非法周期不请求，分页信息不完整不冒充最后一页', async () => {
    await expect(loadPeriodDecisions('a', 'yunnan', { start: '2026-02-30', end: '2026-03-01' })).rejects.toThrow()
    expect(listDeclarationsPage).not.toHaveBeenCalled()
    vi.mocked(listDeclarationsPage).mockResolvedValue({ rows: [], total: 10, limit: 0, offset: 0 } as never)
    await expect(loadPeriodDecisions('a', 'yunnan', period)).rejects.toThrow('分页信息')
  })
  it('保留编码的图表选区，拒绝外部、跨范围和嵌套返回地址', () => {
    const link = '/xhjy/review/analysis?companyId=a&region=yunnan&plants=%E7%94%B2&cadence=month'
    expect(safeAnalysisReturn(link, 'a', 'yunnan')).toBe(link)
    for (const value of [undefined, 'https://evil.invalid', '//evil.invalid', '/xhjy/desk?companyId=a&region=yunnan', link + '&analysisReturn=bad', link + '#bad']) expect(safeAnalysisReturn(value, 'a', 'yunnan')).toBeNull()
    expect(safeAnalysisReturn(link, 'b', 'yunnan')).toBeNull()
    expect(safeAnalysisReturn(link, 'a', 'shanxi')).toBeNull()
  })
})
