import { computed, ref, watch } from 'vue'
import { defaultRegionId, getRegionById, isSelectableRegion } from '@/data/regions'
import { getRegionSpotProfile } from '@/data/regionSpotProfiles'
import type { RegionCalibratedParams } from '@/services/region/regionStrategyAdvisor'
import type { DataBasis } from '@/services/dataBasis'

const storageKey = 'dljy.currentRegionId'

function readInitialRegionId() {
  const stored = window.localStorage.getItem(storageKey)
  // 只接受可切换地区（真实数据省份 ∪ 通用版模板）。历史遗留在 localStorage 里的
  // 无数据省份（如切换面板禁用前存下的 sichuan）→ 回落默认地区（yunnan），
  // 避免启动即停在一个只会看到空/合成数据的严格地区。
  if (stored && isSelectableRegion(stored)) {
    return stored
  }
  return defaultRegionId
}

const currentRegionId = ref(readInitialRegionId())

watch(currentRegionId, (id) => {
  window.localStorage.setItem(storageKey, id)
})

export const selectedRegionId = currentRegionId

export const currentRegion = computed(() => getRegionById(currentRegionId.value))

export function setCurrentRegionId(id: string) {
  // 守卫：拒绝切到无真实数据的禁用地区（严格地区「真实或空」不回退山西）。
  // 通用版模板始终允许。非法/未知 id 亦被 isSelectableRegion 拒绝。
  if (!isSelectableRegion(id)) return
  currentRegionId.value = getRegionById(id).id
}

export function getCurrentRegionSnapshot() {
  return currentRegion.value
}

// 现货决策台 → 工作台(OODA/交易实验室/日前上报)的地区校准参数下发暂存。
export const pendingDeskPreset = ref<RegionCalibratedParams | null>(null)

export function setDeskPreset(preset: RegionCalibratedParams | null) {
  pendingDeskPreset.value = preset
}

// 原「预测→交易实验室价格曲线下发暂存」（PendingPriceCurve / setPendingPriceCurve）随
// #1799 移除：唯一读取方交易策略实验室已删，只剩预测决策座舱在写、无人读。
// 若将来重建预测→决策的曲线交接，按同样的「写入方 + 读取方成对存在」原则重加。

// 当前/指定地区的「规则+现货画像」摘要，打包成精简对象作为编排接口 payload，
// 注入 supervisor 上下文，使其据地调参派发（见 agent-backend service.py 地区联动）。
// 字段口径与后端 stream_message 注入逻辑一一对应，勿随意改名。
export type RegionSummaryPayload = {
  regionId: string
  regionName: string
  gridOperator: string
  marketStage: string
  mechanism: {
    priceFormation: string
    priceFloor: number
    priceCap: number
    allowsNegative: boolean
    settlement: string
    renewableBidding: string
  }
  priceProfile: { shape: string; volatility: string; peakValleySpread: number }
  dominantDriver: string
  keyRisks: string[]
  basis: string
}

export function packageRegionSummary(regionId?: string): RegionSummaryPayload {
  const profile = regionId ? getRegionById(regionId) : currentRegion.value
  const spot = getRegionSpotProfile(profile.id)
  return {
    regionId: profile.id,
    regionName: profile.name,
    gridOperator: profile.gridLabel,
    marketStage: spot.marketStage,
    mechanism: {
      priceFormation: spot.mechanism.priceFormation,
      priceFloor: spot.mechanism.priceFloor,
      priceCap: spot.mechanism.priceCap,
      allowsNegative: spot.mechanism.allowsNegative,
      settlement: spot.mechanism.settlement,
      renewableBidding: spot.mechanism.renewableBidding
    },
    priceProfile: {
      shape: spot.priceProfile.shape,
      volatility: spot.priceProfile.volatility,
      peakValleySpread: spot.priceProfile.peakValleySpread
    },
    dominantDriver: spot.dominantDriver,
    keyRisks: spot.riskParams.keyRisks,
    basis: spot.dataSource
  }
}
