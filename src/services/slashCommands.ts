// 斜杠指令注册中心（类似 Claude Code / Codex 的 slash command）。
// 纯逻辑、无 Vue 依赖：宿主组件（AiAssistant / AgentChatPanel）通过 CommandContext
// 注入各自的动作实现，输入框集成见 src/composables/useSlashInput.ts。
import { buildCatalog } from '@/services/aiNavigator'
import { getCurrentUser } from '@/services/auth'
import { isLlmConfigured, refreshLlmStatus } from '@/services/llm'
import { llmProviders } from '@/data/llmProviders'
import { getAllSkills, renderSkill, splitDateArgs, todayISO, type Skill } from '@/services/skills'
import type { AgentScenario } from '@/services/agent/agentClient'

export type CommandHost = 'assistant' | 'agent'

// 指令执行上下文：由宿主组件注入，指令本身不依赖任何组件内部状态
export type CommandContext = {
  host: CommandHost
  args: string // "/nav 现货价格" 中的 "现货价格"
  navigate: (path: string) => void
  postSystemNote: (text: string) => void // 在消息流插入一条本地提示（/help 输出等，不经 LLM）
  setInput: (text: string) => void
  sendToChat: (text: string) => void // 走当前面板的正常发送（assistant→askAssistant；agent→SSE）
  openWorkbench: (question?: string, scenario?: AgentScenario) => void
  clearSession: () => void
}

export type ArgOption = { label: string; value: string; meta?: string }

export type SlashCommand = {
  name: string // 不含斜杠，如 'nav'、'分析行情'
  aliases?: string[]
  description: string
  argHint?: string // 如 '<页面名>'，菜单内灰字展示；有参指令选中后先补全 "/name " 等待参数
  source: 'builtin' | 'skill'
  hosts?: CommandHost[] // 缺省两端都可用
  getArgOptions?: (query: string) => ArgOption[] // 二级参数补全候选
  runOnArgSelect?: boolean // 参数补全选中后直接执行（如 /nav 选页面即跳转）
  run: (ctx: CommandContext) => void | Promise<void>
}

// ── 工具函数 ──

// 解析 "/nav 现货 价格" → { name: 'nav', args: '现货 价格' }；非斜杠输入返回 null
export function parseSlashInput(text: string): { name: string; args: string } | null {
  const t = text.trim()
  if (!t.startsWith('/') || t.length < 2) return null
  const m = t.slice(1).match(/^(\S+)([\s\S]*)$/)
  if (!m) return null
  return { name: m[1], args: m[2].trim() }
}

function matchName(cmd: SlashCommand, name: string): boolean {
  const n = name.toLowerCase()
  return cmd.name.toLowerCase() === n || (cmd.aliases ?? []).some((a) => a.toLowerCase() === n)
}

export function findCommand(list: SlashCommand[], name: string): SlashCommand | undefined {
  return list.find((c) => matchName(c, name))
}

// name/alias/description 子串模糊匹配（中英皆可），name 前缀命中排前
export function filterCommands(list: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const scored = list
    .map((c) => {
      const names = [c.name, ...(c.aliases ?? [])].map((s) => s.toLowerCase())
      let score = 0
      if (names.some((n) => n.startsWith(q))) score = 3
      else if (names.some((n) => n.includes(q))) score = 2
      else if (c.description.toLowerCase().includes(q)) score = 1
      return { c, score }
    })
    .filter((x) => x.score > 0)
  return scored.sort((a, b) => b.score - a.score).map((x) => x.c)
}

// ── 内置指令 ──

function helpText(host: CommandHost): string {
  const cmds = getCommands(host)
  const builtin = cmds.filter((c) => c.source === 'builtin')
  const skills = cmds.filter((c) => c.source === 'skill')
  const fmt = (c: SlashCommand) =>
    `/${c.name}${c.argHint ? ' ' + c.argHint : ''} — ${c.description}`
  const lines = ['可用指令：', ...builtin.map(fmt)]
  if (skills.length) {
    lines.push('', '技能（可在「AI 设置 → 技能管理」里自定义）：', ...skills.map(fmt))
  }
  lines.push('', '提示：输入 / 可随时唤起指令菜单，↑↓ 选择、Enter/Tab 确认、Esc 关闭。')
  return lines.join('\n')
}

