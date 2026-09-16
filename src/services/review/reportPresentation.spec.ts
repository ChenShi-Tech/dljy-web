// 守关联决策在报告与导出中的呈现：关联不能只留理由不留依据，也不能把内部标识写进交付物。dljy#2872。
import { describe, expect, it } from 'vitest'
import { decisionReferenceCaption, reportParts } from './reportPresentation'
import type { DecisionReference, Publication } from './workpapers'
import type { DeclarationOrder } from '@/services/declarations'

const order = (patch: Partial<DeclarationOrder> = {}) => ({
  id: 'decl-0f1e2d3c', targetDate: '2026-05-31', capacityMw: 50,
  energyCurveMwh96: Array.from({ length: 96 }, () => 1.25), quoteRationale: '按早高峰报量并压低谷段', mode: 'LIVE',
  ...patch,
}) as unknown as DeclarationOrder
const reference = (patch: Partial<DecisionReference> = {}): DecisionReference => ({
  declarationId: 'decl-0f1e2d3c', targetDate: '2026-05-31', simulated: false, version: 'v-9a8b7c',
  capturedAt: '2026-06-01T02:00:00.000Z', snapshot: order(),
  notice: '由交易员明确关联；同一周期不代表因果关系，留存的是关联时读取的申报版本。',
  ...patch,
})
const publication = (blocks: Publication['content']['blocks']): Publication => ({
  id: 'published', draftId: 'draft', revision: 2, contentHash: '', createdAt: '',
  content: { title: '晴川周复盘', authorId: '主笔', summary: '偏差集中在晚高峰', notice: '主笔发布，不等于结算认证', publishedAt: '',
    scope: { objectId: 'a', objectLabel: '晴川风电场', region: 'yunnan', view: 'generator', startDate: '2026-05-25', endDate: '2026-05-31' },
    blocks, evidence: [] },
})

describe('关联决策的报告呈现', () => {
  it('用业务语言给出交易日、性质、容量、电量与报价依据', () => {
    const text = decisionReferenceCaption(reference())
    for (const part of ['2026-05-31 交易日申报', '真实申报', '申报容量 50 MW', '全天申报电量 120 MWh', '按早高峰报量并压低谷段']) expect(text).toContain(part)
    expect(text).toContain('不代表因果关系')
  })
  it('模拟演练不被写成真实申报', () => {
    expect(decisionReferenceCaption(reference({ simulated: true }))).toContain('历史模拟')
    expect(decisionReferenceCaption(reference({ simulated: true }))).not.toContain('真实申报')
  })
  it('曲线点数不足或含非有限值时不给全天电量，避免半条曲线被当成申报总量', () => {
    const short = decisionReferenceCaption(reference({ snapshot: order({ energyCurveMwh96: [1.25, 1.25] }) }))
    expect(short).not.toContain('全天申报电量')
    expect(short).toContain('申报容量 50 MW')
    const broken = Array.from({ length: 96 }, (_, i) => (i === 3 ? Number.NaN : 1.25))
    expect(decisionReferenceCaption(reference({ snapshot: order({ energyCurveMwh96: broken }) }))).not.toContain('全天申报电量')
  })
  it('没有报价依据时说明要回原申报核实，不留空白', () => {
    expect(decisionReferenceCaption(reference({ snapshot: order({ quoteRationale: undefined }) }))).toContain('需回到原申报核实')
  })
  it('导出正文里关联依据排在交易员理由之前，且不出现申报的内部标识', () => {
    const parts = reportParts(publication([{ id: 'd1', kind: 'decision', title: '2026-05-31 交易日申报', text: '这笔申报定了当日报量区间', declarationId: 'decl-0f1e2d3c', decisionVersion: 'v-9a8b7c', reference: reference() }]))
    const texts = parts.filter(part => part.kind !== 'chart').map(part => (part as { text: string }).text)
    const caption = texts.findIndex(text => text.includes('全天申报电量 120 MWh'))
    const reason = texts.findIndex(text => text === '这笔申报定了当日报量区间')
    expect(caption).toBeGreaterThan(-1)
    expect(reason).toBeGreaterThan(caption)
    expect(texts.join('\n')).not.toContain('decl-0f1e2d3c')
    expect(texts.join('\n')).not.toContain('v-9a8b7c')
  })
  it('管理层摘要同样保留关联依据，不让申报相关结论失去出处', () => {
    const parts = reportParts(publication([{ id: 'd1', kind: 'decision', title: '2026-05-31 交易日申报', text: '这笔申报定了当日报量区间', declarationId: 'decl-0f1e2d3c', decisionVersion: 'v-9a8b7c', reference: reference() }]), true)
    const texts = parts.filter(part => part.kind !== 'chart').map(part => (part as { text: string }).text).join('\n')
    expect(texts).toContain('全天申报电量 120 MWh')
    expect(texts).toContain('不代表因果关系')
    // 摘要不带正文，但依据必须在。
    expect(texts).not.toContain('这笔申报定了当日报量区间')
  })
  it('关联副本缺失时拒绝导出，不交付只有理由没有依据的报告', () => {
    const broken = publication([{ id: 'd1', kind: 'decision', title: '关联决策', text: '理由', declarationId: 'decl-0f1e2d3c' }])
    expect(() => reportParts(broken)).toThrow('关联申报不完整')
    // 摘要分支静默跳过的话，会产出一份「导出成功但没有依据」的管理层报告。
    expect(() => reportParts(broken, true)).toThrow('关联申报不完整')
  })
})
