// #2169 P2-2a：数据管理路径族 → data-service 改道判定的纯函数单测。
// 关键负例：/v1/settlements（导入台账读）被复盘中心（交易页）消费，读服务面按边界留平台，
// 不得改道，回归时这条若翻绿意味着边界被破坏。
import { describe, expect, it } from 'vitest'
import { DATA_SVC_ROOT, dataServicePath } from './dataServiceRoutes'

describe('dataServicePath 数据管理路径族改道（#2169 P2-2a）', () => {
  it('上传中心：裸 /v1 与 /api/v1 两种形态都改道', () => {
    expect(dataServicePath('/api/v1/data-upload/contracts')).toBe(`${DATA_SVC_ROOT}/api/v1/data-upload/contracts`)
    expect(dataServicePath('/v1/data-upload/batches')).toBe(`${DATA_SVC_ROOT}/api/v1/data-upload/batches`)
  })

  it('导入中心写链与台账读', () => {
    expect(dataServicePath('/v1/import-templates/upload')).toMatch(/^\/data-svc\/api\/v1\/import-templates/)
    expect(dataServicePath('/v1/import-hub/records')).toMatch(/^\/data-svc\/api\/v1\/import-hub/)
    expect(dataServicePath('/v1/market-analysis/import')).toBe(`${DATA_SVC_ROOT}/api/v1/market-analysis/import`)
    expect(dataServicePath('/v1/settlements/import')).toBe(`${DATA_SVC_ROOT}/api/v1/settlements/import`)
  })

  it('摄取触发/治理只读/凭据与接入控制面', () => {
    expect(dataServicePath('/api/v1/ingest/weather-export')).toBe(`${DATA_SVC_ROOT}/api/v1/ingest/weather-export`)
    expect(dataServicePath('/v1/governance/catalog')).toBe(`${DATA_SVC_ROOT}/api/v1/governance/catalog`)
    expect(dataServicePath('/v1/governance/db-health')).toBe(`${DATA_SVC_ROOT}/api/v1/governance/db-health`)
    expect(dataServicePath('/v1/grid-access/points')).toBe(`${DATA_SVC_ROOT}/api/v1/grid-access/points`)
    expect(dataServicePath('/v1/sichuan-ingest')).toBe(`${DATA_SVC_ROOT}/api/v1/sichuan-ingest`)
    expect(dataServicePath('/v1/data-sources/cgn-yunnan')).toBe(`${DATA_SVC_ROOT}/api/v1/data-sources/cgn-yunnan`)
  })

  it('结算台账读（复盘中心消费）改道 data-service——平台侧处理器已退役', () => {
    // 这条翻回 null 就意味着复盘中心结算台账读 404（平台 BFF 已无该域的处理器）。
    expect(dataServicePath('/v1/settlements')).toBe(`${DATA_SVC_ROOT}/api/v1/settlements`)
    expect(dataServicePath('/api/v1/settlements')).toBe(`${DATA_SVC_ROOT}/api/v1/settlements`)
    // query 串不在判定内（由调用方以 params 传），带 query 的字面量不匹配 exact 集合。
    expect(dataServicePath('/v1/settlements?month=2026-07')).toBeNull()
  })

  it('边界负例：无关读路径不改道', () => {
    // 普通业务域与 agent 域不受影响。
    expect(dataServicePath('/v1/market/list')).toBeNull()
    expect(dataServicePath('/api/v1/trading/spot/declarations')).toBeNull()
    expect(dataServicePath('/agent-api/v1/forecast/predict')).toBeNull()
    expect(dataServicePath('/api/v1/governance/roles')).toBeNull() // 全功能闭环端点不属治理只读三件套
    expect(dataServicePath('/api/v1/data-sources/other')).toBeNull() // 仅 cgn-yunnan 控制面
  })
})
