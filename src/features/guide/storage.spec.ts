/** @vitest-environment happy-dom */
// 导引会话持久化（storage）的降级纪律（ChenShi-Tech/dljy#3404）。
// 守什么：会话按「用户名 + 来源公司」分键互不串；损坏 / 版本不符 / 字段形状不对的数据
// 一律丢弃返回 null；localStorage 抛错（隐私模式 / 配额满）绝不把异常抛回页面。
// 坏掉的症状：换公司后导引进度被别的公司覆盖；一条坏数据让恢复循环每刷新一次抛一次；
// 隐私模式下 localStorage 抛错把整个页面炸白。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuideSession } from './types'
import {
  clearActiveGuideOrigin, loadActiveGuideOrigin, loadCompletedGuides, loadGuideSession,
  markGuideCompleted, resetGuideStorageCache, saveActiveGuideOrigin, saveGuideSession,
} from './storage'

function session(overrides: Partial<GuideSession> = {}): GuideSession {
  return {
    v: 1,
    guideId: 'midlong.contract-basics',
    stepId: '0-0',
    runTag: 'GUIDE-01020304',
    artifacts: {},
    originCompanyId: 'c-origin',
    practiceCompanyId: 'c-practice',
    regionId: 'yunnan',
    status: 'running',
    startedAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

afterEach(() => {
  resetGuideStorageCache()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('会话按用户与来源公司分键', () => {
  it('不同用户 / 不同来源公司的会话互不覆盖', () => {
    saveGuideSession('u1', 'c-a', session({ runTag: 'A' }))
    saveGuideSession('u1', 'c-b', session({ runTag: 'B', originCompanyId: 'c-b' }))
    saveGuideSession('u2', 'c-a', session({ runTag: 'C' }))
    expect(loadGuideSession('u1', 'c-a')?.runTag).toBe('A')
    expect(loadGuideSession('u1', 'c-b')?.runTag).toBe('B')
    expect(loadGuideSession('u2', 'c-a')?.runTag).toBe('C')
    expect(localStorage.getItem('dljy.guide.v1|u1|c-a')).toBeTruthy()
  })

  it('active 指针记录当前会话的来源公司，清除后恢复找不到会话', () => {
    saveActiveGuideOrigin('u1', 'c-a')
    expect(loadActiveGuideOrigin('u1')).toBe('c-a')
    clearActiveGuideOrigin('u1')
    expect(loadActiveGuideOrigin('u1')).toBeNull()
  })
})

describe('损坏数据丢弃', () => {
  it('非 JSON / JSON 合法但不是会话形状 / status 非法 / 版本不符都返回 null', () => {
    const key = 'dljy.guide.v1|u1|c-a'
    localStorage.setItem(key, '{oops')
    expect(loadGuideSession('u1', 'c-a')).toBeNull()

    localStorage.setItem(key, JSON.stringify(session({ status: 'nonsense' as GuideSession['status'] })))
    expect(loadGuideSession('u1', 'c-a')).toBeNull()

    localStorage.setItem(key, JSON.stringify(session({ v: 2 as unknown as 1 })))
    expect(loadGuideSession('u1', 'c-a')).toBeNull()

    localStorage.setItem(key, JSON.stringify(session({ startedAt: 'not-a-number' as unknown as number })))
    expect(loadGuideSession('u1', 'c-a')).toBeNull()

    localStorage.setItem(key, JSON.stringify(session()))
    expect(loadGuideSession('u1', 'c-a')?.stepId).toBe('0-0')
  })

  it('完成记录损坏（非数组 / 非 JSON）返回空数组，不抛错', () => {
    localStorage.setItem('dljy.guide.v1|u1|done', '{"x":1}')
    expect(loadCompletedGuides('u1')).toEqual([])
    localStorage.setItem('dljy.guide.v1|u1|done', 'not-json')
    expect(loadCompletedGuides('u1')).toEqual([])
  })

  it('markGuideCompleted 去重追加', () => {
    markGuideCompleted('u1', 'g1')
    markGuideCompleted('u1', 'g2')
    markGuideCompleted('u1', 'g1')
    expect(loadCompletedGuides('u1')).toEqual(['g1', 'g2'])
  })
})

describe('localStorage 抛错时静默降级', () => {
  it('读写抛错：不把异常抛回页面，且内存兜底让本次会话仍可用（只是不跨刷新）', () => {
    // spy 实例（window.localStorage 对象）的方法，而不是 Storage.prototype——
    // happy-dom 的 Storage.prototype 上挂不到实例行为。
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    resetGuideStorageCache()
    // 没写过任何数据：读被拦返回 null，不抛。
    expect(loadGuideSession('u1', 'c-a')).toBeNull()
    expect(loadActiveGuideOrigin('u1')).toBeNull()
    // 写被拦不抛；随后读走内存兜底，拿回刚保存的会话（当次页面内导引不中断）。
    expect(() => saveGuideSession('u1', 'c-a', session())).not.toThrow()
    expect(loadGuideSession('u1', 'c-a')?.stepId).toBe('0-0')
  })
})
