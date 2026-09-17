// 侧边栏专家命令（统一 AI 侧边栏 EC-01/02/06，design D8）。
//
// 以工作台入口声明（WORKBENCH_ENTRIES）为唯一来源：命令与工作台同名入口共用场景、解读角色与首条问题
// 拼装（buildQuestion），保证侧边栏与工作台逐字一致、不会各改各的。
// - 排除「通用对话」（侧边栏本身就是）与「政策情报官」（披露与规则类工具冻结，暂不提供新入口）
// - 只对有工作台访问权限的角色可用：无权限时命令标记 hidden（不进补全与 /help），手动输入提示无权
import { WORKBENCH_ENTRIES, type WorkbenchEntry } from '@/services/agent/workbenchEntries'
import type { SlashCommand } from '@/services/slashCommands'

/** 入口 key → 侧边栏命令名（不含斜杠）。不在表内的入口不提供命令。 */
export const EXPERT_COMMAND_NAMES: Readonly<Record<string, string>> = {
  morning_brief: '晨报',
  pre_submit_check: '申报前体检',
  strategic_qa: '战略问答',
  declaration_checkup: '申报体检'
}

export interface ExpertLaunch {
  entry: WorkbenchEntry
  /** 首条问题；为空表示只开会话、等用户输入 */
  question: string
  /** 解析出的入口输入值（如目标日） */
  values: Record<string, string>
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/** 形如 YYYY-MM-DD 且是日历上真实存在的日期（排除 2026-99-99、2026-02-30 这类）。 */
function isRealIsoDate(t: string): boolean {
  if (!ISO_DATE_SHAPE.test(t)) return false
  const [y, m, d] = t.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/**
 * 参数里形似日期却不存在的那个词（入口没有日期输入项时不检查）。命令据此直接拒绝：
 * 不能当作目标日发出去（预检取数失败也会照常启动），也不能悄悄换成今天。
 */
export function findInvalidDate(entry: WorkbenchEntry, args: string): string | null {
  if (!(entry.inputs ?? []).some((i) => i.kind === 'date')) return null
  return args.trim().split(/\s+/).find((t) => ISO_DATE_SHAPE.test(t) && !isRealIsoDate(t)) ?? null
}

/**
 * 把命令参数解析成入口输入值：日期类输入取第一个 `YYYY-MM-DD` / 今天 / 明天，缺省为当天；
 * 其余文字归第一个文本类输入（如「拟申报概述」）。入口没有输入项时整句作为问题。
 */
export function parseExpertArgs(entry: WorkbenchEntry, args: string, now: Date = new Date()): Record<string, string> {
  const values: Record<string, string> = {}
  const inputs = entry.inputs ?? []
  const dateInput = inputs.find((i) => i.kind === 'date')
  const textInput = inputs.find((i) => i.kind === 'text')
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  let dateValue: string | null = null
  const rest: string[] = []
  for (const t of tokens) {
    if (!dateValue && dateInput) {
      if (isRealIsoDate(t)) { dateValue = t; continue }
      if (t === '今天') { dateValue = isoDate(now); continue }
      if (t === '明天') { dateValue = isoDate(new Date(now.getTime() + 86_400_000)); continue }
    }
    rest.push(t)
  }
  if (dateInput) values[dateInput.key] = dateValue ?? isoDate(now)
  if (textInput) values[textInput.key] = rest.join(' ')
  return values
}

export function buildExpertLaunch(entry: WorkbenchEntry, args: string, regionName: string, now: Date = new Date()): ExpertLaunch {
  const values = parseExpertArgs(entry, args, now)
  const question = entry.buildQuestion
    ? entry.buildQuestion({ values, regionName })
    : args.trim()
  return { entry, question, values }
}

export function createExpertCommands(opts: {
  canUse: boolean
  regionName: () => string
  launch: (launch: ExpertLaunch) => void
}): SlashCommand[] {
  return WORKBENCH_ENTRIES.filter((e) => EXPERT_COMMAND_NAMES[e.key]).map((entry) => {
    const inputs = entry.inputs ?? []
    const hint = inputs.length
      ? inputs.map((i) => `[${i.label}]`).join(' ')
      : '[问题]'
    return {
      name: EXPERT_COMMAND_NAMES[entry.key],
      description: `${entry.title}：${entry.desc}`,
      argHint: hint,
      source: 'builtin' as const,
      hosts: ['sidebar' as const],
      hidden: !opts.canUse,
      run: (ctx) => {
        if (!opts.canUse) {
          ctx.postSystemNote('当前角色无权使用该命令（专家命令需要智能体工作台访问权限）。')
          return
        }
        const invalid = findInvalidDate(entry, ctx.args)
        if (invalid) {
          ctx.postSystemNote(`日期「${invalid}」不存在，请按 YYYY-MM-DD 输入真实日期，例如 /${EXPERT_COMMAND_NAMES[entry.key]} ${isoDate(new Date())}。`)
          return
        }
        opts.launch(buildExpertLaunch(entry, ctx.args, opts.regionName()))
      }
    }
  })
}
