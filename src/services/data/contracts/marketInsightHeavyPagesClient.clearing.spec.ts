// 出清电量契约客户端的地区隔离测试（dljy#2991）
// ---------------------------------------------------------------------------
// sdpt_zcqxhdl/__list__ 是山西三德公司私有出清清单（dljy 后端 capture-families
// datasetOwners 登记），只有山西有这个键。这里验证：
//   1. 非山西地区（云南/广东/四川）不发任何请求，直接得到「本地区不适用」空态；
//   2. 山西仍按原逻辑请求 __list__ 并正常转换；
//   3. 能力注册表声明与客户端拦截口径一致（云南 degraded：路由可达、页面停用）。
// 必须用单测而非 UI 实机：广东/四川不在可切换地区里，UI 上根本切不过去（见
// regionModules.spec.ts 同款说明）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentRequest = vi.hoisted(() => vi.fn())

// 只替换网络出口 agentRequest；extractEnvelopeMeta 用真实实现，让信封归一链路一起被测。
vi.mock('../request', async (importOriginal) => {
  // request → api → regionContext 在模块顶层读 window.localStorage（地区持久化），
  // node 测试环境补最小 stub，避免整个链路拉不起。
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {} } })
  const actual = await importOriginal<typeof import('../request')>()
  return { ...actual, agentRequest }
})

import { fetchMarketInsightClearingSpotContract } from './marketInsightHeavyPagesClient'
import { getRegionCapabilityForPath, regionCapabilityAllowsRequest, isRegionRouteAvailable } from '@/services/region/regionModules'

describe('fetchMarketInsightClearingSpotContract 地区隔离（#2991）', () => {
  beforeEach(() => {
    agentRequest.mockReset()
  })

  it('云南/广东/四川不发任何请求，返回「本地区不适用」诚实空态', async () => {
    for (const region of ['yunnan', 'guangdong', 'sichuan']) {
      agentRequest.mockClear()
      const contract = await fetchMarketInsightClearingSpotContract({ region })
      expect(agentRequest).not.toHaveBeenCalled()
      // mock 纪律字段齐全：不是真实数据，也不伪装成真实
      expect(contract.basis).toBe('synthetic')
      expect(contract.mock).toBe(true)
      expect(contract.sourceType).toBe('MOCK')
      expect(contract.productionWrite).toBe(false)
      expect(contract.region_requested).toBe(region)
      expect(contract.region_fallback).toBe(false)
      // 空态不画图
      expect(contract.blocks.clearing_spot.timePoints).toEqual([])
      expect(contract.blocks.clearing_spot.series).toEqual([])
      const availabilityNote = contract.data_availability[0]?.note ?? ''
      expect(availabilityNote).toContain('本地区不适用')
      expect(availabilityNote).toContain('__list__')
      expect(contract.blocks.clearing_spot.notes.join('\n')).toContain('#2991')
    }
  })

  it('山西仍按原逻辑请求 sdpt_zcqxhdl/__list__ 并正常转换', async () => {
    agentRequest.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        sourceType: 'CAPTURE',
        data: {
          nameList: ['2026-06-01 00:00', '2026-06-01 12:00'],
          legend: ['日前价出清', '日前负荷预测'],
          yAxisIndexList: [1, 0],
          series: [[350, 360], [1200, 1250]]
        }
      })
    })

    const contract = await fetchMarketInsightClearingSpotContract({ region: 'shanxi' })

    expect(agentRequest).toHaveBeenCalledTimes(1)
    const [, path, config] = agentRequest.mock.calls[0] as [string, string, { query: Record<string, string> }]
    expect(path).toBe('/real')
    expect(config.query.family).toBe('sdpt_zcqxhdl')
    expect(config.query.match).toBe('__list__')
    expect(config.query.region).toBe('shanxi')
    expect(contract.basis).toBe('captured')
    expect(contract.blocks.clearing_spot.timePoints).toHaveLength(2)
    expect(contract.blocks.clearing_spot.series).toHaveLength(2)
    expect(contract.blocks.clearing_spot.series[0]).toMatchObject({ name: '日前价出清', yAxisIndex: 1 })
  })
})

describe('云南出清电量能力声明与客户端拦截口径一致（#2991）', () => {
  it('/sjfx/zcqxhdl 云南 degraded（路由可达、页面停用），山西 available', () => {
    expect(getRegionCapabilityForPath('/sjfx/zcqxhdl', 'yunnan')?.status).toBe('degraded')
    expect(getRegionCapabilityForPath('/sjfx/zcqxhdl', 'shanxi')?.status).toBe('available')
    // degraded 不拦路由（旧深链可达、由页面显示停用说明）；请求门控也不靠它——
    // 拦截由客户端地区白名单负责，两道防线语义不同。
    expect(isRegionRouteAvailable('/sjfx/zcqxhdl', 'yunnan')).toBe(true)
    expect(regionCapabilityAllowsRequest('/sjfx/zcqxhdl', 'yunnan')).toBe(true)
  })

  it('云南 dataSupport 明确 sdpt_zcqxhdl 仅支撑价格分析（listrs_full），出清清单为缺口', () => {
    const cap = getRegionCapabilityForPath('/sjfx/zcqxhdl', 'yunnan')
    const supports = cap?.module.dataSupportByRegion.yunnan ?? []
    const missing = supports.filter((s) => s.families?.includes('sdpt_zcqxhdl') && s.expectation === 'missing')
    expect(missing).toHaveLength(1)
    expect(missing[0].note).toContain('__list__')
    // 真实支撑条目的措辞不得再声称「出清曲线类输入已纳入云南真实支撑」
    const realEntries = supports.filter((s) => s.families?.includes('sdpt_zcqxhdl') && s.expectation === 'real')
    for (const entry of realEntries) {
      expect(entry.note).not.toContain('出清')
    }
  })
})
