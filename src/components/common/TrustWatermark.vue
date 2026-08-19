<script setup lang="ts">
// TrustWatermark — 不可移除水印 wrapper：包裹决策产出，advisory_only 时叠加
// ① 96 点节拍底纹（电力现货 15 分钟粒度的时间隐喻，subject 签名）+ ② 底部水印文本。
// operational 时透传不显形。三层克制（芯片在产出标题旁 + 这里底纹/文本），不破坏阅读但不可忽略。
// 主题变量驱动：节拍线 var(--warning)、文本条基于 var(--panel)/var(--warning)，四档主题协调。
import { computed } from 'vue'
import type { DataSourceBasis } from '@/services/data/types'
import { decisionGradeFromBasis, trustWatermark } from '@/services/data/trustGate'

const props = defineProps<{ basis?: DataSourceBasis | null }>()
const advisory = computed(() => decisionGradeFromBasis(props.basis) === 'advisory_only')
const text = computed(() => trustWatermark(props.basis))
</script>

<template>
  <div class="trust-wrap" :class="{ advisory }">
    <div class="trust-content">
      <slot />
    </div>
    <!-- 96 点节拍底纹：96 等分垂直细线，var(--warning) 低透明，pointer-events:none 不挡交互 -->
    <div v-if="advisory" class="trust-beat" aria-hidden="true" />
    <!-- 底部水印文本条（不可移除：绝对定位 + 高 z-index + 不透明背景） -->
    <div v-if="advisory" class="trust-stamp">{{ text }}</div>
  </div>
</template>

<style scoped>
.trust-wrap { position: relative; border-radius: inherit; }
.trust-content { position: relative; z-index: 1; }
.trust-beat {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  border-radius: inherit;
  /* 96 等分垂直节拍线（电力现货 96 点日曲线的时间节拍） */
  background-image: repeating-linear-gradient(
    to right,
    var(--warning) 0,
    var(--warning) 1px,
    transparent 1px,
    transparent calc(100% / 96)
  );
  opacity: 0.09;
  mix-blend-mode: multiply;
}
.trust-stamp {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 3px 10px;
  font-size: var(--font-xs);
  line-height: 1.4;
  font-family: var(--ck-mono, 'SF Mono', 'JetBrains Mono', ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  color: var(--warning);
  background: color-mix(in srgb, var(--panel) 90%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--warning) 32%, transparent);
  border-radius: 0 0 inherit inherit;
  letter-spacing: 0.01em;
  pointer-events: none;
}
</style>
