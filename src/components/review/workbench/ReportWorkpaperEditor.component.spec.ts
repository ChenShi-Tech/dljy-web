import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '@/services/api'
import { addReportComment, createWorkpaper, getWorkpaper, getReportPublication, listReportPublications, listReportComments, listWorkpapers, publishWorkpaper, saveWorkpaper, type Workpaper } from '@/services/review/workpapers'
import ReportWorkpaperEditor from './ReportWorkpaperEditor.vue'
import type { ReviewEvidenceSnapshot } from '@/services/review/reviewEvidence'

vi.mock('@/services/review/workpapers', async original => ({ ...await original<typeof import('@/services/review/workpapers')>(), addReportComment: vi.fn(), createWorkpaper: vi.fn(), getWorkpaper: vi.fn(), getReportPublication: vi.fn(), listReportPublications: vi.fn(), listReportComments: vi.fn(), listWorkpapers: vi.fn(), publishWorkpaper: vi.fn(), saveWorkpaper: vi.fn() }))
vi.mock('@/services/stance/stanceContext', () => ({ activeStanceType: { value: 'RETAILER' } }))
const snapshot: ReviewEvidenceSnapshot = { scope: { company: 'a', region: 'yunnan', day: '2026-05-31', objectKey: '', objectLabel: '公司总览', version: 'v1' }, capturedAt: '2026-06-01T00:00:00Z', simulated: false, focus: '', entries: [], intervals: [], limitations: [] }
const paper = (): Workpaper => ({ id: '00000000-0000-4000-8000-000000000001', title: '已有底稿', scope: { region: 'yunnan', view: 'retail', objectId: 'company-overview', objectLabel: '公司总览', startDate: '2026-05-31', endDate: '2026-05-31' }, authorId: '主笔', revision: 1, blocks: [{ id: '00000000-0000-4000-8000-000000000002', kind: 'text', title: '原有事实', text: '已保存正文' }], summary: '', updatedAt: '2026-06-01', canEdit: true, evidence: [] })
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paper()], hasMore: false, offset: 0 })
  vi.mocked(getWorkpaper).mockResolvedValue(paper())
  vi.mocked(listReportPublications).mockResolvedValue({ rows: [], hasMore: false, offset: 0 })
  vi.mocked(listReportComments).mockResolvedValue({ rows: [], hasMore: false, offset: 0 })
  vi.mocked(createWorkpaper).mockResolvedValue(paper())
  vi.mocked(saveWorkpaper).mockImplementation(async (_company, draft) => ({ ...draft, revision: draft.revision + 1 }))
  vi.mocked(publishWorkpaper).mockResolvedValue({ id: 'publication', draftId: paper().id, revision: 2, createdAt: '', contentHash: '', content: { ...paper(), evidence: [], publishedAt: '', notice: '主笔发布' } })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers() })
async function open() {
  const wrapper = mount(ReportWorkpaperEditor, { props: { snapshot }, global: { stubs: { ReportEvidenceChart: true } } }); wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('select')[1].setValue(paper().id); await flushPromises()
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, text: string) { return wrapper.findAll('button').find(node => node.text() === text)! }

