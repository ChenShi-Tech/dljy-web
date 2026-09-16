// @vitest-environment happy-dom
//
// 统一工作台的渲染不变量（#2023 入口合并）。
//
// 为什么光有 resolveEntry 的单测不够：那组测的是「query → 该用哪个入口」这层纯函数，
// 而合并真正的风险在**下一层**——六个入口原本是六个 view，现在共用一个壳按声明渲染，
// 任何一个入口的挂件/输入框/水印没接上，页面都照常显示（不报错），只是少了一块东西。
// 这类缺失没有任何自动信号，所以在这里逐个入口挂载一遍、断言它该有的部件确实上屏。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

// 晨报预检栏会真发请求装配 bundle；这里只关心「它有没有被挂上」，不关心装配结果
vi.mock('@/services/agent/morningBriefClient', () => ({
  fetchMorningBriefBundle: vi.fn(async () => ({ basis: 'synthetic', market: {}, gaps: [] })),
}))

import AgentWorkbenchView from './AgentWorkbenchView.vue'
import MorningBriefRail from '@/components/agent/workbench/MorningBriefRail.vue'
import StrategicQaGaps from '@/components/agent/workbench/StrategicQaGaps.vue'
import CheckupAutoApprove from '@/components/agent/workbench/CheckupAutoApprove.vue'
import { WORKBENCH_ENTRIES } from '@/services/agent/workbenchEntries'

const STUBS = {
  AgentChatPanel: { template: '<div class="stub-panel" />' },
  AgentHistorySidebar: { template: '<div class="stub-sidebar" />' },
  'el-alert': { template: '<div class="stub-alert" />' },
  'el-button': { template: '<button class="stub-btn"><slot /></button>' },
  'el-tooltip': { template: '<span><slot /></span>' },
  'el-switch': { template: '<input class="stub-switch" type="checkbox" />' },
  'el-card': { template: '<div><slot /></div>' },
}

// useRoute/useRouter 走 vue-router 的组合式 API，直接 mock 掉（不引真路由器）。
// route 必须是 reactive、replace 必须真写回 query：入口切换走的是 router.replace（入口是
// 可分享的深链），mock 成 vi.fn() 空实现的话组件在同一实例内永远切不动入口，跨入口的
// 状态隔离/保留就无从断言——那正是合并后最容易串味的一层。
type MockRoute = { query: Record<string, string> }
function currentRoute(): MockRoute {
  return (globalThis as Record<string, unknown>).__wbRoute as MockRoute
}
vi.mock('vue-router', () => ({
  useRoute: () => currentRoute(),
  useRouter: () => ({
    replace: (loc: { query?: Record<string, string> }) => { currentRoute().query = loc.query || {} },
  }),
}))

function withQuery(query: Record<string, string>) {
  ;(globalThis as Record<string, unknown>).__wbRoute = reactive({ query })
  return mount(AgentWorkbenchView, { global: { stubs: STUBS } })
}

/** 点顶部入口切换条上标题为 title 的那个 tab。 */
async function switchTo(w: ReturnType<typeof mount>, title: string) {
  const tab = w.findAll('.wb-entry').find((b) => b.text() === title)
  if (!tab) throw new Error(`入口切换条上没有「${title}」`)
  await tab.trigger('click')
  await nextTick()
}

describe('六个入口逐个上屏', () => {
  it('入口切换条列出全部入口，且当前入口高亮', () => {
    const w = withQuery({ entry: 'policy_intel' })
    const tabs = w.findAll('.wb-entry')
    expect(tabs).toHaveLength(WORKBENCH_ENTRIES.length)
    const active = w.findAll('.wb-entry.active')
    expect(active).toHaveLength(1)
    expect(active[0].text()).toBe('政策情报官')
  })

  it.each(WORKBENCH_ENTRIES.map((e) => [e.key, e.title]))(
    'entry=%s 能挂载并渲染对话面板与历史侧栏',
    (key) => {
      const w = withQuery({ entry: key as string })
      expect(w.find('.stub-panel').exists()).toBe(true)
      expect(w.find('.stub-sidebar').exists()).toBe(true)
    }
  )

  it('声明了输入控件的入口把控件渲染出来（数量与注册表一致）', () => {
    for (const e of WORKBENCH_ENTRIES) {
      const w = withQuery({ entry: e.key })
      expect(w.findAll('.wb-input'), `${e.key} 的输入控件数量不符`).toHaveLength(e.inputs?.length ?? 0)
    }
  })
})

