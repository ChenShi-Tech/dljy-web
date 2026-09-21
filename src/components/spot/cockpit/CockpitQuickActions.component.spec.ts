// 现货交易驾驶舱快捷动作不变量（统一 AI 侧边栏 EN-03）。
// 守什么：三个快捷任务点击即唤出 AI 侧边栏并发送对应问题（不再有内嵌对话框）；「检索最新披露」已去掉；
// 无工作台权限的角色按改动前口径禁用；报价决策舱入口保留。
// 坏掉的症状：点快捷任务没反应或问题文本错；披露检索按钮回来给出偏弱结果；无权限角色绕过口径发起任务。
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import CockpitQuickActions from './CockpitQuickActions.vue'
import { resetAiSidebarForTest, takeSliceFor, useAiSidebar } from '@/features/aiSidebar/useAiSidebar'
import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import { activatePage, activeAiPage, deactivatePage } from '@/features/aiSidebar/pageRegistry'

describe('CockpitQuickActions', () => {
  beforeEach(() => {
    resetAiSidebarForTest()
    const cur = activeAiPage().value
    if (cur) deactivatePage(cur)
  })

  it('三个快捷任务、无「检索最新披露」；点击唤出侧边栏并以通用对话角色发送对应问题', async () => {
    const w = mount(CockpitQuickActions, { props: { canUseAgent: true, tomorrow: '2026-09-17', hasBidPlan: false } })
    const tasks = w.findAll('[data-testid="quick-task"]')
    expect(tasks.map((t) => t.text())).toEqual(['生成明日申报草稿', '今日行情解读', '执行风控巡检'])
    expect(w.text()).not.toContain('检索最新披露')
    expect(w.find('.agent-chat-panel').exists()).toBe(false)

    // 即使当前页登记了别的解读角色，快捷任务也固定用通用对话角色（与原内嵌对话框一致）
    activatePage({ label: '其他页', promptKey: PAGE_PROMPT_KEYS.marketInsightCockpit })
    await tasks[1].trigger('click')
    const { state } = useAiSidebar()
    expect(state.open).toBe(true)
    expect(state.request?.question).toBe('分析今日出清价格走势与峰谷价差，解释主要驱动因素')
    expect(state.request?.promptKey).toBe(PAGE_PROMPT_KEYS.workbench)
    expect(takeSliceFor(state.request!.question)).toBeNull()

    await tasks[0].trigger('click')
    expect(state.request?.question).toBe('为 2026-09-17 制定日前申报策略并生成草稿')
  })

  it('无工作台权限：按钮禁用、有提示，点击不发起', async () => {
    const w = mount(CockpitQuickActions, { props: { canUseAgent: false, tomorrow: '2026-09-17', hasBidPlan: false } })
    const tasks = w.findAll('[data-testid="quick-task"]')
    expect(tasks.every((t) => t.attributes('disabled') !== undefined)).toBe(true)
    expect(w.find('[data-testid="quick-actions-locked"]').exists()).toBe(true)
    await tasks[1].trigger('click')
    expect(useAiSidebar().state.request).toBeNull()
  })

  it('有报价方案时保留「打开申报决策舱」入口', async () => {
    const w = mount(CockpitQuickActions, { props: { canUseAgent: true, tomorrow: '2026-09-17', hasBidPlan: true } })
    const btn = w.findAll('button').find((b) => b.text().includes('打开申报决策舱'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(w.emitted('openBidPlan')).toHaveLength(1)
  })
})
