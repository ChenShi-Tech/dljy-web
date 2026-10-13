// S4 申报执行组件测试（slim-s3-s7-stages 任务 6.1；merge-declare-desk-into-s4 扩段后续约）
// 验收：判据输入默认收起、有未过项与十项清单同步自动展开；储能充放电计划仅 STORAGE
// 立场渲染；状态机与推演台说明等主任务/诚实标注不因收纳变化。
// 并入申报台后新增：①段无单时可独立创建草稿（S1–S3 全空不阻断）；④段缺上游产出项
// 标「无上游数据」不判不通过；mock 只垫服务层，不断言搬运后的像素级布局。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/services/declarations', () => ({
  approveDeclaration: vi.fn().mockResolvedValue({}),
  createDeclaration: vi.fn().mockResolvedValue({}),
  secondSignatureNotice: (u: { awaitingSecondSignature?: boolean }) =>
    u.awaitingSecondSignature ? 'L3 双签：第一签已记录，需第二位审批人批准后本单才进入已审批' : null,
  declarationModeOf: () => 'LIVE',
  DECLARATION_MODE_LABEL: { LIVE: '真实申报', REHEARSAL: '历史模拟' },
  getDeclaration: vi.fn().mockRejectedValue(new Error('not found')),
  listDeclarations: vi.fn().mockResolvedValue([]),
  listDeclarationsPage: vi.fn().mockResolvedValue({ rows: [], total: 0, limit: 500, offset: 0, counts: { LIVE: 0, REHEARSAL: 0 }, appliedFilters: {} }),
  markDeclarationCleared: vi.fn().mockResolvedValue({}),
  riskExposureSourceOf: () => null,
  runDeclarationRiskCheck: vi.fn().mockResolvedValue({}),
  EDITABLE_DRAFT_STATUSES: ['DRAFT', 'REJECTED'],
  STATUS_LABEL: { DRAFT: '草稿', RISK_CHECKED: '已风控检查', PENDING_APPROVAL: '待审批', APPROVED: '已审批', SUBMITTED: '已提交' },
  submitDeclaration: vi.fn().mockResolvedValue({}),
  submitDeclarationForApproval: vi.fn().mockResolvedValue({}),
  updateDeclarationCurve: vi.fn().mockResolvedValue({})
}))

vi.mock('@/services/stance/stanceContext', async () => {
  const { ref } = await import('vue')
  return { activeStanceType: ref<string | null>('SELLER') }
})

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan', shortName: '云南' } }
}))

// 审批可见性 UI 门（申报台并入）：测试身份固定为交易负责人，批准/驳回按钮照常渲染
vi.mock('@/services/auth', () => ({
  getCurrentUser: () => ({ username: 'lead', roleCode: 'TRADE_LEAD', subjectType: 'GENERATOR' })
}))

