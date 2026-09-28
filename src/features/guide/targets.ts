// 导引锚点查找与等待（dljy#3404）。
// 锚点是模板里的 data-guide="ml-…" 属性（与测试用的 data-test 并存、互不复用）；
// 对话框/抽屉类目标只认最上层遮罩里的元素，避免 KeepAlive 缓存的旧对话框抢锚点。
import type { GuideWithin } from './types'

export type GuideVisibilityCheck = (el: Element) => boolean

// happy-dom 无布局，getClientRects 恒空：测试用 setGuideVisibilityCheck 替换。
let visibilityCheck: GuideVisibilityCheck = (el) => {
  if (typeof (el as HTMLElement).getClientRects !== 'function') return false
  return el.getClientRects().length > 0
}

export function setGuideVisibilityCheck(fn: GuideVisibilityCheck): void {
  visibilityCheck = fn
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

function zIndex(el: HTMLElement): number {
  try {
    const parsed = Number.parseInt(getComputedStyle(el).zIndex, 10)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

/** 可见的、z-index 最高的遮罩：Element Plus 的 el-dialog / el-drawer 都挂 .el-overlay。 */
function topmostOverlay(): HTMLElement | null {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.el-overlay')).filter(visibilityCheck)
  let best: HTMLElement | null = null
  let bestZ = -Infinity
  for (const overlay of overlays) {
    const z = zIndex(overlay)
    if (z >= bestZ) {
      best = overlay
      bestZ = z
    }
  }
  return best
}

/** 按 data-guide 找目标元素；找不到 / 不可见 / 不在指定范围内返回 null。 */
export function findGuideTarget(name: string, within?: GuideWithin): HTMLElement | null {
  let candidates: HTMLElement[]
  try {
    candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-guide="${cssEscape(name)}"]`))
  } catch {
    return null
  }
  const visible = candidates.filter(visibilityCheck)
  if (!visible.length) return null
  if (within === 'dialog' || within === 'drawer') {
    const overlay = topmostOverlay()
    if (!overlay) return null
    return visible.find((el) => overlay.contains(el)) ?? null
  }
  // page：优先页面内容区（不在任何遮罩内）的匹配；全都藏在遮罩里时退回第一个可见匹配。
  return visible.find((el) => !el.closest('.el-overlay')) ?? visible[0]
}

export type WaitGuideTargetOptions = {
  within?: GuideWithin
  timeoutMs?: number
  /** 换步时取消等待：AbortController 的 signal。 */
  signal?: AbortSignal
}

/**
 * 等目标元素出现（渲染 + 可见）。MutationObserver 观察 body 的结构/class/style/aria-hidden
 * 变化，rAF 合并检查；超时 reject；signal 中止 reject（AbortError）。
 */
export function waitForGuideTarget(name: string, options?: WaitGuideTargetOptions): Promise<HTMLElement> {
  const within = options?.within
  const immediate = findGuideTarget(name, within)
  if (immediate) return Promise.resolve(immediate)

  return new Promise<HTMLElement>((resolve, reject) => {
    const timeoutMs = options?.timeoutMs ?? 10000
    let observer: MutationObserver | null = null
    let frame = 0
    // node（spec）与浏览器 setTimeout 返回类型不同，用 ReturnType 归一。
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
      fn()
    }

    const check = () => {
      frame = 0
      const el = findGuideTarget(name, within)
      if (el) finish(() => resolve(el))
      else schedule()
    }
    const schedule = () => {
      if (!settled) frame = requestAnimationFrame(check)
    }

    try {
      timer = setTimeout(() => finish(() => reject(new Error(`guide target not found within ${timeoutMs}ms: ${name}`))), timeoutMs)
      observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden'],
      })
      options?.signal?.addEventListener(
        'abort',
        () => finish(() => reject(new DOMException('aborted', 'AbortError'))),
        { once: true },
      )
    } catch {
      // 环境异常（无 body 等）：直接按超时语义失败。
      finish(() => reject(new Error(`guide target environment unavailable: ${name}`)))
    }
    schedule()
  })
}
