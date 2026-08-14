// miniMarkdown 零依赖渲染回归：转义顺序是安全不变量——escapeHtml 先于一切标记解析，
// 因此任何语法（含代码块/链接 URL）里的尖括号都不可能以 < 原样进入输出，agent 回复
// 里的 <script> 不可执行。坏掉的症状：聊天面板被注入脚本或整个版面被未闭合标签打穿。
// 同时锁内联标记子集（code/strong/em/link）与块级结构（标题/列表/表格/代码块/hr）。
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './miniMarkdown'

describe('miniMarkdown：HTML 转义安全不变量（先转义后解析）', () => {
  it('script 标签整体转义，输出中不存在可执行的尖括号标签', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })

  it('事件属性注入同样只剩纯文本', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  })

  it('& 最先转义：已转义实体会二次转义（防 &lt;script&gt; 绕过转义层）', () => {
    // 现行为：'&lt;' → '&amp;lt;'。双重显示是代价，换来的是任何 '&' 都不可能拼出实体。
    expect(renderMarkdown('&lt;script&gt;')).toBe('<p>&amp;lt;script&amp;gt;</p>')
    expect(renderMarkdown('a & b')).toBe('<p>a &amp; b</p>')
  })

  it('代码块内容同样被转义（围栏不是裸 HTML 通道）', () => {
    expect(renderMarkdown('```\n<b>x</b>\n```')).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>')
  })

  it('链接 URL 含引号时 href 不会提前闭合（" 已转义为 &quot;）', () => {
    const html = renderMarkdown('[x](https://a.com/?q="1)')
    expect(html).toContain('href="https://a.com/?q=&quot;1"')
  })

  it('链接文本中的 <b> 只以转义形态出现', () => {
    const html = renderMarkdown('[<b>](https://a.com)')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })
})

describe('miniMarkdown：内联标记子集', () => {
  it.each([
    ['**bold**', '<strong>bold</strong>'],
    ['*em*', '<em>em</em>'],
    ['`code`', '<code>code</code>'],
    ['**a** and *b* and `c`', '<strong>a</strong> and <em>b</em> and <code>c</code>'],
  ])('%s → %s', (src, inline) => {
    expect(renderMarkdown(src)).toBe(`<p>${inline}</p>`)
  })

  it('链接只放行 http(s)：javascript:/data: 协议不成链（原样文本，不产 <a>）', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>')
    expect(renderMarkdown('[x](data:text/html,<b>))')).toBe('<p>[x](data:text/html,&lt;b&gt;))</p>')
    expect(renderMarkdown('[x](https://example.com/a)')).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener">x</a></p>'
    )
    expect(renderMarkdown('[x](http://example.com/a)')).toBe(
      '<p><a href="http://example.com/a" target="_blank" rel="noopener">x</a></p>'
    )
  })

  it('反例：不成对/空内容的标记保持原样', () => {
    expect(renderMarkdown('**bold')).toBe('<p>**bold</p>') // 未闭合
    expect(renderMarkdown('*')).toBe('<p>*</p>')
    expect(renderMarkdown('``')).toBe('<p>``</p>') // 空内容 `([^`]+)` 不匹配
  })
})

describe('miniMarkdown：块级结构', () => {
  it('标题 #..#### → h3..h6（h3 起步不抢页面层级）', () => {
    expect(renderMarkdown('# T')).toBe('<h3>T</h3>')
    expect(renderMarkdown('## T')).toBe('<h4>T</h4>')
    expect(renderMarkdown('### T')).toBe('<h5>T</h5>')
    expect(renderMarkdown('#### T')).toBe('<h6>T</h6>')
  })

  it('五级以上井号不按标题解析（降级为段落）', () => {
    expect(renderMarkdown('##### T')).toBe('<p>##### T</p>')
  })

  it('标题后接正文互不吞并', () => {
    expect(renderMarkdown('# T\nbody')).toBe('<h3>T</h3><p>body</p>')
  })

  it('分隔线 --- / *** / - - -', () => {
    expect(renderMarkdown('---')).toBe('<hr>')
    expect(renderMarkdown('***')).toBe('<hr>')
    expect(renderMarkdown('- - -')).toBe('<hr>')
  })

  it('无序/有序列表', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. x\n2. y')).toBe('<ol><li>x</li><li>y</li></ol>')
  })

  it('列表行内支持内联标记', () => {
    expect(renderMarkdown('- **a**')).toBe('<ul><li><strong>a</strong></li></ul>')
  })

  it('无序与有序行混排并入同一列表，类型由首行定（现行为记录）', () => {
    expect(renderMarkdown('- a\n1. b')).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('代码块：语言标注被忽略、内容不做内联解析、支持多行', () => {
    expect(renderMarkdown('```js\nconst a = 1\nconst b = 2\n```')).toBe(
      '<pre><code>const a = 1\nconst b = 2</code></pre>'
    )
    expect(renderMarkdown('```\n**not strong**\n```')).toBe('<pre><code>**not strong**</code></pre>')
  })

  it('未闭合代码块吞到文末（不抛错、不丢内容）', () => {
    expect(renderMarkdown('```js\nfoo')).toBe('<pre><code>foo</code></pre>')
  })

  it('表格：表头/分隔行/数据行齐全才成表', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    )
  })

  it('表格反例：缺分隔行则三行都退化为段落（不半渲染）', () => {
    expect(renderMarkdown('| a | b |\n| x | y |\n| 1 | 2 |')).toBe(
      '<p>| a | b |</p><p>| x | y |</p><p>| 1 | 2 |</p>'
    )
  })

  it('表格单元格支持内联标记', () => {
    expect(renderMarkdown('| **a** |\n|---|\n| `c` |')).toBe(
      '<table><thead><tr><th><strong>a</strong></th></tr></thead><tbody><tr><td><code>c</code></td></tr></tbody></table>'
    )
  })
})

describe('miniMarkdown：段落与空白', () => {
  it('连续行合并为一段，软换行转 <br>', () => {
    expect(renderMarkdown('l1\nl2\n\nl3')).toBe('<p>l1<br>l2</p><p>l3</p>')
  })

  it('段落被列表/标题打断', () => {
    expect(renderMarkdown('text\n- item')).toBe('<p>text</p><ul><li>item</li></ul>')
  })

  it('CRLF 归一后再解析', () => {
    expect(renderMarkdown('a\r\nb\r\n\r\nc')).toBe('<p>a<br>b</p><p>c</p>')
  })

  it('空串与纯空白 → 空输出（不产空 <p>）', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(' \n \n')).toBe('')
  })
})
