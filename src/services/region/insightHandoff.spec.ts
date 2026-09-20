// insightHandoff.spec.ts — 洞察统一下钻上下文与返回状态回归（dljy#3087，OpenSpec 任务 15.1）
// 守什么不变量（对照 specs insight-context-handoff CH01、A15，design D11.1）：
//   ① round-trip：build → parse 逐字段一致，需编码字符（/）的对象 id 往返不丢；
//   ② 命名空间：共享四键（start/end/objects/sources）直写、扩展字段带 hx_ 前缀，两层键不冲突，
//     无 hx_start/hx_objects 等重复键；四键语义为准（重复键丢弃并提示）；
//   ③ 校验与提示：非法日期/对象/视图/价格对象/发起页逐字段丢弃进 ignored（A15「不支持字段
//     明确提示」），未登记 hx_* 键同样提示，不静默忽略影响口径的未知字段；
//   ④ 超长：可选字段按序丢弃并返回 dropped 清单（不静默截断），窗口与 from 必需保留；
//   ⑤ 红线（D3/D11.1）：原始数组不进 URL——query 值中不出现 "["，列表一律逗号分隔 ID 串；
//   ⑥ 返回状态：returnStateOf 返回 from 页 + 可恢复四键上下文；from 缺失/未知 → null（不猜）；
//   ⑦ 与 insightWorkspace 的页 id / 路径约定同步（不 import 其模块以维持零 Vue 依赖）。
// node 档纯函数测试：不 mock 任何东西，shared 契约镜像用真模块。
import { describe, expect, it } from 'vitest'
import { InsightContractError } from 'shared/insight/contract.mjs'
import { INSIGHT_PAGE_IDS, INSIGHT_PAGE_PATHS } from '@/services/region/insightWorkspace'
import {
  DRILLDOWN_QUERY_KEYS,
  DRILLDOWN_SHARED_KEYS,
  INSIGHT_DRILLDOWN_MAX_QUERY_LENGTH,
  INSIGHT_HANDOFF_PAGE_IDS,
  buildInsightDrilldownQuery,
  hasInsightDrilldownParams,
  insightHandoffPagePath,
  parseInsightDrilldownQuery,
  returnStateOf,
  type InsightDrilldownRequest,
} from './insightHandoff'

const BASE: InsightDrilldownRequest = {
  start: '2026-09-17',
  end: '2026-09-18',
  objects: ['YN.KM/01', 'node-2'],
  sources: ['yn.price.user.day-ahead'],
  priceObject: 'user-price',
  marketPhase: 'day-ahead',
  view: 'spread',
  from: 'overview',
}

describe('build → parse round-trip（CH01 跨页上下文一致）', () => {
  it('全字段 round-trip 一致；需编码字符（/）的对象 id 往返不丢', () => {
    const { query, dropped } = buildInsightDrilldownQuery(BASE)
    expect(dropped).toEqual([])

    const { payload, ignored } = parseInsightDrilldownQuery(query)
    expect(ignored).toEqual([])
    expect(payload).toEqual({
      start: '2026-09-17',
      end: '2026-09-18',
      objects: ['YN.KM/01', 'node-2'],
      sources: ['yn.price.user.day-ahead'],
      priceObject: 'user-price',
      marketPhase: 'day-ahead',
      view: 'spread',
      from: 'overview',
    })
  })

  it('最小载荷（仅窗口 + from）：可选字段不进 URL，parse 还原为 null', () => {
    const { query } = buildInsightDrilldownQuery({ start: '2026-05-01', end: '2026-05-01', from: 'prices' })
    expect(query).toEqual({ start: '2026-05-01', end: '2026-05-01', [DRILLDOWN_QUERY_KEYS.from]: 'prices' })

    const { payload, ignored } = parseInsightDrilldownQuery(query)
    expect(ignored).toEqual([])
    expect(payload).toMatchObject({ start: '2026-05-01', end: '2026-05-01', objects: null, view: null })
    expect(returnStateOf(payload)).toMatchObject({ pageId: 'prices', path: '/insight/prices', query: { start: '2026-05-01', end: '2026-05-01' } })
  })
})

