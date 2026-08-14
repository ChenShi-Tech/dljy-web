<script setup lang="ts">
// 市场机制速览（结构性事实，不加示意角标）。
import type { RegionSpotProfile } from '../../data/regionSpotProfiles'

defineProps<{ profile: RegionSpotProfile }>()
</script>

<template>
  <section class="mechanism-strip">
    <div>
      <small>价格形成</small>
      <strong>{{ profile.mechanism.priceFormation }}</strong>
    </div>
    <div>
      <small>结算</small>
      <strong>{{ profile.mechanism.settlement }}</strong>
    </div>
    <div>
      <small>申报粒度</small>
      <strong>{{ profile.mechanism.granularity }}</strong>
    </div>
    <div>
      <small>限价(元/MWh)</small>
      <strong>
        {{ profile.mechanism.priceFloor }} ~ {{ profile.mechanism.priceCap }}
        <el-tag v-if="profile.mechanism.allowsNegative" size="small" type="warning">允许负价</el-tag>
      </strong>
    </div>
    <div>
      <small>新能源报价</small>
      <strong>{{ profile.mechanism.renewableBidding }}</strong>
    </div>
  </section>
</template>

<style scoped>
.mechanism-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.mechanism-strip div {
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}
.mechanism-strip small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 4px;
}
.mechanism-strip strong {
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
@media (max-width: 1180px) {
  .mechanism-strip {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 768px) {
  .mechanism-strip {
    grid-template-columns: 1fr;
  }
}
</style>
