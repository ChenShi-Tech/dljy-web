// @vitest-environment happy-dom
// 地区现货概览·全国覆盖面板：卡片视觉与 main 一致（名称 + 规则状态主标签，规则台账轴
// 是本面板本意）；数据开通态不做常驻标注，口径差只在点击时交代——已开通卡点击切换
// 当前地区；未开通卡点击弹框架说明气泡（不切换），修复旧版点击被守卫静默吞掉。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AuthUser } from '@/services/auth'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/services/auth', () => ({
  getCurrentUser: () => ({ roleCode: 'TRADER', subjectType: 'RETAIL' }) as unknown as AuthUser,
  getStoredUser: () => null
}))
vi.mock('@/services/governance', () => ({
  canAccessPath: () => true,
  isPathAvailableInRegion: () => true,
  roleLabels: { TRADER: '交易员' }
}))
vi.mock('@/services/region/regionModules', () => ({ getRegionBusinessModules: () => [] }))
vi.mock('../data/regionSpotProfiles', () => ({ getRegionSpotProfile: () => ({}) }))
vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div class="stub-banner" />' }
}))
vi.mock('../components/region/MarketMechanismStrip.vue', () => ({
  default: { name: 'MarketMechanismStrip', template: '<div class="stub-strip" />' }
}))
vi.mock('../components/region/PriceBehaviorPanel.vue', () => ({
  default: { name: 'PriceBehaviorPanel', template: '<div class="stub-price" />' }
}))
vi.mock('../components/region/GenerationMixPanel.vue', () => ({
  default: { name: 'GenerationMixPanel', template: '<div class="stub-mix" />' }
}))
import RegionalTradingHubView from './RegionalTradingHubView.vue'
import { currentRegion, setCurrentRegionId } from '@/services/region/regionContext'

const STUBS = {
  'el-tag': { template: '<span class="stub-tag" :data-type="type"><slot /></span>', props: ['type'] },
  'el-button': { template: '<button class="stub-btn" type="button"><slot /></button>' },
  // append-to-body 真实场景挂 body，但本 spec 只断言逻辑态（开/关/内容），
  // 去 teleport 让弹窗留在组件子树内便于查询
  'el-dialog': {
    template: '<div v-if="modelValue" class="stub-dialog"><slot /><slot name="footer" /></div>',
    props: ['modelValue', 'title']
  }
}

const OPENED_ROWS = ['云南', '山西']
const LOCKED_ROWS = ['陕西', '新疆', '广东', '贵州', '广西', '海南', '山东', '内蒙古']

function cardByShortName(wrapper: ReturnType<typeof mount>, shortName: string) {
  const card = wrapper.findAll('.priority-region').find((b) => b.text().includes(shortName))
  expect(card, `覆盖面板应有「${shortName}」卡片`).toBeDefined()
  return card!
}

function mountView() {
  return mount(RegionalTradingHubView, { global: { stubs: STUBS }, attachTo: document.body })
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
  setCurrentRegionId('yunnan')
})

describe('地区现货概览·全国覆盖面板', () => {
  it('全部卡片可点；主标签为规则状态，视觉与 main 一致', () => {
    const wrapper = mountView()
    expect(wrapper.findAll('.priority-region')).toHaveLength(OPENED_ROWS.length + LOCKED_ROWS.length)

    for (const shortName of OPENED_ROWS) {
      const card = cardByShortName(wrapper, shortName)
      expect(card.attributes('disabled')).toBeUndefined()
      expect(card.text()).toMatch(/试运行/) // 云南/山西：该省现货实际阶段=试运行（台账轴恢复）
      expect(card.findAll('.stub-tag')).toHaveLength(1) // 单标签，无第二枚文案标签
    }

    for (const shortName of LOCKED_ROWS) {
      const card = cardByShortName(wrapper, shortName)
      expect(card.attributes('disabled')).toBeUndefined() // 不再禁用：点击改为弹说明
      // 台账轴信息完整回归主标签（山东=运行中、新疆=试运行、陕西等=待定制）
      expect(card.text()).toMatch(/试运行|运行中|待定制/)
      expect(card.findAll('.stub-tag')).toHaveLength(1)
    }
  })

  it('已开通卡片点击切换当前地区（云南→山西）', async () => {
    const wrapper = mountView()
    await cardByShortName(wrapper, '山西').trigger('click')
    expect(currentRegion.value.id).toBe('shanxi')
    expect(wrapper.find('.stub-dialog').exists()).toBe(false)
  })

  it('未开通卡片点击不改变当前地区，弹框架说明；「先看云南」回落云南', async () => {
    const wrapper = mountView()
    await cardByShortName(wrapper, '山东').trigger('click')

    expect(currentRegion.value.id).toBe('yunnan') // 不切换
    const dialog = wrapper.find('.stub-dialog')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('运行中') // 该省市场实际阶段（台账事实如实呈现）
    expect(dialog.text()).toContain('暂未开通')

    // 底部出口：「知道了」关闭不切区；「先看云南」关闭并切到 yunnan
    await dialog.findAll('.stub-btn')[0]!.trigger('click')
    expect(wrapper.find('.stub-dialog').exists()).toBe(false)

    await cardByShortName(wrapper, '山东').trigger('click')
    await wrapper.find('.stub-dialog').findAll('.stub-btn')[1]!.trigger('click')
    expect(currentRegion.value.id).toBe('yunnan')
    expect(currentRegion.value.shortName).toBe('云南')
  })
})