describe('URL 键命名空间（设计决策）', () => {
  it('共享四键直写、扩展字段带 hx_ 前缀；与四键不冲突、无 hx_ 重复键', () => {
    const { query } = buildInsightDrilldownQuery(BASE)
    const keys = Object.keys(query)
    // 共享四键原样出现（业务窗与对象/来源两层同一信息只写一处）
    expect(query.start).toBe('2026-09-17')
    expect(query.end).toBe('2026-09-18')
    expect(query.objects).toBe(encodeURIComponent('YN.KM/01') + ',' + encodeURIComponent('node-2'))
    expect(query.sources).toBe('yn.price.user.day-ahead')
    // 扩展字段带 hx_ 前缀，camelCase 对应 D11.1 字段名
    expect(query[DRILLDOWN_QUERY_KEYS.priceObject]).toBe('user-price')
    expect(query[DRILLDOWN_QUERY_KEYS.marketPhase]).toBe('day-ahead')
    expect(query[DRILLDOWN_QUERY_KEYS.view]).toBe('spread')
    expect(query[DRILLDOWN_QUERY_KEYS.from]).toBe('overview')
    // 不存在命名空间重复键；扩展键不与四键同名
    for (const key of keys) {
      expect(key).not.toBe('hx_start')
      expect(key).not.toBe('hx_end')
      expect(key).not.toBe('hx_objects')
      expect(key).not.toBe('hx_sources')
    }
    for (const shared of DRILLDOWN_SHARED_KEYS) {
      expect(DRILLDOWN_QUERY_KEYS).not.toHaveProperty(shared)
    }
  })

  it('hx_start/hx_objects 等重复键被丢弃并提示，四键语义为准；未登记 hx_* 键同样提示', () => {
    const { payload, ignored } = parseInsightDrilldownQuery({
      start: '2026-09-17',
      end: '2026-09-18',
      hx_start: '2020-01-01', // 手改/坏构造留下的命名空间重复键：不影响四键还原
      hx_objects: 'node-x',
      hx_foobar: '1', // 未登记的未来键：明确提示，不静默忽略
    })
    expect(payload.start).toBe('2026-09-17')
    expect(payload.end).toBe('2026-09-18')
    expect(ignored).toEqual(['hx_start', 'hx_objects', 'hx_foobar'])
    expect(hasInsightDrilldownParams({ hx_foobar: '1' })).toBe(true)
    expect(hasInsightDrilldownParams({ page: '2' })).toBe(false)
  })
})

describe('解析校验与丢弃提示（A15「不支持字段明确提示」）', () => {
  it('非法日期：窗口整对丢弃进 ignored，payload 窗口为 null', () => {
    const { payload, ignored } = parseInsightDrilldownQuery({ start: '2026-13-01', end: '2026-09-18' })
    expect(payload.start).toBeNull()
    expect(payload.end).toBeNull()
    expect(ignored).toEqual(['start、end'])
  })

  it('只带一端日期：同样丢弃并提示（与四键一致，提示的是无法单独生效的那一端）', () => {
    const { payload, ignored } = parseInsightDrilldownQuery({ end: '2026-09-18' })
    expect(payload.start).toBeNull()
    expect(ignored).toEqual(['end'])
  })

  it('对象列表含非法项：整参数丢弃进 ignored（四键语义，不悄悄缩窄选区），合法来源仍还原', () => {
    const { payload, ignored } = parseInsightDrilldownQuery({
      start: '2026-09-17',
      end: '2026-09-18',
      objects: `${encodeURIComponent('YN.KM/01')},${encodeURIComponent('昆明节点')}`,
      sources: 'yn.price.user.day-ahead',
    })
    expect(payload.objects).toBeNull()
    expect(payload.sources).toEqual(['yn.price.user.day-ahead'])
    expect(ignored).toEqual(['objects'])
  })

  it('非法 view / priceObject / marketPhase / from：逐字段丢弃进 ignored，其余字段照常还原', () => {
    const { payload, ignored } = parseInsightDrilldownQuery({
      start: '2026-09-17',
      end: '2026-09-18',
      [DRILLDOWN_QUERY_KEYS.view]: 'nope',
      [DRILLDOWN_QUERY_KEYS.priceObject]: 'free-price',
      [DRILLDOWN_QUERY_KEYS.marketPhase]: 'day-after',
      [DRILLDOWN_QUERY_KEYS.from]: 'somewhere-else',
    })
    expect(payload.view).toBeNull()
    expect(payload.priceObject).toBeNull()
    expect(payload.marketPhase).toBeNull()
    expect(payload.from).toBeNull()
    // 窗口不受坏扩展字段牵连
    expect(payload.start).toBe('2026-09-17')
    expect(ignored).toEqual(
      expect.arrayContaining([DRILLDOWN_QUERY_KEYS.view, DRILLDOWN_QUERY_KEYS.priceObject, DRILLDOWN_QUERY_KEYS.marketPhase, DRILLDOWN_QUERY_KEYS.from])
    )
  })
})

