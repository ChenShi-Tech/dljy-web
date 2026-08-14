// 完整 Markdown 渲染：markdown-it（GFM 表格/任务列表/换行）+ highlight.js 代码高亮
// + DOMPurify 防 XSS。供智能体策略/报告流式渲染使用，替代零依赖 miniMarkdown 的能力上限。
//
// 注意：流式渲染场景下每次 token 追加都会整体重渲染，markdown-it 足够快；
// DOMPurify 兜底防注入（外部内容/模型输出都视为不可信）。

import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

const md: MarkdownIt = new MarkdownIt({
  html: false, // 不放行原始 HTML（连同 DOMPurify 双保险）
  linkify: true,
  breaks: true, // 软换行转 <br>，贴合聊天/报告习惯
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        /* 降级到自动检测 */
      }
    }
    try {
      return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`
    } catch {
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
    }
  }
})

// GFM 任务列表：- [ ] / - [x] → 复选框（只读）
md.core.ruler.after('inline', 'gfm_task_lists', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue
    const text = token.content
    const m = /^\[([ xX])\]\s+/.exec(text)
    if (m && token.children[0]?.type === 'text') {
      const checked = m[1].toLowerCase() === 'x'
      token.children[0].content = token.children[0].content.replace(/^\[([ xX])\]\s+/, '')
      const box = new state.Token('html_inline', '', 0)
      box.content = `<input class="md-task" type="checkbox" disabled${checked ? ' checked' : ''}> `
      token.children.unshift(box)
    }
  }
  return true
})

// 链接统一加 target/rel（新开页 + 防 opener）
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// DOMPurify：放行 hljs/任务列表所需属性
const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'class', 'type', 'checked', 'disabled'],
  ALLOWED_ATTR: undefined as unknown as string[] // 用默认白名单 + ADD_ATTR
}

/** 渲染完整 Markdown 为安全 HTML（流式与静态通用）。 */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const raw = md.render(src)
  return DOMPurify.sanitize(raw, { ADD_ATTR: PURIFY_CONFIG.ADD_ATTR })
}

/** 行内 Markdown（无块级包裹），用于标签/摘要等单行场景。 */
export function renderMarkdownInline(src: string): string {
  if (!src) return ''
  return DOMPurify.sanitize(md.renderInline(src), { ADD_ATTR: PURIFY_CONFIG.ADD_ATTR })
}
