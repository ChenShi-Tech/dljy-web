// 数据运维总览渲染契约：本面板是数据运维工作台的落地首屏，「打开是空白」正是它要根治的问题，
// 故把两件事钉死——① 接口有数时四指标与链路四段渲染的是真实数字（不是占位/常量）；
// ② 某一路取数失败只降级该块并显示失败原因，其余块照常出数（诚实红线：不整页空白、不猜数）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'

const apiGet = vi.fn()
const fetchUploadBatches = vi.fn()

vi.mock('@/services/api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }))
vi.mock('@/services/data/uploadClient', () => ({
  fetchUploadBatches: (...args: unknown[]) => fetchUploadBatches(...args)
}))
// 地区上下文与横幅只与「切地区重取」有关，与本面板的渲染契约无关，隔离掉保持 spec 自包含。
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))

import OpsOverviewPanel from './OpsOverviewPanel.vue'

const CATALOG = {
  generatedAt: '2026-08-19T02:00:00.000Z',
  region: 'yunnan',
  empty: false,
  message: '',
  stats: {
    families: 12,
    datasets: 34,
    rows: 567890,
    documents: 0,
    bySource: [{ source_type: 'CAPTURE', n: 20 }, { source_type: 'IMPORT', n: 14 }]
  },
  registeredFamilyCount: 20,
  items: [
    { family: 'yn_node_price', familyLabel: '节点电价', region: 'yunnan', datasetKey: 'day_ahead', rowCount: 9600, sourceType: 'CAPTURE', capturedAt: null, dataTime: '2026-08-18T00:00:00.000Z' },
    { family: 'yn_meteo', familyLabel: '云南气象', region: 'yunnan', datasetKey: 'hourly', rowCount: 720, sourceType: 'IMPORT', capturedAt: null, dataTime: null }
  ]
}

const QUALITY = {
  generatedAt: '2026-08-19T02:05:00.000Z',
  summary: { pass: 30, warn: 2, fail: 1 },
  items: [{ family: 'yn_meteo', datasetKey: 'hourly', region: 'yunnan', checks: [{ id: 'completeness', status: 'warn', detail: '完整率 92%' }] }],
  streams: [
    { stream: 'yn_node_price/day_ahead', kind: 'family', region: 'yunnan', cadence: '日更', status: 'fail', ageHours: 96, lastAt: '2026-08-15T00:00:00.000Z', detail: '按日更节奏已停更 4 天' },
    { stream: 'yn_meteo/hourly', kind: 'family', region: 'yunnan', cadence: '小时更', status: 'pass', ageHours: 1, lastAt: '2026-08-19T01:00:00.000Z', detail: '正常' }
  ],
  empty: false,
  message: ''
}

const BACKUP = {
  generatedAt: '2026-08-19T02:10:00.000Z',
  available: true,
  message: '',
  latest: { name: '20260818-030000', createdAt: '2026-08-18T03:00:00.000Z', full: true, sqliteCount: 5 },
  history: [{ name: '20260818-030000', createdAt: '2026-08-18T03:00:00.000Z', full: true, sqliteCount: 5 }]
}

const BATCHES = [
  { id: 'B-2', dataset: 'retail-settlement', file_name: '零售结算-07.xlsx', rows_valid: 1200, status: 'COMMITTED', created_at: '2026-08-18T10:00:00.000Z' },
  { id: 'B-1', dataset: 'unit-output', file_name: '机组出力-07.xlsx', rows_valid: 96, status: 'REVERTED', created_at: '2026-08-17T10:00:00.000Z' }
]

function payload(data: unknown) {
  return { code: 200, data }
}

function mockAll() {
  apiGet.mockImplementation((path: string) => {
    if (path === '/v1/governance/catalog') return Promise.resolve(payload(CATALOG))
    if (path === '/v1/governance/quality') return Promise.resolve(payload(QUALITY))
    if (path === '/v1/governance/backup') return Promise.resolve(payload(BACKUP))
    return Promise.reject(new Error(`未预期的路径 ${path}`))
  })
  fetchUploadBatches.mockResolvedValue(BATCHES)
}

