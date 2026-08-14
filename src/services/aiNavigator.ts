// AI 助手：既是全能助手（聊天/写代码/答疑），也能根据意图推荐页面跳转。
// 用「自由文本正文 + @@NAV 标记行」协议（比 JSON mode 健壮：正文含代码/长文本也不会解析崩）。
import { navigation, type NavItem } from '@/data/navigation'
import { filterNavigationForUser, type GovernanceUser } from '@/services/governance'
import { getCurrentRegionSnapshot } from '@/services/region/regionContext'
import { chatCompletion, type ChatMessage } from '@/services/llm'
import { buildNavigatorSystemPrompt } from '@/prompts/navigator'

export type PageEntry = { path: string; title: string; group: string }
export type NavSuggestion = { path: string; title: string; group: string; reason: string }
export type AssistantReply = { reply: string; suggestions: NavSuggestion[] }
export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type CurrentPage = { path: string; title: string; group?: string; scope?: string; kind?: string }

export function buildCatalog(user?: GovernanceUser): PageEntry[] {
  const out: PageEntry[] = []
  const visibleNavigation = filterNavigationForUser(navigation as NavItem[], user, getCurrentRegionSnapshot().id)
  for (const item of visibleNavigation as NavItem[]) {
    if (item.children?.length) {
      for (const child of item.children) {
        out.push({ path: child.path, title: child.title, group: item.title })
      }
    } else {
      out.push({ path: item.path, title: item.title, group: item.title })
    }
  }
  return out
}

// 系统提示已统一迁到 src/prompts/navigator.ts（buildNavigatorSystemPrompt）。

export async function askAssistant(
  history: ChatTurn[],
  catalog: PageEntry[],
  currentPage?: CurrentPage,
  signal?: AbortSignal
): Promise<AssistantReply> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildNavigatorSystemPrompt(catalog, currentPage) },
    ...history.map((h) => ({ role: h.role, content: h.content }))
  ]
  const content = await chatCompletion(messages, { signal })

  // 当前页的 base 路径（去 query 串）：@@NAV 解析与兜底补卡都排除它，避免「在当前页问当前页」
  // 时补出当前页跳转卡，触发 autoJump 跳回/关闭助手，违背「不把当前页本身作为跳转推荐」。
  const currentBase = (currentPage?.path || '').split('?')[0]
  const byPath = new Map(catalog.map((p) => [p.path, p]))
  const suggestions: NavSuggestion[] = []
  const navLine = content.match(/@@NAV:\s*(.+?)\s*$/m)
  if (navLine) {
    for (const part of navLine[1].split(';;')) {
      const [p, reason] = part.split('|').map((s) => s.trim())
      const base = (p || '').split('?')[0] // 路径可带查询串(?date=…),只用 base 在清单里校验
      if (base === currentBase) continue // 排除当前页，不补自身跳转卡
      const page = byPath.get(base)
      if (page && !suggestions.some((o) => o.path === p)) {
        suggestions.push({ ...page, path: p, reason: reason || '' }) // 保留含参数的完整路径供跳转
      }
    }
  }

  let reply = content.replace(/@@NAV:.*$/m, '').trim()
  if (!reply) reply = suggestions.length ? '为你找到以下页面：' : '（未获得回复，请重试）'

  // 兜底：回答涉及系统主题、但模型漏给跳转卡时，用用户问题在清单里做关键词匹配，强制补上相关卡片。
  if (!suggestions.length) {
    const intent = [...history].reverse().find((h) => h.role === 'user')?.content ?? ''
    const intentChars = new Set(Array.from(intent))
    const scored = catalog
      .filter((p) => (p.path || '').split('?')[0] !== currentBase) // 排除当前页，不补自身
      .map((p) => {
        let s = 0
        new Set(Array.from(p.title)).forEach((c) => {
          if (intentChars.has(c) && /[一-龥A-Za-z0-9]/.test(c)) s++
        })
        return { p, s }
      })
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
    for (const { p } of scored) suggestions.push({ ...p, reason: '相关页面' })
  }

  return { reply, suggestions }
}
