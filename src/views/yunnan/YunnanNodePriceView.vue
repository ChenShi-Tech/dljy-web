<script setup lang="ts">
import { computed } from 'vue'
import RegionScopedNotice from '@/components/region/RegionScopedNotice.vue'
import { currentRegion } from '@/services/region/regionContext'
import YunnanNodePricePanel from './panels/YunnanNodePricePanel.vue'

const isYunnanRegion = computed(() => currentRegion.value.id === 'yunnan')
</script>

<template>
  <main class="yunnan-node-price-view">
    <RegionScopedNotice
      v-if="!isYunnanRegion"
      module-title="节点电价分析"
      expected-region-label="云南"
      :current-region-label="currentRegion.name"
    />

    <YunnanNodePricePanel v-else />
  </main>
</template>

<style scoped>
.yunnan-node-price-view {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--bg);
  color: var(--text);
}
</style>
