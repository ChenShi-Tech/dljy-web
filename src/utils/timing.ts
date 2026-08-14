// 通用防抖/节流工具：搜索输入、窗口与容器 resize 等高频事件保护。
// 交互体验优化：高频事件不加保护会导致输入卡顿与多图同时重排的掉帧。

type AnyFn<A extends unknown[]> = (...args: A) => void

export interface Cancellable {
  cancel: () => void
}

/** 防抖：触发后等待 wait 毫秒，期间再次触发则重新计时（搜索输入等）。 */
export function debounce<A extends unknown[]>(fn: AnyFn<A>, wait = 300): AnyFn<A> & Cancellable {
  let timer: number | undefined
  const wrapped = (...args: A) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => window.clearTimeout(timer)
  return wrapped
}

/** 帧节流：一帧内多次触发只执行最后一次（resize / scroll 等）。 */
export function rafThrottle<A extends unknown[]>(fn: AnyFn<A>): AnyFn<A> & Cancellable {
  let handle = 0
  let lastArgs: A | null = null
  const wrapped = (...args: A) => {
    lastArgs = args
    if (handle) return
    handle = window.requestAnimationFrame(() => {
      handle = 0
      if (lastArgs) fn(...lastArgs)
    })
  }
  wrapped.cancel = () => {
    if (handle) window.cancelAnimationFrame(handle)
    handle = 0
  }
  return wrapped
}
