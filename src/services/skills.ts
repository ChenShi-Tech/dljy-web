// 技能（Skill）系统：命名的提示模板/工作流，即自定义斜杠指令。
// 每个技能会自动注册为同名斜杠指令（如「分析行情」→ /分析行情 6月10日）。
// 内置技能对齐 ironclaw 后端子智能体角色；用户自定义技能存 localStorage（与 llm.ts 同模式）。
import { ref } from 'vue'
import { fetchAgentSkills, type AgentScenario } from '@/services/agent/agentClient'

export type SkillTarget = 'chat' | 'agent'

export type Skill = {
  id: string
  name: string // 同时作为斜杠指令名，如「分析行情」
  description: string
  template: string // 支持 {{args}}（原始参数串）与 {{date}}（参数中的日期，缺省今天）占位
  target: SkillTarget // chat=轻量 LLM 对话；agent=智能体工作台（多步工具调用）
  scenario?: AgentScenario // target=agent 时的会话场景
  builtin?: boolean
}

const KEY = 'dljy_ai_skills'

export const builtinSkills: Skill[] = [
  {
    id: 'builtin_market_analysis',
    name: '分析行情',
    description: '分析指定日期的现货行情：出清价走势、峰谷价差、新能源出力影响',
    template: '请分析{{date}}的现货行情：出清价走势、峰谷价差、新能源出力对价格的影响，并给出结论与操作建议。{{args}}',
    target: 'agent',
    scenario: 'chat',
    builtin: true
  },
  {
    id: 'builtin_declaration_draft',
    name: '申报草稿',
    description: '生成日前申报草稿（96 点），含策略依据，等待人工审批',
    template: '请基于价格预测、持仓与风险约束，为{{date}}生成日前申报草稿，注明策略依据。{{args}}',
    target: 'agent',
    scenario: 'declaration_prep',
    builtin: true
  },
  {
    id: 'builtin_daily_review',
    name: '复盘报告',
    description: '日度复盘：申报 vs 出清、结算偏差归因、绩效汇总',
    template: '请对{{date}}做日度复盘：申报与出清对比、结算偏差归因、绩效汇总，输出复盘报告。{{args}}',
    target: 'agent',
    scenario: 'daily_review',
    builtin: true
  },
  {
    id: 'builtin_risk_check',
    name: '风控检查',
    description: '检查当前持仓敞口与偏差考核风险，给出预警与对策',
    template: '请检查当前持仓敞口、偏差考核与价格波动风险，给出风险预警与应对建议。{{args}}',
    target: 'agent',
    scenario: 'chat',
    builtin: true
  },
  {
    id: 'builtin_explain',
    name: '概念解释',
    description: '通俗解释电力市场概念，并举本省现货的例子',
    template: '请用通俗中文解释电力市场概念：{{args}}，并举一个省级电力现货市场的实际例子帮助理解。',
    target: 'chat',
    builtin: true
  }
]

export function getUserSkills(): Skill[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return (JSON.parse(raw) as Skill[]).map((s) => ({ ...s, builtin: false }))
  } catch {
    /* ignore broken localStorage */
  }
  return []
}

export function saveUserSkills(skills: Skill[]) {
  localStorage.setItem(
    KEY,
    JSON.stringify(skills.map(({ builtin: _b, ...rest }) => rest))
  )
}

// 后端技能（harness 渐进式披露 Skills）
// 前端只持有 L1 索引（名称+描述），注册为同名斜杠指令；执行时把任务交给
// 智能体工作台，由后端 agent 按需 load_skill / read_skill_file 读取全文。
let backendSkills: Skill[] = []
let backendFetchedAt = 0
// 刷新请求序号：force 重取会并发多次 fetch（连续增删改/启停），只应用最新一次结果，
// 避免较早发出的请求后返回时把 backendSkills 覆盖成过期索引。
let backendFetchSeq = 0
// 后端技能加载版本号：每次成功刷新后自增。斜杠菜单（useSlashInput）以它为响应式
// 依赖，使「fetch 异步完成」能触发已打开的菜单重算，补上首屏尚未到达的后端技能。
export const backendSkillsVersion = ref(0)

