<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { DljyUiArtifactBlock } from '@/utils/artifactBlocks'
import StorageDecisionCard from './storage/StorageDecisionCard.vue'
import StorageDispatchTape from './storage/StorageDispatchTape.vue'
import StorageRevenueWaterfall from './storage/StorageRevenueWaterfall.vue'
import StorageSensitivityMatrix from './storage/StorageSensitivityMatrix.vue'
import StorageAssumptionPanel from './storage/StorageAssumptionPanel.vue'
import InvestmentDecisionCard from './investment/InvestmentDecisionCard.vue'
import ProjectFinanceSummary from './investment/ProjectFinanceSummary.vue'
import CashflowCurve from './investment/CashflowCurve.vue'
import DataQualityPanel from './common/DataQualityPanel.vue'
import RiskChecklist from './common/RiskChecklist.vue'
import ForecastBandCard from './brief/ForecastBandCard.vue'
import StrategyTable from './brief/StrategyTable.vue'
import MorningBriefSummary from './brief/MorningBriefSummary.vue'
import MarketSnapshot from './brief/MarketSnapshot.vue'
// insight（市场洞察驾驶舱）
import MarketSnapshotCard from './insight/MarketSnapshotCard.vue'
import AnomalyRadarCard from './insight/AnomalyRadarCard.vue'
import ElasticityCurveCard from './insight/ElasticityCurveCard.vue'
import SpreadArbitrageCard from './insight/SpreadArbitrageCard.vue'
import NodePriceHeatCard from './insight/NodePriceHeatCard.vue'
import MarketNarrativeCard from './insight/MarketNarrativeCard.vue'
// review（复盘体系 #2033：#2038 预留位，#2042/#2043 转正消费）
import PnLWaterfall from './review/PnLWaterfall.vue'
import DeviationAttribution from './review/DeviationAttribution.vue'
import TrustWatermark from '@/components/common/TrustWatermark.vue'

const props = defineProps<{ block: DljyUiArtifactBlock }>()

const COMPONENTS: Record<string, Component> = {
  StorageDecisionCard,
  StorageDispatchTape,
  StorageRevenueWaterfall,
  StorageSensitivityMatrix,
  StorageAssumptionPanel,
  InvestmentDecisionCard,
  ProjectFinanceSummary,
  CashflowCurve,
  // common（跨板块复用）
  DataQualityPanel,
  RiskChecklist,
  // brief（交易晨报）
  ForecastBandCard,
  StrategyTable,
  MorningBriefSummary,
  MarketSnapshot,
  // insight（市场洞察驾驶舱）
  MarketSnapshotCard,
  AnomalyRadarCard,
  ElasticityCurveCard,
  SpreadArbitrageCard,
  NodePriceHeatCard,
  MarketNarrativeCard,
  // review（复盘体系 #2033）
  PnLWaterfall,
  DeviationAttribution
}

const resolved = computed(() => COMPONENTS[props.block.component])
</script>

<template>
  <TrustWatermark v-if="resolved" :basis="block.basis">
    <component
      :is="resolved"
      :data="block.props"
      :title="block.title"
      :basis="block.basis"
    />
  </TrustWatermark>
  <div v-else class="unknown-ui">未注册的 dljy-ui 组件：{{ block.component }}</div>
</template>

<style scoped>
.unknown-ui {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 8px;
  color: #b91c1c;
  background: rgba(254, 226, 226, 0.45);
  font-size: 12.5px;
}
</style>
