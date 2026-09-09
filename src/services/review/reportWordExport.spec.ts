// 守发布内容/图表/资料性质同源；防止导出丢人工判断或把模拟变成真实。dljy#2875。
import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { buildReportWord } from './reportWordExport'
import { reportChartOption } from './reportPresentation'
import type { Publication, ReportEvidence } from './workpapers'

const material: ReportEvidence = {
  id: 'material', region: 'yunnan', authorId: '主笔', createdAt: '', sourceKind: 'client_provided', contentHash: 'hash',
  content: { topic: 'price', labels: ['日前价格', '实时价格'], sourceNotice: '资料来源尚未认证', capturedAt: '', input: { scope: { objectId: 'a' }, period: { date: '2026-05-31' } }, result: {
    intervals: [], anomalies: [], energy: { baselineMwh: null, actualMwh: null, netDeviationMwh: null, absoluteDeviationMwh: null, absoluteDeviationPct: null },
    prices: { daAverage: 200, rtAverage: 180, spreadAverage: 20, comparableMinutes: 15 }, coverage: { expectedMinutes: 1440, observedMinutes: 15, comparableMinutes: 0, ratio: 0 },
    notice: '', methodology: '', simulated: true, periods: { current: { start: '2026-05-31', end: '2026-05-31' } },
  } },
}
const publication: Publication = { id: 'published', draftId: 'draft', revision: 3, contentHash: '', createdAt: '', content: {
  title: '复盘 <人工结论>', authorId: '主笔', summary: '需要关注价差', notice: '主笔发布，不等于结算认证', publishedAt: '', scope: { objectId: 'a', objectLabel: '公司总览', region: 'yunnan', view: 'retail', startDate: '2026-05-31', endDate: '2026-05-31' },
  blocks: [{ id: 'chart', title: '价差分析', kind: 'chart', text: '第一行解释\n第二行解释', evidenceId: 'material', evidenceRole: 'primary' }, { id: 'reason', title: '原因', kind: 'reason', text: '可能与供需有关', state: 'pending', supports: '支持材料', refutes: '反对材料' }], evidence: [material],
} }
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII='

describe('冻结报告的 Word 导出', () => {
  it('生成真正的 docx，保留中文、段落、图表和待核实原因', async () => {
    const render = vi.fn().mockResolvedValue(pixel)
    const blob = await buildReportWord(publication, false, render)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('复盘 &lt;人工结论&gt;')
    for (const text of ['第一行解释', '第二行解释', '待核实的可能原因', '反对材料', '模拟演练', '资料来源尚未认证', '20 元/MWh']) expect(xml).toContain(text)
    expect(Object.keys(zip.files).some(path => path.startsWith('word/media/') && path.endsWith('.png'))).toBe(true)
    expect(render).toHaveBeenCalledWith(material)
    expect(xml).not.toContain('client_provided')
  })
  it('摘要不带完整正文但保留依据的模拟/未认证性质', async () => {
    const render = vi.fn()
    const blob = await buildReportWord(publication, true, render)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('需要关注价差')
    expect(xml).toContain('模拟演练')
    expect(xml).not.toContain('第二行解释')
    expect(render).not.toHaveBeenCalled()
  })
  it('图表材料缺失时失败，不生成看似完整的报告', async () => {
    await expect(buildReportWord({ ...publication, content: { ...publication.content, evidence: [] } })).rejects.toThrow('材料不完整')
    expect(reportChartOption(material).yAxis).toMatchObject({ name: '元/MWh' })
  })
})