// el-table 内部 DOM 在 happy-dom 下不进 text()，断言集中在指标卡/链路段（表格另有 DynamicTable 契约测试覆盖）。
const stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  RegionDataBanner: true,
  DataBasisBadge: true,
  ElTable: { template: '<div class="stub-table"><slot /></div>' },
  ElTableColumn: { props: ['label'], template: '<div class="stub-col">{{ label }}</div>' }
}

async function mountPanel() {
  const wrapper = mount(OpsOverviewPanel, { global: { stubs } })
  await flushPromises()
  return wrapper
}

describe('数据运维总览面板', () => {
  beforeEach(() => {
    apiGet.mockReset()
    fetchUploadBatches.mockReset()
  })

  it('接口有数时渲染真实指标（族数/质量/断流/备份），不是占位', async () => {
    mockAll()
    const text = (await mountPanel()).text()
    expect(text).toContain('12')             // 已入库数据族
    expect(text).toContain('/ 20 注册')
    expect(text).toContain('34 个数据集')
    expect(text).toContain('30')             // 质量通过数
    expect(text).toContain('告警 2 · 不合格 1')
    expect(text).toContain('/ 2 条流')       // 断流 1 / 共 2 条流
  })

  it('链路四段状态由真实数字推导：断流点名待补的流，入库段报批次台账', async () => {
    mockAll()
    const text = (await mountPanel()).text()
    expect(text).toContain('2 类来源在库')                    // 接入段读 bySource
    expect(text).toContain('近期批次 2 笔 · 已落库 1 笔')      // 入库段读批次台账（含撤销区分）
    expect(text).toContain('1 条流停更')                      // 摄取段读断流
    expect(text).toContain('yn_node_price/day_ahead')         // 且点名是哪条
    expect(text).toContain('质量 通过 30 / 告警 2 / 不合格 1') // 治理段读质量摘要
  })

  it('总览行动按钮上抛 navigate，供工作台切到对应面板', async () => {
    mockAll()
    const wrapper = await mountPanel()
    const buttons = wrapper.findAll('button.stage-link')
    expect(buttons.length).toBeGreaterThan(0)
    await buttons[0].trigger('click')
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['data-source'])
  })

  it('某一路失败只降级该块并如实报错，其余块照常出数', async () => {
    mockAll()
    apiGet.mockImplementation((path: string) => {
      if (path === '/v1/governance/quality') return Promise.reject(new Error('data-service 503'))
      if (path === '/v1/governance/catalog') return Promise.resolve(payload(CATALOG))
      if (path === '/v1/governance/backup') return Promise.resolve(payload(BACKUP))
      return Promise.reject(new Error(`未预期的路径 ${path}`))
    })
    const text = (await mountPanel()).text()
    expect(text).toContain('data-service 503')  // 质量块如实报失败原因
    expect(text).toContain('34 个数据集')       // 目录块不受牵连
    expect(text).toContain('5 个库')            // 备份块不受牵连
    expect(text).not.toContain('质量 通过 30')  // 不拿旧值/占位值冒充
  })

  it('目录为空时显示后端给的说明而非空白', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/v1/governance/catalog') {
        return Promise.resolve(payload({ ...CATALOG, empty: true, message: '当前地区尚无采集数据', items: [], stats: { ...CATALOG.stats, families: 0, datasets: 0, rows: 0, bySource: [] } }))
      }
      if (path === '/v1/governance/quality') return Promise.resolve(payload(QUALITY))
      if (path === '/v1/governance/backup') return Promise.resolve(payload(BACKUP))
      return Promise.reject(new Error(`未预期的路径 ${path}`))
    })
    fetchUploadBatches.mockResolvedValue([])
    const text = (await mountPanel()).text()
    expect(text).toContain('尚无来源记录')
    expect(text).toContain('尚无上传批次')
  })
})
