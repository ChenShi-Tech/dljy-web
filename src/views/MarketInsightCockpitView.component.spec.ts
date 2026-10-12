// @vitest-environment happy-dom
// 市场洞察驾驶舱组件行为（slim-and-fix-market-insight-pages R1）：
// 预检产物随地区切换失效——切地区清空 bundle/error 回预检空态（KeepAlive 页不重挂载，
// 须显式注册 onRegionChange），再预检携带新地区参数；失败态同样不跨地区残留。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const fetchBundle = vi.fn()
vi.mock('@/services/market/marketInsightClient', () => ({
  fetchMarketInsightBundle: (...args: unknown[]) => fetchBundle(...args)
}))
// 地区：reactive 状态（普通对象字段变更不会触发 computed），用例内切换驱动 onRegionChange 的 watch。
const regionRef = vi.hoisted(() => ({ state: null as { id: string; name: string } | null }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { computed, reactive } = await import('vue')
  regionRef.state = reactive({ id: 'shanxi', name: '山西' })
  return { ...actual, currentRegion: computed(() => regionRef.state) }
})
vi.mock('@/features/aiSidebar', () => ({
  defineAiPage: () => {},
  useAiSidebar: () => ({ ask: vi.fn(), interpret: vi.fn() })
}))
import MarketInsightCockpitView from './MarketInsightCockpitView.vue'

const BUNDLE = {
  basis: 'captured',
  blocks: { anomalies: { items: [] }, snapshot: {} },
  data_availability: {}
}

const stubs = {
  'el-alert': { props: ['title'], template: '<div class="stub-alert">{{ title }}</div>' },
  'el-button': { template: '<button type="button"><slot /></button>' },
  HomeConsoleView: { template: '<div class="stub-console" />' },
  TrustBadge: { template: '<span class="stub-trust" />' },
  AnomalyRadarCard: { template: '<div class="stub-card" />' },
  MarketSnapshotCard: { template: '<div class="stub-card" />' },
  ElasticityCurveCard: { template: '<div class="stub-card" />' },
  SpreadArbitrageCard: { template: '<div class="stub-card" />' },
  NodePriceHeatCard: { template: '<div class="stub-card" />' },
  DataQualityPanel: { template: '<div class="stub-card" />' }
}

function precheckButton(wrapper: ReturnType<typeof mount>) {
  const button = wrapper.findAll('button').find((b) => b.text().includes('数据预检'))
  if (!button) throw new Error('未找到「数据预检」按钮')
  return button
}

async function mountView() {
  const wrapper = mount(MarketInsightCockpitView, { global: { stubs } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  fetchBundle.mockReset()
  // 上个用例可能已把地区切走；复位后本用例的切换才是真实变更（watch 才会触发）。
  regionRef.state!.id = 'shanxi'
  regionRef.state!.name = '山西'
})

describe('市场洞察驾驶舱：地区切换数据一致性', () => {
  it('预检后切地区，洞察区清空回预检空态，再预检携带新地区', async () => {
    fetchBundle.mockResolvedValue(BUNDLE)
    const wrapper = await mountView()

    await precheckButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.mic-empty').exists()).toBe(false)
    expect(wrapper.find('.mic-tag').exists()).toBe(true)
    expect(fetchBundle).toHaveBeenLastCalledWith(expect.objectContaining({ region: 'shanxi' }))

    regionRef.state!.id = 'yunnan'
    await flushPromises()
    expect(wrapper.find('.mic-empty').exists()).toBe(true)
    expect(wrapper.find('.mic-tag').exists()).toBe(false)

    await precheckButton(wrapper).trigger('click')
    await flushPromises()
    expect(fetchBundle).toHaveBeenLastCalledWith(expect.objectContaining({ region: 'yunnan' }))
    expect(wrapper.find('.mic-tag').exists()).toBe(true)
  })

  it('预检失败呈现失败态，切地区后失败态不残留', async () => {
    fetchBundle.mockRejectedValue(new Error('agent-backend 不可达'))
    const wrapper = await mountView()

    await precheckButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.mic-err').exists()).toBe(true)

    regionRef.state!.id = 'yunnan'
    await flushPromises()
    expect(wrapper.find('.mic-err').exists()).toBe(false)
    expect(wrapper.find('.mic-empty').exists()).toBe(true)
  })

  it('文案收敛（R5）：免责一处、模块清单不再同页罗列多次、无口号与结论句', async () => {
    fetchBundle.mockResolvedValue(BUNDLE)
    const wrapper = await mountView()
    await precheckButton(wrapper).trigger('click')
    await flushPromises()

    const text = wrapper.text()
    // 免责只在页头 alert 一处（卡片为 stub，不参与计数）
    expect(text.match(/非结算依据/g)?.length ?? 0).toBe(1)
    // 五模块清单只在副标题一处（空态/分区 small 不再重复罗列）
    expect(text.match(/弹性 · 价差|价格弹性 · 价差套利/g)?.length ?? 0).toBe(0)
    expect(text.match(/行情 \/ 弹性/g)?.length ?? 0).toBe(1)
    expect(text).not.toContain('一屏决策')
    expect(text).not.toContain('市场运行平稳')
    expect(text).not.toContain('实时巡检')
    expect(text).not.toContain('智能体流式研判')
    // R5：无装饰性 emoji 字符（🛰/📊 标题、✨ 按钮均改纯文本/lucide 图标）
    for (const ch of ['✨', '🛰', '📊']) {
      expect(text).not.toContain(ch)
    }
  })

  it('连点预检：晚归的旧响应不复活旧 bundle', async () => {
    // A（慢，captured）先发起；B（快，synthetic）后发起先返回；A 晚归不得覆盖 B。
    let resolveA!: (v: typeof BUNDLE) => void
    const slow = new Promise<typeof BUNDLE>((r) => { resolveA = r })
    fetchBundle.mockReturnValueOnce(slow as never)
    fetchBundle.mockResolvedValueOnce({ ...BUNDLE, basis: 'synthetic' })
    const wrapper = await mountView()

    await precheckButton(wrapper).trigger('click')
    await precheckButton(wrapper).trigger('click')
    await flushPromises()
    expect(fetchBundle).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.mic-tag').text()).toContain('含模拟/缺失')

    resolveA(BUNDLE)
    await flushPromises()
    expect(wrapper.find('.mic-tag').text()).toContain('含模拟/缺失')
  })
})
