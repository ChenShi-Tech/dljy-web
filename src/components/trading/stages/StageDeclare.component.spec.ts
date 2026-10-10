// S4 申报执行组件测试（slim-s3-s7-stages 任务 6.1）
// 验收：判据输入默认收起、有未过项与十项清单同步自动展开；储能充放电计划仅 STORAGE
// 立场渲染；状态机与推演台说明等主任务/诚实标注不因收纳变化。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/services/declarations', () => ({
  approveDeclaration: vi.fn().mockResolvedValue({}),
  secondSignatureNotice: (u: { awaitingSecondSignature?: boolean }) =>
    u.awaitingSecondSignature ? 'L3 双签：第一签已记录，需第二位审批人批准后本单才进入已审批' : null,
  declarationModeOf: () => 'LIVE',
  runDeclarationRiskCheck: vi.fn().mockResolvedValue({}),
  EDITABLE_DRAFT_STATUSES: ['DRAFT', 'REJECTED'],
  STATUS_LABEL: { DRAFT: '草稿' },
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

import { activeStanceType } from '@/services/stance/stanceContext'
import StageDeclare from './StageDeclare.vue'
import { mount } from '@/test/mount'

const STUBS = { AgentChatPanel: true, StorageDispatchBlock: true }

/** 申报单夹具：状态 DRAFT、截止在未来（不触发过期/提醒分支）。 */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DECL-S4',
    status: 'DRAFT',
    targetDate: '2026-10-10',
    deadline: '2026-12-31T10:00:00Z',
    energyCurveMwh96: Array.from({ length: 96 }, () => 10),
    priceCurve96: [],
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
