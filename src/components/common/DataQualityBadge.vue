<script setup lang="ts">
// DataQualityBadge — 通用 region 数据质量徽条（共享状态 UI 基建，#450）
// ----------------------------------------------------------------------------
// 面板顶部一行小徽条，标当前数据的「真实度 / 新鲜度 / 完整率 / 来源」，供 F4-F8
// 现货面板统一调用。刻意只吃原子信号（basis/freshness/completeness/source...），
// 不耦合任何 bundle 形状，区别于 MarketInsightBundle 里与 InsightAvailabilityItem[]
// 形状强绑定的 DataQualityPanel（耦合反例）。各字段全部可选：传哪个显哪个。
//
// 复用而非重造：
//   - basis → 复用 <TrustBadge>（basis→decisionGrade 落地「可决策/仅决策支持」）
//   - 新鲜度 → 复用 services/data/freshness 的 freshnessOf/ageDaysOf（与 ChartCard 同口径）
//   - 口径色板 → var(--success)/var(--warning)/var(--danger)，主题自动协调
//
// 用法：
//   <DataQualityBadge :basis="meta.basis" :updated-at="meta.updatedAt" cadence="monthly"
//                     :completeness="0.96" source="yn_spot_settlement" />
import { computed } from 'vue'
import TrustBadge from './TrustBadge.vue'
import { freshnessOf, ageDaysOf, type Freshness, type FreshnessCadence } from '@/services/data/freshness'
import type { DataSourceBasis } from '@/services/data/types'

const props = withDefaults(defineProps<{
  /** 数据口径（real/captured/illustrative/synthetic/user_saved）→ 复用 TrustBadge */
  basis?: DataSourceBasis | null
  /** 显式新鲜度（覆盖 updatedAt 推导） */
  freshness?: Freshness | null
  /** 数据时间（采集/写入时刻，未显式传 freshness 时按 cadence 推导） */
  updatedAt?: string | number | null
  /** 新鲜度推导节律（默认 daily） */
  cadence?: FreshnessCadence
  /** 完整率 0..1（缺测占比的互补），传则显一个进度点 + 百分比 */
  completeness?: number | null
  /** 数据来源标签（表名/渠道） */
  source?: string | null
  /** 自由备注（贴在末尾，适合「样本区间/统计口径」等说明） */
  note?: string | null
}>(), {
  cadence: 'daily'
})

// 新鲜度分级：显式 freshness → updatedAt 按 cadence 推导 → 无则 unknown。
const level = computed<Freshness>(() => props.freshness ?? freshnessOf(props.updatedAt, { cadence: props.cadence }))
const ageDays = computed(() => ageDaysOf(props.updatedAt))
const freshText = computed(() => {
  if (props.updatedAt == null) {
    if (level.value === 'unknown') return ''
    return { fresh: '较新', aging: '老化', stale: '已过期' }[level.value] ?? ''
  }
  const d = new Date(props.updatedAt)
  if (Number.isNaN(d.getTime())) return ''
  const days = ageDays.value
  if (level.value === 'stale') return days == null ? '数据已过期' : `已过期 ${days} 天`
  if (level.value === 'aging') return days == null ? '数据老化' : `${days} 天前`
  if (level.value === 'unknown') return '时间未知'
  return '较新'
})

// 完整率百分比（0..1 → 0..100），非法值归一为 null。
const completenessPct = computed(() => {
  const v = props.completeness
  if (v == null || Number.isNaN(v)) return null
  return Math.round(Math.min(1, Math.max(0, v)) * 100)
})
</script>

<template>
  <div class="dq-badge" role="status">
    <!-- 真实度：复用 TrustBadge（可决策/仅决策支持） -->
    <TrustBadge v-if="basis" :basis="basis" />

    <!-- 新鲜度：与 ChartCard 数据时间点同色板 -->
    <span
      v-if="freshText"
      class="dq-badge__chip dq-badge__fresh"
      :class="`dq-badge__fresh--${level}`"
      :title="updatedAt != null ? `数据时间 ${String(updatedAt)}` : '数据时间未知'"
    >
      <i class="dq-badge__dot" />
      {{ freshText }}
    </span>

    <!-- 完整率：小进度条 + 百分比 -->
    <span v-if="completenessPct != null" class="dq-badge__chip dq-badge__comp" :title="`完整率 ${completenessPct}%`">
      <span class="dq-badge__meter">
        <span class="dq-badge__meter-fill" :style="{ width: `${completenessPct}%` }" />
      </span>
      {{ completenessPct }}%
    </span>

    <!-- 来源标签 -->
    <span v-if="source" class="dq-badge__chip dq-badge__source" :title="`来源：${source}`">
      {{ source }}
    </span>

    <!-- 备注 -->
    <span v-if="note" class="dq-badge__note">{{ note }}</span>
  </div>
</template>

<style scoped>
.dq-badge {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.dq-badge__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: 11px;
  line-height: 1.5;
  font-weight: 500;
  border: 1px solid;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dq-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
/* 新鲜度色板：与 ChartCard chart-card__dot 同源（fresh 绿/aging 琥珀/stale 红/unknown 灰）。 */
.dq-badge__fresh--fresh {
  color: var(--success, #16a34a);
  border-color: color-mix(in srgb, var(--success, #16a34a) 42%, transparent);
  background: color-mix(in srgb, var(--success, #16a34a) 10%, transparent);
}
.dq-badge__fresh--fresh .dq-badge__dot { background: var(--success, #16a34a); }
.dq-badge__fresh--aging {
  color: var(--warning, #d97706);
  border-color: color-mix(in srgb, var(--warning, #d97706) 42%, transparent);
  background: color-mix(in srgb, var(--warning, #d97706) 10%, transparent);
}
.dq-badge__fresh--aging .dq-badge__dot { background: var(--warning, #d97706); }
.dq-badge__fresh--stale {
  color: var(--danger, #dc2626);
  border-color: color-mix(in srgb, var(--danger, #dc2626) 42%, transparent);
  background: color-mix(in srgb, var(--danger, #dc2626) 10%, transparent);
}
.dq-badge__fresh--stale .dq-badge__dot { background: var(--danger, #dc2626); }
.dq-badge__fresh--unknown {
  color: var(--muted, #6b7280);
  border-color: color-mix(in srgb, var(--muted, #6b7280) 42%, transparent);
  background: color-mix(in srgb, var(--muted, #6b7280) 8%, transparent);
}
.dq-badge__fresh--unknown .dq-badge__dot { background: var(--muted, #6b7280); }

/* 完整率：中性灰底 + 主题色填充条。 */
.dq-badge__comp {
  color: var(--text-body, #344054);
  border-color: var(--line, #e5e7eb);
  background: var(--panel-sub, #f8fafc);
}
.dq-badge__meter {
  display: inline-block;
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--muted, #94a3b8) 30%, transparent);
  overflow: hidden;
}
.dq-badge__meter-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--primary, #0f766e);
}

/* 来源：浅描边药丸。 */
.dq-badge__source {
  color: var(--muted, #6b7280);
  border-color: var(--line, #e5e7eb);
  background: transparent;
}

.dq-badge__note {
  font-size: 11px;
  color: var(--muted, #909399);
}
</style>
