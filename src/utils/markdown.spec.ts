// 完整 Markdown 渲染回归（markdown-it + highlight.js + DOMPurify）。
// 守的安全不变量：html:false 不放行原始 HTML，智能体报告/策略输出一律视为不可信，
// 坏掉即 XSS。同时锁 breaks/linkify/链接新开页/任务列表/行内渲染这些影响报告可读性的
// 行为。katex/mermaid 不在本模块（由组件渲染），不测。
//
// ⚠️ dompurify 被 mock 为透传：实测本仓 happy-dom（vitest 4 + dompurify 3.4.13）下
// DOMPurify.sanitize 会剥掉所有标签只剩文本（sanitize('<h1>x</h1>') → 'x'），
// 是 happy-dom DOM 实现与 DOMPurify 的兼容性问题（真实浏览器正常），非源码 bug。
// 透传后本 spec 守的是 markdown-it html:false 的转义层，生产上 XSS 防线的主层；
// DOMPurify 兜底层无法在本测试环境有效断言。
import { describe, expect, it, vi } from 'vitest'

const sanitizePassthrough = vi.hoisted(() => (html: string) => html)
vi.mock('dompurify', () => ({
  default: { sanitize: sanitizePassthrough, isSupported: true },
}))

import { renderMarkdown, renderMarkdownInline } from './markdown'

describe('renderMarkdown：空输入诚实返回空串', () => {
  it.each([
    [''],
    [null],
    [undefined],
  ])('renderMarkdown(%p) → ""', (src) => {
    expect(renderMarkdown(src as string)).toBe('')
  })

  it('renderMarkdownInline 同口径', () => {
    expect(renderMarkdownInline('')).toBe('')
  })
})

describe('renderMarkdown：核心块级/内联渲染', () => {
  it('标题保持 markdown-it 原生层级（# → h1，不似 miniMarkdown 强制 h3 起步）', () => {
    expect(renderMarkdown('# 标题')).toContain('<h1>标题</h1>')
    expect(renderMarkdown('### 三级')).toContain('<h3>三级</h3>')
  })

  it('粗体/斜体/行内码', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('*em*')).toContain('<em>em</em>')
    expect(renderMarkdown('`code`')).toContain('<code>code</code>')
  })

  it('块级渲染以 <p> 包裹段落', () => {
    expect(renderMarkdown('hello')).toContain('<p>hello</p>')
  })

  it('breaks:true 软换行转 <br>（贴合聊天/报告习惯）', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('第一行<br>')
  })

  it('GFM 表格', () => {
    const html = renderMarkdown('| 列A | 列B |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>列A</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('fence 代码块走自定义 highlight（class="hljs" + 关键字着色）', () => {
    const html = renderMarkdown('```js\nconst x = 1\n```')
    expect(html).toContain('class="hljs"')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('const')
  })

  it('未知语言围栏自动检测不抛错、仍有 hljs 容器', () => {
    const html = renderMarkdown('```\nplain text 123\n```')
    expect(html).toContain('class="hljs"')
  })
})

describe('renderMarkdown：链接策略', () => {
  it('链接统一新开页并防 opener（target=_blank + rel=noopener noreferrer）', () => {
    const html = renderMarkdown('[点我](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('javascript: 协议被 markdown-it validateLink 拒绝（不成链，退回原样文本）', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('<a') // 未生成链接元素，自然无危险 href
    expect(html).toContain('x') // 文本不丢
  })

  it('linkify：裸 URL 文本自动成链', () => {
    const html = renderMarkdown('详见 https://example.com/docs')
    expect(html).toContain('href="https://example.com/docs"')
  })
})

describe('renderMarkdown：raw HTML 转义（html:false 主防线）', () => {
  it('<script> 整体转义，输出无脚本标签', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('事件属性注入拿不到可执行属性（标签整体退化为转义文本）', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img') // 无未转义标签，onerror 只是纯文本
    expect(html).toContain('&lt;img')
  })

  it('iframe 不可通过原始 HTML 混入', () => {
    expect(renderMarkdown('<iframe src="https://evil.example"></iframe>')).not.toContain('<iframe')
  })
})

describe('GFM 任务列表：只读复选框', () => {
  it('- [ ] → 未勾选 disabled 复选框', () => {
    const html = renderMarkdown('- [ ] 待办')
    expect(html).toContain('<input')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('disabled')
    expect(html).not.toContain('checked')
    expect(html).toContain('待办') // 标记前缀剥离、文本保留
  })

  it('- [x] / - [X] → 勾选态', () => {
    expect(renderMarkdown('- [x] 已办')).toContain('checked')
    expect(renderMarkdown('- [X] 已办')).toContain('checked')
  })

  it('非任务列表的普通列表不受插件影响', () => {
    const html = renderMarkdown('- 普通')
    expect(html).not.toContain('<input')
    expect(html).toContain('<li>普通</li>')
  })
})

describe('renderMarkdownInline：行内渲染无块级包裹', () => {
  it('不包 <p>', () => {
    expect(renderMarkdownInline('**a** b')).toBe('<strong>a</strong> b')
  })

  it('行内码与链接照常工作且带新开页属性', () => {
    const html = renderMarkdownInline('[x](https://e.com) `c`')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('<code>c</code>')
    expect(html).not.toContain('<p>')
  })

  it('行内渲染同样不给原始 HTML 放行', () => {
    expect(renderMarkdownInline('<b>x</b>')).not.toContain('<b>')
  })
})
