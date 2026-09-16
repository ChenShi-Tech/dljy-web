// 侧边栏会话去留规则单测：逐行对应 design D5 表格（统一 AI 侧边栏 SS-02/03、EC-01）。
// 坏掉的症状：跨页解读沿用上一页的解读角色（pi 只在建会话时锁定角色）；生成中再点快捷问题被
// 送进忙碌会话被拒；专家命令混进普通对话。
import { describe, it, expect } from 'vitest'
import { decideSession, type AiSessionRecord } from './sessionPolicy'
import { entryForSession } from '@/services/agent/workbenchEntries'

const fshq: AiSessionRecord = {
  sessionId: 's_1', scenario: 'chat', promptKey: 'market_data_analysis', sourceRoute: '/sjfx/fshq', entryKey: 'workbench', title: '分时行情'
}
const page = (route: string, promptKey = 'market_data_analysis') => ({ kind: 'page' as const, route, promptKey, scenario: 'chat' })

describe('decideSession', () => {
  it('页面发起：同页面 + 同角色 + chat + 不在生成中 → 续聊', () => {
    expect(decideSession(fshq, false, page('/sjfx/fshq'))).toBe('continue')
  })
  it('页面发起：跨页面 → 新开', () => {
    expect(decideSession(fshq, false, page('/sjfx/zrsjg'))).toBe('new')
  })
  it('页面发起：同页面但角色不同 → 新开', () => {
    expect(decideSession(fshq, false, page('/sjfx/fshq', 'market_operations'))).toBe('new')
  })
  it('页面发起：当前会话正在生成 → 新开（原会话继续跑）', () => {
    expect(decideSession(fshq, true, page('/sjfx/fshq'))).toBe('new')
  })
  it('页面发起：当前是专家场景会话或来自历史（无来源页）→ 新开', () => {
    expect(decideSession({ ...fshq, scenario: 'morning_brief' }, false, page('/sjfx/fshq'))).toBe('new')
    expect(decideSession({ ...fshq, sourceRoute: '' }, false, page(''))).toBe('new')
  })
  it('页面发起：没有当前会话 → 新开', () => {
    expect(decideSession(null, false, page('/sjfx/fshq'))).toBe('new')
  })
  it('自由输入：有当前会话（即使生成中、即使是别的页面开的）→ 续聊；没有 → 新开', () => {
    expect(decideSession(fshq, false, { kind: 'free', route: '/dashboard', promptKey: 'workbench', scenario: 'chat' })).toBe('continue')
    expect(decideSession(null, false, { kind: 'free', route: '/dashboard', promptKey: 'workbench', scenario: 'chat' })).toBe('new')
  })
  it('专家命令：任何情况都新开', () => {
    expect(decideSession(fshq, false, { kind: 'expert', route: '/sjfx/fshq', promptKey: 'morning_brief', scenario: 'morning_brief' })).toBe('new')
  })
})

describe('entryForSession', () => {
  it('专项场景直接命中入口', () => {
    expect(entryForSession('morning_brief').key).toBe('morning_brief')
    expect(entryForSession('strategic_qa').key).toBe('strategic_qa')
    expect(entryForSession('declaration_checkup').key).toBe('declaration_checkup')
  })
  it('chat 场景按页面提示词 key 区分', () => {
    expect(entryForSession('chat', 'pre_submit_check').key).toBe('pre_submit_check')
    expect(entryForSession('chat', 'policy_intel').key).toBe('policy_intel')
    expect(entryForSession('chat', 'workbench').key).toBe('workbench')
  })
  it('页面解读角色、未知 key、缺 key 都落通用对话', () => {
    expect(entryForSession('chat', 'market_data_analysis').key).toBe('workbench')
    expect(entryForSession('chat', '').key).toBe('workbench')
    expect(entryForSession('daily_review').key).toBe('workbench')
  })
})
