import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportArchivePanel from './ReportArchivePanel.vue'
const api = vi.hoisted(() => ({ listReportPublications: vi.fn(), getReportPublication: vi.fn() }))
vi.mock('@/services/review/workpapers', () => api)
vi.mock('./PublishedReportReader.vue', () => ({ default: { props: ['publication'], template: '<div>已发布正文 {{ publication.id }}</div>' } }))
const entry = { id: 'report-a', draftId: 'draft-a', revision: 2, title: '五月复盘', createdAt: '2026-06-01T01:00:00Z' }
beforeEach(() => { vi.resetAllMocks(); api.listReportPublications.mockResolvedValue({ rows: [entry], hasMore: true, offset: 0 }); api.getReportPublication.mockResolvedValue({ id: entry.id }) })
const open = () => mount(ReportArchivePanel, { props: { company: 'a', region: 'yunnan' } })
describe('统一报告目录', () => {
  it('按当前范围查询全部底稿的发布版本，分页不丢已加载条目', async () => {
    const wrapper = open(); await flushPromises()
    expect(api.listReportPublications).toHaveBeenCalledWith('a', 'yunnan', undefined, 0)
    api.listReportPublications.mockResolvedValue({ rows: [{ ...entry, id: 'report-b' }], hasMore: false, offset: 1 })
    await wrapper.findAll('button').find(b => b.text() === '加载更多报告')!.trigger('click'); await flushPromises()
    expect(api.listReportPublications).toHaveBeenLastCalledWith('a', 'yunnan', undefined, 1)
    expect(wrapper.findAll('li')).toHaveLength(2)
    await wrapper.findAll('li button')[0].trigger('click'); await flushPromises()
    expect(api.getReportPublication).toHaveBeenCalledWith('a', 'yunnan', 'report-a')
    expect(wrapper.text()).toContain('已发布正文 report-a')
    await wrapper.findAll('button').find(b => b.text() === '返回报告目录')!.trigger('click')
    expect(wrapper.findAll('li')).toHaveLength(2)
    wrapper.unmount()
  })
  it('切换公司立即清除原目录并丢弃旧正文响应', async () => {
    const wrapper = open(); await flushPromises()
    let resolve!: (value: unknown) => void
    api.getReportPublication.mockImplementation(() => new Promise(done => { resolve = done }))
    await wrapper.find('li button').trigger('click')
    api.listReportPublications.mockResolvedValue({ rows: [], hasMore: false })
    await wrapper.setProps({ company: 'b' }); resolve({ id: 'report-a' }); await flushPromises()
    expect(wrapper.text()).not.toContain('已发布正文')
    expect(wrapper.text()).not.toContain('五月复盘')
    expect(api.listReportPublications).toHaveBeenLastCalledWith('b', 'yunnan', undefined, 0)
    wrapper.unmount()
  })
  it('目录失败与空目录明确区分，内部错误不展示', async () => {
    api.listReportPublications.mockRejectedValue(new Error('report_publications SQL'))
    const wrapper = open(); await flushPromises()
    expect(wrapper.text()).toContain('报告目录暂时无法读取')
    expect(wrapper.text()).not.toContain('尚无已发布')
    expect(wrapper.text()).not.toContain('SQL')
    await wrapper.findAll('button').find(b => b.text().includes('查看旧报告'))!.trigger('click')
    expect(wrapper.emitted('legacy')).toHaveLength(1)
    wrapper.unmount()
  })
})
