<script setup lang="ts">
// 策略维（Epic #2033 · #2038 外壳）：胜率概览（tradingMemory Beta-Binomial 后验真数据）+ 本维模板清单。
// T04 方案硬规则：样本 <30 不出胜率结论，只标「样本不足」——数字仍显示但明确标注为后验分布参考。
import { computed } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionWinStats } from '@/services/tradingMemory'
import type { TemplateCard } from '@/services/review/cockpitModel'
import MetricTile from '../MetricTile.vue'
import TemplateChips from '../TemplateChips.vue'

defineProps<{ templates: TemplateCard[] }>()
const emit = defineEmits<{ (e: 'open-template', template: TemplateCard): void }>()

const stats = computed(() => getRegionWinStats(currentRegion.value.id))
const enough = computed(() => stats.value.sampleSize >= 30)
const pct = (v: number) => (v * 100).toFixed(1)
</script>

<template>
  <div class="dim">
    <div class="tiles">
      <MetricTile
        label="后验胜率"
        :value="stats.sampleSize ? pct(stats.posteriorWinRate) : '—'"
        :unit="stats.sampleSize ? '%' : ''"
        :tone="stats.sampleSize ? 'default' : 'muted'"
        :pill="enough ? null : { text: '样本不足', tone: 'off' }"
        info="Beta-Binomial 后验估计。T04 方案硬规则：样本 <30 不出胜率结论，此处数字仅为后验分布参考，不可作为策略优劣判据。"
        :sub="enough ? '样本已达结论门槛' : '满 30 笔出结论'"
      />
      <MetricTile label="样本量" :value="String(stats.sampleSize)" unit="笔" :sub="`门槛 30 笔`" />
      <MetricTile
        label="90% 可信区间"
        :value="stats.sampleSize ? `${(stats.credibleLow * 100).toFixed(0)}–${(stats.credibleHigh * 100).toFixed(0)}` : '—'"
        :unit="stats.sampleSize ? '%' : ''"
        :tone="stats.sampleSize ? 'default' : 'muted'"
        info="后验分布的 90% 可信区间；区间越宽说明样本越不足以支撑结论。"
      />
      <MetricTile
        label="策略库服务端化"
        value="—"
        tone="muted"
        :pill="{ text: '归 #2045', tone: 'off' }"
        info="策略库与胜率分析报告的服务端化（tradingMemory 收编 PG、回测/实盘双口径分列）归 #2045。本区当前消费前端 Beta-Binomial 后验真数据。"
      />
    </div>
    <TemplateChips :templates="templates" label="策略复盘模板" @open-template="emit('open-template', $event)" />
  </div>
</template>

<style scoped>
.dim { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 720px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
</style>