describe('跨入口状态隔离', () => {
  // 合并前六个入口是六个 view，切换即销毁重建，输入值天然互不可见。合并后共用一个壳，
  // 输入值改由 inputsByEntry 按入口分桶——桶没分对就会「在申报前体检填的话，切到政策
  // 情报官变成了关键词」，或者切回来发现刚填的没了。两种都不会报错，只能靠断言守。
  // 串值必须用**同名 key** 来测：晨报与申报前体检的日期框 key 都是 `date`，桶没分对时
  // 后者会直接显示前者填的日期。拿 intent/keyword 这种异名 key 测是测不出来的——
  // 即使所有入口共用一个桶，读 values['keyword'] 也只会拿到 undefined 而非串值
  // （这条用例最初就是这么写的，变异「共用一个桶」照样全绿，等于没测）。
  it('同名输入 key 按入口分桶：晨报改日期不会串到申报前体检', async () => {
    const w = withQuery({ entry: 'morning_brief' })
    const briefDate = w.find('.wb-date')
    expect(briefDate.exists(), '晨报应有日期输入').toBe(true)
    const today = (briefDate.element as HTMLInputElement).value
    await briefDate.setValue('2026-01-15')

    await switchTo(w, '申报前体检')
    const checkDate = w.find('.wb-date')
    expect(checkDate.exists(), '申报前体检应有日期输入').toBe(true)
    expect(
      (checkDate.element as HTMLInputElement).value,
      '申报前体检的日期不该拿到晨报填的值'
    ).toBe(today)
  })

  it('切走再切回，该入口上次填的值还在', async () => {
    const w = withQuery({ entry: 'pre_submit_check' })
    const intent = w.findAll('.wb-input').find((i) => !i.classes('wb-date'))
    expect(intent, '申报前体检应有一个文本输入').toBeTruthy()
    await intent!.setValue('这次打算报高一点')

    await switchTo(w, '政策情报官')
    await switchTo(w, '申报前体检')
    const back = w.findAll('.wb-input').find((i) => !i.classes('wb-date'))
    expect((back!.element as HTMLInputElement).value).toBe('这次打算报高一点')
  })

  it('切换入口清掉上一个入口的会话高亮与已启动状态', async () => {
    const w = withQuery({ entry: 'morning_brief' })
    await switchTo(w, '通用对话')
    // 通用对话没有 buildQuestion，启动按钮整块不渲染（按钮文案是 hasRun 的唯一出口）
    expect(w.findAll('.stub-btn')).toHaveLength(0)
  })
})

