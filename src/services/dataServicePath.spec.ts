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

  it('边界负例：交易页消费的读路径与无关路径不改道', () => {
    // 复盘中心（ReviewCenterView）消费的导入台账读，读服务面留平台。
    expect(dataServicePath('/v1/settlements')).toBeNull()
    expect(dataServicePath('/api/v1/settlements')).toBeNull()
    // 普通业务域与 agent 域不受影响。
    expect(dataServicePath('/v1/market/list')).toBeNull()
    expect(dataServicePath('/api/v1/trading/spot/declarations')).toBeNull()
    expect(dataServicePath('/agent-api/v1/forecast/predict')).toBeNull()
    expect(dataServicePath('/api/v1/governance/roles')).toBeNull() // 全功能闭环端点不属治理只读三件套
    expect(dataServicePath('/api/v1/data-sources/other')).toBeNull() // 仅 cgn-yunnan 控制面
  })
})