function navCatalog(): { path: string; title: string; group: string }[] {
  return buildCatalog(getCurrentUser())
}

function runNav(ctx: CommandContext) {
  const q = ctx.args.trim()
  const catalog = navCatalog()
  if (!q) {
    ctx.postSystemNote('用法：/nav <页面名>，例如 /nav 分时行情。\n输入 "/nav " 后可继续键入筛选页面。')
    return
  }
  // 精确命中标题/路径优先直达：菜单选中项写回的是完整标题，避免与更长标题
  // （如「价格预测」↔「日滚动价格预测」）的子串歧义而误报「匹配到多个页面」。
  const exact = catalog.find((p) => p.title === q || p.path === q)
  if (exact) {
    ctx.navigate(exact.path)
    return
  }
  const hits = catalog.filter(
    (p) => p.title.includes(q) || p.group.includes(q) || p.path.includes(q)
  )
  if (hits.length === 1) {
    ctx.navigate(hits[0].path)
  } else if (hits.length > 1) {
    ctx.postSystemNote(
      `「${q}」匹配到多个页面，请说得更具体些：\n` +
        hits.slice(0, 8).map((p) => `· ${p.title}（${p.group}）→ /nav ${p.title}`).join('\n')
    )
  } else {
    ctx.postSystemNote(`没找到与「${q}」匹配的页面，输入 "/nav " 可浏览全部页面。`)
  }
}

async function runModel(ctx: CommandContext) {
  // agent-backend：模型与密钥已收口到服务端，前端不再 localStorage 切换模型，
  // 统一在「AI 设置」页管理。这里展示状态 + 各厂商可选模型，切换引导去 /settings。
  if (ctx.args.trim()) {
    ctx.postSystemNote('模型与密钥已收口到服务端，切换请到「AI 设置」页（/settings）。')
    return
  }
  const list = llmProviders
    .filter((p) => p.models.length)
    .map((p) => `· ${p.name}：${p.models.join('、')}`)
    .join('\n')
  const configured = isLlmConfigured() || await refreshLlmStatus()
  ctx.postSystemNote(
    `${configured ? '大模型已在服务端配置' : '尚未配置大模型'}。` +
      `模型与密钥统一在「AI 设置」页管理（/settings）。\n\n各厂商可选模型：\n${list}`
  )
}

function modelArgOptions(query: string): ArgOption[] {
  const q = query.trim().toLowerCase()
  const out: ArgOption[] = []
  for (const p of llmProviders) {
    for (const m of p.models) {
      if (!p.models.length) continue
      if (q && !m.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) continue
      out.push({ label: m, value: m, meta: p.name })
    }
  }
  return out.slice(0, 12)
}

// 技能 → 顶级斜杠指令
function skillToCommand(skill: Skill): SlashCommand {
  return {
    name: skill.name,
    description: skill.description + (skill.target === 'agent' ? '（智能体）' : ''),
    argHint: skill.template.includes('{{date}}') ? '[日期] [补充说明]' : '[补充说明]',
    source: 'skill',
    run: (ctx) => runSkill(skill, ctx)
  }
}

// 首条消息只认裸日期（YYYY-MM-DD）的智能体场景：declaration_prep 图首条必须是日期；
// daily_review 也只有首条为纯日期才会套用复盘任务模板（见后端 service.py stream_message）。
// 整句渲染的 prompt 会落进自由追问 / 普通聊天、跳过专属图，故移交时只带日期。
const DATE_FIRST_SCENARIOS: AgentScenario[] = ['declaration_prep', 'daily_review']

export function runSkill(skill: Skill, ctx: CommandContext) {
  // chat 技能（轻量 LLM 对话）：两端都直接走当前会话发送
  if (skill.target !== 'agent') {
    ctx.sendToChat(renderSkill(skill, ctx.args))
    return
  }
  const scenario = skill.scenario ?? 'chat'
  // 裸日期场景：首条只发日期；补充说明无法随首条进入图，提示去工作台追问
  if (DATE_FIRST_SCENARIOS.includes(scenario)) {
    const { date, rest } = splitDateArgs(ctx.args)
    const day = date ?? todayISO()
    if (rest) {
      ctx.postSystemNote(
        `已按 ${day} 移交「${skill.name}」；补充说明「${rest}」请在任务启动后到工作台追问。`
      )
    }
    ctx.openWorkbench(day, scenario)
    return
  }
  // 普通智能体场景：整句渲染后交由宿主 openWorkbench 落地
  // （助手端 → 深链工作台；工作台端 → 同场景当前会话直接发送）
  ctx.openWorkbench(renderSkill(skill, ctx.args), scenario)
}

