// 企业储能资产档案客户端：对接 /api/v1/market/storage-assets（PG · 迁移 013）。
// 固定资产/成本参数入企业专有库（companyId 隔离），S4 申报时拉取；
// 临时覆盖不回写档案——覆盖是当日申报决定，随 storagePlan 写回申报单留痕。
import { apiGet, apiPut } from '@/services/api'

export type StorageAsset = {
  id: string
  assetName: string
  region: string
  powerMw: number
  capacityMwh: number
  socMin: number
  socMax: number
  etaRoundTrip: number
  rampLimitMw: number | null
  cycleCostYuanPerMwh: number
  chargeAdderYuanPerMwh: number
  maxCyclesPerDay: number
  inCapacityList: boolean
  capacityStandardYuanPerKwYear: number
  dischargeDurationH: number
  cyclesPerYear: number
  operatingDod: number
  monthlyChargeQuotaMwh: number | null
  note: string | null
  updatedBy: string
  updatedAt: string
}

export async function listStorageAssets(): Promise<StorageAsset[]> {
  const res = await apiGet<{ data: { assets: StorageAsset[] } }>('/v1/market/storage-assets')
  return (res as { data?: { assets?: StorageAsset[] } }).data?.assets ?? []
}

export async function saveStorageAsset(input: Partial<StorageAsset> & { assetName: string; region: string }): Promise<StorageAsset> {
  const res = await apiPut<{ data: StorageAsset }>('/v1/market/storage-assets', input)
  return (res as { data?: StorageAsset }).data as StorageAsset
}
