// 锁死 session-ready 的「渲染期捕获世代」语义。
//
// 这组用例的价值在于区分两种写法：**取处理器时**捕获世代（正确）vs **事件到达时**读当前值
// （错误，内联箭头的默认行为）。后者在类型和运行时都不会报错，只会让被丢弃实例的会话 id
// 悄悄覆盖当前会话——所以只能靠测试卡住。
import { describe, expect, it } from 'vitest'

import { makeSessionReadyGuard } from '@/components/agent/sessionReadyGuard'

type Mode = 'market' | 'draft'

function setup() {
  const runKey: Record<Mode, number> = { market: 0, draft: 0 }
  const slots: Record<Mode, string | null> = { market: null, draft: null }
  const handlerFor = makeSessionReadyGuard<Mode>({
    currentRunKey: (m) => runKey[m],
    commit: (m, id) => { slots[m] = id },
  })
  return { runKey, slots, handlerFor }
}

describe('makeSessionReadyGuard', () => {
  it('当前世代的事件正常落库', () => {
    const { slots, handlerFor } = setup()
    expect(handlerFor('draft', 0)('sess-1')).toBe(true)
    expect(slots.draft).toBe('sess-1')
  })

  it('旧实例的迟到事件被丢弃——即使它是唯一到达的事件', () => {
    const { runKey, slots, handlerFor } = setup()
    const staleHandler = handlerFor('draft', 0) // 第一次点击时取得
    runKey.draft = 1 // 用户再点一次「协助起草」，旧实例被卸载
    expect(staleHandler('sess-old')).toBe(false)
    expect(slots.draft).toBeNull()
  })

  it('旧实例晚于新实例返回时，不覆盖新实例已登记的会话', () => {
    const { runKey, slots, handlerFor } = setup()
    const stale = handlerFor('draft', 0)
    runKey.draft = 1
    const fresh = handlerFor('draft', 1)
    fresh('sess-new')
    stale('sess-old') // 旧的 createAgentSession 此刻才返回
    expect(slots.draft).toBe('sess-new')
  })

  it('世代号在取处理器时即固定——之后世代如何变化都不影响该处理器的判定依据', () => {
    // 反例即内联箭头：事件到达时才读当前值，旧事件会"借用"新世代蒙混过关
    const { runKey, handlerFor } = setup()
    const h = handlerFor('market', 0)
    runKey.market = 5
    expect(h('x')).toBe(false)
    runKey.market = 0 // 世代绕回（理论上不会，但语义应只认数值相等）
    expect(h('y')).toBe(true)
  })

  it('模式各自独立：起草侧世代前进不影响情报侧的处理器', () => {
    const { runKey, slots, handlerFor } = setup()
    const marketHandler = handlerFor('market', 0)
    runKey.draft = 3
    expect(marketHandler('sess-market')).toBe(true)
    expect(slots.market).toBe('sess-market')
    expect(slots.draft).toBeNull()
  })

  it('处理器不跨模式写入：起草处理器只写起草槽', () => {
    const { slots, handlerFor } = setup()
    handlerFor('draft', 0)('sess-draft')
    expect(slots.market).toBeNull()
    expect(slots.draft).toBe('sess-draft')
  })
})
