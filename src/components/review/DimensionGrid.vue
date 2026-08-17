<script setup lang="ts">
// 六维入口卡（Epic #2033 · M1 · #2038）：注册表六维 → 驾驶舱导航。
// 「偏差复盘/结果复盘」锚到页面既有区块（升级现页不另建，2026-08-13 拍板）；
// 其余维度入口 = 模板抽屉。就绪度徽章来自注册表台账（缺数据要显示缺口数，不许静默）。
import { computed } from 'vue'
import { buildDimensionCards, type DimensionCard, type TemplateCard } from '@/services/review/cockpitModel'

const props = defineProps<{ cards?: DimensionCard[] }>()
const emit = defineEmits<{
  /** 点击维度（带锚点的滚到锚点，无锚点的开模板抽屉） */
  (e: 'select-dimension', card: DimensionCard): void
  /** 点击模板 chip → 打开模板渲染器 */
  (e: 'open-template', template: TemplateCard): void
}>()

const rows = computed(() => props.cards ?? buildDimensionCards())

const READINESS_LABEL: Record<TemplateCard['readiness'], string> = {
  ready: '就绪',
  data_gap: '缺数据',
  deferred: '后置'
}

function onDimension(card: DimensionCard) {
  emit('select-dimension', card)
}
</script>

<template>
  <nav class="dg" aria-label="六维复盘入口">
    <button
      v-for="c in rows"
      :key="c.key"
      type="button"
      class="dg-card"
      :class="{ 'dg-anchored': !!c.anchor }"
      @click="onDimension(c)"
    >
      <span class="dg-head">
        <b>{{ c.label }}</b>
        <i v-if="c.anchor" class="dg-anchor-tag">{{ c.anchor === 'deviation' || c.anchor === 'result' ? '现有区块' : '深入面板' }}</i>
      </span>
      <span class="dg-counts">
        <i class="rd rd-ready">{{ c.counts.ready }} 就绪</i>
        <i v-if="c.counts.dataGap" class="rd rd-gap">{{ c.counts.dataGap }} 缺数据</i>
        <i v-if="c.counts.deferred" class="rd rd-deferred">{{ c.counts.deferred }} 后置</i>
        <i v-if="!c.templates.length" class="rd rd-none">暂无登记模板</i>
      </span>
      <span v-if="c.templates.length" class="dg-templates">
        <button
          v-for="t in c.templates"
          :key="t.id"
          type="button"
          class="dg-chip"
          :class="`dg-chip-${t.readiness}`"
          :title="`${t.id} ${t.name}${t.gapNote ? ` · ${t.gapNote}` : ''}`"
          @click.stop="emit('open-template', t)"
        >
          {{ t.id }} {{ t.name }}{{ t.slots24 ? ' ·24h' : '' }}
          <i>{{ READINESS_LABEL[t.readiness] }}</i>
        </button>
      </span>
    </button>
  </nav>
</template>

<style scoped>
.dg { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.dg-card {
  display: flex; flex-direction: column; gap: 6px; text-align: left;
  padding: 10px 12px; border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 10px; background: #fff; cursor: pointer; min-width: 0;
}
.dg-card:hover { border-color: var(--el-color-primary, #2563eb); }
.dg-anchored { background: #f8fbff; }
.dg-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.dg-head b { font-size: 13px; color: var(--el-text-color-primary, #303133); }
.dg-anchor-tag { font-style: normal; font-size: 10px; color: #0369a1; border: 1px solid #bae6fd; border-radius: 999px; padding: 0 6px; white-space: nowrap; }
.dg-counts { display: flex; flex-wrap: wrap; gap: 4px; }
.rd { font-style: normal; font-size: 10.5px; border-radius: 999px; padding: 0 7px; }
.rd-ready { background: #f0fdf4; color: #15803d; }
.rd-gap { background: #fffbeb; color: #a16207; }
.rd-deferred { background: #f1f5f9; color: #64748b; }
.rd-none { background: #f8fafc; color: #94a3b8; }
.dg-templates { display: flex; flex-direction: column; gap: 3px; }
.dg-chip {
  display: flex; align-items: center; gap: 5px; width: 100%;
  padding: 3px 8px; border: 1px dashed transparent; border-radius: 6px;
  background: transparent; font-size: 11.5px; color: var(--el-text-color-regular, #606266);
  cursor: pointer; text-align: left; min-width: 0;
}
.dg-chip:hover { border-color: var(--el-color-primary, #2563eb); background: #f8fbff; }
.dg-chip i { margin-left: auto; font-style: normal; font-size: 10px; white-space: nowrap; opacity: 0.85; }
.dg-chip-ready i { color: #15803d; }
.dg-chip-data_gap i { color: #a16207; }
.dg-chip-deferred i { color: #64748b; }
.dg-chip-data_gap { color: var(--el-text-color-secondary, #909399); }
</style>