const builtinCommands: SlashCommand[] = [
  {
    name: 'help',
    aliases: ['h', '帮助'],
    description: '查看全部指令与技能',
    source: 'builtin',
    run: (ctx) => ctx.postSystemNote(helpText(ctx.host))
  },
  {
    name: 'clear',
    aliases: ['cls', '清空'],
    description: '清空当前会话，开始新对话',
    source: 'builtin',
    run: (ctx) => ctx.clearSession()
  },
  {
    name: 'nav',
    aliases: ['go', '跳转'],
    description: '直达系统页面（不经过大模型）',
    argHint: '<页面名>',
    source: 'builtin',
    runOnArgSelect: true,
    getArgOptions: (query) => {
      const q = query.trim()
      return navCatalog()
        .filter((p) => !q || p.title.includes(q) || p.group.includes(q) || p.path.includes(q))
        .slice(0, 10)
        .map((p) => ({ label: p.title, value: p.title, meta: p.group }))
    },
    run: runNav
  },
  {
    name: 'settings',
    aliases: ['config', '设置'],
    description: '打开 AI 设置（模型 / API Key / 技能管理）',
    source: 'builtin',
    run: (ctx) => ctx.navigate('/system/ai-studio?tab=models')
  },
  {
    name: 'model',
    aliases: ['模型'],
    description: '查看或切换大模型',
    argHint: '[模型名]',
    source: 'builtin',
    runOnArgSelect: true,
    getArgOptions: modelArgOptions,
    run: runModel
  },
  {
    name: 'agent',
    aliases: ['workbench', '工作台'],
    description: '把问题交给智能体工作台深度处理（查数据、跑量化、出报告）',
    argHint: '[问题]',
    source: 'builtin',
    hosts: ['assistant'],
    run: (ctx) => ctx.openWorkbench(ctx.args.trim() || undefined)
  },
  {
    name: 'skill',
    aliases: ['技能'],
    description: '运行一个技能',
    argHint: '<技能名> [参数]',
    source: 'builtin',
    getArgOptions: (query) => {
      const q = query.trim()
      return getAllSkills()
        .filter((s) => !q || s.name.includes(q) || s.description.includes(q))
        .map((s) => ({ label: s.name, value: s.name, meta: s.description }))
    },
    run: (ctx) => {
      const parsed = ctx.args.trim().match(/^(\S+)([\s\S]*)$/)
      if (!parsed) {
        ctx.postSystemNote('用法：/skill <技能名> [参数]，例如 /skill 分析行情 6月10日。\n输入 /help 查看全部技能。')
        return
      }
      const skill = getAllSkills().find((s) => s.name === parsed[1] || s.name.includes(parsed[1]))
      if (!skill) {
        ctx.postSystemNote(`没找到技能「${parsed[1]}」，输入 /help 查看全部技能，或到「AI 设置 → 技能管理」新建。`)
        return
      }
      runSkill(skill, { ...ctx, args: parsed[2].trim() })
    }
  }
]

// 当前端可用的全部指令：内置 + 技能动态转化（每次打开菜单时调用，用户新建技能即时生效）
export function getCommands(host: CommandHost): SlashCommand[] {
  const cmds = builtinCommands.filter((c) => !c.hosts || c.hosts.includes(host))
  const skillCmds = getAllSkills().map(skillToCommand)
  return [...cmds, ...skillCmds]
}

// 执行斜杠输入：是已知指令则运行并返回 true；以 / 开头但未知也拦截（提示而非发给 LLM）
export function executeSlashInput(text: string, makeContext: (args: string) => CommandContext): boolean {
  const parsed = parseSlashInput(text)
  if (!parsed) return false
  const host = makeContext('').host
  const cmd = findCommand(getCommands(host), parsed.name)
  if (cmd) {
    void cmd.run(makeContext(parsed.args))
    return true
  }
  makeContext('').postSystemNote(`未知指令 /${parsed.name}，输入 /help 查看全部指令。`)
  return true
}
