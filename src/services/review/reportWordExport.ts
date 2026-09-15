import type { ReportEvidence, Publication } from './workpapers'
import { reportChartOption, reportParts } from './reportPresentation'

/** 图片只在本机由已发布资料绘制，无外部上传、无模型调用。 */
export async function renderReportChart(evidence: ReportEvidence): Promise<string> {
  const { init } = await import('echarts')
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  const chart = init(canvas, undefined, { width: 1100, height: 420, renderer: 'canvas' })
  try { chart.setOption(reportChartOption(evidence)); return chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }) }
  finally { chart.dispose() }
}

/** 标准 OOXML；文字保持可编辑，图表嵌入固定图片并附同源统计和资料性质。 */
export async function buildReportWord(publication: Publication, brief = false, renderChart = renderReportChart): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = await import('docx')
  const children = []
  for (const part of reportParts(publication, brief)) {
    if (part.kind === 'chart') {
      children.push(new Paragraph({ children: [new ImageRun({ data: await renderChart(part.evidence), type: 'png', transformation: { width: 550, height: 210 }, altText: { title: part.evidence.content.labels.join('与'), description: '发布时固定的分时曲线', name: '复盘分析图' } })] }))
    } else {
      for (const text of part.text.split(/\r?\n/)) children.push(new Paragraph({
        heading: part.kind === 'title' ? HeadingLevel.TITLE : part.kind === 'heading' ? HeadingLevel.HEADING_1 : undefined,
        spacing: { after: 140 }, children: [new TextRun({ text, font: 'Microsoft YaHei', size: part.kind === 'title' ? 36 : part.kind === 'heading' ? 28 : 22 })],
      }))
    }
  }
  const doc = new Document({ creator: publication.content.authorId, title: publication.content.title, description: publication.content.notice,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  })
  return Packer.toBlob(doc)
}
export async function downloadReportWord(publication: Publication, brief = false) {
  const blob = await buildReportWord(publication, brief), url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = `${publication.content.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100)}-第${publication.revision}版-${brief ? '摘要' : '详版'}.docx`
  document.body.append(link); link.click(); link.remove()
  // 下载交给浏览器之后再释放，不在 click 同步栈中销毁 URL。
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
