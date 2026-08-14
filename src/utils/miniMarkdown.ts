// 轻量 Markdown 渲染（零依赖）：覆盖 agent 回复常用语法。
// 支持: 标题/粗斜体/行内码/代码块/无序与有序列表/简单表格/链接/分隔线。
// 输出前先做 HTML 转义，链接仅放行 http(s)。

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src.replace(/\r\n/g, '\n')).split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // 代码块
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`)
      continue
    }
    // 表格（连续 | 开头行，第二行为分隔行）
    if (line.includes('|') && /^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const headers = line.split('|').slice(1, -1).map((c) => inline(c.trim()))
      i += 2
      const rows: string[] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => inline(c.trim()))
        rows.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
        i++
      }
      out.push(
        `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
      )
      continue
    }
    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)/)
    if (heading) {
      const level = heading[1].length + 2 // h3 起步，避免抢页面层级
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }
    if (/^\s*([-*]\s*){3,}$/.test(line)) {
      out.push('<hr>')
      i++
      continue
    }
    // 列表
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`)
        i++
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    // 普通段落（合并连续行）
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
      buf.push(lines[i++])
    }
    out.push(`<p>${inline(buf.join('<br>'))}</p>`)
  }
  return out.join('')
}
