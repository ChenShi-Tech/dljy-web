export interface MapPointAsset {
  id: string
  longitude: number
  latitude: number
}

export interface MapPointItem {
  kind: 'asset'
  id: string
  assetIds: [string]
  longitude: number
  latitude: number
}

export interface MapPointCluster {
  kind: 'cluster'
  id: string
  assetIds: string[]
  longitude: number
  latitude: number
}

export type MapPointRenderItem = MapPointItem | MapPointCluster

export function clusterCellSizeDegrees(cameraHeightM: number): number {
  if (!Number.isFinite(cameraHeightM) || cameraHeightM < 0) return 0
  if (cameraHeightM >= 1_500_000) return 1.2
  if (cameraHeightM >= 720_000) return 0.62
  return 0
}

export function aggregateMapPoints(
  assets: MapPointAsset[],
  cameraHeightM: number,
  selectedAssetId?: string | null,
): MapPointRenderItem[] {
  const validAssets = assets
    .filter((asset) => Number.isFinite(asset.longitude) && Number.isFinite(asset.latitude))
    .sort((a, b) => a.id.localeCompare(b.id))
  const cellSize = clusterCellSizeDegrees(cameraHeightM)
  if (cellSize === 0) {
    return validAssets.map((asset) => ({
      kind: 'asset',
      id: asset.id,
      assetIds: [asset.id],
      longitude: asset.longitude,
      latitude: asset.latitude,
    }))
  }

  const groups = new Map<string, MapPointAsset[]>()
  for (const asset of validAssets) {
    const key = asset.id === selectedAssetId
      ? `selected:${asset.id}`
      : `${Math.floor((asset.longitude + 180) / cellSize)}:${Math.floor((asset.latitude + 90) / cellSize)}`
    const group = groups.get(key) ?? []
    group.push(asset)
    groups.set(key, group)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const longitude = group.reduce((sum, asset) => sum + asset.longitude, 0) / group.length
      const latitude = group.reduce((sum, asset) => sum + asset.latitude, 0) / group.length
      if (group.length === 1) {
        return {
          kind: 'asset' as const,
          id: group[0].id,
          assetIds: [group[0].id] as [string],
          longitude,
          latitude,
        }
      }
      return {
        kind: 'cluster' as const,
        id: `cluster:${key}:${group.map((asset) => asset.id).join('|')}`,
        assetIds: group.map((asset) => asset.id),
        longitude,
        latitude,
      }
    })
}
