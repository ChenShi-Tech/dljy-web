<script setup lang="ts">
/**
 * 场站目录面板
 * ------------------------------------------------------------------
 * 原先内嵌在「电厂地理空间」页。2026-09-08 那页并入「空间联动驾驶舱」、气象页也要同
 * 一套目录，于是抽成组件——三个页面各抄一份检索规则，早晚出现「同一个关键词在 A 页
 * 搜得到、B 页搜不到」。筛选规则本身在 `plantCatalog.ts`，那里有测试。
 *
 * 组件自己持有检索/筛选状态，通过 `update:filtered` 把结果交回宿主：地图上要绘制的
 * 点必须与目录里列出的一致，否则会出现「列表里有、图上没有」。
 */
import { computed, ref, watch } from 'vue'
import { Aperture, Factory, Search, Sun, Wind } from 'lucide-vue-next'

import { filterPlantCatalog, type PlantConfidenceFilter, type PlantTypeFilter } from './plantCatalog'
import type { GridGeoPlant } from './types'

const props = withDefaults(defineProps<{
  plants: readonly GridGeoPlant[]
  /**
   * `floating` = 浮在地图左上的独立面板（「电厂地理空间」页的原样式）；
   * `embedded` = 去掉定位与外壳，嵌进宿主已有的侧栏（驾驶舱的右侧信息面板）。
   * 驾驶舱左侧已被场景导轨占满，浮动版会直接压在它上面。
   */
  variant?: 'floating' | 'embedded'
  selectedPlantId?: string | null
  /** 当前维度下的电厂总数，用于「已上屏 / 总数」那一格。 */
  totalCount?: number | null
  /** 已定位数量与未定位数量，用于底部的覆盖度说明。 */
  locatedCount?: number | null
  unresolvedCount?: number | null
}>(), {
  variant: 'floating',
  selectedPlantId: null,
  totalCount: null,
  locatedCount: null,
  unresolvedCount: null,
})

const emit = defineEmits<{
  select: [plant: GridGeoPlant]
  'update:filtered': [plants: GridGeoPlant[]]
}>()

const keyword = ref('')
const typeFilter = ref<PlantTypeFilter>('all')
const confidenceFilter = ref<PlantConfidenceFilter>('all')

const filteredPlants = computed(() => filterPlantCatalog(props.plants, {
  keyword: keyword.value,
  type: typeFilter.value,
  confidence: confidenceFilter.value,
}))

// immediate：宿主挂载后就要拿到初始集合，否则首屏地图是空的。
watch(filteredPlants, (items) => emit('update:filtered', items), { immediate: true })

function typeIcon(plant: GridGeoPlant) {
  return plant.plantType === 'wind' ? Wind : plant.plantType === 'solar' ? Sun : Factory
}

defineExpose({ filteredPlants })
</script>

<template>
  <aside class="asset-panel" :class="props.variant === 'embedded' ? 'embedded' : 'glass-panel'">
    <div class="panel-heading">
      <div>
        <small>ASSET CATALOG</small>
        <strong>场站目录</strong>
      </div>
      <span>{{ filteredPlants.length }} / {{ props.totalCount ?? props.plants.length }}</span>
    </div>

    <label class="search-box">
      <Search :size="15" aria-hidden="true" />
      <input v-model="keyword" placeholder="搜索电厂、节点或区域" aria-label="搜索电厂、节点或区域" />
    </label>

    <div class="filter-row" role="group" aria-label="按机组类型筛选">
      <button type="button" :class="{ active: typeFilter === 'all' }" :aria-pressed="typeFilter === 'all'" @click="typeFilter = 'all'">全部</button>
      <button type="button" :class="{ active: typeFilter === 'wind' }" :aria-pressed="typeFilter === 'wind'" @click="typeFilter = 'wind'"><Wind :size="13" aria-hidden="true" /> 风电</button>
      <button type="button" :class="{ active: typeFilter === 'solar' }" :aria-pressed="typeFilter === 'solar'" @click="typeFilter = 'solar'"><Sun :size="13" aria-hidden="true" /> 光伏</button>
    </div>

    <select v-model="confidenceFilter" class="confidence-select" aria-label="按定位置信度筛选">
      <option value="all">全部定位置信度</option>
      <option value="verified">已核验公开范围</option>
      <option value="probable">待二次核验</option>
      <option value="unverified">未核验</option>
    </select>

    <div class="asset-list" aria-label="可定位场站列表">
      <button
        v-for="plant in filteredPlants"
        :key="plant.plantId"
        type="button"
        class="asset-item"
        :class="[{ active: plant.plantId === props.selectedPlantId }, `type-${plant.plantType}`]"
        :aria-current="plant.plantId === props.selectedPlantId ? 'true' : undefined"
        @click="emit('select', plant)"
      >
        <span class="asset-icon"><component :is="typeIcon(plant)" :size="17" aria-hidden="true" /></span>
        <span class="asset-copy">
          <strong>{{ plant.standardName }}</strong>
          <small>{{ plant.location.locationLabel }}</small>
        </span>
        <span class="capacity">{{ plant.capacityMw === null ? '—' : plant.capacityMw }}</span>
      </button>
      <div v-if="!filteredPlants.length" class="empty-list">没有符合筛选条件的空间资产</div>
    </div>

    <div class="coverage-note">
      <Aperture :size="15" aria-hidden="true" />
      <span v-if="typeof props.unresolvedCount === 'number'">已上屏 {{ props.locatedCount ?? filteredPlants.length }} 个位置；其余 {{ props.unresolvedCount }} 个已审计并明确标为坐标待核验，不从定价节点猜测位置。</span>
      <span v-else>受管空间目录已加载 {{ props.locatedCount ?? props.plants.length }} 个位置，人工订正保留来源与修订历史。</span>
    </div>
  </aside>
