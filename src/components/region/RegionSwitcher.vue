<script setup lang="ts">
import { computed, ref } from 'vue'
import { MapPin } from 'lucide-vue-next'
import {
  genericRegionProfiles,
  getRegionById,
  getRegionDataMaturity,
  getRegionStatusLabel,
  isOpenRegion,
  isSelectableRegion,
  provinceRegionProfiles,
  regionIdForAreaCode,
  type GridOperatorId
} from '@/data/regions'
import { getStoredUser } from '@/services/auth'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const search = ref('')

const selectedRegion = computed(() => getRegionById(props.modelValue))

// 账号属地地区（Sub-4 #520）：登录账号 areaCode 映射的地区卡片标「我的属地」。
// 登录/登出会重挂布局与本组件，非响应式读取足够；未登录/GROUP/未登记属地为 null 不标。
const myRegionId = computed(() => regionIdForAreaCode(getStoredUser()?.areaCode))

const operatorLabels: Record<GridOperatorId, string> = {
  'state-grid': '国家电网覆盖省区',
  'china-southern-grid': '南方电网覆盖省区',
  'inner-mongolia-grid': '内蒙古电力/国网蒙东',
  'special-region': '特别行政区',
  'taiwan-grid': '台湾电力体系'
}

const groupedProvinceRegions = computed(() => {
  const keyword = search.value.trim()
  const matched = provinceRegionProfiles.filter((region) => {
    if (!keyword) return true
    return `${region.name}${region.shortName}${region.gridLabel}${region.regionGroup}`.includes(keyword)
  })
  const groups = new Map<GridOperatorId, typeof provinceRegionProfiles>()
  for (const region of matched) {
    const current = groups.get(region.gridOperator) ?? []
    current.push(region)
    groups.set(region.gridOperator, current)
  }
  return Array.from(groups.entries()).map(([operator, regions]) => ({
    operator,
    label: operatorLabels[operator],
    regions
  }))
})

// 地区数据成熟度标签：真实(success) / 演示(warning) / 暂无数据(info)。
// 三态对应 regions.ts 的 real / demo-opened / demo-disabled。
function maturityTagLabel(id: string) {
  const m = getRegionDataMaturity(id)
  if (m === 'real') return '真实'
  if (m === 'demo-opened') return '演示'
  return '暂无数据'
}
function maturityTagType(id: string): 'success' | 'warning' | 'info' {
  const m = getRegionDataMaturity(id)
  if (m === 'real') return 'success'
  if (m === 'demo-opened') return 'warning'
  return 'info'
}

function selectRegion(id: string) {
  // 守卫：未开通地区禁用不可切（与模板禁用态双保险，防键盘/无障碍绕过）。
  // 已开通 = 真实数据地区 ∪ 演示开通地区（如四川）。
  if (!isSelectableRegion(id)) return
  emit('update:modelValue', id)
}
</script>

<template>
  <el-popover placement="bottom-end" width="520" trigger="click" popper-class="region-switcher-popper">
    <template #reference>
      <button class="region-switcher-button" type="button">
        <MapPin :size="16" />
        <span>{{ selectedRegion.shortName }}</span>
        <small>{{ selectedRegion.gridLabel }}</small>
      </button>
    </template>

    <div class="region-switcher">
      <div class="region-switcher-head">
        <div>
          <strong>地区规则体系</strong>
          <span>{{ selectedRegion.ruleSet.label }}</span>
        </div>
        <el-tag size="small">{{ getRegionStatusLabel(selectedRegion.ruleSet.spotRuleStatus) }}</el-tag>
      </div>

      <el-input v-model="search" size="small" placeholder="搜索省区、区域或电网" clearable />

      <section class="region-section">
        <h3>通用版</h3>
        <div class="region-card-grid compact">
          <button
            v-for="region in genericRegionProfiles"
            :key="region.id"
            :class="['region-card', { active: region.id === modelValue }]"
            type="button"
            @click="selectRegion(region.id)"
          >
            <strong>{{ region.name }}</strong>
            <span>{{ region.ruleSet.marketScope }}</span>
          </button>
        </div>
      </section>

      <section v-for="group in groupedProvinceRegions" :key="group.operator" class="region-section">
        <h3>{{ group.label }}</h3>
        <div class="region-card-grid">
          <button
            v-for="region in group.regions"
            :key="region.id"
            :class="['region-card', { active: region.id === modelValue }]"
            type="button"
            :disabled="!isOpenRegion(region.id)"
            :aria-disabled="!isOpenRegion(region.id)"
            :title="isOpenRegion(region.id) ? undefined : '本地区暂未开通，暂不可切换'"
            @click="selectRegion(region.id)"
          >
            <strong>{{ region.shortName }}</strong>
            <span>{{ region.regionGroup }} · {{ getRegionStatusLabel(region.ruleSet.spotRuleStatus) }}</span>
            <!-- 数据真实度三态分级：真实(云南/山西·有专属真实采集) / 演示(四川·已开通演示公司，
                 无真实市场数据，切进去图表走空态) / 暂无数据(未开通，禁用灰显)。 -->
            <el-tag
              :type="maturityTagType(region.id)"
              size="small"
              effect="plain"
              class="maturity-tag"
            >{{ maturityTagLabel(region.id) }}</el-tag>
            <!-- 账号属地：登录账号 areaCode 归属的地区（登录后默认切到此区，仍可自由切换） -->
            <el-tag
              v-if="region.id === myRegionId"
              type="warning"
              size="small"
              effect="plain"
              class="maturity-tag"
            >我的属地</el-tag>
          </button>
        </div>
      </section>
    </div>
  </el-popover>
</template>

<style scoped>
.region-switcher-button {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 2px 6px;
  min-height: 32px;
  max-width: 180px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}

.region-switcher-button svg {
  grid-row: span 2;
  color: var(--primary);
}

.region-switcher-button span,
.region-switcher-button small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.region-switcher-button span {
  font-size: var(--font-md);
  font-weight: 700;
  line-height: 1;
}

.region-switcher-button small {
  color: var(--muted);
  font-size: var(--font-xs);
  line-height: 1;
}

.region-switcher {
  display: grid;
  gap: 12px;
  max-height: min(680px, 72vh);
  overflow: auto;
}

.region-switcher-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.region-switcher-head strong,
.region-switcher-head span {
  display: block;
}

.region-switcher-head span {
  margin-top: 4px;
  color: var(--muted);
  font-size: var(--font-sm);
}

.region-section {
  display: grid;
  gap: 8px;
}

.region-section h3 {
  margin: 0;
  color: var(--text-body);
  font-size: var(--font-md);
}

.region-card-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.region-card-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.region-card {
  min-width: 0;
  min-height: 54px;
  padding: 9px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel-sub);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.region-card.active {
  border-color: var(--primary);
  background: var(--primary-tint);
}

/* 未开通地区：灰显禁用不可切（严格地区「真实或空」，不回退山西） */
.region-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.region-card:disabled:hover {
  border-color: var(--line-soft);
  background: var(--panel-sub);
}

.region-card strong,
.region-card span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.region-card strong {
  font-size: var(--font-md);
}

.region-card span {
  margin-top: 6px;
  color: var(--muted);
  font-size: var(--font-xs);
}

.region-card .maturity-tag {
  margin-top: 6px;
  height: 18px;
  padding: 0 5px;
  line-height: 16px;
}

@media (max-width: 768px) {
  .region-switcher-button {
    max-width: 104px;
    padding: 4px 8px;
  }

  .region-switcher-button small {
    display: none;
  }

  .region-card-grid,
  .region-card-grid.compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
