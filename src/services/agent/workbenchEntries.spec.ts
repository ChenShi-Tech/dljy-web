// 工作台入口解析单测（#2023 入口合并）。
//
// 锁的是**深链不失效**：合并把六个页面收进 `/ai-agent`，五条旧路径改 redirect 带 `?entry=`，
// 而浮层助手与合并前工作台一直在用 `?scenario=`。这两套参数都要继续认——认错一个，
// 用户的书签/审批卡里的绝对 URL 就会静默落到通用对话上，页面还照常显示（不报错），
// 只是「点开的不是他要的那个入口」，这类退化没人会去提 bug。
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  WORKBENCH_ENTRIES,
  DEFAULT_ENTRY_KEY,
  findEntry,
  initialInputValues,
  resolveEntry
} from './workbenchEntries'

describe('入口注册表自身的不变量', () => {
  it('key 全表唯一：它同时是 historyKey 与 localStorage 会话指针，重了就串台', () => {
    const keys = WORKBENCH_ENTRIES.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('key 只用小写字母/数字/下划线：与 Node 侧 PAGE_KEY_RE 对齐，否则落库被拒', () => {
    for (const e of WORKBENCH_ENTRIES) {
      expect(e.key, `${e.key} 不合法`).toMatch(/^[a-z0-9_]{1,64}$/)
    }
  })

  it('默认入口存在，且每个入口都有标题与说明（场景卡靠它们上屏）', () => {
    expect(findEntry(DEFAULT_ENTRY_KEY)).toBeTruthy()
    for (const e of WORKBENCH_ENTRIES) {
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.desc.length).toBeGreaterThan(0)
    }
  })

  it('声明了输入控件的入口必须有 buildQuestion：否则填了框没有任何地方消费它', () => {
    for (const e of WORKBENCH_ENTRIES) {
      if (e.inputs?.length) expect(e.buildQuestion, `${e.key} 缺 buildQuestion`).toBeTypeOf('function')
    }
  })
})

describe('resolveEntry：?entry= 深链（五条旧路径的 redirect 落点）', () => {
  const cases: Array<[string, string]> = [
    ['morning_brief', 'morning_brief'],
    ['pre_submit_check', 'chat'],
    ['policy_intel', 'chat'],
    ['strategic_qa', 'strategic_qa'],
    ['declaration_checkup', 'declaration_checkup']
  ]
  it.each(cases)('entry=%s → 入口命中且 scenario=%s', (entryKey, scenario) => {
    const r = resolveEntry({ entry: entryKey })
    expect(r.entry.key).toBe(entryKey)
    expect(r.scenario).toBe(scenario)
  })

  it('pre_submit_check / policy_intel 的 scenario 是 chat 而非同名 scenario', () => {
    // 这是合并时才暴露的事实：它们从来不是 scenario，靠 promptKey 区分。
    // 若哪天有人把它们改成同名 scenario，后端会以「未知场景」拒绝建会话。
    expect(resolveEntry({ entry: 'pre_submit_check' }).entry.promptKey).toBe('pre_submit_check')
    expect(resolveEntry({ entry: 'policy_intel' }).entry.promptKey).toBe('policy_intel')
  })
})

describe('resolveEntry：?scenario= 深链（浮层助手与合并前工作台在用，不能失效）', () => {
  it('有独立入口的 scenario 直接落到那个入口', () => {
    expect(resolveEntry({ scenario: 'morning_brief' }).entry.key).toBe('morning_brief')
    expect(resolveEntry({ scenario: 'strategic_qa' }).entry.key).toBe('strategic_qa')
    expect(resolveEntry({ scenario: 'declaration_checkup' }).entry.key).toBe('declaration_checkup')
  })

  it('declaration_prep / daily_review 没有独立入口，落通用对话并保留该 scenario', () => {
    // 合并前 AgentWorkbenchView 就是这么认的，语义不变
    for (const s of ['declaration_prep', 'daily_review'] as const) {
      const r = resolveEntry({ scenario: s })
      expect(r.entry.key).toBe(DEFAULT_ENTRY_KEY)
      expect(r.scenario).toBe(s)
    }
  })

  it('entry 与 scenario 同时给出时，通用对话入口下以更具体的 scenario 为准', () => {
    const r = resolveEntry({ entry: 'workbench', scenario: 'daily_review' })
    expect(r.entry.key).toBe('workbench')
    expect(r.scenario).toBe('daily_review')
  })

  it('专项入口不被 scenario 参数改写：entry 已经指名了它该跑哪个场景', () => {
    const r = resolveEntry({ entry: 'morning_brief', scenario: 'daily_review' })
    expect(r.entry.key).toBe('morning_brief')
    expect(r.scenario).toBe('morning_brief')
  })
})

describe('resolveEntry：脏输入一律回落通用对话，不抛错', () => {
  it.each([
    ['未知 entry', { entry: 'nope' }],
    ['未知 scenario', { scenario: 'nope' }],
    ['空 query', {}],
    ['非字符串', { entry: 42, scenario: null }]
  ])('%s → 通用对话', (_label, query) => {
    const r = resolveEntry(query as { entry?: unknown; scenario?: unknown })
    expect(r.entry.key).toBe(DEFAULT_ENTRY_KEY)
    expect(r.scenario).toBe('chat')
  })
})

describe('initialInputValues', () => {
  it('date 类初值给今天（用户不填也能直接开跑），text 类给空串', () => {
    const brief = findEntry('morning_brief')!
    expect(initialInputValues(brief).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const intel = findEntry('policy_intel')!
    expect(initialInputValues(intel).keyword).toBe('')
  })

  it('无输入控件的入口给空对象', () => {
    expect(initialInputValues(findEntry('strategic_qa')!)).toEqual({})
  })
})

describe('路由 redirect 与注册表对得上（静态源码断言）', () => {
  // 为什么值得单独锁：redirect 里的 entry 值**拼错不会报错**——resolveEntry 认不出就回落
  // 通用对话，页面照常渲染、控制台安静，用户只是「点开的不是他要的那个入口」。
  // 这类退化没人会去提 bug，只能靠这里比对。
  const routerSrc = readFileSync(
    new URL('../../router/index.ts', import.meta.url),
    'utf-8'
  )
  const redirects = [...routerSrc.matchAll(/aiAgentRedirect\('([^']+)',\s*'([^']+)'\)/g)]
    .map((m) => ({ path: m[1], entry: m[2] }))

  it('五条旧路径全部挂上了 redirect', () => {
    expect(redirects.map((r) => r.path).sort()).toEqual([
      'declaration-checkup',
      'strategic-qa',
      'xhjy/morning-brief',
      'xhjy/policy-intel',
      'xhjy/presubmit-check'
    ])
  })

  it('每条 redirect 的 entry 值都能在注册表里解析到同名入口', () => {
    for (const { path, entry } of redirects) {
      expect(findEntry(entry), `${path} → entry=${entry} 在注册表里不存在`).toBeTruthy()
      expect(resolveEntry({ entry }).entry.key).toBe(entry)
    }
  })

  it('被 redirect 的旧路径不再有 page() 定义（否则 redirect 永远命不中）', () => {
    for (const { path } of redirects) {
      expect(routerSrc.includes(`page('${path}'`), `${path} 仍有 page() 定义`).toBe(false)
    }
  })
})
