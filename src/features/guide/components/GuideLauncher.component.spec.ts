// 操作导引入口（GuideLauncher）的可用性与面板行为（ChenShi-Tech/dljy#3404）。
// 守什么：不可用时按钮保持可见但禁用，tooltip 按固定顺序报第一条命中原因
// （地区 → 能否进练习空间 → 已选公司 → 能力加载 → 模块总开关 → 合同/持仓子模块 → 写权限）；
// 可用时点开面板列出导引，规划中的灰显且没有可点按钮，点开始才调 start。
// 坏掉的症状：没有写权限的账号点「开始」往真实公司写数据；地区不支持时按钮直接消失
// 让用户以为功能坏了；规划中的导引被点开后卡在找不到锚点。
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuideDefinition, GuideSession } from '../types'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'
import GuideLauncher from './GuideLauncher.vue'

const hoisted = vi.hoisted(() => ({ canSwitch: true }))

vi.mock('../runner', async () => {
  const { ref } = await import('vue')
  return {
    guideSession: ref<GuideSession | null>(null),
    guideState: ref<{ definition: { title: string }; index: number; total: number } | null>(null),
    start: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
    exit: vi.fn(async () => {}),
  }
})

vi.mock('../registry', () => ({
  listGuides: vi.fn(async (): Promise<GuideDefinition[]> => [
    { id: 'midlong.contract-basics', group: 'midlong', title: '合同入门', summary: '在练习空间建一份测试合同', status: 'ready', requires: [], needsWrite: true, steps: [] },
    { id: 'midlong.allocation-stations', group: 'midlong', title: '分解与场站', summary: '把合同电量分解到月与场站', status: 'planned', requires: [], needsWrite: true, steps: [] },
  ]),
}))

vi.mock('../storage', () => ({ loadCompletedGuides: vi.fn((): string[] => []) }))

vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ username: 'tester' }) }))

vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  const selectedCompanyId = ref<string | null>('comp-a')
  return { selectedCompanyId, canSwitchCompany: () => hoisted.canSwitch, __selected: selectedCompanyId }
})

vi.mock('@/services/region/regionContext', async () => {
  const { ref } = await import('vue')
  const currentRegion = ref<{ id: string } | null>({ id: 'yunnan' })
  return { currentRegion, __region: currentRegion }
})

import { guideSession, guideState, start } from '../runner'
import { loadCompletedGuides } from '../storage'
import * as companyContext from '@/services/company/companyContext'
import * as regionContext from '@/services/region/regionContext'

// mock 工厂里 guideState 是可写 ref，但 import 类型沿真实模块（computed 只读）——用断言拿可写句柄。
const stateRef = guideState as unknown as { value: { definition: { title: string }; index: number; total: number } | null }

const selectedRef = (companyContext as unknown as { __selected: Ref<string | null> }).__selected
const regionRef = (regionContext as unknown as { __region: Ref<{ id: string } | null> }).__region

const caps = (overrides: Partial<MidlongCapabilities> = {}): MidlongCapabilities => ({
  enabled: true, regionId: 'yunnan', regionSupported: true, pilotRegions: ['yunnan'], phase: 'P1',
  modules: { contracts: true, positions: true, imports: true, curves: true, stationAllocations: true, plans: false, execution: false, review: false },
  canWrite: true, companyId: 'comp-a', scopeCompanyIds: ['comp-a'], reason: null, ...overrides,
})

function launch(capabilities: MidlongCapabilities | null = caps()) {
  return mount(GuideLauncher, { props: { group: 'midlong', capabilities } })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  // mock 的 ref 是模块级单例：上个用例切走的地区 / 公司 / 会话不能泄漏到本用例。
  guideSession.value = null
  stateRef.value = null
  selectedRef.value = 'comp-a'
  regionRef.value = { id: 'yunnan' }
  hoisted.canSwitch = true
  vi.clearAllMocks()
})

afterEach(() => {
  document.body.innerHTML = '' // popover 内容 teleport 到 body，wrapper 卸载之外再兜底清一次
})

