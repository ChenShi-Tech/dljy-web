// 守关联依据的归属：同一底稿内重试保留，换底稿必须清空，否则会被确认进错误的报告。dljy#2872。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { loadPeriodDecisions } from '@/services/review/periodDecisions'
import { previewDecisionReference, type DecisionReference, type Workpaper } from '@/services/review/workpapers'
import DecisionLinkPanel from './DecisionLinkPanel.vue'
import type { DeclarationOrder } from '@/services/declarations'

vi.mock('@/services/review/periodDecisions', () => ({ loadPeriodDecisions: vi.fn() }))
vi.mock('@/services/review/workpapers', async original => ({ ...await original<typeof import('@/services/review/workpapers')>(), previewDecisionReference: vi.fn() }))

const order = { id: 'decl-0f1e2d3c', targetDate: '2026-05-31', companyId: 'a', region: 'yunnan', capacityMw: 50, energyCurveMwh96: Array.from({ length: 96 }, () => 1.25), quoteRationale: '按早高峰报量', mode: 'LIVE', status: 'CLEARED', createdAt: '2026-05-30T01:00:00Z' } as unknown as DeclarationOrder
const reference: DecisionReference = { declarationId: 'decl-0f1e2d3c', targetDate: '2026-05-31', simulated: false, version: 'v-9a8b7c', capturedAt: '2026-06-01T02:00:00.000Z', snapshot: order, notice: '由交易员明确关联。' }
const orderB = { ...order, id: 'decl-99887766', quoteRationale: '另一笔的报价依据' } as unknown as DeclarationOrder
const referenceB: DecisionReference = { ...reference, declarationId: 'decl-99887766' }
const paper = (id: string): Workpaper => ({ id, title: `底稿 ${id}`, scope: { region: 'yunnan', view: 'generator', objectId: 'a', objectLabel: '晴川风电场', startDate: '2026-05-25', endDate: '2026-05-31' }, authorId: '主笔', revision: 1, blocks: [], summary: '', updatedAt: '2026-06-01', canEdit: true })

const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadPeriodDecisions).mockResolvedValue({ rows: [order], omitted: 0, nextOffset: null })
  vi.mocked(previewDecisionReference).mockResolvedValue(reference)
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

async function openPanel(draft: Workpaper) {
  const wrapper = mount(DecisionLinkPanel, { props: { company: 'a', draft }, global: { stubs: { DecisionReferenceCard: true } } })
  wrappers.push(wrapper)
  wrapper.find('details').element.open = true
  await wrapper.find('details').trigger('toggle')
  await flushPromises()
  return wrapper
}
async function pickAndType(wrapper: ReturnType<typeof mount>, text: string) {
  await wrapper.findAll('button').find(button => button.text() === '核对并关联')!.trigger('click')
  await flushPromises()
  await wrapper.get('textarea').setValue(text)
}

describe('关联依据的归属', () => {
  it('同一底稿内重新核对版本时保留已写的理由', async () => {
    const wrapper = await openPanel(paper('draft-1'))
    await pickAndType(wrapper, '这笔申报定了当日报量区间')
    await wrapper.findAll('button').find(button => button.text() === '重新核对版本')!.trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('这笔申报定了当日报量区间')
  })
  it('换到另一份底稿后清空理由，不让它被确认进错误的报告', async () => {
    const wrapper = await openPanel(paper('draft-1'))
    await pickAndType(wrapper, '这笔申报定了当日报量区间')
    await wrapper.setProps({ draft: paper('draft-2') })
    await flushPromises()
    // 换底稿后预览先被清掉。重新选一笔申报让输入框出现，但**不输入任何内容**——
    // 这里若自己 setValue('')，断言到的就只是刚设进去的值，等于什么都没测。
    await wrapper.findAll('button').find(button => button.text() === '核对并关联')!.trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
  })
  it('换一笔申报后清空理由，不让它挂到上一笔之外的申报上', async () => {
    vi.mocked(loadPeriodDecisions).mockResolvedValue({ rows: [order, orderB], omitted: 0, nextOffset: null })
    vi.mocked(previewDecisionReference).mockImplementation(async (_company, _draft, id) => (id === orderB.id ? referenceB : reference))
    const wrapper = await openPanel(paper('draft-1'))
    await pickAndType(wrapper, '这笔申报定了当日报量区间')
    await wrapper.findAll('button').find(button => button.text() === '换一笔')!.trigger('click')
    await flushPromises()
    // 选第二笔申报：此处不输入任何内容，输入框必须是空的。
    await wrapper.findAll('button').filter(button => button.text() === '核对并关联')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
  })
  it('只切换记录类型筛选不清空理由', async () => {
    const wrapper = await openPanel(paper('draft-1'))
    await pickAndType(wrapper, '这笔申报定了当日报量区间')
    await wrapper.get('select').setValue('LIVE')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '核对并关联')!.trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('这笔申报定了当日报量区间')
  })
})
