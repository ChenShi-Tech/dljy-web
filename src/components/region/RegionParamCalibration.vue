<script setup lang="ts">
// 地区参数标定 + 一键下发：算出本地区正确参数集，带入实验室/日前上报。
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { RegionSpotProfile } from '../../data/regionSpotProfiles'
import { calibrateRegionParams } from '@/services/region/regionStrategyAdvisor'
import { setDeskPreset } from '@/services/region/regionContext'
import IllustrativeBadge from './IllustrativeBadge.vue'

const props = defineProps<{ profile: RegionSpotProfile }>()
const router = useRouter()

const params = computed(() => calibrateRegionParams(props.profile))
const arbText = computed(() => {
  const w = params.value.arbWindow
  const fmt = (hours: number[]) => (hours.length ? hours.map((h) => `${h}:00`).join('、') : '—')
  return `充电 ${fmt(w.chargeHours)}；放电 ${fmt(w.dischargeHours)}`
})

function handoff(path: string) {
  setDeskPreset(params.value)
  router.push(path)
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <div class="section-kicker">地区参数标定与下发</div>
      <IllustrativeBadge v-if="params.basis === 'curated'" label="基于地区特征示意模型" />
    </div>
    <div class="param-grid">
      <div><small>限价区间(元/MWh)</small><strong>{{ params.priceFloor }} ~ {{ params.priceCap }}</strong></div>
      <div><small>波动预算(元/MWh)</small><strong>{{ params.volBudget }}</strong></div>
      <div><small>负价规避阈值</small><strong>{{ params.negativeThreshold }}</strong></div>
      <div><small>申报粒度</small><strong>{{ params.granularity }}</strong></div>
      <div><small>价格标签口径</small><strong>{{ params.priceLabel }}</strong></div>
      <div class="wide"><small>储能套利时段窗口</small><strong>{{ arbText }}</strong></div>
    </div>
    <div class="handoff">
      <span>带入工作台执行：</span>
      <el-button type="primary" size="small" @click="handoff('/xhjy/zrqsb')">日前上报</el-button>
      <el-button size="small" @click="handoff('/xhjy/desk')">申报工作台</el-button>
    </div>
  </section>
</template>

<style scoped>
.panel {
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.section-kicker {
  color: var(--primary);
  font-size: 13px;
  font-weight: 650;
}
.param-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.param-grid div {
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}
.param-grid .wide {
  grid-column: span 3;
}
.param-grid small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 6px;
}
.param-grid strong {
  color: var(--text);
}
.handoff {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-soft);
}
@media (max-width: 1180px) {
  .param-grid {
    grid-template-columns: 1fr 1fr;
  }
  .param-grid .wide {
    grid-column: span 2;
  }
}
@media (max-width: 768px) {
  .param-grid {
    grid-template-columns: 1fr;
  }
  .param-grid .wide {
    grid-column: auto;
  }
}
</style>
