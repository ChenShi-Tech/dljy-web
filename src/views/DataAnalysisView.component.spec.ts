// @vitest-environment happy-dom
// 综合数据分析组件行为（slim-and-fix-market-insight-pages R2）：
// fetchDay 失败不缓存成「已加载且无数据」的成功态——该天可重试（再次访问重新发请求），
// 热力图路径读不到被污染的空缓存，失败日重新取数、不再画成无数据灰格。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@/test/mount'

const fetchMeta = vi.fn()
const fetchDayContract = vi.fn()
vi.mock('@/services/data/contracts', () => ({
  fetchMarketInsightZsjfxMetaContract: (...a: unknown[]) => fetchMeta(...a),
  fetchMarketInsightZsjfxDayContract: (...a: unknown[]) => fetchDayContract(...a),
  normalizeContractBasis: (b?: string) => (b === 'real' || b === 'captured' ? 'captured' : 'synthetic')
}))
const regionRef = vi.hoisted(() => ({ state: null as { id: string; name: string } | null }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { computed, reactive } = await import('vue')
  regionRef.state = reactive({ id: 'yunnan', name: '云南' })
  return { ...actual, currentRegion: computed(() => regionRef.state) }
})
vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ roleCode: 'ADMIN' }) }))
vi.mock('@/services/governance', () => ({
  canAccessPath: () => true,
  firstAccessiblePath: () => '/dashboard'
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/composables/useQuerySync', () => ({ useQuerySync: () => {} }))
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))
vi.mock('@/features/aiSidebar', () => ({ defineAiPage: () => {}, useAiSidebar: () => ({ interpret: vi.fn() }) }))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
// echarts：捕获 setOption；showLoading/hideLoading 必须齐（load 直接调用，缺了会静默崩）
const chartState = vi.hoisted(() => ({ setOptionCalls: [] as unknown[][] }))
vi.mock('@/composables/useEChart', () => ({
  useEChart: () => ({
    setOption: (...args: unknown[]) => { chartState.setOptionCalls.push(args) },
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    instance: () => null,
    resize: vi.fn(),
    dispose: vi.fn()
  })
}))
import DataAnalysisView from './DataAnalysisView.vue'

const warnSpy = vi.spyOn(ElMessage, 'warning')

const META = {
  blocks: {
    zsjfx: {
      meta: {
        dates: ['2026-05-09', '2026-05-10'],
        goodDates: ['2026-05-09', '2026-05-10'],
        defaults: ['系统负荷实际值'],
        groups: { 预测: ['日前负荷预测'], 实际值: ['系统负荷实际值'] }
      }
    }
  }
}

const DAY = {
  blocks: { zsjfx: { day: { series: { 系统负荷实际值: Array.from({ length: 96 }, (_, i) => i) } } } }
}

async function mountView() {
  const wrapper = mount(DataAnalysisView)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia()) // useAnalysisStore 在 setup 顶层取 store
  fetchMeta.mockReset()
  fetchDayContract.mockReset()
  chartState.setOptionCalls.length = 0
  warnSpy.mockClear()
  fetchMeta.mockResolvedValue(META)
})

describe('综合数据分析：失败日不缓存、可重试', () => {
  it('fetchDay 失败后点击同一天重新发请求并成功渲染', async () => {
    fetchDayContract.mockRejectedValueOnce(new Error('503'))
    fetchDayContract.mockResolvedValue(DAY)
    const wrapper = await mountView()

    // 挂载 load：meta 成功、当日(2026-05-10)取数失败 → 仅 1 次请求，警告可见
    expect(fetchDayContract).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2026-05-10'))
    const optionsAfterFailure = chartState.setOptionCalls.length

    // cols 是 [上月, 本月] 两列，各有一个 '10' 格；只有本月（has）的会真正取数
    const dayCells = wrapper.findAll('.dcell').filter((d) => d.text() === '10' && d.classes().includes('has'))
    expect(dayCells.length).toBe(1)
    await dayCells[0].trigger('click')
    await flushPromises()

    // 失败未缓存 → 同一天重新发请求；成功后 render() 追加了 setOption
    expect(fetchDayContract).toHaveBeenCalledTimes(2)
    expect(chartState.setOptionCalls.length).toBeGreaterThan(optionsAfterFailure)
  })

  it('工具条无 emoji 字符（图标组件渲染）且未实现入口呈禁用态不触发提示', async () => {
    const infoSpy = vi.spyOn(ElMessage, 'info')
    const wrapper = await mountView()
    const text = wrapper.text()
    // R5：装饰性 emoji 退出文案（✨/📁/🏷/📊/➗/🗓/🚨），图标由 lucide 组件渲染
    for (const ch of ['✨', '🛰', '📊', '📁', '🏷', '➗', '🗓', '🚨']) {
      expect(text).not.toContain(ch)
    }
    // 未实现入口：禁用态 + 悬停说明，点击不触发请求或提示
    for (const label of ['弹出日历', '分别指定', '纵向展示', '配置']) {
      const btn = wrapper.findAll('button').find((b) => b.text() === label)
      expect(btn, label).toBeTruthy()
      expect(btn!.attributes('disabled'), label).toBeDefined()
    }
    // 解读本页等正常按钮仍在（功能不变）
    expect(wrapper.findAll('button').some((b) => b.text().includes('解读本页'))).toBe(true)
    expect(infoSpy).not.toHaveBeenCalled()
    infoSpy.mockRestore()
  })

  it('可用性热力图对失败日重新取数（不读失败缓存、不画无数据灰格）', async () => {
    fetchDayContract.mockRejectedValueOnce(new Error('503'))
    fetchDayContract.mockResolvedValue(DAY)
    const wrapper = await mountView()
    expect(fetchDayContract).toHaveBeenCalledTimes(1)

    const heatBtn = wrapper.findAll('button').find((b) => b.text().includes('可用性'))
    expect(heatBtn).toBeTruthy()
    await heatBtn!.trigger('click')
    await flushPromises()

    // 5 月两天都在目录：09 从未请求、10 失败未缓存 → 两天都应重新取数
    const dates = fetchDayContract.mock.calls.map((c) => (c[0] as { date: string }).date)
    expect(dates).toContain('2026-05-09')
    expect(dates).toContain('2026-05-10')
    expect(fetchDayContract).toHaveBeenCalledTimes(3)
  })
})
