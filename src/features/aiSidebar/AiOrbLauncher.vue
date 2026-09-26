<script setup lang="ts">
// 右下角悬浮液态玻璃球 = 全站的 AI 侧边栏入口（统一 AI 侧边栏 SH-01 / PI-06）。
//
// 它**跟着页面能力走**：当前页声明了解读（defineAiPage 的 interpret，或标记为 interpret 的快捷问题）
// 时，点击直接开始「解读本页」，提示「解读本页：<页面名>」；没有声明的页面只打开侧边栏、
// 不自动发问，提示「打开 AI 助手」——绝不对没有数据切片的页面发「数据已在上下文」式的解读
// （#2210/#2222 两次踩过：模型收到这种措辞却没有数据，只能编造）。
//
// 历史：#38 曾把它改成一律跳 /ai-agent，#40 回退为「只在注册解读的页面出现」，结果大多数页面
// 看不到入口。现在全站常驻，行为按页面分岔。侧边栏打开期间退场避让。
import { ref, computed } from 'vue'
import LiquidGlassOrb from '@/components/orb/LiquidGlassOrb.vue'
import type { OrbPresetId } from '@/components/orb/orbPresets'
import { useAiSidebar } from './useAiSidebar'
import { activeAiPage, canInterpret } from './pageRegistry'

const { state: sidebar, interpret } = useAiSidebar()
const page = activeAiPage()
const active = ref(false)
const interpretable = computed(() => canInterpret(page.value))
const hintTitle = computed(() => (interpretable.value && page.value ? `解读本页：${page.value.label}` : '打开 AI 助手'))
const hintText = computed(() => (interpretable.value ? '解读本页' : 'AI 助手'))

// 蓝晶液滴：电光蓝主色与交易看板/弧光主题最贴合；要换观感改这里即可
// （可选：siri/voiceWave/spectrum/aurora/frost/plasma/chrome/opal/violetEmber）
const preset: OrbPresetId = 'blueDrop'

// interpret() 自带分岔：有解读能力发起解读，没有则只打开侧边栏
function onClick() {
  interpret()
}
</script>

<template>
  <Transition name="ai-orb">
    <button
      v-show="!sidebar.open"
      class="ai-orb-launcher"
      type="button"
      :aria-label="hintTitle"
      :title="hintTitle"
      @click="onClick"
      @mouseenter="active = true"
      @mouseleave="active = false"
      @focus="active = true"
      @blur="active = false"
    >
      <span class="ai-orb-ball">
        <LiquidGlassOrb :preset="preset" :speed-scale="active ? 1.6 : 1" />
      </span>
      <span class="ai-orb-hint" aria-hidden="true">{{ hintText }}</span>
    </button>
  </Transition>
</template>

<style scoped>
.ai-orb-launcher {
  position: fixed;
  right: 26px;
  bottom: 26px;
  z-index: 1400; /* AI 面板 1500 之下、页面内容之上 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.ai-orb-ball {
  display: block;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  transition: transform 0.22s ease;
}

.ai-orb-launcher:hover .ai-orb-ball,
.ai-orb-launcher:focus-visible .ai-orb-ball {
  transform: scale(1.08);
}

.ai-orb-launcher:focus-visible {
  outline: none;
}

.ai-orb-launcher:focus-visible .ai-orb-ball {
  box-shadow:
    0 0 0 2px var(--panel, #fff),
    0 0 0 4px var(--primary, #1677ff);
}

/* 悬浮提示胶囊：默认半隐，交互时浮出 */
.ai-orb-hint {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--panel, rgba(10, 19, 34, 0.85));
  border: 1px solid var(--line, rgba(255, 255, 255, 0.14));
  color: var(--text, #eaf4ff);
  font-size: var(--font-tb-11);
  line-height: 18px;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  pointer-events: none;
}

.ai-orb-launcher:hover .ai-orb-hint,
.ai-orb-launcher:focus-visible .ai-orb-hint {
  opacity: 0.96;
  transform: translateY(0);
}

/* 退场（面板打开避让）/回场过渡 */
.ai-orb-enter-active,
.ai-orb-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.ai-orb-enter-from,
.ai-orb-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.92);
}

@media (max-width: 768px) {
  .ai-orb-launcher {
    right: 18px;
    bottom: 18px;
  }

  .ai-orb-ball {
    width: 54px;
    height: 54px;
  }
}
</style>
