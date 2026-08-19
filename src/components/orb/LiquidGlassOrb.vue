<script setup lang="ts">
// 液态玻璃球通用渲染组件：WebGPU 可用时用 WGSL 着色器逐帧渲染；
// 环境不支持（无 navigator.gpu）或用户偏好减少动效时，降级为 CSS 静态玻璃球（取预设色）。
// 画布不可见（IntersectionObserver）时自动挂起帧循环，切回零成本恢复。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildOrbUniformSeed, ORB_PRESETS, type OrbPresetId } from './orbPresets'
import { LiquidOrbRenderer, type OrbRenderStatus } from './orbRenderer'

const props = withDefaults(
  defineProps<{
    preset?: OrbPresetId
    /** 速度倍率（悬浮 1.6、生成中加速等状态反馈），1 = 预设原速 */
    speedScale?: number
    /** 外部强制走静态降级 */
    staticFallback?: boolean
  }>(),
  { preset: 'blueDrop', speedScale: 1, staticFallback: false }
)

const hostRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
// pending = 尚未探测完 WebGPU；running/unsupported/failed 见 OrbRenderStatus
const status = ref<'pending' | OrbRenderStatus>('pending')

let renderer: LiquidOrbRenderer | null = null
let observer: IntersectionObserver | null = null

const params = computed(() => ORB_PRESETS[props.preset].params)

// CSS 降级：探测失败 / 不支持 / 减少动效 / 外部强制
const preferReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const useCssFallback = computed(
  () => props.staticFallback || preferReducedMotion || (status.value !== 'pending' && status.value !== 'running')
)

// 降级球沿用预设配色，保证任何环境下观感一致
const fallbackStyle = computed(() => ({
  '--orb-c1': params.value.colorB,
  '--orb-c2': params.value.colorC,
  '--orb-c3': params.value.colorD,
  '--orb-glow': params.value.glowColor
}))

function seedOf(): Float32Array {
  return buildOrbUniformSeed(params.value)
}

watch(
  () => props.preset,
  () => renderer?.updateSeed(seedOf())
)

watch(
  () => props.speedScale,
  (scale) => renderer?.setSpeedScale(scale)
)

// 降级后销毁渲染器（如运行中设备失联），避免持有死画布继续占资源
watch(status, (s) => {
  if (s === 'unsupported' || s === 'failed') {
    renderer?.destroy()
    renderer = null
  }
})

onMounted(async () => {
  if (!hostRef.value) return
  observer = new IntersectionObserver((entries) => {
    renderer?.setVisible(entries.some((entry) => entry.isIntersecting))
  })
  observer.observe(hostRef.value)

  if (props.staticFallback || preferReducedMotion) {
    status.value = 'unsupported'
    return
  }
  if (!canvasRef.value) return
  renderer = new LiquidOrbRenderer(canvasRef.value, {
    seed: seedOf(),
    onStatus: (s) => {
      status.value = s
    }
  })
  await renderer.start()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  renderer?.destroy()
  renderer = null
})
</script>

<template>
  <div ref="hostRef" class="liquid-orb">
    <canvas
      v-show="status === 'pending' || status === 'running'"
      ref="canvasRef"
      class="liquid-orb-canvas"
      aria-hidden="true"
    ></canvas>
    <div
      v-if="useCssFallback"
      class="liquid-orb-css"
      :style="fallbackStyle"
      aria-hidden="true"
    ></div>
  </div>
</template>

<style scoped>
.liquid-orb {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.liquid-orb-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* 静态降级球：三层径向渐变叠出「液态玻璃」高光/反光/主体色 */
.liquid-orb-css {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 38%),
    radial-gradient(circle at 70% 76%, color-mix(in srgb, var(--orb-c3, #1ec8ff) 65%, transparent), transparent 58%),
    radial-gradient(circle at 50% 50%, var(--orb-c2, #0756b8) 0%, var(--orb-c1, #0756b8) 62%, color-mix(in srgb, var(--orb-c1, #020b1d) 70%, #000) 100%);
  box-shadow:
    inset 0 -10px 20px rgba(255, 255, 255, 0.22),
    inset 0 10px 22px rgba(255, 255, 255, 0.3),
    0 12px 34px -10px color-mix(in srgb, var(--orb-glow, #168dff) 55%, transparent);
}
</style>
