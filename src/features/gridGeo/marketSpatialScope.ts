import { AREA_LABEL_BY_REGION } from 'shared/region/constants.mjs'
import { resolveCaptureOwner } from 'shared/schema/entities/capture-families.mjs'
import type { PlantOutputCaptureSource } from '@/services/market/plantOutputClient'
import type { GridGeoPlantIntegrations } from './types'

type WeatherCaptureSource = {
  region: string
  meteo: { family: string; dataset: string }
  irradiance: { family: string; dataset: string }
}

const WEATHER_CAPTURE_SOURCE_BY_REGION: Readonly<Record<string, WeatherCaptureSource>> = Object.freeze({
  yunnan: Object.freeze({
    region: 'yunnan',
    meteo: Object.freeze({ family: 'yn_meteo', dataset: 'yn_meteo_hourly' }),
    irradiance: Object.freeze({ family: 'yn_irradiance', dataset: 'yn_irradiance_hourly' }),
  }),
})

export function mappingMatchesScope(mapping: GridGeoPlantIntegrations, companyId: string, regionId: string) {
  return Boolean(companyId && regionId)
    && mapping.asset.ownerCompanyId === companyId
    && mapping.asset.regionId === regionId
}

// 节点电价 API 使用业务地区中文名。只接受权威地区表中的精确映射；未知地区
// 返回 null，由调用方诚实降级为空，不把它回退成云南或山西。
export function resolveGridSpatialPriceRegion(regionId: string): string | null {
  const label = (AREA_LABEL_BY_REGION as Record<string, string>)[regionId]
  return typeof label === 'string' && label.trim() ? label : null
}

// 当前 capture registry 只登记了云南公共气象族。其他地区即使属于同一电网，也不能
// 借用云南站点；必须等本地区来源显式注册后才会返回可读取配置。
export function resolveGridSpatialWeatherSource(regionId: string): WeatherCaptureSource | null {
  return WEATHER_CAPTURE_SOURCE_BY_REGION[regionId] ?? null
}

export function mergeSourceTruthMetas(items: Array<{
  sourceType?: string
  mock?: boolean
  productionWrite?: boolean
  updatedAt?: string | null
}>) {
  return {
    sourceType: [...new Set(items.map((item) => item.sourceType).filter((item): item is string => Boolean(item)))].join('+'),
    mock: items.some((item) => item.mock === true),
    productionWrite: items.some((item) => item.productionWrite === true),
    updatedAt: items.map((item) => item.updatedAt).filter((item): item is string => Boolean(item)).sort().at(-1) ?? null,
  }
}

// 私有出力族必须同时匹配当前公司、当前地区和 capture owner registry；任一维度
// 不可证明时返回空集合，由上层展示 not-configured，绝不回退固定公司数据族。
export function resolveScopedOutputSources(
  mappings: GridGeoPlantIntegrations[],
  companyId: string,
  regionId: string,
): PlantOutputCaptureSource[] {
  const sources = new Map<string, PlantOutputCaptureSource>()
  for (const mapping of mappings) {
    const output = mapping.domains.output
    if (!mappingMatchesScope(mapping, companyId, regionId)) continue
    if (output.status !== 'configured' || !output.family || !output.dataset) continue
    if (resolveCaptureOwner(output.family, regionId, output.dataset) !== companyId) continue
    const source = { family: output.family, dataset: output.dataset, region: regionId }
    sources.set(`${source.region}:${source.family}:${source.dataset}`, source)
  }
  return [...sources.values()]
}