describe('图文底稿交付', () => {
  it('切换底稿后丢弃旧出版物的慢响应，不能显示或导出错误报告', async () => {
    const other = { ...paper(), id: '00000000-0000-4000-8000-000000000003', title: '另一份底稿' }
    vi.mocked(listWorkpapers).mockResolvedValue({ rows: [paper(), other], hasMore: false, offset: 0 })
    vi.mocked(listReportPublications).mockResolvedValueOnce({ rows: [{ id: 'old-publication', draftId: paper().id, createdAt: '', revision: 1, title: '旧报告' }], hasMore: false, offset: 0 })
    let finish!: (value: Awaited<ReturnType<typeof getReportPublication>>) => void
    vi.mocked(getReportPublication).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await open()
    await button(wrapper, '查看正文第 1 版').trigger('click')
    vi.mocked(getWorkpaper).mockResolvedValueOnce(other)
    await wrapper.findAll('select')[1].setValue(other.id); await flushPromises()
    finish({ id: 'old-publication', draftId: paper().id, revision: 1, createdAt: '', contentHash: '', content: { ...paper(), evidence: [], publishedAt: '', notice: '旧报告' } }); await flushPromises()
    expect(wrapper.findComponent({ name: 'PublishedReportReader' }).exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('input[maxlength="200"]').element.value).toBe('另一份底稿')
  })
  it('采纳原因建议后恢复待核实，通过既有自动保存落库，不自动发布', async () => {
    vi.mocked(getWorkpaper).mockResolvedValue({ ...paper(), blocks: [{ ...paper().blocks[0], kind: 'reason', state: 'confirmed' }] })
    const wrapper = await open()
    await button(wrapper, '辅助撰写这段').trigger('click')
    wrapper.findComponent({ name: 'ReportWritingAssistant' }).vm.$emit('adopt', '新的待核实解释', false)
    await flushPromises(); await vi.advanceTimersByTimeAsync(1000); await flushPromises()
    expect(saveWorkpaper).toHaveBeenCalledWith('a', expect.objectContaining({ blocks: [expect.objectContaining({ text: '新的待核实解释', state: 'pending' })] }))
    expect(publishWorkpaper).not.toHaveBeenCalled()
  })
  it('读取服务器底稿，编辑自动保存，服务器慢响应不覆盖继续输入的内容', async () => {
    const wrapper = await open()
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="事实与说明"]').element.value).toBe('已保存正文')
    let finish!: (value: Workpaper) => void
    vi.mocked(saveWorkpaper).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="事实与说明"]').setValue('第一次修改')
    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="事实与说明"]').setValue('继续输入的修改')
    finish({ ...paper(), revision: 2 }); await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="事实与说明"]').element.value).toBe('继续输入的修改')
    await vi.advanceTimersByTimeAsync(1000); await flushPromises()
    expect(vi.mocked(saveWorkpaper).mock.lastCall?.[1].blocks[0].text).toBe('继续输入的修改')
    expect(vi.mocked(saveWorkpaper).mock.lastCall?.[1].revision).toBe(2)
  })
  it('版本冲突保留人工正文，不自动循环覆盖服务器', async () => {
    const wrapper = await open()
    vi.mocked(saveWorkpaper).mockRejectedValue(new ApiError('conflict', { status: 409, code: 409, payload: { code: 409 } }))
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="事实与说明"]').setValue('不能丢失的文字')
    await vi.advanceTimersByTimeAsync(1000); await flushPromises()
    expect(wrapper.text()).toContain('当前文字已保留')
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="事实与说明"]').element.value).toBe('不能丢失的文字')
    const count = vi.mocked(saveWorkpaper).mock.calls.length
    await vi.advanceTimersByTimeAsync(4000)
    expect(saveWorkpaper).toHaveBeenCalledTimes(count)
  })
  it('主笔核对后直接发布，不启动智能体或等待批注批准', async () => {
    const wrapper = await open()
    await wrapper.get('.publish input[type=checkbox]').setValue(true)
    await button(wrapper, '发布报告').trigger('click'); await flushPromises()
    expect(publishWorkpaper).toHaveBeenCalledWith('a', expect.objectContaining({ id: paper().id }))
    expect(wrapper.text()).toContain('已发布正文第 2 版')
  })
  it('同事只有只读正文和批注入口，批注关联当前正文版本', async () => {
    vi.mocked(getWorkpaper).mockResolvedValue({ ...paper(), canEdit: false })
    vi.mocked(addReportComment).mockResolvedValue({ id: 'comment', authorId: '同事', revision: 1, blockId: null, body: '需要补充价格依据', createdAt: '' })
    const wrapper = await open()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.publish').exists()).toBe(false)
    await wrapper.get('textarea[aria-label="批注内容"]').setValue('需要补充价格依据')
    await button(wrapper, '添加批注').trigger('click'); await flushPromises()
    expect(addReportComment).toHaveBeenCalledWith('a', expect.objectContaining({ revision: 1 }), expect.any(String), '需要补充价格依据', null)
  })
  it('新建底稿不携带上一份报告的批注和批注位置', async () => {
    vi.mocked(listReportComments).mockResolvedValue({ rows: [{ id: 'old', authorId: '同事', revision: 1, blockId: paper().blocks[0].id, body: '仅属于旧报告的批注', createdAt: '' }], offset: 0, hasMore: false })
    const wrapper = await open()
    expect(wrapper.text()).toContain('仅属于旧报告的批注')
    await wrapper.get('select[aria-label="批注位置"]').setValue(paper().blocks[0].id)
    await button(wrapper, '新建本次底稿').trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain('仅属于旧报告的批注')
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="批注位置"]').element.value).toBe('')
  })
  it('关联面板里未确认的理由计入底稿未保存状态，离开守卫才看得见', async () => {
    const wrapper = await open()
    expect(wrapper.emitted('dirty')!.at(-1)).toEqual([false])
    wrapper.findComponent({ name: 'DecisionLinkPanel' }).vm.$emit('dirty', true)
    await flushPromises()
    expect(wrapper.emitted('dirty')!.at(-1)).toEqual([true])
  })
  it('有未确认的关联依据时不能发布，已勾选的核对确认随之失效', async () => {
    const wrapper = await open()
    await wrapper.find('.publish input[type="checkbox"]').setValue(true)
    wrapper.findComponent({ name: 'DecisionLinkPanel' }).vm.$emit('dirty', true)
    await flushPromises()
    expect((wrapper.find('.publish input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(button(wrapper, '发布报告').attributes('disabled')).toBeDefined()
    expect(publishWorkpaper).not.toHaveBeenCalled()
  })
  it('关联决策块不提供复制，避免绕开预览再建一个关联', async () => {
    // 复制会克隆申报版本却不走 decision-preview：申报变过就在自动保存时冲突且无法在该块上重新核对，
    // 没变过则等于凭空多出一个未经交易员核对的关联。
    const linked = { ...paper(), blocks: [...paper().blocks, { id: '00000000-0000-4000-8000-000000000009', kind: 'decision' as const, title: '2026-05-31 交易日申报', text: '这笔申报定了当日报量区间', declarationId: 'decl-0f1e2d3c', decisionVersion: 'v-9a8b7c', reference: { declarationId: 'decl-0f1e2d3c', targetDate: '2026-05-31', simulated: false, version: 'v-9a8b7c', capturedAt: '2026-06-01T02:00:00.000Z', snapshot: {} as never, notice: '由交易员明确关联。' } }] }
    vi.mocked(getWorkpaper).mockResolvedValue(linked)
    const wrapper = await open()
    const blocks = wrapper.findAll('article.block')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].findAll('button').some(node => node.text() === '复制')).toBe(true)
    expect(blocks[1].findAll('button').some(node => node.text() === '复制')).toBe(false)
  })
  it('公司周期底稿保留完整起止日，不缩成单日', async () => {
    const wrapper = mount(ReportWorkpaperEditor, { props: { snapshot: { ...snapshot, scope: { ...snapshot.scope, period: { start: '2026-05-01', end: '2026-05-31' } } } }, global: { stubs: { ReportEvidenceChart: true } } }); wrappers.push(wrapper)
    await flushPromises(); await button(wrapper, '新建本次底稿').trigger('click'); await flushPromises()
    expect(createWorkpaper).toHaveBeenCalledWith('a', expect.objectContaining({ startDate: '2026-05-01', endDate: '2026-05-31' }), expect.any(String), expect.any(String))
  })
})
