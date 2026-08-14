<script setup lang="ts">
import { computed } from 'vue'
import RegionScopedNotice from '@/components/region/RegionScopedNotice.vue'
import { currentRegion } from '@/services/region/regionContext'
import YunnanSettlementPricePanel from './panels/YunnanSettlementPricePanel.vue'

const isYunnanRegion = computed(() => currentRegion.value.id === 'yunnan')
</script>

<template>
  <main class="yunnan-settle-price-view">
    <RegionScopedNotice
      v-if="!isYunnanRegion"
      module-title="结算价分析"
      expected-region-label="云南"
      :current-region-label="currentRegion.name"
    />

    <YunnanSettlementPricePanel v-else />
  </main>
</template>

<style scoped>
.yunnan-settle-price-view {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--bg);
  color: var(--text);
}
</style>
