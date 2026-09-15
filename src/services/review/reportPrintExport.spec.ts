import { describe, expect, it } from 'vitest'
import { buildReportPrintHtml } from './reportPrintExport'
import type { Publication } from './workpapers'

const publication: Publication = {
  id: 'publication', draftId: 'draft', revision: 2, contentHash: '', createdAt: '',
  content: {
    title: '复盘 <img src=x onerror=alert(1)>', authorId: '主笔', summary: '关注偏差', notice: '主笔发布，原因仍待核实', publishedAt: '',
    scope: { objectId: 'company-overview', objectLabel: '公司总览', region: 'yunnan', view: 'generator', startDate: '2026-05-01', endDate: '2026-05-31' },
    blocks: [{ id: 'reason', kind: 'reason', title: '可能原因', text: '第一行\n<script>alert(1)</script>', state: 'pending', supports: '已有材料', refutes: '存在相反记录' }], evidence: [],
  },
}
describe('冻结报告打印与 PDF 预览', () => {
  it('保留日期范围和待核实状态，人工文字不能成为 HTML', async () => {
    const html = await buildReportPrintHtml(publication)
    expect(html).toContain('2026-05-01—2026-05-31')
    expect(html).toContain('待核实的可能原因')
    expect(html).toContain('存在相反记录')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('@page{size:A4')
  })
  it('摘要保留发布说明，详版引用材料缺失时拒绝生成', async () => {
    const html = await buildReportPrintHtml(publication, true)
    expect(html).toContain('主笔发布，原因仍待核实')
    expect(html).not.toContain('存在相反记录')
    await expect(buildReportPrintHtml({ ...publication, content: { ...publication.content, blocks: [{ id: 'chart', title: '分析', kind: 'chart', text: '', evidenceId: 'missing' }] } })).rejects.toThrow('材料不完整')
  })
})
