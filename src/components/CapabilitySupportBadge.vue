<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Database, Info } from 'lucide-vue-next'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath, type RegionCapabilityDataSupport } from '@/services/region/regionModules'

const props = defineProps<{ path: string }>()

const capability = computed(() => getRegionCapabilityForPath(props.path, currentRegion.value.id))
const supports = computed<RegionCapabilityDataSupport[]>(() => {
  const cap = capability.value
  if (!cap) return []
  return cap.route?.dataSupportByRegion?.[currentRegion.value.id]
    ?? cap.module.dataSupportByRegion[currentRegion.value.id]
    ?? []
})

const primarySupport = computed(() => supports.value[0] ?? null)
const degraded = computed(() => capability.value?.status === 'degraded')

const statusText = computed(() => {
  if (!capability.value) return '未声明地区能力'
  if (capability.value.status === 'available') return '当前地区数据支撑'
  if (capability.value.status === 'degraded') return '当前地区能力降级'
  if (capability.value.status === 'not-configured') return '当前地区暂未开通'
  return '当前地区隐藏'
})

const expectationLabel: Record<RegionCapabilityDataSupport['expectation'], string> = {
  real: '真实',
  partial: '部分',
  missing: '缺失',
  'format-only': '格式'
}
</script>

<template>
  <div v-if="capability" class="cap-support" :class="{ degraded }" role="status">
    <AlertTriangle v-if="degraded" :size="15" />
    <Database v-else :size="15" />
    <span class="cap-support__status">{{ statusText }}</span>
    <el-tag
      v-if="primarySupport"
      size="small"
      :type="primarySupport.expectation === 'real' ? 'success' : primarySupport.expectation === 'missing' ? 'warning' : 'info'"
      effect="plain"
    >
      {{ expectationLabel[primarySupport.expectation] }} · {{ primarySupport.label }}
    </el-tag>
    <span v-if="primarySupport?.families?.length" class="cap-support__families">{{ primarySupport.families.join(' / ') }}</span>
    <span v-if="degraded" class="cap-support__note">
      <Info :size="13" />{{ capability.route?.note || primarySupport?.note }}
    </span>
  </div>
</template>

<style scoped>
.cap-support {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--muted);
  font-size: var(--font-sm);
  margin-bottom: 10px;
}
.cap-support.degraded {
  border-color: color-mix(in srgb, var(--warning, #d97706) 35%, var(--line));
  background: color-mix(in srgb, var(--warning, #d97706) 8%, var(--panel));
  color: var(--warning);
}
.cap-support__status {
  font-weight: 700;
  color: var(--text);
}
.cap-support__families {
  color: var(--primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.cap-support__note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
}
</style>
