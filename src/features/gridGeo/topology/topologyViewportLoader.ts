import type { GridTopologyFeature, GridTopologySnapshotResponse } from '../types'

export type TopologyViewportQuery = {
  bounds?: string
  lod: 0 | 1 | 2
  limit: number
  featureKinds?: string
}

export type TopologyTransportMeta = {
  durationMs: number | null
  responseBytes: number | null
  positionCount: number | null
  budgetStatus: 'PASS' | 'REJECTED' | null
  sloStatus: 'PASS' | 'SLOW' | null
}

export type TopologyViewportResult = {
  features: GridTopologyFeature[]
  total: number
  response: GridTopologySnapshotResponse
  transport: TopologyTransportMeta
  truncated: boolean
}

type FetchPage = (params: Record<string, string | number>, options: { signal: AbortSignal }) => Promise<{
  response: GridTopologySnapshotResponse
  transport: TopologyTransportMeta
}>

export function createTopologyViewportLoader(fetchPage: FetchPage) {
  let controller: AbortController | null = null
  let requestId = 0

  function cancel() {
    requestId += 1
    controller?.abort()
    controller = null
  }

  async function load(query: TopologyViewportQuery, scopeKey: string, options: { maxPages?: number } = {}): Promise<TopologyViewportResult | null> {
    cancel()
    const activeId = requestId
    controller = new AbortController()
    const signal = controller.signal
    const maxPages = Math.max(1, Math.min(4, options.maxPages ?? 2))
    const byId = new Map<string, GridTopologyFeature>()
    let cursor: string | null = null
    let latest: Awaited<ReturnType<FetchPage>> | null = null
    let total = 0
    for (let page = 0; page < maxPages; page += 1) {
      const params: Record<string, string | number> = { lod: query.lod, limit: query.limit }
      if (query.bounds) params.bounds = query.bounds
      if (query.featureKinds) params.featureKinds = query.featureKinds
      if (cursor) params.cursor = cursor
      latest = await fetchPage(params, { signal })
      if (signal.aborted || activeId !== requestId || !scopeKey) return null
      for (const feature of latest.response.data.features) byId.set(feature.featureId, feature)
      total = latest.response.data.total
      cursor = latest.response.data.nextCursor
      if (!cursor) break
    }
    if (!latest || signal.aborted || activeId !== requestId) return null
    return {
      features: [...byId.values()],
      total,
      response: latest.response,
      transport: latest.transport,
      truncated: Boolean(cursor),
    }
  }

  return Object.freeze({ load, cancel })
}