describe('不可用时按钮禁用并按固定顺序报第一条命中原因', () => {
  const cases: Array<{ when: string; arrange: () => MidlongCapabilities | null; hint: string }> = [
    { when: '地区非云南', arrange: () => { regionRef.value = { id: 'guangdong' }; return caps() }, hint: '云南' },
    { when: '当前角色不能进练习空间', arrange: () => { hoisted.canSwitch = false; return caps() }, hint: '练习空间只对管理员/老板开放' },
    { when: '尚未选择公司', arrange: () => { selectedRef.value = null; return caps() }, hint: '尚未选择有效公司' },
    { when: '能力未加载完成', arrange: () => null, hint: '尚未加载完成' },
    { when: '模块总开关关闭', arrange: () => caps({ enabled: false }), hint: '已暂停使用' },
    { when: '合同或持仓子模块未开', arrange: () => caps({ modules: { ...caps().modules, positions: false } }), hint: '合同或月度持仓模块未开通' },
    { when: '对所选公司无写权限', arrange: () => caps({ canWrite: false }), hint: '没有中长期写权限' },
  ]

  it.each(cases)('$when 时按钮禁用，title 提示原因，popover 同步禁用', ({ arrange, hint }) => {
    const capabilities = arrange()
    const w = launch(capabilities)
    const button = w.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain(hint)
    // 面板入口由两层保证：按钮 disabled（浏览器不派发 click）+ el-popover 自身 disabled。
    expect(w.findComponent({ name: 'ElPopover' }).props('disabled')).toBe(true)
  })

  it('多条原因同时命中时只报第一条（地区优先于角色与写权限）', () => {
    regionRef.value = { id: 'guangdong' }
    hoisted.canSwitch = false
    const w = launch(caps({ canWrite: false }))
    expect(w.get('button').attributes('title')).toContain('云南')
  })
})

describe('可用时打开选择面板', () => {
  async function openPicker() {
    const w = launch()
    const button = w.get('button')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('title')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()
    return w
  }

  it('面板顶部说明练习空间数据口径，并列出导引', async () => {
    await openPicker()
    const text = document.body.textContent ?? ''
    expect(text).toContain('练习数据不计入集团汇总')
    expect(text).toContain('合同入门')
  })

  it('规划中的导引灰显且没有可点按钮，不会误触未实现内容', async () => {
    await openPicker()
    const items = [...document.querySelectorAll('.guide-picker-item')]
    expect(items).toHaveLength(2)
    expect(items[1].className).toContain('is-planned')
    expect(items[1].textContent).toContain('规划中')
    expect(items[1].querySelector('button')).toBeNull()
  })

  it('点 ready 导引的「开始」调用 start 并收起面板', async () => {
    const w = await openPicker()
    const beginButton = [...document.querySelectorAll('.guide-picker-item button')].find((el) => el.textContent?.includes('开始'))
    expect(beginButton).toBeTruthy()
    beginButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(start).toHaveBeenCalledWith('midlong.contract-basics')
    // begin 里 await start 后 emit('close')，收起由 v-model:visible 驱动（popover 内容卸载有自己的时序，断言契约而非 DOM）。
    expect(w.findComponent({ name: 'ElPopover' }).props('visible')).toBe(false)
  })

  it('已完成的导引按钮文案是「再来一遍」', async () => {
    vi.mocked(loadCompletedGuides).mockReturnValue(['midlong.contract-basics'])
    await openPicker()
    const beginButton = [...document.querySelectorAll('.guide-picker-item button')].find((el) => el.textContent?.includes('再来一遍'))
    expect(beginButton).toBeTruthy()
  })
})

describe('运行中的按钮文案', () => {
  it('未运行时显示「操作导引」', () => {
    expect(launch().get('button').text()).toBe('操作导引')
  })

  it('运行中显示「导引中 n/N」', () => {
    guideSession.value = { status: 'running', guideId: 'midlong.contract-basics' } as GuideSession
    stateRef.value = { definition: { title: '合同入门' }, index: 2, total: 36 }
    expect(launch().get('button').text()).toBe('导引中 3/36')
  })

  it('暂停时显示「导引已暂停」', () => {
    guideSession.value = { status: 'paused', guideId: 'midlong.contract-basics' } as GuideSession
    expect(launch().get('button').text()).toBe('导引已暂停')
  })
})
