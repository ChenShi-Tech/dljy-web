// @vitest-environment happy-dom
// 报告工坊产物级来源标注（修「任一模板在线→本地 Mock 报告被全页标成 Dify AI」的倒挂）：
// ① 混部态选离线模板生成 → 抬头/正文如实标「模拟数据」，右上角连通性徽标语义不变；
// ② 选在线模板走真调 → 输出逐字节原样 + 「Dify AI」标注（证明原功能未被波及）；
// ③ 全离线生成与旧行为一致；④ 历史回放按条目 mock 字段精确还原来源。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { dify } = vi.hoisted(() => ({
  dify: {
    pingDifyService: vi.fn(async (_id: string) => false),
    runReportWorkflow: vi.fn(async () => ({ data: { outputs: { text: 'REAL_DIFY_BODY' } } }))
  }
}))
vi.mock('@/services/agent/difyClient', () => dify)
import ReportWorkshopView from './ReportWorkshopView.vue'
import { getStoredUser } from '@/services/auth'
import type { AuthUser } from '@/services/auth'

vi.mock('@/services/auth', async (orig) => ({
  ...((await orig()) as object),
  getStoredUser: vi.fn(() => ({ username: 'admin', roleCode: 'ADMIN' }) as unknown as AuthUser)
}))

const STUBS: Record<string, object> = {}
for (const name of ['el-alert', 'el-date-picker', 'el-divider', 'el-dropdown', 'el-dropdown-menu', 'el-dropdown-item',
  'el-form', 'el-form-item', 'el-icon', 'el-input', 'el-option', 'el-radio-button', 'el-radio-group', 'el-select']) {
  STUBS[name] = { template: '<div><slot /></div>' }
}
STUBS['el-tag'] = { template: '<span class="stub-tag" :data-type="type"><slot /></span>', props: ['type'] }
STUBS['el-button'] = {
  template: '<button class="stub-btn" type="button" :disabled="disabled"><slot /></button>',
  props: ['disabled', 'loading', 'type', 'size', 'text', 'icon']
}

async function mountWith(onlineIds: string[]) {
  dify.pingDifyService.mockImplementation(async (id: string) => onlineIds.includes(id))
  const wrapper = mount(ReportWorkshopView, { global: { stubs: STUBS }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function selectAndGenerate(wrapper: ReturnType<typeof mount>, cardText: string) {
  const card = wrapper.findAll('.template-card').find((c) => c.text().includes(cardText))!
  await card.trigger('click')
  const btn = wrapper.findAll('button').find((b) => b.text().includes('生成报告'))!
  await btn.trigger('click')
  // mock 分支带 800~1500ms 假延迟，轮询直到出稿
  await vi.waitFor(() => expect(wrapper.find('.paper-meta-line').exists()).toBe(true), { timeout: 4000 })
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('报告工坊·产物级来源标注', () => {
  it('混部态选离线模板：抬头与正文如实标注模拟数据，连通性徽标语义保留', async () => {
    const wrapper = await mountWith(['daily-spot'])
    await selectAndGenerate(wrapper, '月度结算分析')

    const headerLine = wrapper.find('.paper-meta-line').text()
    expect(headerLine).toContain('数据来源：模拟数据')
    expect(headerLine).not.toContain('Dify AI')
    // 正文统一注入声明（该模板原始正文无标注）
    expect(wrapper.find('.paper-body').text()).toContain('本地模板生成')
    // 右上角徽标仍是「服务连通性」语义：在线即绿——修复范围只限产物标注
    const successTag = wrapper.findAll('.stub-tag').find((t) => t.text().includes('已连接'))
    expect(successTag).toBeDefined()
  })

  it('选在线模板走真调：输出原样、标注 Dify AI、历史记为非 Mock', async () => {
    const wrapper = await mountWith(['daily-spot'])
    await selectAndGenerate(wrapper, '日前市场日报')

    expect(wrapper.find('.paper-body').text()).toContain('REAL_DIFY_BODY')
    expect(wrapper.find('.paper-body').text()).not.toContain('本地模板生成') // 真调输出零注入
    expect(wrapper.find('.paper-meta-line').text()).toContain('Dify AI')
    expect(wrapper.find('.history-item .hi-icon').text()).toBe('🤖')
  })

  it('全离线：行为与旧版一致（模拟数据标注）', async () => {
    const wrapper = await mountWith([])
    await selectAndGenerate(wrapper, '风险仪表盘')

    expect(wrapper.find('.paper-meta-line').text()).toContain('数据来源：模拟数据')
    expect(getStoredUser as unknown as ReturnType<typeof vi.fn>).toBeTruthy() // 守卫仅防越权场景
  })

  it('历史回放按条目真伪还原来源（后生成的真报告不污染回放的旧 Mock 件）', async () => {
    const wrapper = await mountWith(['daily-spot'])
    await selectAndGenerate(wrapper, '月度结算分析') // mock
    await selectAndGenerate(wrapper, '日前市场日报') // dify，unshift 到首位

    const rows = wrapper.findAll('.history-item')
    expect(rows[0]!.find('.hi-icon').text()).toBe('🤖')
    expect(rows[1]!.find('.hi-icon').text()).toBe('📝')

    await rows[1]!.trigger('click') // 回放那条 Mock 报告
    expect(wrapper.find('.paper-meta-line').text()).toContain('数据来源：模拟数据')
    await rows[0]!.trigger('click') // 回放真报告
    expect(wrapper.find('.paper-meta-line').text()).toContain('Dify AI')
  })
})
