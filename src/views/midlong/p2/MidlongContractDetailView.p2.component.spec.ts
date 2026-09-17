// 合同详情页 P2 区块的开关不变量（dljy#2971）。
// 守什么：分时分解与场站分配区只在能力开通且是电量合同时出现；未开通时不出现空壳区块，也不调用 P2 接口。
// 坏掉的症状：能力未交付时详情页出现「导入曲线」按钮；框架协议详情里出现场站分配。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongCapabilities, MidlongContractDetail } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ fetchCapabilities: vi.fn(), fetchContract: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '7' }, query: {} }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))
vi.mock('@/services/company/companyApi', () => ({ fetchStations: vi.fn(async () => []) }))
vi.mock('@/services/midlong/midlongApi', () => ({
  CompanyNotSelectedError: class extends Error {},
  fetchCapabilities: hoisted.fetchCapabilities, fetchContract: hoisted.fetchContract, fetchSubjects: vi.fn(async () => []),
  correctContract: vi.fn(), verifyContract: vi.fn(), voidContract: vi.fn(), addEvidence: vi.fn(), linkAlias: vi.fn(), fetchEvidenceContent: vi.fn(),
  midlongFailureOf: (e: unknown) => ({ status: 500, errorCode: 'UNKNOWN', message: String(e), details: null }),
}))

import MidlongContractDetailView from '../MidlongContractDetailView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' }, MidlongContractFormDialog: { template: '<div />' }, 'router-link': { template: '<a><slot /></a>' },
  MidlongContractCurvesPanel: { template: '<div class="stub-curves" />' }, MidlongContractStationsPanel: { template: '<div class="stub-stations" />' },
}
const caps = (modules: Record<string, boolean>): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, plans: false, execution: false, review: false, ...modules } as MidlongCapabilities['modules'],
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null,
})
const detail = (documentKind: 'OBLIGATION' | 'FRAMEWORK') => ({
  contractId: 7, documentKind, confirmationStatus: 'CONFIRMED', deliveryProgress: 'NOT_STARTED', qualityFlags: [], revisions: [], evidence: [], events: [], aliases: [],
  linkedContracts: [], framework: null, linkedTrades: { label: '关联成交电量', tradeCount: 0, volume: '0' }, currentRevision: null, current: {}, sourceNamespace: 'TEST', rowVersion: 1,
} as unknown as MidlongContractDetail)

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('合同详情的 P2 区块开关', () => {
  it('能力开通且是电量合同：显示分时分解与场站分配区', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({ curves: true, stationAllocations: true }))
    hoisted.fetchContract.mockResolvedValue(detail('OBLIGATION'))
    const w = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.find('.stub-curves').exists()).toBe(true)
    expect(w.find('.stub-stations').exists()).toBe(true)
  })

  it('能力未开通或是框架协议：不出现 P2 区块', async () => {
    hoisted.fetchCapabilities.mockResolvedValue(caps({}))
    hoisted.fetchContract.mockResolvedValue(detail('OBLIGATION'))
    const off = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(off.find('.stub-curves').exists()).toBe(false)
    expect(off.find('.stub-stations').exists()).toBe(false)
    off.unmount()
    hoisted.fetchCapabilities.mockResolvedValue(caps({ curves: true, stationAllocations: true }))
    hoisted.fetchContract.mockResolvedValue(detail('FRAMEWORK'))
    const framework = mount(MidlongContractDetailView, { global: { stubs: STUBS } })
    await flushPromises()
    expect(framework.find('.stub-curves').exists()).toBe(false)
    expect(framework.find('.stub-stations').exists()).toBe(false)
  })
})
