// 中长期售电 P2 展示口径与服务层（dljy#2971，MP-02/MP-04/MP-05）。
// 守什么：分时未知不显示成 0、部分未知明示；内部估算与内部经营分配有区别标签；主体合计的拆分说明不出现相加合计；
// 能力开关未开通时服务层判定为关闭；曲线文件改了中间内容幂等键就不同。
// 坏掉的症状：只有月量的合同在小时视图显示 0；估算曲线看起来像正式资料；页面出现「主体 + 场站」的 1900。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ apiPost: vi.fn() }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }), currentRegionId: (await import('vue')).ref('yunnan') }))
vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiPost: hoisted.apiPost }))
vi.mock('@/services/company/companyApi', () => ({ companyUnselected: () => false }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp') }))

import { createCurveDraft, p2ModuleOn } from './midlongP2Api'
import { basisTag, allocationKindTag, bucketQuantityLabel, inheritedLabel, parseProfileWeights, stationSplitText } from './midlongP2Format'
import { validateStationAllocations } from './midlongP2Types'
import type { MidlongCapabilities } from './midlongTypes'

beforeEach(() => {
  hoisted.apiPost.mockReset()
  hoisted.apiPost.mockResolvedValue({ data: { curveSetId: 1 } })
})

describe('分时与场站展示口径', () => {
  it('分时未知不显示 0；部分未知注明；无交割义务才是 0', () => {
    expect(bucketQuantityLabel({ coverage: 'UNKNOWN', formalQuantity: null })).toBe('分时未知')
    expect(bucketQuantityLabel({ coverage: 'PARTIAL', formalQuantity: '1' })).toBe('1（另有合同分时未知）')
    expect(bucketQuantityLabel({ coverage: 'NO_OBLIGATION', formalQuantity: '0' })).toBe('0（无交割义务）')
    expect(bucketQuantityLabel({ coverage: 'COMPLETE', formalQuantity: '0.25' })).toBe('0.25')
  })

  it('有曲线但合同还有电量未分解到月份：已知部分照显示，注明不完整的原因', () => {
    expect(bucketQuantityLabel({ coverage: 'PARTIAL', formalQuantity: '24', unknownContractIds: [], incompleteContractIds: [9] })).toBe('24（另有电量未分解到月份）')
    expect(bucketQuantityLabel({ coverage: 'PARTIAL', formalQuantity: '24', unknownContractIds: [2], incompleteContractIds: [9] })).toBe('24（另有合同分时未知；另有电量未分解到月份）')
    expect(bucketQuantityLabel({ coverage: 'PARTIAL', formalQuantity: '1', unknownContractIds: [2], incompleteContractIds: [] })).toBe('1（另有合同分时未知）')
  })

  it('更正后沿用旧版本的分解标「沿用 vN」，当前版本自己的不标', () => {
    expect(inheritedLabel(1)).toBe('沿用 v1')
    expect(inheritedLabel(null)).toBe('')
    expect(inheritedLabel(undefined)).toBe('')
  })

  it('内部估算与内部经营分配带区别标签', () => {
    expect(basisTag('INTERNAL_ESTIMATE').label).toContain('不计入正式持仓')
    expect(allocationKindTag('INTERNAL_OPERATING').label).toContain('非正式交易分解')
    expect(allocationKindTag('FORMAL_TRADING').label).toBe('正式交易分解')
  })

  it('主体合计 1000 = 场站份额 900 + 未分配 100，说明里没有相加的 1900', () => {
    const text = stationSplitText({ subjectTotalQuantity: '1000', stationAllocatedQuantity: '900', unallocatedQuantity: '100', stationMonthUnknownQuantity: '0' })
    expect(text).toBe('主体合计 1,000 = 场站份额 900 + 未分配 100')
    expect(text).not.toContain('1,900')
  })

  it('页面预览与后端同一条共享规则：400 + 500 余额 100，再加 200 超出 100', () => {
    const revision = { deliveryStart: '2027-06-01', deliveryEnd: '2027-06-30', totalQuantity: '1000', allocations: [] }
    const ok = validateStationAllocations({ segmentMode: 'CONTRACT_TOTAL', revision, rows: [{ stationId: 1, quantity: '400' }, { stationId: 2, quantity: '500' }] })
    expect(ok.segments[0].unallocatedQuantity).toBe('100')
    const over = validateStationAllocations({ segmentMode: 'CONTRACT_TOTAL', revision, rows: [{ stationId: 1, quantity: '400' }, { stationId: 2, quantity: '500' }, { stationId: 3, quantity: '200' }] })
    expect(over.blocking).toBe(true)
    expect(over.segments[0].excessQuantity).toBe('100')
  })

  it('权重个数必须等于一天的时段数', () => {
    expect(parseProfileWeights('1,1,1', 24)).toEqual({ ok: false, message: '权重应为 24 个（一天的时段数），当前 3 个' })
    expect(parseProfileWeights(Array.from({ length: 24 }, () => '1').join(' '), 24).ok).toBe(true)
  })
})

describe('P2 服务层', () => {
  const caps = (modules: Record<string, boolean>): MidlongCapabilities => ({
    enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
    modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false, ...modules } as MidlongCapabilities['modules'],
    canWrite: true, companyId: 'comp', scopeCompanyIds: ['comp'], reason: null,
  })

  it('能力开关：未开通、地区未开通或模块暂停时一律视为关闭', () => {
    expect(p2ModuleOn(caps({}), 'curves')).toBe(false)
    expect(p2ModuleOn(caps({ curves: true }), 'curves')).toBe(true)
    expect(p2ModuleOn({ ...caps({ curves: true }), regionSupported: false }, 'curves')).toBe(false)
    expect(p2ModuleOn({ ...caps({ stationAllocations: true }), enabled: false }, 'stationAllocations')).toBe(false)
  })

  it('曲线草稿幂等键覆盖文件完整内容：只改中间内容键不同，重试键相同', async () => {
    const input = (middle: string) => ({
      expectedRevisionNo: 1, evidenceBasis: 'FORMAL' as const, coverageFromMonth: '2027-05', coverageToMonth: '2027-05', unit: 'MW', granularityMinutes: 15 as const, sourceTimezone: 'Asia/Shanghai',
      files: [{ role: 'workbook' as const, fileName: 'c.xlsx', contentBase64: `${'A'.repeat(300)}${middle}${'Z'.repeat(300)}` }],
    })
    await createCurveDraft(7, input('v1'))
    await createCurveDraft(7, input('v2'))
    await createCurveDraft(7, input('v1'))
    const keys = hoisted.apiPost.mock.calls.map((call) => (call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'])
    expect(keys[1]).not.toBe(keys[0])
    expect(keys[2]).toBe(keys[0])
    expect(hoisted.apiPost.mock.calls[0][0]).toBe('/api/v1/midlong/contracts/7/curves?company=comp')
  })
})
