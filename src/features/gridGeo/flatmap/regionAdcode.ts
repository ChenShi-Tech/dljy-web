// 前端地区 id ↔ 国家行政区划码（adcode）映射。
//
// 用途：省级平面地图按当前地区加载对应省界 GeoJSON（public/geo/boundary/{adcode}.json）。
// 口径：adcode 为 GB/T 2260 省级码，与 DataV.GeoAtlas 的文件名一致；地区 id 口径同
// `src/data/regions.ts` 的 `requiredProvincialRegionIds`。
//
// 模板地区（generic / state-grid / china-southern-grid 等非省级 profile）没有对应行政区，
// 一律返回 null 由调用方降级——不猜、不回退到任意省，避免串读他省地图。

import { requiredProvincialRegionIds } from '@/data/regions'

/** 省级地区 id → 行政区划码。仅登记省级行政区；模板地区不在此表。 */
export const REGION_ADCODE: Readonly<Record<string, string>> = Object.freeze({
  beijing: '110000',
  tianjin: '120000',
  hebei: '130000',
  shanxi: '140000',
  'inner-mongolia': '150000',
  liaoning: '210000',
  jilin: '220000',
  heilongjiang: '230000',
  shanghai: '310000',
  jiangsu: '320000',
  zhejiang: '330000',
  anhui: '340000',
  fujian: '350000',
  jiangxi: '360000',
  shandong: '370000',
  henan: '410000',
  hubei: '420000',
  hunan: '430000',
  guangdong: '440000',
  guangxi: '450000',
  hainan: '460000',
  chongqing: '500000',
  sichuan: '510000',
  guizhou: '520000',
  yunnan: '530000',
  tibet: '540000',
  shaanxi: '610000',
  gansu: '620000',
  qinghai: '630000',
  ningxia: '640000',
  xinjiang: '650000',
  taiwan: '710000',
  'hong-kong': '810000',
  macau: '820000',
})

/** adcode → 省级地区 id 的反向索引。 */
export const ADCODE_REGION: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(REGION_ADCODE).map(([regionId, adcode]) => [adcode, regionId])),
)

/**
 * DataV 未提供下级（地市州）分块的 adcode。
 * 台湾仅有本级面数据，因此其地图只有一个整体要素、不可下钻到地市。
 */
export const ADCODE_WITHOUT_SUBDIVISIONS: ReadonlySet<string> = Object.freeze(new Set(['710000']))

/** 取地区对应的行政区划码；模板地区/未登记地区返回 null（调用方须降级，不得回退他省）。 */
export function adcodeForRegion(regionId: string | null | undefined): string | null {
  if (!regionId) return null
  return REGION_ADCODE[String(regionId).trim()] ?? null
}

/** 取行政区划码对应的地区 id；未登记返回 null。 */
export function regionForAdcode(adcode: string | null | undefined): string | null {
  if (!adcode) return null
  return ADCODE_REGION[String(adcode).trim()] ?? null
}

/** 该地区的省图是否可下钻到地市州。 */
export function hasSubdivisions(regionId: string | null | undefined): boolean {
  const adcode = adcodeForRegion(regionId)
  return adcode !== null && !ADCODE_WITHOUT_SUBDIVISIONS.has(adcode)
}

/** 已登记 adcode 的省级地区 id 列表（稳定顺序，便于校验与遍历）。 */
export const MAPPED_REGION_IDS: readonly string[] = Object.freeze(Object.keys(REGION_ADCODE))

/**
 * 校验用：`requiredProvincialRegionIds` 中未登记 adcode 的地区。
 * 正常应为空数组；非空表示 regions.ts 新增了省级地区但漏配地图数据。
 */
export function findRegionsMissingAdcode(): string[] {
  return requiredProvincialRegionIds.filter((regionId) => !(regionId in REGION_ADCODE))
}
