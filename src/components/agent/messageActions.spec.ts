// 消息级操作纯函数单测（统一 AI 侧边栏 SH-05）。
// 坏掉的症状：复制只拿到最后一段或混进工具参数 JSON；重新提问发出的不是这条回复对应的问题。
import { describe, it, expect } from 'vitest'
import { assistantPlainText, previousUserText } from './messageActions'

describe('assistantPlainText', () => {
  it('按顺序拼接全部文本段，跳过工具卡等非文本段与空段', () => {
    const msg = {
      role: 'assistant' as const,
      segs: [
        { kind: 'text', chunks: ['今日', '日前均价 149'] },
        { kind: 'tool', chunks: ['{"args":1}'] },
        { kind: 'text', chunks: ['  '] },
        { kind: 'text', chunks: ['峰谷价差较大'] }
      ]
    }
    expect(assistantPlainText(msg)).toBe('今日日前均价 149\n\n峰谷价差较大')
  })
  it('没有文本段时为空串', () => {
    expect(assistantPlainText({ role: 'assistant', segs: [{ kind: 'approval' }] })).toBe('')
  })
})

describe('previousUserText', () => {
  const messages = [
    { role: 'user' as const, text: '问题一', segs: [] },
    { role: 'assistant' as const, segs: [{ kind: 'text', chunks: ['答一'] }] },
    { role: 'user' as const, text: '问题二', segs: [] },
    { role: 'assistant' as const, segs: [{ kind: 'text', chunks: ['答二'] }] }
  ]
  it('取该回复之前最近的一条用户问题', () => {
    expect(previousUserText(messages, 1)).toBe('问题一')
    expect(previousUserText(messages, 3)).toBe('问题二')
  })
  it('之前没有用户消息时返回 null', () => {
    expect(previousUserText([{ role: 'assistant', segs: [] }], 0)).toBeNull()
  })
})
