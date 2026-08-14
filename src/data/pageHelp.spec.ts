import { describe, expect, it } from 'vitest'
import { getPageHelp, pageHelpRegistry } from './pageHelp'

// 页面说明注册表（#848）查找语义与结构完整性回归锁：
// 与守卫 verify-page-help.mjs 互补——守卫校验「key 是真实路由 name + docPath 文件存在」，
// 本单测校验「运行时查找行为」与「每条 entry 结构」，防止 getPageHelp 回退/注册表被改空。

describe('pageHelp 注册表结构', () => {
  it('非空，已覆盖相当数量业务路由', () => {
    expect(Object.keys(pageHelpRegistry).length).toBeGreaterThan(50)
  })

  it('每条 entry 有非空 title 与 20-400 字 body', () => {
    for (const [key, entry] of Object.entries(pageHelpRegistry)) {
      expect(entry.title.trim(), `${key} 缺 title`).toBeTruthy()
      const len = [...entry.body].length
      expect(len, `${key} body 长度 ${len} 不在 20-400`).toBeGreaterThanOrEqual(20)
      expect(len, `${key} body 长度 ${len} 不在 20-400`).toBeLessThanOrEqual(400)
    }
  })

  it('key 均为字符串，docPath 为字符串或省略', () => {
    for (const [key, entry] of Object.entries(pageHelpRegistry)) {
      expect(typeof key).toBe('string')
      if (entry.docPath !== undefined) expect(typeof entry.docPath).toBe('string')
    }
  })
})

describe('getPageHelp 查找', () => {
  it('已注册路由返回条目', () => {
    const entry = getPageHelp('Dashboard')
    expect(entry).toBeDefined()
    expect(entry!.title).toBe('交易驾驶舱')
    expect(entry!.body.length).toBeGreaterThan(0)
  })

  it('未注册路由返回 undefined（调用方据此不渲染按钮）', () => {
    expect(getPageHelp('NotARealRoute_xyz')).toBeUndefined()
  })

  it('非字符串 name（路由无 name 时为 Symbol/undefined）保守返回 undefined', () => {
    expect(getPageHelp(undefined)).toBeUndefined()
    expect(getPageHelp(null)).toBeUndefined()
    expect(getPageHelp(123)).toBeUndefined()
    expect(getPageHelp(Symbol('x'))).toBeUndefined()
  })
})
