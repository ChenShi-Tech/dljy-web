<script setup lang="ts">
import { AlertTriangle, Database, Route } from 'lucide-vue-next'
import type { RegionCapabilityDataSupport } from '@/services/region/regionModules'

defineProps<{
  title: string
  regionName: string
  note?: string | null
  supports?: RegionCapabilityDataSupport[]
}>()

const expectationLabel: Record<RegionCapabilityDataSupport['expectation'], string> = {
  real: '真实支撑',
  partial: '部分支撑',
  missing: '缺口',
  'format-only': '仅格式'
}
</script>

<template>
  <section class="cap-degraded">
    <div class="cap-degraded__head">
      <AlertTriangle :size="17" />
      <h3>{{ title }}</h3>
      <el-tag type="warning" size="small">能力降级</el-tag>
    </div>
    <p>
      当前地区为 <b>{{ regionName }}</b>。{{ note || '该业务能力在当前地区缺少可直接消费的真实来源，页面不发起跨地区或 Mock 回放请求。' }}
    </p>
    <div v-if="supports?.length" class="cap-degraded__support">
      <div v-for="item in supports" :key="item.label" class="cap-degraded__support-item">
        <Database :size="14" />
        <span class="cap-degraded__support-label">{{ expectationLabel[item.expectation] }} · {{ item.label }}</span>
        <span v-if="item.families?.length" class="cap-degraded__families">{{ item.families.join(' / ') }}</span>
        <span class="cap-degraded__support-note">{{ item.note }}</span>
      </div>
    </div>
    <div class="cap-degraded__path">
      <Route :size="14" />
      <span>数据到货后按当前地区通道接入，页面不跨地区回放、不合成填充。</span>
    </div>
  </section>
</template>

<style scoped>
.cap-degraded {
  padding: 16px 18px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: var(--panel);
}
.cap-degraded__head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--warning);
  margin-bottom: 10px;
}
.cap-degraded__head h3 {
  margin: 0;
  color: var(--text);
  font-size: var(--font-lg);
  font-weight: 700;
}
.cap-degraded p {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: var(--font-md);
  line-height: 1.7;
}
.cap-degraded p b {
  color: var(--text);
  font-weight: 600;
}
.cap-degraded__support {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}
.cap-degraded__support-item {
  display: grid;
  grid-template-columns: auto minmax(120px, max-content) minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  color: var(--text);
  font-size: var(--font-sm);
}
.cap-degraded__support-label {
  font-weight: 600;
}
.cap-degraded__families {
  color: var(--primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.cap-degraded__support-note {
  grid-column: 2 / -1;
  color: var(--muted);
  line-height: 1.5;
}
.cap-degraded__path {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: var(--font-sm);
}
@media (max-width: 768px) {
  .cap-degraded__support-item {
    grid-template-columns: auto 1fr;
  }
  .cap-degraded__families,
  .cap-degraded__support-note {
    grid-column: 2;
  }
}
</style>