</template>

<style scoped>
.asset-panel { position: absolute; z-index: 6; top: 16px; bottom: 16px; left: 16px; display: flex; width: 296px; padding: 15px; flex-direction: column; border-radius: 16px; color: #dff5ff; }
/* 嵌入态：交出定位与外壳，靠宿主容器给尺寸。列表区仍需 min-height:0 才能在 flex 里滚动。 */
.asset-panel.embedded { position: static; width: auto; min-height: 0; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; backdrop-filter: none; }
.asset-panel.embedded .panel-heading { display: none; }
.glass-panel { border: 1px solid rgba(109, 200, 239, .2); background: linear-gradient(145deg, rgba(5, 23, 40, .88), rgba(3, 14, 28, .72)); box-shadow: 0 18px 44px rgba(0, 7, 18, .38), inset 0 1px rgba(255, 255, 255, .04); backdrop-filter: blur(18px) saturate(1.2); }
.panel-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-heading div { display: flex; flex-direction: column; gap: 2px; }
.panel-heading small { color: #4abbdc; font-size: var(--font-9-5); letter-spacing: .18em; }
.panel-heading strong { font-size: var(--font-xl); }
.panel-heading > span { padding: 4px 8px; border-radius: 999px; color: #7adcf6; background: rgba(42, 178, 218, .1); font-size: var(--font-11-5); }
.search-box { display: flex; height: 38px; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid rgba(99, 190, 226, .18); border-radius: 10px; color: #68c8e4; background: rgba(4, 16, 31, .7); }
.search-box input { min-width: 0; flex: 1; color: #e7f8ff; border: 0; outline: 0; background: transparent; font-size: var(--font-sm); }
.search-box input::placeholder { color: #5f7e8e; }
.filter-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 9px; }
.filter-row button { display: inline-flex; height: 31px; align-items: center; justify-content: center; gap: 5px; border: 1px solid rgba(112, 187, 218, .16); border-radius: 8px; color: #8db7c9; background: rgba(5, 21, 38, .72); font-size: var(--font-xs); cursor: pointer; }
.filter-row button.active { color: #eafaff; border-color: rgba(48, 212, 255, .5); background: rgba(25, 135, 173, .22); box-shadow: inset 0 0 15px rgba(48, 212, 255, .08); }
.confidence-select { width: 100%; height: 32px; margin: 7px 0 9px; padding: 0 8px; border: 1px solid rgba(112, 187, 218, .16); border-radius: 8px; outline: 0; color: #9bc4d4; background: #081b2d; font-size: var(--font-xs); }
.asset-list { min-height: 0; flex: 1; overflow-y: auto; padding-right: 4px; scrollbar-color: rgba(72, 184, 220, .45) transparent; scrollbar-width: thin; }
.asset-item { display: grid; width: 100%; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-bottom: 5px; padding: 8px; text-align: left; border: 1px solid transparent; border-radius: 10px; color: #d6edf7; background: rgba(8, 28, 45, .54); cursor: pointer; transition: .18s ease; }
.asset-item:hover { transform: translateX(2px); border-color: rgba(91, 193, 226, .2); background: rgba(10, 42, 63, .72); }
.asset-item.active { border-color: rgba(255, 229, 138, .5); background: linear-gradient(90deg, rgba(112, 95, 26, .3), rgba(11, 42, 60, .7)); box-shadow: inset 3px 0 #ffe58a; }
.asset-icon { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 9px; color: #31d9ff; background: rgba(49, 217, 255, .1); }
.asset-item.type-solar .asset-icon { color: #b49aff; background: rgba(164, 126, 255, .12); }
.asset-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.asset-copy strong { overflow: hidden; font-size: var(--font-sm); text-overflow: ellipsis; white-space: nowrap; }
.asset-copy small { overflow: hidden; color: #6f96a8; font-size: var(--font-11-5); text-overflow: ellipsis; white-space: nowrap; }
.capacity { color: #8db6c7; font-size: var(--font-11-5); font-variant-numeric: tabular-nums; }
.empty-list { padding: 30px 8px; color: #7293a1; text-align: center; font-size: var(--font-xs); }
.coverage-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; padding: 9px; border-radius: 9px; color: #7ea8b8; background: rgba(25, 86, 107, .17); font-size: var(--font-11-5); line-height: 1.45; }
@media (max-width: 900px) { .asset-panel { display: none; } }
</style>