describe('超长丢弃策略（不静默截断）', () => {
  it('超长时按 view → marketPhase → priceObject → objects → sources 丢弃可选字段并返回 dropped 清单；窗口与 from 保留', () => {
    const longIds = Array.from({ length: 120 }, (_, i) => `yn.node.district-${i}-with-a-very-long-suffix-${1000 + i}`)
    const { query, dropped } = buildInsightDrilldownQuery({
      start: '2026-09-17',
      end: '2026-09-18',
      objects: longIds,
      sources: longIds.slice(0, 60),
      view: 'spread',
      priceObject: 'user-price',
      marketPhase: 'day-ahead',
      from: 'overview',
    })
    // 必需字段保留；query 落回上限内
    expect(query.start).toBe('2026-09-17')
    expect(query.end).toBe('2026-09-18')
    expect(query[DRILLDOWN_QUERY_KEYS.from]).toBe('overview')
    expect(new URLSearchParams(query).toString().length).toBeLessThanOrEqual(INSIGHT_DRILLDOWN_MAX_QUERY_LENGTH)
    // dropped 非空且按序（业务影响从小到大），不静默截断
    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped).toEqual([...dropped].sort((a, b) => ['view', 'marketPhase', 'priceObject', 'objects', 'sources'].indexOf(a) - ['view', 'marketPhase', 'priceObject', 'objects', 'sources'].indexOf(b)))
    // parse 侧对被丢字段如实呈 null（调用方可见，不是假装什么都没发生）
    const { payload } = parseInsightDrilldownQuery(query)
    for (const field of dropped) {
      expect(payload[field as 'view' | 'marketPhase' | 'priceObject' | 'objects' | 'sources']).toBeNull()
    }
  })

  it('仍超长（必需字段自身超限，正常载荷不可能）：抛契约错误而不是静默截断', () => {
    // view 等 hx_ 字段极长：逐层丢完后 from 是最后一个保留项——构造必抛场景需绕过 DROP_ORDER，
    // 直接给超长 from 会先被枚举校验拒绝；这里验证枚举外的超长 from 抛的是校验错误（不写入 URL）。
    expect(() =>
      buildInsightDrilldownQuery({ start: '2026-09-17', end: '2026-09-18', from: `x`.repeat(2000) as InsightDrilldownRequest['from'] })
    ).toThrow(InsightContractError)
  })
})

describe('红线：原始数组不进 URL（D3/D11.1）', () => {
  it('query 值中不出现 "[" 或 "{"：列表是逗号分隔 ID 串，不是 JSON', () => {
    const { query } = buildInsightDrilldownQuery(BASE)
    for (const [key, value] of Object.entries(query)) {
      expect(`${key}=${value}`).not.toMatch(/[[\]{]/)
    }
    expect(query.objects).not.toContain('[')
    expect(query.objects).toContain(',')
  })
})

describe('返回状态（returnStateOf）', () => {
  it('from 页 + 可恢复四键上下文齐全：view/priceObject/marketPhase 不带回发起页', () => {
    const { payload } = parseInsightDrilldownQuery(buildInsightDrilldownQuery(BASE).query)
    const state = returnStateOf(payload)
    expect(state).toEqual({
      pageId: 'overview',
      path: '/insight/overview',
      query: {
        start: '2026-09-17',
        end: '2026-09-18',
        objects: `${encodeURIComponent('YN.KM/01')},${encodeURIComponent('node-2')}`,
        sources: 'yn.price.user.day-ahead',
      },
    })
  })

  it('from 缺失或未登记：null（没有可验证的返回位置，不猜）', () => {
    expect(returnStateOf({ start: null, end: null, objects: null, sources: null, priceObject: null, marketPhase: null, view: null, from: null })).toBeNull()
    expect(
      returnStateOf({ start: '2026-09-17', end: '2026-09-18', objects: null, sources: null, priceObject: null, marketPhase: null, view: null, from: 'cockpit' as never })
    ).toBeNull()
  })

  it('窗口非法（被丢弃）时返回状态仍指向 from 页，但不带窗口四键（发起页按默认窗口打开，不带坏上下文）', () => {
    const { payload } = parseInsightDrilldownQuery({ [DRILLDOWN_QUERY_KEYS.from]: 'overview' })
    const state = returnStateOf(payload)
    expect(state).toEqual({ pageId: 'overview', path: '/insight/overview', query: {} })
  })
})

describe('构造校验（坏请求不写进 URL）', () => {
  it('非法窗口 / 非法对象 / 非法 view / 未知 payload 键：抛 InsightContractError', () => {
    expect(() => buildInsightDrilldownQuery({ ...BASE, start: '2026-09-31' })).toThrow(InsightContractError)
    expect(() => buildInsightDrilldownQuery({ ...BASE, end: '2026-09-10' })).toThrow(InsightContractError) // end < start
    expect(() => buildInsightDrilldownQuery({ ...BASE, objects: ['昆明节点'] })).toThrow(InsightContractError)
    expect(() => buildInsightDrilldownQuery({ ...BASE, view: 'nope' })).toThrow(InsightContractError)
    expect(() => buildInsightDrilldownQuery({ ...BASE, from: 'cockpit' })).toThrow(InsightContractError)
    expect(() => buildInsightDrilldownQuery({ ...BASE, priceObject: 'free-price' })).toThrow(InsightContractError)
  })
})

describe('与 insightWorkspace 的页 id / 路径约定同步（静态契约）', () => {
  it('INSIGHT_HANDOFF_PAGE_IDS 与 INSIGHT_PAGE_IDS 一致，路径都是 /insight/<pageId>', () => {
    expect([...INSIGHT_HANDOFF_PAGE_IDS]).toEqual([...INSIGHT_PAGE_IDS])
    for (const pageId of INSIGHT_HANDOFF_PAGE_IDS) {
      expect(insightHandoffPagePath(pageId)).toBe(INSIGHT_PAGE_PATHS[pageId])
    }
  })
})
