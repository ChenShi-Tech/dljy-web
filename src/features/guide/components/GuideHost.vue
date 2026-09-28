<script setup lang="ts">
// 导引全局挂载点（dljy#3404）：AppLayout 常驻。无会话时不渲染任何 DOM；
// 有会话时解析当前步骤的目标元素（300ms 轮询兜底，覆盖对话框关闭重开），
// 渲染高亮环与卡片；层级用 Element Plus 的 zIndex 服务保证盖过业务弹层。
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useZIndex } from 'element-plus'
import { attachGuideRouter, guideSession, guideState, restore } from '../runner'
import { findGuideTarget } from '../targets'
import { useTargetRect } from '../composables/useAnchoredPosition'
import { useGuideLayer } from '../composables/useGuideLayer'
import { getCurrentUser } from '@/services/auth'
import GuideOverlay from './GuideOverlay.vue'
import GuideCard from './GuideCard.vue'

const router = useRouter()
const { nextZIndex } = useZIndex()

onMounted(() => {
  // 适配 vue-router 的 currentRoute（Ref）：runner 只读 path 与 push。
  attachGuideRouter(
    { push: (to) => void router.push(to), currentRoute: { get path() { return router.currentRoute.value.path } } },
    { getUsername: () => getCurrentUser().username },
  )
  void restore()
})

const targetEl = shallowRef<HTMLElement | null>(null)

function resolveTarget(): void {
  const step = guideState.value?.step
  if (!step?.target || !guideSession.value || guideSession.value.status !== 'running') {
    targetEl.value = null
    return
  }
  const next = findGuideTarget(step.target, step.within)
  if (next && next !== targetEl.value) revealTarget(next)
  targetEl.value = next
}

// 目标换成新元素且不在视口内（如长对话框底部的「保存」按钮）就滚到可见处，否则高亮与箭头指向屏幕外。
function revealTarget(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const inView = rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth
  if (inView) return
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
}

watch(
  () => [guideState.value?.step?.id, guideSession.value?.status] as const,
  () => resolveTarget(),
  { flush: 'post' },
)

let pollTimer = 0
onMounted(() => {
  pollTimer = window.setInterval(resolveTarget, 300)
})
onBeforeUnmount(() => window.clearInterval(pollTimer))

const rect = useTargetRect(targetEl)
// 目标换成新元素（如刚打开的对话框里的字段）就重新取层级，盖过之后才打开的对话框。
const zIndex = useGuideLayer(targetEl, nextZIndex)
const ringRect = computed(() => (guideSession.value?.status === 'running' ? rect.value : null))
</script>

<template>
  <div v-if="guideSession" class="guide-host" aria-live="polite">
    <GuideOverlay :rect="ringRect" :z-index="zIndex" />
    <GuideCard :target-el="guideSession.status === 'running' ? targetEl : null" :z-index="zIndex" />
  </div>
</template>

<style scoped>
.guide-host {
  display: contents;
}
</style>
