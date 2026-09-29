// 七步面板异步装配（trading-day-morning-summary-and-lazy-stages 任务 3.1）
// ---------------------------------------------------------------------------
// 不用裸 defineAsyncComponent 的原因：其 errorComponent 只收到 { error }，拿不到
// retry 句柄（Vue runtime-core 仅回传 error），「失败可重试」立不住。这里自己管理
// loading/ok/error 三态：失败只影响当前步面板区域，步进条/深链/键盘动线在容器层
// 不受影响（spec「懒加载失败不阻断动线」）；抽成模块是为了失败→重试路径可独立单测。
import { defineComponent, h, onBeforeUnmount, ref, shallowRef, type Component } from 'vue'

export const StageLoading = defineComponent({
  name: 'StageLoading',
  setup() {
    return () => h('p', { class: 'td-stage-loading' }, '正在加载该步骤面板…')
  }
})

export const StageLoadError = defineComponent({
  name: 'StageLoadError',
  props: { retry: { type: Function, required: true } },
  setup(props) {
    return () =>
      h('div', { class: 'td-stage-error' }, [
        h('p', '该步骤面板加载失败（网络瞬断或版本刚切换）。其余步骤仍可正常切换使用。'),
        h('button', { type: 'button', class: 'ghost', onClick: () => (props.retry as () => void)() }, '重试加载')
      ])
  }
})

export function lazyStage(
  loader: () => Promise<{ default: Component }>,
  loadingDelayMs = 150
): Component {
  let cached: Component | null = null
  return defineComponent({
    name: 'LazyStage',
    inheritAttrs: false,
    setup(_props, { attrs }) {
      const state = ref<'loading' | 'ok' | 'error'>(cached ? 'ok' : 'loading')
      const resolved = shallowRef<Component | null>(cached)
      const loadingVisible = ref(false)
      let delayTimer: ReturnType<typeof setTimeout> | undefined
      let runId = 0

      async function run() {
        const id = ++runId
        if (cached) {
          resolved.value = cached
          state.value = 'ok'
          return
        }
        state.value = 'loading'
        loadingVisible.value = loadingDelayMs <= 0
        clearTimeout(delayTimer)
        if (loadingDelayMs > 0) {
          delayTimer = setTimeout(() => {
            if (id === runId && state.value === 'loading') loadingVisible.value = true
          }, loadingDelayMs)
        }
        try {
          const mod = await loader()
          if (id !== runId) return
          cached = mod.default
          resolved.value = cached
          state.value = 'ok'
        } catch {
          if (id !== runId) return
          state.value = 'error'
        } finally {
          clearTimeout(delayTimer)
        }
      }

      if (!cached) void run()
      onBeforeUnmount(() => clearTimeout(delayTimer))

      return () => {
        if (state.value === 'ok' && resolved.value) return h(resolved.value, attrs)
        if (state.value === 'error') return h(StageLoadError, { retry: () => void run() })
        return loadingVisible.value ? h(StageLoading) : null
      }
    }
  })
}
