import { computed } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'

// 回放取数能力降级四件套单源（spot-trading-module-hygiene）。
// 此前在 DayAheadReportView 与 DayAheadEnergyView 逐字复制（连判定表达式都相同），
// 修口径需人肉同步两处。传入本页路由路径（如 '/xhjy/zrqsb'），随当前地区联动。
export function useCapturedCapability(routePath: string) {
  const routeCapability = computed(() => getRegionCapabilityForPath(routePath, currentRegion.value.id))
  const capabilitySupports = computed(() =>
    routeCapability.value?.route?.dataSupportByRegion?.[currentRegion.value.id]
    ?? routeCapability.value?.module.dataSupportByRegion[currentRegion.value.id]
    ?? []
  )
  const isCapabilityDegraded = computed(() => routeCapability.value?.status === 'degraded' || routeCapability.value?.status === 'hidden' || routeCapability.value?.status === 'not-configured')
  const capabilityNote = computed(() =>
    routeCapability.value?.route?.note
    ?? capabilitySupports.value.find((item) => item.expectation === 'missing')?.note
    ?? null
  )
  return { routeCapability, capabilitySupports, isCapabilityDegraded, capabilityNote }
}