describe('入口专属部件不能在合并中丢失', () => {
  it('只有晨报入口挂上数据预检栏（合并前那四块 dljy-ui 卡片的载体）', () => {
    // 查组件实例而不是 DOM：预检栏未取数时内部 v-if 不出内容，但组件必须已挂上，
    // 否则点「生成晨报」时 ensureLoaded 拿不到 ref，装配会被静默跳过。
    expect(
      withQuery({ entry: 'morning_brief' }).findComponent(MorningBriefRail).exists(),
      '晨报入口缺预检栏'
    ).toBe(true)
    for (const key of ['workbench', 'policy_intel', 'pre_submit_check', 'strategic_qa']) {
      expect(
        withQuery({ entry: key }).findComponent(MorningBriefRail).exists(),
        `${key} 不该挂预检栏`
      ).toBe(false)
    }
  })

  it('两个 PoC 入口各自的专属部件在位（缺口清单 / 授权开关）', () => {
    expect(
      withQuery({ entry: 'strategic_qa' }).findComponent(StrategicQaGaps).exists(),
      '战略问答缺数据缺口清单'
    ).toBe(true)
    expect(
      withQuery({ entry: 'declaration_checkup' }).findComponent(CheckupAutoApprove).exists(),
      '申报体检缺自动执行授权开关'
    ).toBe(true)
    // 授权开关不该出现在别的入口：它开的是「落库草稿免审」，串到别处就是越权面
    expect(
      withQuery({ entry: 'workbench' }).findComponent(CheckupAutoApprove).exists()
    ).toBe(false)
  })

  it('申报前体检入口显示不可移除的结论水印（advisory_only 口径）', () => {
    const w = withQuery({ entry: 'pre_submit_check' })
    const mark = w.find('.wb-watermark')
    expect(mark.exists(), '申报前体检必须带结论水印').toBe(true)
    expect(mark.text().length).toBeGreaterThan(0)
  })

  it('其它入口不显示该水印（水印是口径标注，不该到处贴）', () => {
    for (const key of ['workbench', 'morning_brief', 'policy_intel', 'strategic_qa']) {
      expect(withQuery({ entry: key }).find('.wb-watermark').exists(), `${key} 不该有水印`).toBe(false)
    }
  })

  it('顶栏通用警示对所有入口常驻（智能体内容为分析示意）', () => {
    for (const e of WORKBENCH_ENTRIES) {
      expect(withQuery({ entry: e.key }).find('.stub-alert').exists(), `${e.key} 缺顶栏警示`).toBe(true)
    }
  })
})

// 统一 AI 侧边栏「在工作台打开」：/ai-agent?entry=&session= 续接同一会话（SS-06）。
// 坏掉的症状：放大到工作台后看到的是空白新会话；或续接目标赖着不走，用户点「开始」却又回放旧会话；
// 或工作台页被缓存时，同一次导航换入口把刚设好的续接目标清掉。
describe('按会话续接（?session=）', () => {
  const PANEL_WITH_PROPS = {
    props: ['resumeSessionId', 'scenario', 'promptKey', 'initialQuestion'],
    template: '<div class="stub-panel" :data-resume="resumeSessionId || \'\'" :data-scenario="scenario" />'
  }
  function mountWith(query: Record<string, string>) {
    ;(globalThis as Record<string, unknown>).__wbRoute = reactive({ query })
    return mount(AgentWorkbenchView, { global: { stubs: { ...STUBS, AgentChatPanel: PANEL_WITH_PROPS } } })
  }

  it('带 entry + session：选中对应入口并续接该会话，不新建', () => {
    const w = mountWith({ entry: 'morning_brief', session: 's_brief' })
    expect(w.find('.wb-entry.active').text()).toBe('交易晨报')
    expect(w.find('.stub-panel').attributes('data-resume')).toBe('s_brief')
    expect(w.find('.stub-panel').attributes('data-scenario')).toBe('morning_brief')
  })

  it('缺 entry 时落在通用对话入口，仍续接该会话', () => {
    const w = mountWith({ session: 's_unknown' })
    expect(w.find('.wb-entry.active').text()).toBe('通用对话')
    expect(w.find('.stub-panel').attributes('data-resume')).toBe('s_unknown')
  })

  it('续接后点「开始」开新任务：续接目标清掉，面板不再回放旧会话', async () => {
    const w = mountWith({ entry: 'morning_brief', session: 's_brief' })
    await w.find('.stub-btn').trigger('click')
    await nextTick()
    await nextTick()
    expect(w.find('.stub-panel').attributes('data-resume')).toBe('')
  })

  it('工作台已停在别的入口时，同一次导航换入口并带 session：续接目标不被换入口清掉', async () => {
    const w = mountWith({ entry: 'workbench' })
    expect(w.find('.stub-panel').attributes('data-resume')).toBe('')
    currentRoute().query = { entry: 'morning_brief', session: 's_nav' }
    await nextTick()
    await nextTick()
    expect(w.find('.wb-entry.active').text()).toBe('交易晨报')
    expect(w.find('.stub-panel').attributes('data-resume')).toBe('s_nav')
  })
})
