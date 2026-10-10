<script setup lang="ts">
// TrustBadge — 可信度芯片：把 PR-6 的 basis→decisionGrade 判定落地为产出标题旁的小标签。
// operational（real/captured/user_saved）显绿「可决策」；advisory_only（synthetic/illustrative/占位/未知）显琥珀「仅决策支持」。
// 主题变量驱动（var(--success)/var(--warning)），四档主题（classic/arc/flow/paper）自动协调，不硬编码。
import { computed } from 'vue'
import type { DataSourceBasis } from '@/services/data/types'
import { decisionGradeFromBasis } from '@/services/data/trustGate'

const props = defineProps<{ basis?: DataSourceBasis | null; prefix?: string }>()
const grade = computed(() => decisionGradeFromBasis(props.basis))
const label = computed(() => (grade.value === 'operational' ? '可决策' : '仅决策支持'))
</script>

<template>
  <span class="trust-badge" :class="grade" :title="`basis=${basis ?? 'unknown'} · ${grade === 'operational' ? '可进结算/申报' : '非结算依据'}`">
    <i class="dot" />
    <span v-if="prefix" class="prefix">{{ prefix }}·</span>{{ label }}
  </span>
</template>

<style scoped>
.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: var(--font-xs);
  line-height: 1.5;
  font-weight: 500;
  border: 1px solid;
  white-space: nowrap;
}
.dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.operational {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 42%, transparent);
  background: color-mix(in srgb, var(--success) 10%, transparent);
}
.operational .dot { background: var(--success); }
.advisory_only {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 42%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}
.advisory_only .dot { background: var(--warning); }
</style>
