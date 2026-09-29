// 历史报告不能让已移除模型在质量记分牌/趋势图里重新出现；保留真实模型及参照基线。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'

const api = vi.hoisted(() => ({ scoreboard: vi.fn(), chart: vi.fn() }))
vi.mock('@/services/forecast/mlForecastClient', () => ({ fetchForecastScoreboard: api.scoreboard }))
vi.mock('@/services/region/regionContext', () => ({ selectedRegionId: ref('yunnan') }))
vi.mock('@/composables/useEChart', () => ({ useEChart: () => ({ setOption: api.chart }) }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
import Scoreboard from './ForecastScoreboardView.vue'

const removed = ['Autoformer', 'DLinear', 'FEDformer', 'Informer', 'iTransformer', 'PatchTST', 'TimesNet', 'TimeXer'].map((id) => `tslib:${id}`)
const wrappers: VueWrapper[] = []
beforeEach(() => { api.scoreboard.mockReset(); api.chart.mockReset() })
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()) })

describe('质量记分牌模型清理', () => {
  it('全部8个TSLib占位移除项不出现在表格或图例，真实PatchTST和Naive参照仍保留', async () => {
    const ids = [...removed, 'patchtst', 'remote:yunnan-renewable-patchtst-20260729', 'naive_1d']
    api.scoreboard.mockResolvedValue({ available: true, report: {
      region_id: 'yunnan', date_range: ['2026-06-01', '2026-06-25'], n_days: 25,
      basis: 'captured', generated_at: '2026-08-31', runs: { full: {
        overall: Object.fromEntries(ids.map((id) => [id, { mae: 1, skill_vs_lear: 0.1 }])),
        per_day: [{ date: '2026-06-25', patchtst_mase: 0.9 }],
      } },
    } })
    const slot = { template: '<div><slot name="title"/><slot name="header"/><slot/></div>' }
    const wrapper = mount(Scoreboard, { global: { directives: { loading: () => {} }, stubs: {
      ElCard: slot, ElAlert: slot, ElRadioGroup: slot, ElRadioButton: slot, ElTag: slot,
      ElEmpty: true, ElButton: true, DataBasisBadge: true,
      ElTable: { name: 'ElTable', props: ['data'], template: '<div><span v-for="row in data" :key="row.id">{{row.label}}</span></div>' }, ElTableColumn: true,
    } } })
    wrappers.push(wrapper)
    await flushPromises()
    const rows = wrapper.findComponent({ name: 'ElTable' }).props('data') as Array<{ id: string }>
    expect(rows.map((row) => row.id)).toEqual(['patchtst', 'remote:yunnan-renewable-patchtst-20260729', 'naive_1d'])
    for (const id of removed) expect(wrapper.text()).not.toContain(id)
    expect(api.chart).toHaveBeenCalled()
    const chart = api.chart.mock.calls.at(-1)![0]
    expect(chart.legend.data).toEqual(['patchtst', 'remote:yunnan-renewable-patchtst-20260729'])
    for (const id of removed) expect(chart.series.map((series: { name: string }) => series.name)).not.toContain(id)
  })
})
