// 守摘要模式：管理层只看摘要时，关联申报的依据与免责提示不能消失。dljy#2872。
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PublishedReportReader from './PublishedReportReader.vue'
import type { DecisionReference, Publication } from '@/services/review/workpapers'
import type { DeclarationOrder } from '@/services/declarations'

const reference: DecisionReference = {
  declarationId: 'decl-0f1e2d3c', targetDate: '2026-05-31', simulated: false, version: 'v-9a8b7c', capturedAt: '2026-06-01T02:00:00.000Z',
  snapshot: { id: 'decl-0f1e2d3c', targetDate: '2026-05-31', capacityMw: 50, energyCurveMwh96: Array.from({ length: 96 }, () => 1.25), quoteRationale: '按早高峰报量', mode: 'LIVE' } as unknown as DeclarationOrder,
  notice: '由交易员明确关联；同一周期不代表因果关系。',
}
const publication: Publication = { id: 'published', draftId: 'draft', revision: 2, contentHash: '', createdAt: '', content: {
  title: '晴川周复盘', authorId: '主笔', summary: '偏差集中在晚高峰', notice: '主笔发布，不等于结算认证', publishedAt: '',
  scope: { region: 'yunnan', view: 'generator', objectId: 'a', objectLabel: '晴川风电场', startDate: '2026-05-25', endDate: '2026-05-31' },
  blocks: [{ id: 'd1', kind: 'decision', title: '2026-05-31 交易日申报', text: '这笔申报定了当日报量区间', declarationId: 'decl-0f1e2d3c', decisionVersion: 'v-9a8b7c', reference }],
  evidence: [] } }

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
function open() {
  const wrapper = mount(PublishedReportReader, { props: { publication }, global: { stubs: { ReportEvidenceChart: true } } })
  wrappers.push(wrapper)
  return wrapper
}

describe('已发布报告的关联呈现', () => {
  it('详版渲染关联卡片并可打开原申报', () => {
    const wrapper = open()
    expect(wrapper.text()).toContain('2026-05-31 交易日申报')
    expect(wrapper.text()).toContain('真实申报')
    expect(wrapper.text()).toContain('这笔申报定了当日报量区间')
    expect(wrapper.find('.decision-card').exists()).toBe(true)
  })
  it('只看管理层摘要时仍保留关联依据与免责提示', async () => {
    const wrapper = open()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    const text = wrapper.text()
    expect(text).toContain('全天申报电量 120 MWh')
    expect(text).toContain('不代表因果关系')
    // 摘要不带正文
    expect(text).not.toContain('这笔申报定了当日报量区间')
    // 也不该泄漏申报的内部标识
    expect(text).not.toContain('decl-0f1e2d3c')
  })
})
