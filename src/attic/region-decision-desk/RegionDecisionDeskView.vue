<script setup lang="ts">
// 现货决策台：当前地区的策略适配评分、收益/风险快测、参数标定与一键下发。
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionSpotProfile } from '../data/regionSpotProfiles'
import type { SubjectProfile } from '@/services/region/regionStrategyAdvisor'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import StrategyFitPanel from '../components/region/StrategyFitPanel.vue'
import SpotPnlEstimator from '../components/region/SpotPnlEstimator.vue'
import RegionParamCalibration from '../components/region/RegionParamCalibration.vue'

const profile = computed(() => getRegionSpotProfile(currentRegion.value.id))
const subject = ref<SubjectProfile>({ kind: 'trader', capacityMw: 100, contractCoverage: 0.7, hasStorage: false })

// profile 为 computed，切换地区自动更新；此处保留 onRegionChange 以便与其它业务页一致。
onRegionChange(() => {})
</script>

<template>
  <div class="decision-desk">
    <RegionDataBanner />
    <header class="desk-head">
      <h2>{{ currentRegion.shortName }}现货决策台</h2>
      <p>地区校准的策略适配、收益风险快测与参数下发——切换地区即按该地区现货特征重算。</p>
    </header>

    <div v-if="profile.marketStage === 'not-started'" class="empty">
      该地区现货市场尚未启动，暂无决策标定。可切换到已运行地区，或查看
      <RouterLink to="/xhjy/region">地区现货概览</RouterLink>。
    </div>
    <template v-else>
      <StrategyFitPanel :profile="profile" v-model:subject="subject" />
      <SpotPnlEstimator :profile="profile" :subject="subject" />
      <RegionParamCalibration :profile="profile" />
    </template>
  </div>
</template>

<style scoped>
.decision-desk {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--surface-hover);
  color: var(--text);
  display: grid;
  gap: 14px;
  align-content: start;
}
.desk-head h2 {
  margin: 0 0 4px;
  color: var(--chip-text);
  font-size: var(--font-24);
}
.desk-head p {
  margin: 0;
  color: var(--text-soft);
  line-height: 1.6;
}
.empty {
  padding: 40px;
  text-align: center;
  color: var(--text-soft);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
</style>
