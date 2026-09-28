// 导引目标查找与等待（targets）的层级规则（ChenShi-Tech/dljy#3404）。
// 守什么：dialog/drawer 目标只认最上层遮罩里的元素（KeepAlive 缓存的旧对话框抢不到锚点）；
// page 目标优先页面内容区；不可见元素被过滤；waitForGuideTarget 超时 reject、元素后出现能等到。
// 坏掉的症状：导引高亮框跳到上一次打开已缓存的旧对话框字段上；或对话框还没渲染完就
// 判定 target-missing 让用户「跳到上一步」。
import { afterEach, describe, expect, it } from 'vitest'
import { findGuideTarget, setGuideVisibilityCheck, waitForGuideTarget } from './targets'

function anchor(name: string): HTMLElement {
  const el = document.createElement('div')
  el.dataset.guide = name
  return el
}

function overlay(zIndex: string, ...children: HTMLElement[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'el-overlay'
  el.style.zIndex = zIndex
  for (const child of children) el.appendChild(child)
  document.body.appendChild(el)
  return el
}

const defaultVisibility = (el: Element): boolean =>
  typeof (el as HTMLElement).getClientRects === 'function' && el.getClientRects().length > 0

afterEach(() => {
  document.body.innerHTML = ''
  setGuideVisibilityCheck(defaultVisibility)
})

describe('findGuideTarget', () => {
  it('目标元素不可见（被过滤）时返回 null：可见性检查可注入替换（无布局环境 / 测试用）', () => {
    document.body.appendChild(anchor('ml-x'))
    setGuideVisibilityCheck(() => true)
    expect(findGuideTarget('ml-x')).not.toBeNull()
    setGuideVisibilityCheck(() => false)
    expect(findGuideTarget('ml-x')).toBeNull()
  })

  it('page：注入可见性后命中页面内容区的锚点', () => {
    setGuideVisibilityCheck(() => true)
    document.body.appendChild(anchor('ml-x'))
    expect(findGuideTarget('ml-x', 'page')?.dataset.guide).toBe('ml-x')
  })

  it('page：同名锚点一个在遮罩内一个在页面时，优先页面内容区那个', () => {
    setGuideVisibilityCheck(() => true)
    overlay('2000', anchor('ml-x'))
    const pageEl = anchor('ml-x')
    document.body.appendChild(pageEl)
    expect(findGuideTarget('ml-x', 'page')).toBe(pageEl)
  })

  it('page：匹配全藏在遮罩里时退回第一个可见匹配，而不是返回 null', () => {
    setGuideVisibilityCheck(() => true)
    const inOverlay = anchor('ml-x')
    overlay('2000', inOverlay)
    expect(findGuideTarget('ml-x', 'page')).toBe(inOverlay)
  })

  it('dialog：只在 z-index 最高的遮罩内找（旧对话框是低层遮罩时抢不走）', () => {
    setGuideVisibilityCheck(() => true)
    const stale = anchor('ml-x')
    overlay('1000', stale)
    const fresh = anchor('ml-x')
    overlay('2000', fresh)
    expect(findGuideTarget('ml-x', 'dialog')).toBe(fresh)
  })

  it('dialog：页面上没有遮罩时返回 null，即使锚点存在于页面内容区', () => {
    setGuideVisibilityCheck(() => true)
    document.body.appendChild(anchor('ml-x'))
    expect(findGuideTarget('ml-x', 'dialog')).toBeNull()
  })
})

describe('waitForGuideTarget', () => {
  it('已存在的目标立即 resolve', async () => {
    setGuideVisibilityCheck(() => true)
    const el = anchor('ml-x')
    document.body.appendChild(el)
    await expect(waitForGuideTarget('ml-x', { timeoutMs: 100 })).resolves.toBe(el)
  })

  it('超时未出现按 target-missing 语义 reject', async () => {
    setGuideVisibilityCheck(() => true)
    await expect(waitForGuideTarget('ml-never', { timeoutMs: 20 })).rejects.toThrow(/not found/)
  })

  it('等待途中元素出现（MutationObserver 通道）能等到而不是误判超时', async () => {
    setGuideVisibilityCheck(() => true)
    const pending = waitForGuideTarget('ml-late', { timeoutMs: 2000 })
    setTimeout(() => document.body.appendChild(anchor('ml-late')), 30)
    const el = await pending
    expect(el.dataset.guide).toBe('ml-late')
  })
})
