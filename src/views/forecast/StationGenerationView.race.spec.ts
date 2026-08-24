// @vitest-environment happy-dom
//
// 厂站发电预测切公司/切站世代守卫回归（dljy#2331，同 ForecastScoreboardView.load 族）。
//
// 本页两条在飞链路都会被切公司打断：`watch(selectedCompanyId, reloadStations)` 拉场站列表，
// 以及点「预测」后的 runStationGeneration。无守卫时晚归的陈旧响应会写回新公司上下文——
// 旧公司的场站列表贴到新公司的下拉里（选到别家的资产），旧站的出力曲线贴到新站上，
// 而 P10/P50/P90 申报与偏差罚款是按 selectedStation 的所属地区结算规则算的，
// 曲线与结算口径错配就是算错钱。这类覆盖没有任何自动信号，故在此钉死。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

type Station = { id: number; name: string; type: string; capacity: number; regionId: string }

// vi.mock 的 factory 会被提升到文件顶部，普通顶层常量在它执行时尚未初始化——
// 共享给 factory 的桩必须走 vi.hoisted 一同提升。
const H = vi.hoisted(() => {
  const deferred: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  return {
    deferred,
    fetchStations: vi.fn(() => new Promise((resolve, reject) => { deferred.push({ resolve, reject }) })),
    errorToast: vi.fn(),
    companyId: { value: 1 as number | null },
  }
})
const { deferred, errorToast } = H

vi.mock('@/services/company/companyApi', () => ({ fetchStations: H.fetchStations }))
vi.mock('@/services/company/companyContext', async () => {
  const { ref: r } = await import('vue')
  const id = r<number | null>(1)
  H.companyId = id
  return { selectedCompanyId: id }
})
vi.mock('@/services/region/regionContext', async () => {
  const { computed, ref: r } = await import('vue')
  const id = r('yunnan')
  // services/api 在模块加载期 watch(currentRegion)，缺这个导出会在 mount 前就抛
  return {
    selectedRegionId: id,
    currentRegion: computed(() => ({ id: id.value, name: id.value })),
    selectRegion: vi.fn(),
  }
})
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: H.errorToast },
}))

vi.mock('@/services/forecast/mlForecastClient', () => ({
  runStationGeneration: vi.fn(),
  fetchBidAdvice: vi.fn(),
  runDeviationRisk: vi.fn(),
  fetchDayWeather: vi.fn(async () => ({ points: [] })),
}))

vi.mock('../../composables/useEChart', () => ({
  useEChart: () => ({
    setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
    showLoading: vi.fn(), hideLoading: vi.fn(), instance: () => null,
  }),
}))
vi.mock('../../composables/useTheme', () => ({ chartChrome: () => ({}), cssVar: () => '#000' }))
vi.mock('@/services/chart/chartOptions', () => ({
  axisTooltip: () => ({}), chartToolbox: () => ({}), emptyOverlay: () => ({}),
  insideZoom: () => ({}), fmtNum: (v: number) => String(v),
}))
vi.mock('../../rules/settlement', () => ({
  getSettlementRuleSpec: () => null, assessmentPriceOf: () => 100, segmentFactorOf: () => 1,
}))

import StationGenerationView from './StationGenerationView.vue'

const STUBS = {
  CompanyScopeBar: { template: '<div />' },
  'el-alert': { template: '<div><slot name="title" /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-card': { template: '<div><slot name="header" /><slot /></div>' },
  'el-select': { props: ['modelValue'], template: '<div class="sel"><slot /></div>' },
  'el-option': { props: ['label', 'value'], template: '<div class="opt" :data-value="value">{{ label }}</div>' },
  'el-button': { template: '<button><slot /></button>' },
  'el-radio-group': { template: '<div><slot /></div>' },
  'el-radio-button': { template: '<button><slot /></button>' },
  'el-input-number': { template: '<input />' },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-table': { template: '<div><slot /></div>' },
  'el-table-column': { template: '<div />' },
  'el-descriptions': { template: '<div><slot /></div>' },
  'el-descriptions-item': { template: '<div><slot /></div>' },
  'el-empty': { template: '<div />' },
  'el-statistic': { template: '<div />' },
  'el-divider': { template: '<div />' },
  'el-switch': { template: '<input />' },
  'el-progress': { template: '<div />' },
}

function stationsOf(company: string): Station[] {
  return [{ id: company === 'A' ? 11 : 22, name: `${company}-光伏站`, type: '光伏', capacity: 100, regionId: 'yunnan' }]
}

function renderedStationNames(w: ReturnType<typeof mount>) {
  return w.findAll('.opt').map((o) => o.text()).filter((t) => t.includes('站'))
}

describe('dljy#2331 厂站发电预测世代守卫', () => {
  it('切公司后旧公司的场站列表晚归，不得覆盖新公司的列表', async () => {
    deferred.length = 0
    const w = mount(StationGenerationView, { global: { stubs: STUBS } })
    await nextTick()
    expect(deferred).toHaveLength(1)              // onMounted 拉了 A 公司

    H.companyId.value = 2                    // 切到 B 公司
    await nextTick()
    expect(deferred).toHaveLength(2)

    deferred[1].resolve(stationsOf('B'))           // 新公司先归
    await nextTick(); await nextTick()
    expect(renderedStationNames(w)).toEqual(['B-光伏站（光伏 · 100MW）'])

    deferred[0].resolve(stationsOf('A'))           // 旧公司晚归——必须丢弃
    await nextTick(); await nextTick()
    expect(renderedStationNames(w)).toEqual(['B-光伏站（光伏 · 100MW）'])
    w.unmount()
  })

  it('陈旧请求失败晚归不弹错误提示，也不打断新公司上下文', async () => {
    deferred.length = 0
    errorToast.mockClear()
    const w = mount(StationGenerationView, { global: { stubs: STUBS } })
    await nextTick()

    H.companyId.value = 3
    await nextTick()
    deferred[1].resolve(stationsOf('B'))
    await nextTick(); await nextTick()

    deferred[0].reject(new Error('旧公司请求超时'))  // 陈旧失败晚归
    await nextTick(); await nextTick()

    expect(errorToast).not.toHaveBeenCalled()
    expect(renderedStationNames(w)).toEqual(['B-光伏站（光伏 · 100MW）'])
    w.unmount()
  })
})
