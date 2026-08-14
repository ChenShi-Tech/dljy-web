<script setup lang="ts">
// 经营总览大屏 KPI 卡片：统一基底 + 主题色强调（左侧色条/弱辉光），四主题对称。
// quiet 克制（frontend-design）：所有卡视觉一致，让数字成为焦点。可选钻取(to) + 环比(deltaPct)。
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCountUp, fmtNum } from '@/composables/useCountUp'

const props = withDefaults(defineProps<{
  label: string
  value: number
  unit?: string
  decimals?: number
  hint?: string
  to?: string
  deltaPct?: number  // 同比/环比 %，正涨负跌；|值|<2 不显示
}>(), { decimals: 0 })

const display = useCountUp(props.value, { decimals: props.decimals, duration: 1200 })
watch(() => props.value, (v) => { display.value = fmtNum(v, props.decimals) })

const router = useRouter()
function drill() { if (props.to) router.push(props.to) }
const showDelta = computed(() => typeof props.deltaPct === 'number' && Number.isFinite(props.deltaPct) && Math.abs(props.deltaPct) >= 2)
</script>

<template>
  <div class="kpi-card" :class="{ clickable: to }" @click="drill">
    <div class="kpi-top">
      <span class="kpi-label">{{ label }}</span>
      <span v-if="showDelta" class="kpi-delta" :class="(deltaPct ?? 0) >= 0 ? 'up' : 'down'">
        {{ (deltaPct ?? 0) >= 0 ? '▲' : '▼' }} {{ Math.abs(deltaPct ?? 0).toFixed(1) }}%
      </span>
    </div>
    <div class="kpi-value">
      <span class="kpi-num">{{ display }}</span>
      <span v-if="unit" class="kpi-unit">{{ unit }}</span>
    </div>
    <div v-if="hint" class="kpi-hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.kpi-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px 14px 20px;
  border-radius: 14px;
  background: linear-gradient(160deg, var(--panel-2, var(--panel, #fff)), var(--panel, #fff));
  border: 1px solid var(--line);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.kpi-card.clickable { cursor: pointer; }
.kpi-card.clickable:hover {
  border-color: var(--primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14), 0 0 0 1px color-mix(in srgb, var(--primary) 50%, transparent);
  transform: translateY(-2px);
}
/* 统一左侧色条：主题色，辉光强度主题感知（深色强、浅色弱，由 .biz-screen --kpi-glow-strength 控制） */
.kpi-card::before {
  content: '';
  position: absolute;
  left: 0; top: 14px; bottom: 14px;
  width: 3px; border-radius: 0 2px 2px 0;
  background: var(--primary);
  box-shadow: 0 0 14px color-mix(in srgb, var(--primary) calc(var(--kpi-glow-strength, 0.45) * 100%), transparent);
}
.kpi-top { display: flex; justify-content: space-between; align-items: center; min-height: 18px; }
.kpi-label { font-size: 12.5px; color: var(--muted); letter-spacing: 0.2px; font-weight: 500; }
.kpi-delta {
  font-size: 11px; padding: 2px 7px; border-radius: 6px;
  font-variant-numeric: tabular-nums; font-weight: 600; line-height: 1.4;
}
.kpi-delta.up { color: var(--success); background: color-mix(in srgb, var(--success) 15%, transparent); }
.kpi-delta.down { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
.kpi-value { display: flex; align-items: baseline; gap: 5px; margin-top: 2px; }
.kpi-num {
  font-size: 28px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text); letter-spacing: -0.5px; line-height: 1.1;
}
.kpi-unit { font-size: 12px; color: var(--muted); font-weight: 500; }
.kpi-hint { font-size: 11px; color: var(--text-soft); margin-top: 1px; }
</style>
