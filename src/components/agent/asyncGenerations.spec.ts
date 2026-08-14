// 锁死「流式运行 ↔ 历史加载」两条异步通道的**交叉作废**规则。
//
// 这些用例对应的都是真实发生过的漏网（PR #1426 codex 七轮审查）：守卫写了，但只作废自己
// 那条通道。症状全部是静默的 UI 错乱——不报错，只是用户看到别的会话的内容、或看到仍在
// 后台跑的任务显示"已完成"，所以必须靠测试而不是靠人眼守住。
import { describe, expect, it } from 'vitest'

import { createAsyncGenerations } from '@/components/agent/asyncGenerations'

describe('createAsyncGenerations · 各自通道的基本世代守卫', () => {
  it('新流作废旧流：旧流世代的回调/收尾一律 stale', () => {
    const g = createAsyncGenerations()
    const first = g.beginStream()
    expect(g.isStreamStale(first)).toBe(false)
    const second = g.beginStream()
    expect(g.isStreamStale(first)).toBe(true)
    expect(g.isStreamStale(second)).toBe(false)
  })

  it('侧栏连点两个会话：先点的那次晚归也不得写回', () => {
    const g = createAsyncGenerations()
    const a = g.beginHistoryLoad()
    const b = g.beginHistoryLoad()
    expect(g.isHistoryStale(a)).toBe(true)
    expect(g.isHistoryStale(b)).toBe(false)
  })
})

describe('createAsyncGenerations · 交叉作废（历轮漏网的正主）', () => {
  it('历史加载在途时发送新消息 → 历史响应必须失效', () => {
    // 否则：历史响应写回时会 abort 刚启动的 SSE，并用旧 transcript 覆盖用户刚发的消息
    const g = createAsyncGenerations()
    const load = g.beginHistoryLoad()
    g.beginStream() // 用户点了发送
    expect(g.isHistoryStale(load)).toBe(true)
  })

  it('新建对话 → 在途历史加载必须失效', () => {
    // 否则：点历史会话后、transcript 返回前点「新建对话」，旧 transcript 把空会话覆盖回旧会话
    const g = createAsyncGenerations()
    const load = g.beginHistoryLoad()
    g.invalidateHistoryLoad()
    expect(g.isHistoryStale(load)).toBe(true)
  })

  it('切走当前会话 → 在途流必须失效', () => {
    // 否则：断开 SSE 不停后端 run，旧 send() 的 finally 仍会跑 finalize，把仍在运行的核查显示为已完成
    const g = createAsyncGenerations()
    const run = g.beginStream()
    g.invalidateStream()
    expect(g.isStreamStale(run)).toBe(true)
  })
})

describe('createAsyncGenerations · 开流前先预留世代（探活期间可被切换作废）', () => {
  // attachActiveRunIfAny 要先探活（网络往返）再决定附着。世代若等探活返回才取，会反过来
  // 作废用户在探活期间发起的会话切换——本类修复引入交叉作废后新增的竞态。
  it('预留世代 → 期间发生会话切换 → 预留的世代失效，探活回来应放手', () => {
    const g = createAsyncGenerations()
    const reserved = g.beginStream()     // 探活前预留
    g.invalidateStream()                 // 期间用户点了别的会话（loadHistory 会做这件事）
    g.beginHistoryLoad()
    expect(g.isStreamStale(reserved)).toBe(true)
  })

  it('预留世代 → 期间无切换 → 世代仍有效，可正常附着', () => {
    const g = createAsyncGenerations()
    const reserved = g.beginStream()
    expect(g.isStreamStale(reserved)).toBe(false)
  })

  it('预留在前时，期间开始的历史加载不被探活回程误伤', () => {
    const g = createAsyncGenerations()
    g.beginStream()                      // 预留（此刻作废历史，但当时无在途）
    const load = g.beginHistoryLoad()    // 用户随后点了历史会话
    expect(g.isHistoryStale(load)).toBe(false)
  })
})

describe('createAsyncGenerations · 不得过度作废（同样会坏功能）', () => {
  it('beginHistoryLoad 不动流世代——loadHistory 内部另行 invalidateStream，那里还要 abort reader 与复位 UI', () => {
    const g = createAsyncGenerations()
    const run = g.beginStream()
    g.beginHistoryLoad()
    expect(g.isStreamStale(run)).toBe(false)
  })

  it('invalidateStream 不动历史世代——否则 loadHistory 调它时会作废自己刚取的世代，历史永远加载不出来', () => {
    const g = createAsyncGenerations()
    const load = g.beginHistoryLoad()
    g.invalidateStream()
    expect(g.isHistoryStale(load)).toBe(false)
  })

  it('invalidateHistoryLoad 不动流世代——新建对话已单独作废流，重复递增会让刚复位的 UI 再次错位', () => {
    const g = createAsyncGenerations()
    const run = g.beginStream()
    g.invalidateHistoryLoad()
    expect(g.isStreamStale(run)).toBe(false)
  })

  it('两个实例互不干扰（同页多个面板各自记世代）', () => {
    const a = createAsyncGenerations()
    const b = createAsyncGenerations()
    const runA = a.beginStream()
    b.beginStream()
    b.beginStream()
    expect(a.isStreamStale(runA)).toBe(false)
  })
})

describe('createAsyncGenerations · 初始世代不可被误判为有效', () => {
  it('未开始任何运行时，0 号世代即当前值——守卫只在拿到 begin* 返回值后使用', () => {
    // 说明性用例：调用方必须持有 begin* 的返回值，不得自造 0 当作"当前世代"
    const g = createAsyncGenerations()
    expect(g.isStreamStale(0)).toBe(false)
    g.beginStream()
    expect(g.isStreamStale(0)).toBe(true)
  })
})
