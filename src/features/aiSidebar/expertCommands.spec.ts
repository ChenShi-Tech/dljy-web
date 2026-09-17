// @vitest-environment happy-dom
//
// 侧边栏专家命令不变量（统一 AI 侧边栏 EC-01/02/06）。
// 坏掉的症状：侧边栏首问与工作台漂移（两处各拼一套）；无权限角色在补全里看到专家命令；
// 政策情报从侧边栏溜回来；/agent 移交命令在侧边栏把用户带离当前页。
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/services/aiNavigator', () => ({ buildCatalog: () => [] }))
vi.mock('@/services/auth', () => ({ getCurrentUser: () => ({ roleCode: 'TRADER', username: 'trader' }) }))
vi.mock('@/services/llm', () => ({ getCachedTiers: () => [], isLlmConfigured: () => true, refreshLlmStatus: async () => true }))
import { WORKBENCH_ENTRIES, findEntry } from '@/services/agent/workbenchEntries'
import { executeSlashInput, getCommands, type CommandContext } from '@/services/slashCommands'
import { buildExpertLaunch, createExpertCommands, parseExpertArgs } from './expertCommands'

const NOW = new Date(2026, 8, 16, 10, 0, 0)
const entry = (key: string) => findEntry(key)!

function ctxFor(extra: ReturnType<typeof createExpertCommands>, notes: string[]): (args: string) => CommandContext {
  return (args) => ({
    host: 'sidebar', args, extraCommands: extra,
    navigate: () => {}, postSystemNote: (t) => notes.push(t), setInput: () => {}, sendToChat: () => {}, openWorkbench: () => {}, clearSession: () => {}
  })
}

describe('parseExpertArgs / buildExpertLaunch', () => {
  it('/晨报 2026-09-17：首条消息为该目标日；缺省为当天；「明天」换算为次日', () => {
    expect(buildExpertLaunch(entry('morning_brief'), '2026-09-17', '云南省', NOW).question).toBe('2026-09-17')
    expect(buildExpertLaunch(entry('morning_brief'), '', '云南省', NOW).question).toBe('2026-09-16')
    expect(buildExpertLaunch(entry('morning_brief'), '明天', '云南省', NOW).question).toBe('2026-09-17')
  })

  it('/申报前体检：首问与工作台 buildQuestion 在同样输入下逐字相同（日期 + 拟申报概述）', () => {
    const e = entry('pre_submit_check')
    const launched = buildExpertLaunch(e, '2026-09-18 高峰多报 20MW', '云南省', NOW)
    expect(launched.values).toEqual({ date: '2026-09-18', intent: '高峰多报 20MW' })
    expect(launched.question).toBe(e.buildQuestion!({ values: { date: '2026-09-18', intent: '高峰多报 20MW' }, regionName: '云南省' }))
    // 缺省：当天 + 空概述，与工作台点「开始体检」一致
    expect(buildExpertLaunch(e, '', '云南省', NOW).question)
      .toBe(e.buildQuestion!({ values: { date: '2026-09-16', intent: '' }, regionName: '云南省' }))
  })

  it('战略问答/申报体检没有预制首问：带问题时整句发送，不带时为空（只开会话等输入）', () => {
    expect(buildExpertLaunch(entry('strategic_qa'), '云南明年要不要加储能', '云南省', NOW).question).toBe('云南明年要不要加储能')
    expect(buildExpertLaunch(entry('declaration_checkup'), '', '云南省', NOW).question).toBe('')
  })

  it('形似日期却不存在的词不当作目标日（dljy-web#121 审查 P2）', () => {
    expect(parseExpertArgs(entry('morning_brief'), '2026-99-99', NOW)).toEqual({ date: '2026-09-16' })
    expect(parseExpertArgs(entry('pre_submit_check'), '2026-02-30 高峰多报', NOW)).toEqual({ date: '2026-09-16', intent: '2026-02-30 高峰多报' })
    expect(parseExpertArgs(entry('morning_brief'), '2028-02-29', NOW)).toEqual({ date: '2028-02-29' }) // 闰年照常
  })

  it('没有日期输入项的入口不吞掉像日期的文字', () => {
    expect(parseExpertArgs(entry('strategic_qa'), '2026-09-18 的风险', NOW)).toEqual({})
  })
})

describe('createExpertCommands', () => {
  it('只为晨报/申报前体检/战略问答/申报体检生成命令，不含通用对话与政策情报', () => {
    const names = createExpertCommands({ canUse: true, regionName: () => '云南省', launch: () => {} }).map((c) => c.name)
    expect(names.sort()).toEqual(['战略问答', '晨报', '申报体检', '申报前体检'].sort())
    expect(WORKBENCH_ENTRIES.some((e) => e.key === 'policy_intel')).toBe(true) // 工作台仍保留政策情报官
  })

  it('有权限：执行命令发起对应入口的会话', () => {
    const launch = vi.fn()
    const extra = createExpertCommands({ canUse: true, regionName: () => '云南省', launch })
    expect(executeSlashInput('/晨报 2026-09-17', ctxFor(extra, []))).toBe(true)
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ question: '2026-09-17', entry: expect.objectContaining({ key: 'morning_brief' }) }))
  })

  it('日期不存在：提示并拒绝，不发起会话（dljy-web#121 审查 P2）', () => {
    const launch = vi.fn()
    const notes: string[] = []
    const extra = createExpertCommands({ canUse: true, regionName: () => '云南省', launch })
    expect(executeSlashInput('/晨报 2026-99-99', ctxFor(extra, notes))).toBe(true)
    expect(executeSlashInput('/申报前体检 2026-02-30 高峰多报', ctxFor(extra, notes))).toBe(true)
    expect(launch).not.toHaveBeenCalled()
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('2026-99-99')
    // 没有日期输入项的入口不检查
    expect(executeSlashInput('/战略问答 2026-99-99 的风险', ctxFor(extra, notes))).toBe(true)
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('无权限：补全与 /help 看不到专家命令，手动输入提示无权且不发起会话', () => {
    const launch = vi.fn()
    const notes: string[] = []
    const extra = createExpertCommands({ canUse: false, regionName: () => '云南省', launch })
    const visible = getCommands('sidebar', extra).filter((c) => !c.hidden).map((c) => c.name)
    expect(visible).not.toContain('晨报')
    executeSlashInput('/help', ctxFor(extra, notes))
    expect(notes.join('\n')).not.toContain('/晨报')
    executeSlashInput('/晨报', ctxFor(extra, notes))
    expect(notes.at(-1)).toContain('当前角色无权使用该命令')
    expect(launch).not.toHaveBeenCalled()
  })

  it('侧边栏宿主下 /政策情报 与 /agent 都是未知命令；/help 列出专家命令', () => {
    const notes: string[] = []
    const extra = createExpertCommands({ canUse: true, regionName: () => '云南省', launch: () => {} })
    executeSlashInput('/政策情报 新能源', ctxFor(extra, notes))
    expect(notes.at(-1)).toContain('未知指令 /政策情报')
    executeSlashInput('/agent 帮我深度分析', ctxFor(extra, notes))
    expect(notes.at(-1)).toContain('未知指令 /agent')
    executeSlashInput('/help', ctxFor(extra, notes))
    expect(notes.at(-1)).toContain('/晨报')
    expect(notes.at(-1)).not.toContain('/政策情报')
  })
})
