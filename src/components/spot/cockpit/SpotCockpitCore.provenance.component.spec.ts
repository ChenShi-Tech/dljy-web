// 同 YunnanNodePricePanel.provenance.component.spec.ts（#1791），这里锁的是驾驶舱
// 现货 cockpit 页的节点价来源标注与数据基准徽章。
//
// 该页此前无条件渲染「厂侧 PG · 非电网官方」并把基准徽章写死成「实时真实数据」，而
// 取数在无授权时会静默落到公共节点价端点——两条标注都与实际来源不符。
//
// 正反两侧都断言：有授权时该出现，无授权时**必须不出现**。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const entitled = vi.hoisted(() => ({ value: false }))

vi.mock('@/services/market/cgnYunnanLivePrice', () => ({
  hasCgnYunnanPriceEntitlement: () => entitled.value,
}))

vi.mock('@/services/cockpitData', () => ({
  COCKPIT_PRIVATE_FAMILIES: [],
  loadCockpit: vi.fn(async () => {
    throw new Error('spec 不验取数，只验来源标注')
  }),
}))

vi.mock('@/components/region/RegionDataBanner.vue', () => ({
  default: { name: 'RegionDataBanner', template: '<div />' },
}))

const PRIVATE_BADGE = '厂侧 PG · 非电网官方'
const REALTIME_LABEL = '实时真实数据'
const CAPTURED_LABEL = '真实采集回放'

async function mountCockpit() {
  const { mount } = await import('@/test/mount')
  const { default: Cockpit } = await import('./SpotCockpitCore.vue')
  return mount(Cockpit, {
    props: { regionName: '云南', regionId: 'yunnan' },
    global: { stubs: { ChartCard: true, DynamicTable: true } },
  })
}

describe('现货 cockpit · 节点价来源标注', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('中广核云南账号：显示厂侧标注，节点价基准为实时真实数据', async () => {
    entitled.value = true
    const text = (await mountCockpit()).text()
    expect(text).toContain(PRIVATE_BADGE)
    expect(text).toContain(`节点价：${REALTIME_LABEL}`)
    // 页脚此前写死「节点电价 DuckDB」——节点价早已改走 PG，这是同一处组件里的第三处
    // 陈旧来源陈述，一并纳入锁定。
    expect(text).toContain('节点电价中广核厂侧私有 PostgreSQL')
    expect(text).not.toContain('DuckDB')
  })

  it('非中广核账号：**不得**出现厂侧标注，基准降为真实采集回放', async () => {
    entitled.value = false
    const text = (await mountCockpit()).text()
    expect(text).not.toContain(PRIVATE_BADGE)
    expect(text).toContain(`节点价：${CAPTURED_LABEL}`)
    expect(text).not.toContain(`节点价：${REALTIME_LABEL}`)
    expect(text).toContain('节点电价平台公共节点电价')
    expect(text).not.toContain('中广核厂侧私有 PostgreSQL')
  })
})
