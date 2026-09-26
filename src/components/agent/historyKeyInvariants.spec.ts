// 对话内核接入点的历史标识不变量（unify-ai-sidebar EN-06；替代文档中从未落地为脚本的
// verify:agent-chat-invariants）。
//
// 守什么：每个 AgentChatPanel 接入点的 history-key 都是静态值、全仓唯一，且没有关闭历史持久化。
// history-key 决定 ①localStorage 会话指针隔离 ②落库的来源标注（历史列表按它显示「来自哪个页面」）。
// 坏掉的症状：两个页面同 key 会互相续上对方的会话、历史来源标签张冠李戴；关闭持久化则刷新即丢对话。
//
// 唯一合法的动态绑定：工作台按入口取 key（取值集合来自 WORKBENCH_ENTRIES 的静态声明，一并纳入唯一性）。
// 其余动态绑定一律判失败（AgentSidekick 已随统一 AI 侧边栏入口收拢删除）。
import { describe, it, expect } from 'vitest'
import { WORKBENCH_ENTRIES } from '@/services/agent/workbenchEntries'

const sources = import.meta.glob<string>('/src/**/*.vue', { query: '?raw', import: 'default', eager: true })

const DYNAMIC_ALLOWED: Record<string, string> = {
  '/src/views/AgentWorkbenchView.vue': 'entry.key'
}

function scan() {
  const statics: Array<{ key: string; file: string }> = []
  const dynamics: Array<{ expr: string; file: string }> = []
  const persistOff: string[] = []
  for (const [file, code] of Object.entries(sources)) {
    if (file.startsWith('/src/attic/')) continue
    for (const m of code.matchAll(/(?<![:\w-])history-key="([^"]+)"/g)) statics.push({ key: m[1], file })
    for (const m of code.matchAll(/(?:v-bind:|:)history-key="([^"]+)"/g)) dynamics.push({ expr: m[1], file })
    if (/(?::|v-bind:)?persist-history="false"/.test(code)) persistOff.push(file)
  }
  return { statics, dynamics, persistOff }
}

describe('AgentChatPanel 接入点 history-key 不变量', () => {
  it('扫描确实找到了接入点（防止 glob 失效时空转通过）', () => {
    const { statics } = scan()
    expect(statics.map((s) => s.key)).toContain('ai_center')
    // 侧边栏 + 流程内嵌步骤页（复盘/申报台/一日作业台/储能测算）至少 8 处
    expect(statics.length).toBeGreaterThanOrEqual(8)
  })

  it('动态绑定只允许登记过的两处', () => {
    const unexpected = scan().dynamics.filter((d) => DYNAMIC_ALLOWED[d.file] !== d.expr)
    expect(unexpected, JSON.stringify(unexpected)).toEqual([])
  })

  it('所有 history-key（含工作台入口 key）全仓唯一', () => {
    const all = [
      ...scan().statics,
      ...WORKBENCH_ENTRIES.map((e) => ({ key: e.key, file: '/src/services/agent/workbenchEntries.ts' }))
    ]
    const byKey = new Map<string, string[]>()
    for (const { key, file } of all) byKey.set(key, [...(byKey.get(key) ?? []), file])
    const duplicated = [...byKey.entries()].filter(([, files]) => files.length > 1)
    expect(duplicated, `重复的 history-key：${JSON.stringify(duplicated)}`).toEqual([])
  })

  it('没有接入点关闭历史持久化', () => {
    expect(scan().persistOff).toEqual([])
  })
})
