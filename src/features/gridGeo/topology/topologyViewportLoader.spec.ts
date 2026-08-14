import { describe, expect, it } from 'vitest'
import type { GridTopologyFeature, GridTopologySnapshotResponse } from '../types'
import { createTopologyViewportLoader } from './topologyViewportLoader'

function feature(id: string): GridTopologyFeature {
  return { featureId: id, kind: 'node', name: id, status: 'active', topologyVersion: 'v1', sourceRef: id, classification: 'restricted', ownerCompanyId: 'company', regionId: 'yunnan', gridOperator: 'csg', geometry: { type: 'Point', coordinates: [100, 25] } }
}

function response(features: GridTopologyFeature[], total: number, nextCursor: string | null): GridTopologySnapshotResponse {
  return {
    code: 200, sourceType: 'DB', mock: false, productionWrite: false,
    data: {
      contractVersion: '1', provider: { id: 'provider', label: 'provider', status: 'available', configurationVisible: true }, topologyVersion: 'v1', sourceVersion: 's1', effectiveFrom: null, effectiveTo: null, updatedAt: '2026-07-11', authorizationRef: null, license: null, gridOperator: 'csg', regionId: 'yunnan', ownerCompanyId: 'company', crs: 'WGS84', classification: 'restricted', capabilities: { featureKinds: ['node'], queryModes: ['cursor'], geometryRequired: true, physics: false }, readiness: [], featureCounts: { node: total, total }, dataAvailability: { status: 'available', reason: 'ok', regionRequested: 'yunnan', regionServed: 'yunnan', fallback: false }, features, total, nextCursor,
    },
  }
}

const transport = { durationMs: 12, responseBytes: 800, positionCount: 1, budgetStatus: 'PASS' as const, sloStatus: 'PASS' as const }

describe('topology viewport loader', () => {
  it('按受控游标合并分页并去重稳定 ID', async () => {
    const calls: Array<Record<string, string | number>> = []
    const loader = createTopologyViewportLoader(async (params) => {
      calls.push(params)
      return params.cursor
        ? { response: response([feature('node:one'), feature('node:two')], 2, null), transport }
        : { response: response([feature('node:one')], 2, 'signed-cursor'), transport }
    })
    const result = await loader.load({ lod: 1, limit: 1 }, 'company:yunnan', { maxPages: 2 })
    expect(result?.features.map((item) => item.featureId)).toEqual(['node:one', 'node:two'])
    expect(result?.truncated).toBe(false)
    expect(calls[1].cursor).toBe('signed-cursor')
  })

  it('新作用域请求会中止旧请求且不返回跨域残留', async () => {
    let release!: () => void
    const loader = createTopologyViewportLoader(async (_params, options) => {
      await new Promise<void>((resolve, reject) => {
        release = resolve
        options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
      return { response: response([feature('node:old')], 1, null), transport }
    })
    const oldRequest = loader.load({ lod: 1, limit: 1 }, 'old-scope').catch((error) => error)
    loader.cancel()
    release()
    const oldResult = await oldRequest
    expect(oldResult).toBeInstanceOf(DOMException)
    expect((oldResult as DOMException).name).toBe('AbortError')
  })

  it('分页预算截断时诚实标记 truncated', async () => {
    const loader = createTopologyViewportLoader(async () => ({ response: response([feature('node:one')], 3, 'more'), transport }))
    const result = await loader.load({ lod: 0, limit: 1 }, 'scope', { maxPages: 1 })
    expect(result?.truncated).toBe(true)
    expect(result?.total).toBe(3)
  })
})
