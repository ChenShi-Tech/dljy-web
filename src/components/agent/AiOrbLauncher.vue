<script setup lang="ts">
// 全局 AI 球入口：右下角悬浮液态玻璃球，点按开合统一 AI 面板（useAiPanel 单例）。
// 面板本身是贴右全高 640px 浮层（z-index 1500），打开期间球退场避让；
// 悬浮/聚焦提速流转，作为「可交互」的状态反馈。
import { ref } from 'vue'
import { useAiPanel } from '@/composables/useAiPanel'
import LiquidGlassOrb from '@/components/orb/LiquidGlassOrb.vue'
import type { OrbPresetId } from '@/components/orb/orbPresets'

const { state: aiPanel, openNav, close } = useAiPanel()
const active = ref(false)

// 蓝晶液滴：电光蓝主色与交易看板/弧光主题最贴合；要换观感改这里即可
// （可选：siri/voiceWave/spectrum/aurora/frost/plasma/chrome/opal/violetEmber）
const preset: OrbPresetId = 'blueDrop'

function togglePanel() {
  if (aiPanel.open) {
    close()
  } else {
    openNav()
  }
}
</script>

<template>
  <Transition name="ai-orb">
    <button
      v-show="!aiPanel.open"
      class="ai-orb-launcher"
      type="button"
      aria-label="AI 助手，点我提问"
      @click="togglePanel"
      @mouseenter="active = true"
      @mouseleave="active = false"
      @focus="active = true"
      @blur="active = false"
    >
      <span class="ai-orb-ball">
        <LiquidGlassOrb :preset="preset" :speed-scale="active ? 1.6 : 1" />
      </span>
      <span class="ai-orb-hint" aria-hidden="true">AI 助手</span>
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
  font-size: 11px;
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
