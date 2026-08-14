import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

// Animate a number from 0 -> target with easeOutCubic. Demo-only helper.
export function useCountUp(target: number, opts: { duration?: number; decimals?: number; delay?: number } = {}): Ref<string> {
  const { duration = 1400, decimals = 0, delay = 0 } = opts
  const out = ref('0')
  const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  let rafId = 0
  let timeoutId = 0
  onMounted(() => {
    let start = 0
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const run = (ts: number) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      out.value = fmt(target * ease(p))
      if (p < 1) rafId = requestAnimationFrame(run)
      else out.value = fmt(target)
    }
    timeoutId = window.setTimeout(() => { rafId = requestAnimationFrame(run) }, delay)
  })
  // 组件卸载前取消未完成的动画帧/延迟，避免卸载后仍写 ref（泄漏 + Vue 警告）。
  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId)
    if (timeoutId) window.clearTimeout(timeoutId)
  })
  return out
}

// Plain formatter for static numbers. 防御 undefined/NaN/null（图表空系列 tooltip 等）→ 0，避免 toLocaleString 崩溃阻塞 Vue 调度。
export function fmtNum(n: number, decimals = 0) {
  return (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
