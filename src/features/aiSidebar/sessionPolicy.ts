// 侧边栏会话去留规则（统一 AI 侧边栏 SS-01/02/03、EC-01，design D5）。纯函数，逐条对应规格。
//
// 背景：pi 的页面提示词 key（解读角色）只在建会话时锁定，发消息不再读取。所以「页面 B 的解读
// 送进页面 A 的会话」会让 B 沿用 A 的角色——跨页解读必须新开会话；同页同角色才续聊。

export type AiRequestKind = 'page' | 'free' | 'expert'

/** 侧边栏当前会话记录；sessionId 为 null 表示空白新对话（首次发送时才由内核建会话）。 */
export interface AiSessionRecord {
  sessionId: string | null
  scenario: string
  promptKey: string
  /** 发起会话的页面路由；从历史/运行中列表打开的会话为空串 */
  sourceRoute: string
  /** 对应的工作台入口 key（在工作台打开用） */
  entryKey: string
  title: string
  /** 专家会话的入口输入值（如晨报目标日），用于会话前置卡片 */
  meta?: Record<string, string>
}

export interface AiSessionRequest {
  kind: AiRequestKind
  route: string
  promptKey: string
  scenario: string
}

export type SessionDecision = 'continue' | 'new'

export function decideSession(current: AiSessionRecord | null, busy: boolean, request: AiSessionRequest): SessionDecision {
  // 专家命令：一律新开对应场景的会话
  if (request.kind === 'expert') return 'new'
  // 输入框直接提问：有当前会话就续聊，没有才新开（通用对话角色）
  if (request.kind === 'free') return current ? 'continue' : 'new'
  // 页面发起（解读/快捷问题/选中即问）：同页面、同角色、通用对话场景且不在生成中才续聊
  if (!current || busy) return 'new'
  const samePage = current.sourceRoute !== '' && current.sourceRoute === request.route
  const sameRole = current.promptKey === request.promptKey
  return samePage && sameRole && current.scenario === 'chat' && request.scenario === 'chat' ? 'continue' : 'new'
}
