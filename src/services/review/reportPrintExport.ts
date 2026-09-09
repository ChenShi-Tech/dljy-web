import type { Publication } from './workpapers'
import { reportParts } from './reportPresentation'
import { renderReportChart } from './reportWordExport'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** 打印与 Word 共用发布材料；所有人工文字按纯文本处理。 */
export async function buildReportPrintHtml(publication: Publication, brief = false, renderChart = renderReportChart): Promise<string> {
  const elements: string[] = []
  for (const part of reportParts(publication, brief)) {
    if (part.kind === 'chart') {
      const png = await renderChart(part.evidence)
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png)) throw new Error('图表图片生成失败')
      elements.push(`<figure><img src="${png}" alt="发布时固定的复盘分析图" /></figure>`)
    } else {
      const tag = part.kind === 'title' ? 'h1' : part.kind === 'heading' ? 'h2' : 'p'
      elements.push(`<${tag}>${escapeHtml(part.text)}</${tag}>`)
    }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(publication.content.title)}</title><style>
    @page{size:A4;margin:18mm}body{font:12pt/1.7 "Microsoft YaHei","PingFang SC",sans-serif;color:#222;margin:0}
    h1{font-size:22pt}h2{font-size:15pt;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}
    figure{margin:12pt 0;break-inside:avoid}img{display:block;width:100%;height:auto}h1,h2{overflow-wrap:anywhere}
  </style></head><body>${elements.join('\n')}</body></html>`
}

/** 浏览器打印对话框提供保存 PDF；不上传材料，不调用模型。 */
export async function printPublishedReport(publication: Publication, brief = false): Promise<void> {
  const html = await buildReportPrintHtml(publication, brief)
  const frame = document.createElement('iframe')
  frame.title = '复盘报告打印预览'
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0'
  const loaded = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve()
    frame.onerror = () => reject(new Error('打印预览加载失败'))
  })
  frame.srcdoc = html
  document.body.append(frame)
  try {
    await loaded
    const target = frame.contentWindow, doc = frame.contentDocument
    if (!target || !doc) throw new Error('打印预览不可用')
    await doc.fonts?.ready
    await Promise.all(Array.from(doc.images).map(img => img.decode()))
    // afterprint 在关闭对话框后触发；不在 print 返回时销毁仍可能使用的文档。
    target.addEventListener('afterprint', () => frame.remove(), { once: true })
    target.focus()
    target.print()
  } catch (error) { frame.remove(); throw error }
}