export function refreshBackendSkills(force = false): void {
  if (!force && Date.now() - backendFetchedAt < 60_000) return // 节流：菜单每次打开都会触发
  backendFetchedAt = Date.now()
  const seq = ++backendFetchSeq // 本次刷新序号，回调时据此丢弃过期结果
  fetchAgentSkills()
    .then((list) => {
      if (seq !== backendFetchSeq) return // 已有更新的刷新发出，丢弃这份过期结果
      backendSkills = list.map((s) => ({
        id: 'backend_' + s.name,
        name: s.name,
        description: s.description,
        template: `请使用「${s.name}」技能完成任务：{{args}}`,
        target: 'agent' as const,
        scenario: 'chat' as const,
        builtin: true // 不可在前端技能管理里编辑（后端技能经 /api/agent/skills 管理）
      }))
      backendSkillsVersion.value++ // 通知斜杠菜单重算，补上异步到达的后端技能
    })
    .catch(() => {
      if (seq !== backendFetchSeq) return // 过期的失败不应清掉更新后的缓存
      backendSkills = [] // 智能体后端未启动时静默降级，前端内置技能仍可用
    })
}

// 技能工作室增删改 / 启停后调用：跳过 60s 节流立即重取后端技能索引，使斜杠菜单与
// 指令查找即时反映变更（fetch 成功后 backendSkillsVersion 自增触发菜单重算）。
export function invalidateBackendSkills(): void {
  refreshBackendSkills(true)
}

// 合并优先级：用户自定义 > 前端内置 > 后端（按 name 去重）。
// 前端内置排在后端之前：同名技能（申报草稿/复盘报告）前端版带专属场景图
// （审批 interrupt、申报面板），不应被后端索引加载后降级成普通聊天移交。
// 本函数必须保持纯读取，不在普通渲染/命令列表计算时触发 /agent-api。
// 后端刷新由 useSlashInput 在用户输入 "/" 后按需触发，技能工作室变更后由
// invalidateBackendSkills() 强制触发。
export function getAllSkills(): Skill[] {
  const user = getUserSkills()
  const seen = new Set(user.map((s) => s.name))
  const out = [...user]
  for (const s of [...builtinSkills, ...backendSkills]) {
    if (!seen.has(s.name)) {
      out.push(s)
      seen.add(s.name)
    }
  }
  return out
}

export function genSkillId(): string {
  return 'sk' + Date.now().toString(36) + Math.random().toString(16).slice(2, 6)
}

// 从参数串里识别日期：支持 2026-06-12 / 2026/6/12 / 6月12日（年份缺省取今年）
export function extractDate(args: string): string | null {
  const iso = args.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const cn = args.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?/)
  if (cn) {
    const y = cn[1] || String(new Date().getFullYear())
    return `${y}-${cn[2].padStart(2, '0')}-${cn[3].padStart(2, '0')}`
  }
  return null
}

export function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 从参数串拆出日期与剩余文本（renderSkill 与申报场景移交共用）
export function splitDateArgs(args: string): { date: string | null; rest: string } {
  const trimmed = args.trim()
  const date = extractDate(trimmed)
  if (!date) return { date: null, rest: trimmed }
  const rest = trimmed
    .replace(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, '')
    .replace(/(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?/, '')
    .trim()
  return { date, rest }
}

// 渲染技能模板：{{date}} ← 参数中识别到的日期（缺省今天）；{{args}} ← 原始参数串。
// 已被 {{date}} 消费的日期文本不再重复出现在 {{args}} 里。
export function renderSkill(skill: Skill, args: string): string {
  let out = skill.template
  let rest = args.trim()
  if (out.includes('{{date}}')) {
    const split = splitDateArgs(rest)
    if (split.date) rest = split.rest
    out = out.split('{{date}}').join(split.date ?? todayISO())
  }
  out = out.split('{{args}}').join(rest)
  return out.replace(/\s+$/g, '').trim()
}
