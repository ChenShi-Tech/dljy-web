// 导引浮层层级（dljy#3404）：每次目标元素换成新元素时，向 Element Plus 的全局 z-index 计数器要一个新值。
// 只在初始化时取一次会被之后才打开的对话框盖住——对话框的 z-index 每次打开都递增，
// 实机走查里「主体编码」那一步卡片和高亮环都落在对话框遮罩下面。
// 同一个元素重复解析（GuideHost 300ms 轮询）不重复取号，避免把全局计数器越推越高。
import { shallowRef, watch } from 'vue'
import type { Ref, ShallowRef } from 'vue'

export function useGuideLayer(target: Ref<HTMLElement | null>, nextZIndex: () => number): Readonly<ShallowRef<number>> {
  const zIndex = shallowRef(nextZIndex())
  watch(
    target,
    (el, previous) => {
      if (el && el !== previous) zIndex.value = nextZIndex()
    },
    { flush: 'sync' },
  )
  return zIndex
}