// 套保敞口预览（HA-02 并入）：桩住取数，不打真实 HTTP
vi.mock('@/services/hedge/hedgeApi', () => ({
  fetchOverview: vi.fn().mockResolvedValue(null)
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

import { activeStanceType } from '@/services/stance/stanceContext'
import StageDeclare from './StageDeclare.vue'
import { mount } from '@/test/mount'

const STUBS = { AgentChatPanel: true, StorageDispatchBlock: true, DeclarationCurveEditor: true, 'router-link': true }

/** 申报单夹具：状态 DRAFT、截止在未来（不触发过期/提醒分支）。 */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DECL-S4',
    status: 'DRAFT',
    targetDate: '2026-10-10',
    deadline: '2026-12-31T10:00:00Z',
    energyCurveMwh96: Array.from({ length: 96 }, () => 10),
    priceCurve96: [],
    approvalRecord: [],
    preflight: {},
    ...overrides
  }
}

async function settle(wrapper: ReturnType<typeof mount>, rounds = 5) {
  await flushPromises()
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

function mountS4(props: Record<string, unknown> = {}) {
  return settle(
    mount(StageDeclare, {
      props: { declaration: order(), targetDate: '2026-10-10', ...props },
      global: { stubs: STUBS }
    })
  )
}

beforeEach(() => {
  ;(activeStanceType as Ref<string | null>).value = 'SELLER'
})

describe('StageDeclare 判据收纳与立场渲染（slim-s3-s7-stages）', () => {
  it('判据输入默认收起、十项清单折叠，只留结论徽章；推演台说明保留', async () => {
    const w = await mountS4()
    const criteria = w.find('details.dc-criteria')
    expect(criteria.exists()).toBe(true)
    expect(criteria.attributes('open')).toBeUndefined()
    expect(criteria.text()).toContain('判据输入')
    // 无 S1–S3 产出时 summary 提示展开人工录入
    expect(criteria.text()).toContain('展开人工录入')
    const list = w.find('details.dc-list-fold')
    expect(list.attributes('open')).toBeUndefined()
    expect(list.text()).toContain('10/10 全部通过')
    expect(w.text()).toContain('可进入提交')
    expect(w.text()).toContain('本清单是交易员的推演台')
  })

  it('判据不过（VaR 超授权）时判据输入与十项清单同步自动展开', async () => {
    const w = await mountS4()
    // 展开判据输入，把日 VaR 改到超授权（默认 8.2 万 / 授权 10 万）
    await w.find('details.dc-criteria summary').trigger('click')
    const varInput = w.find('details.dc-criteria input[type="number"]')
    await varInput.setValue('200000')
    await settle(w)
    expect(w.find('details.dc-criteria').attributes('open')).toBeDefined()
    expect(w.find('details.dc-list-fold').attributes('open')).toBeDefined()
    expect(w.text()).toContain('不可提交')
  })

  it('储能充放电计划仅 STORAGE 立场渲染；售电立场走报量不报价口径', async () => {
    ;(activeStanceType as Ref<string | null>).value = 'STORAGE'
    const wStorage = await mountS4()
    expect(wStorage.find('details.dc-storage').exists()).toBe(true)
    expect(wStorage.find('details.dc-storage').attributes('open')).toBeDefined()
    // STORAGE 立场为报量报价：分段报价折叠存在
    expect(wStorage.find('details#dc-sec-segments').exists()).toBe(true)

    ;(activeStanceType as Ref<string | null>).value = 'SELLER'
    const wSeller = await mountS4()
    expect(wSeller.find('details.dc-storage').exists()).toBe(false)
    expect(wSeller.text()).toContain('报量不报价口径')
    expect(wSeller.find('details#dc-sec-segments').exists()).toBe(false)
  })

  it('状态机主任务不变：DRAFT 态提供风控检查入口', async () => {
    const w = await mountS4()
    expect(w.find('.dc-machine').exists()).toBe(true)
    expect(w.find('.dc-machine').text()).toContain('风控检查')
  })
})

describe('S4 L3 双签真实反馈（fix-spot-p2-remaining）', () => {
  it('第一签（awaitingSecondSignature=true）：显示双签提示，不谎报「已批准」', async () => {
    const { approveDeclaration } = await import('@/services/declarations')
    vi.mocked(approveDeclaration).mockResolvedValueOnce(
      order({ status: 'PENDING_APPROVAL', awaitingSecondSignature: true }) as never
    )
    const w = await mountS4({ declaration: order({ status: 'PENDING_APPROVAL' }) })
    const btn = w.findAll('button').find((b) => b.text().trim() === '批准')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await settle(w)
    expect(w.find('.dc-ok').text()).toContain('需第二位审批人批准')
    expect(w.find('.dc-ok').text()).not.toContain('已批准')
    w.unmount()
  })

  it('批准生效（awaitingSecondSignature=false）：照常显示「已批准」', async () => {
    const { approveDeclaration } = await import('@/services/declarations')
    vi.mocked(approveDeclaration).mockResolvedValueOnce(
      order({ status: 'APPROVED', awaitingSecondSignature: false }) as never
    )
    const w = await mountS4({ declaration: order({ status: 'PENDING_APPROVAL' }) })
    const btn = w.findAll('button').find((b) => b.text().trim() === '批准')
    await btn!.trigger('click')
    await settle(w)
    expect(w.find('.dc-ok').text()).toContain('已批准')
    w.unmount()
  })
})

// slim-spot-page-explainers：放行自查说明性尾注收 ⓘ（spec trading-day-workbench
// 「折叠头只留标题与状态徽章」——S4 尾注不再以常驻段落显示）。
describe('S4 放行自查尾注收纳（slim-spot-page-explainers）', () => {
  it('「权威把关在服务端」说明收进 h3 ⓘ，无常驻 dc-note 段落', async () => {
    const wrapper = await mountS4()
    expect(wrapper.find('p.dc-note').exists()).toBe(false)
    const info = wrapper.find('#dc-sec-checklist h3').findComponent({ name: 'InfoHint' })
    expect(info.exists()).toBe(true)
    expect(info.props('text')).toContain('权威把关在服务端')
    // 结论徽章与十项清单折叠可见性不变
    expect(wrapper.find('#dc-sec-checklist .dc-verdict').exists()).toBe(true)
  })
})

// merge-declare-desk-into-s4：申报台并入后的六段结构与独立申报路径。
// 守什么：无单时可独立创建草稿（S1–S3 全空不警告不阻断）；放行自查缺上游产出标
// 「无上游数据」但不判不通过；不再有跳申报台的链接与段编号/段内导航（三次验收降噪）；
// 坏掉的症状是 S4 又退回「没上游就干不了活」、导航噪音回潮或开出第二个申报入口。
describe('S4 并入申报台：面板结构与独立申报路径（merge-declare-desk-into-s4）', () => {
  it('无段内导航与段编号；草稿与历史为申报台同构双 tab', async () => {
    const w = await mountS4()
    // 降噪契约（D7 第三版）：无段内跳转导航，面板标题不带 ①②③ 等编号
    expect(w.find('.dc-section-nav').exists()).toBe(false)
    expect(w.find('h3').text()).not.toMatch(/[①②③④⑤⑥]/)
    expect(w.text()).not.toContain('去申报工作台')
    // 草稿与历史同框双 tab（申报单 / 历史申报单）
    const tabs = w.find('.dc-tabs')
    expect(tabs.text()).toContain('申报单')
    expect(tabs.text()).toContain('历史申报单')
    expect(w.find('#dc-sec-curve').findComponent({ name: 'DeclarationCurveEditor' }).exists()).toBe(true)
    w.unmount()
  })

  it('无单且 S1–S3 全空：申报单 tab 给独立创建草稿表单，建单走 createDeclaration', async () => {
    const { createDeclaration } = await import('@/services/declarations')
    vi.mocked(createDeclaration).mockClear()
    // 目标日须为未来日：过去目标日会预选历史模拟（按钮文案随之不同），那是另一条分支
    const w = await mountS4({ declaration: null, targetDate: '2099-10-10' })
    expect(w.find('.dc-draft-form').exists()).toBe(true)
    expect(w.text()).toContain('报价依据摘要')
    // 填够 8 字报价依据后创建
    await w.find('.dc-rationale textarea').setValue('中长期均价 232，现货 P50 预测 248')
    const btn = w.findAll('button').find((b) => b.text().includes('创建申报草稿'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await settle(w)
    expect(createDeclaration).toHaveBeenCalledWith(expect.objectContaining({
      targetDate: '2099-10-10',
      mode: 'LIVE'
    }))
    w.unmount()
  })

  it('S1–S3 全空：放行自查缺上游项标「无上游数据」，但不判不通过（默认人工勾填仍可通过）', async () => {
    const w = await mountS4({ declaration: order({ preflight: {} }) })
    const criteria = w.find('details.dc-criteria')
    expect(criteria.text()).toContain('无上游数据')
    expect(criteria.text()).toContain('不判不通过')
    expect(w.text()).toContain('可进入提交')
    w.unmount()
  })

  it('历史申报单 tab 默认不加载，切 tab 才拉取时间窗列表', async () => {
    const { listDeclarationsPage } = await import('@/services/declarations')
    vi.mocked(listDeclarationsPage).mockClear()
    const w = await mountS4()
    // 默认停在「申报单」tab：历史列表不渲染、不发请求
    expect(w.find('.dc-history-table').exists()).toBe(false)
    expect(listDeclarationsPage).not.toHaveBeenCalled()
    const historyTab = w.findAll('.dc-tabs button').find((b) => b.text().includes('历史申报单'))
    await historyTab!.trigger('click')
    await settle(w)
    // mock 返回空列表：表格不渲染但空态提示出现，证明已切到历史 tab 且请求已发
    expect(w.text()).toContain('该时间窗内没有申报单')
    expect(listDeclarationsPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }))
    w.unmount()
  })

  // 六次验收：tbody 窗口化虚拟滚动——长列表只渲染可见窗口 ±overscan，spacer 行维持滚动条真实长度。
  it('历史列表虚拟滚动：60 行只渲染窗口行数，spacer 垫高保持滚动长度', async () => {
    const { listDeclarationsPage } = await import('@/services/declarations')
    const many = Array.from({ length: 60 }, (_, i) => order({ id: `DECL-V${i}` }))
    vi.mocked(listDeclarationsPage).mockResolvedValueOnce({
      rows: many, total: 60, limit: 500, offset: 0,
      counts: { LIVE: 60, REHEARSAL: 0 }, appliedFilters: {}
    } as unknown as Awaited<ReturnType<typeof listDeclarationsPage>>)
    const w = await mountS4()
    const historyTab = w.findAll('.dc-tabs button').find((b) => b.text().includes('历史申报单'))
    await historyTab!.trigger('click')
    await settle(w)
    const tbody = w.find('.dc-history-table tbody')
    const dataRows = tbody.findAll('tr:not(.dc-hist-spacer)')
    const spacers = tbody.findAll('tr.dc-hist-spacer')
    // jsdom 无布局（clientHeight=0）：窗口退化为 overscan 量级，远小于 60
    expect(dataRows.length).toBeLessThan(60)
    expect(dataRows.length).toBeGreaterThanOrEqual(1)
    // 底部 spacer 存在，撑起未渲染部分
    expect(spacers.length).toBeGreaterThanOrEqual(1)
    w.unmount()
  })

  // 四次验收：历史单/同日单选入作业（申报台 openHistoryRow/decl-select 同构）。
  // 容器经 select-order 消费：同日直接换单、跨日切标的日后按 pendingSelectId 精确选中。
  it('同日多单：头部下拉渲染，选择后 emit select-order', async () => {
    const { listDeclarations } = await import('@/services/declarations')
    const other = order({ id: 'DECL-S4-OLD', updatedAt: '2026-10-09T00:00:00Z' })
    vi.mocked(listDeclarations).mockResolvedValueOnce([order(), other] as unknown as Awaited<ReturnType<typeof listDeclarations>>)
    const w = await mountS4()
    const select = w.find('select.dc-decl-select')
    expect(select.exists()).toBe(true)
    expect(select.text()).toContain('DECL-S4-OLD')
    await select.setValue('DECL-S4-OLD')
    const emitted = w.emitted('select-order')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toMatchObject({ id: 'DECL-S4-OLD' })
    w.unmount()
  })

  it('历史单「查看」：emit select-order 并切回申报单 tab（抽屉已退役）', async () => {
    const { listDeclarationsPage } = await import('@/services/declarations')
    const histOrder = order({ id: 'DECL-HIST', targetDate: '2026-09-01' })
    vi.mocked(listDeclarationsPage).mockResolvedValueOnce({
      rows: [histOrder], total: 1, limit: 500, offset: 0,
      counts: { LIVE: 1, REHEARSAL: 0 }, appliedFilters: {}
      // 夹具只填断言用到的字段，page 结构按服务签名整体 cast
    } as unknown as Awaited<ReturnType<typeof listDeclarationsPage>>)
    const w = await mountS4()
    const historyTab = w.findAll('.dc-tabs button').find((b) => b.text().includes('历史申报单'))
    await historyTab!.trigger('click')
    await settle(w)
    const viewBtn = w.findAll('button').find((b) => b.text().trim() === '查看')
    expect(viewBtn).toBeTruthy()
    await viewBtn!.trigger('click')
    await settle(w)
    const emitted = w.emitted('select-order')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toMatchObject({ id: 'DECL-HIST' })
    // 抽屉退役：不再渲染只读抽屉
    expect(w.find('.dc-drawer').exists()).toBe(false)
    // 查看后自动切回「申报单」tab（选中单在申报单动线里呈现）
    expect(w.find('.dc-tabs button.on')!.text()).toContain('申报单')
    w.unmount()
  })

  // D7 第二版布局（二次验收反馈）：申报台同源功能连续成「申报作业区」（草稿/曲线/风控提交/历史单），
  // S4 原有内容（分段报价/放行自查/临场改价留痕）整体后置「链路增强区」，两区不穿插。
  it('D7 第三版：申报作业区连续成片（草稿与历史同框），链路增强区后置不穿插', async () => {
    ;(activeStanceType as Ref<string | null>).value = 'STORAGE'
    const w = await mountS4()
    // 申报作业区：草稿与历史（双 tab 面板）、申报曲线、风控与提交连续成片
    expect(w.find('.dc-zone-desk #dc-sec-draft').exists()).toBe(true)
    expect(w.find('.dc-zone-desk #dc-sec-curve').exists()).toBe(true)
    expect(w.find('.dc-zone-desk #dc-sec-machine').exists()).toBe(true)
    // 历史申报单不再是独立面板：入口只在草稿面板的历史 tab（#dc-sec-history 已移除）
    expect(w.find('#dc-sec-history').exists()).toBe(false)
    // 链路增强区：S4 原有内容整体后置
    expect(w.find('.dc-zone-enhance #dc-sec-segments').exists()).toBe(true)
    expect(w.find('.dc-zone-enhance #dc-sec-checklist').exists()).toBe(true)
    // 区序：申报作业区在链路增强区之前（DOM 序=视觉序，键盘动线一致）
    const zones = w.findAll('.dc-zone')
    expect(zones.length).toBe(2)
    expect(zones[0].classes()).toContain('dc-zone-desk')
    expect(zones[1].classes()).toContain('dc-zone-enhance')
    // 既有入栏契约不回退：储能附属块随曲线栏、临场改价留痕随报价段
    expect(w.find('.dc-area-draft > #dc-sec-draft').exists()).toBe(true)
    expect(w.find('.dc-area-curve > #dc-sec-curve').exists()).toBe(true)
    expect(w.find('.dc-area-curve > details.dc-storage').exists()).toBe(true)
    expect(w.find('.dc-area-segments > #dc-sec-segments').exists()).toBe(true)
    expect(w.find('.dc-area-segments > details.dc-pricechange').exists()).toBe(true)
    expect(w.find('.dc-area-checklist > #dc-sec-checklist').exists()).toBe(true)
    expect(w.find('.dc-area-machine > #dc-sec-machine').exists()).toBe(true)
    w.unmount()
  })
})
