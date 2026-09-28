// 导引浮层定位（dljy#3404）：@floating-ui/dom 的 computePosition + offset/flip/shift/arrow，
// autoUpdate 开 animationFrame 持续跟随目标（对话框动画、页面滚动都会带动卡片）。
// 高亮环的矩形由 useTargetRect 每帧读取目标 getBoundingClientRect 得到。
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Middleware, Placement } from '@floating-ui/dom'

export type AnchoredOptions = {
  /** 期望方向；flip 中间件在放不下时自动换边。 */
  placement: 'top' | 'bottom' | 'left' | 'right'
  /** 卡片离目标（以及高亮环让位）的间距。 */
  offsetPx?: number
}

/**
 * 把 floating 元素锚到 target 旁：坐标写入返回的 refs（fixed 定位 + transform 使用）。
 * 箭头元素需带 data-guide-arrow 属性，位置由本函数逐帧写入。
 */
export function useAnchoredPosition(
  target: Ref<HTMLElement | null>,
  floating: Ref<HTMLElement | null>,
  options: Ref<AnchoredOptions>,
): {
  x: Ref<number>
  y: Ref<number>
  /** 实际落在哪一侧（flip 后可能与期望不同），箭头按它定方向。 */
  side: Ref<'top' | 'bottom' | 'left' | 'right'>
} {
  const x = shallowRef(0)
  const y = shallowRef(0)
  const side = shallowRef<'top' | 'bottom' | 'left' | 'right'>(options.value.placement)
  let dispose: (() => void) | null = null

  function start(): void {
    dispose?.()
    dispose = null
    const targetEl = target.value
    const floatEl = floating.value
    if (!targetEl || !floatEl) return
    const arrowEl = floatEl.querySelector<HTMLElement>('[data-guide-arrow]')
    dispose = autoUpdate(
      targetEl,
      floatEl,
      async () => {
        const liveTarget = target.value
        const liveFloat = floating.value
        if (!liveTarget || !liveFloat) return
        const middlewares: Middleware[] = [offset(options.value.offsetPx ?? 14), flip(), shift({ padding: 12 })]
        if (arrowEl) middlewares.push(arrow({ element: arrowEl }))
        const state = await computePosition(liveTarget, liveFloat, {
          placement: options.value.placement as Placement,
          strategy: 'fixed',
          middleware: middlewares,
        })
        x.value = state.x
        y.value = state.y
        side.value = state.placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'
        if (arrowEl) {
          const data = state.middlewareData.arrow as { x?: number; y?: number } | undefined
          arrowEl.style.left = data?.x != null ? `${data.x}px` : ''
          arrowEl.style.top = data?.y != null ? `${data.y}px` : ''
        }
      },
      { animationFrame: true },
    )
  }

  watch([target, floating, () => options.value.placement], start, { flush: 'post' })
  onBeforeUnmount(() => dispose?.())
  return { x, y, side }
}

/** 每帧读目标的屏幕矩形（高亮环用它画框）；目标消失时值为 null。 */
export function useTargetRect(target: Ref<HTMLElement | null>): Readonly<ShallowRef<DOMRectReadOnly | null>> {
  const rect = shallowRef<DOMRectReadOnly | null>(null)
  let raf = 0

  const tick = (): void => {
    const el = target.value
    const next = el ? el.getBoundingClientRect() : null
    const cur = rect.value
    const changed =
      !next !== !cur ||
      (!!next && !!cur && (next.top !== cur.top || next.left !== cur.left || next.width !== cur.width || next.height !== cur.height))
    if (changed) rect.value = next
    raf = requestAnimationFrame(tick)
  }

  watch(
    target,
    (el) => {
      rect.value = el ? el.getBoundingClientRect() : null
      if (el && !raf) raf = requestAnimationFrame(tick)
      if (!el && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf)
  })
  return rect
}
