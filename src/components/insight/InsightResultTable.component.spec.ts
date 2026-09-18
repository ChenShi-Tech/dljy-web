// InsightResultTable.component.spec.ts — 结果明细表回归（dljy#2996 任务 5.8）
// 守什么不变量：
//   ① 列为语义身份（对象/字段/区间起止/值/单位），值缺测显示「—」，不用 0 顶替；
//   ② 本页 x 行 / 全量 y 行如实标注（page.scope），分页结果不冒充全量；
//   ③ 导出全量必须经 fetchAll 重新查询（不带 page），拿到全量口径再落 CSV；
//   ④ CSV 保留单位、来源业务标题、原生粒度说明；缺测行写「缺测」；BOM 头保证
//      Excel 打开不乱码；
//   ⑤ 选区高亮按语义匹配（对象 ∈ 选区对象、时段相交），不按数组下标。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@/test/mount'
import InsightResultTable from './InsightResultTable.vue'
import { buildInsightCsv } from './insightCsv'
import type { InsightSelection } from 'shared/insight/handoff.mjs'
import { insightResult, nodePriceSeries, RESULT_VERSION, nodePriceResult } from './insightFixtures'

const PRICE = nodePriceSeries()

/** el-table 异步渲染（挂载后下一拍才出行），断言前等一拍。 */
async function rendered(wrapper: ReturnType<typeof mount>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
}

function pageResult(scope: 'all' | 'page', totalRows: number, returnedRows?: number) {
  const result = nodePriceResult(['300.125', null, '301'])
  const rows = (result.data?.rows ?? []) as Array<Record<string, string>>
  const sliced = returnedRows !== undefined ? rows.slice(0, returnedRows) : rows
  return insightResult({
    ...result,
    data: { ...result.data!, rows: sliced },
    page:
      scope === 'page'
        ? { scope: 'page', size: 50, offset: 0, returnedRows: sliced.length, totalRows, nextCursor: null }
        : { scope: 'all', totalRows },
  })
}

describe('列与本页/全量标注', () => {
  it('列含对象、字段、区间起止、值、单位；缺测值显示「—」', async () => {
    const result = nodePriceResult(['300.125', null, '301'])
    // 再塞一行 value 空串的行（后端可能下发空值字符串）：表格层按缺测显示。
    const rows = [...(result.data!.rows as Array<Record<string, string>>)]
    rows.push({ seriesId: PRICE.seriesId, intervalStart: '2026-09-10T00:45:00+08:00', intervalEnd: '2026-09-10T01:00:00+08:00', value: '' })
    const patched = insightResult({ ...result, data: { ...result.data!, rows } })

    const wrapper = mount(InsightResultTable, { props: { result: patched } })
    await rendered(wrapper)
    const text = wrapper.text()

    for (const column of ['对象', '字段', '区间起', '区间止', '值', '单位']) expect(text).toContain(column)
    expect(text).toContain('YN.KM.01')
    expect(text).toContain('yuan/MWh')
    // 值按来源精度显示（yn.price.node.public.day-ahead 默认 3 位）。
    expect(text).toContain('300.125')
    expect(text).toContain('—')
  })

  it('分页结果标注「本页 x 行 / 全量 y 行」，不冒充全量', () => {
    const wrapper = mount(InsightResultTable, { props: { result: pageResult('page', 96, 2) } })
    expect(wrapper.text()).toContain('本页 2 行 / 全量 96 行')
  })

  it('全量结果标注「全量 y 行」', () => {
    const wrapper = mount(InsightResultTable, { props: { result: pageResult('all', 3) } })
    expect(wrapper.text()).toContain('全量 3 行')
  })
})

describe('导出', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>
  let urlSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('导出本页：直接落 CSV，不重新查询', async () => {
    const wrapper = mount(InsightResultTable, { props: { result: pageResult('all', 3) } })
    await rendered(wrapper)

    const button = wrapper.findAll('button').find((item) => item.text() === '导出本页')
    await button!.trigger('click')

    expect(urlSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('导出全量：经 fetchAll 重新查询（不带 page 由页面实现），拿到全量才落 CSV', async () => {
    const fetchAll = vi.fn().mockResolvedValue(pageResult('all', 5))
    const wrapper = mount(InsightResultTable, { props: { result: pageResult('page', 5, 2), fetchAll } })
    await rendered(wrapper)

    const button = wrapper.findAll('button').find((item) => item.text() === '导出全量')
    await button!.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchAll).toHaveBeenCalledTimes(1)
    expect(urlSpy).toHaveBeenCalledTimes(1)
  })
})

describe('CSV 口径（insightCsv 纯函数）', () => {
  it('头部写来源业务标题与原生粒度；列保留单位；缺测行写「缺测」；BOM 头', () => {
    const result = nodePriceResult(['300.125', null, '301'])
    const rows = [...(result.data!.rows as Array<Record<string, string>>)]
    rows.push({ seriesId: PRICE.seriesId, intervalStart: '2026-09-10T00:45:00+08:00', intervalEnd: '2026-09-10T01:00:00+08:00', value: '' })
    const patched = insightResult({ ...result, data: { ...result.data!, rows } })

    const csv = buildInsightCsv(patched)

    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('# 来源：云南公开节点日前价格（历史）')
    expect(csv).toContain('# 原生粒度：15 分钟')
    expect(csv).toContain('yuan/MWh')
    expect(csv).toContain('300.125')
    // 空值行按缺测导出，不导出空白或 0。
    expect(csv).toContain('缺测')
    expect(csv).not.toMatch(/,\s*,yuan\/MWh/)
    // 不出现来源标识原文 / 内部词。
    expect(csv).not.toMatch(/yn\.price|capture|family|SELECT/)
  })
})

describe('选区联动高亮', () => {
  function selectionOf(intervals: Array<{ start: string; end: string }>, objects: string[] = ['YN.KM.01']): InsightSelection {
    return {
      schemaVersion: 'insight-selection/v1',
      resultRef: { queryId: 'q-test-1', resultVersion: RESULT_VERSION, readSetRef: `rs1:${'b'.repeat(64)}`, expiresAt: null },
      regionId: 'yunnan',
      companyId: 'c1',
      objectRefs: objects.map((id) => ({ type: 'object', id })),
      timeIntervals: intervals,
      metricRefs: [],
      recordRefs: [],
      priceObject: 'public-node',
      marketPhase: 'day-ahead',
      sourceIds: ['yn.price.node.public.day-ahead'],
      contextVersion: 3,
    }
  }

  it('对象匹配且时段相交的行高亮；时段外的行不高亮（语义匹配，不按下标）', async () => {
    const result = nodePriceResult(['300.125', '301.5', '302'])
    const wrapper = mount(InsightResultTable, {
      props: { result, selection: selectionOf([{ start: '2026-09-10T00:00:00+08:00', end: '2026-09-10T00:30:00+08:00' }]) },
    })
    await rendered(wrapper)

    const rows = wrapper.findAll('tr')
    const highlighted = rows.filter((row) => row.classes().includes('insight-table__row--selected'))

    // 00:00 与 00:15 两行在选区内；00:30 在外。
    expect(highlighted).toHaveLength(2)
  })

  it('对象不在选区内：整表无高亮', async () => {
    const result = nodePriceResult(['300.125'])
    const wrapper = mount(InsightResultTable, {
      props: { result, selection: selectionOf([{ start: '2026-09-10T00:00:00+08:00', end: '2026-09-10T00:15:00+08:00' }], ['YN.OTHER.99']) },
    })
    await rendered(wrapper)

    expect(wrapper.findAll('tr').filter((row) => row.classes().includes('insight-table__row--selected'))).toHaveLength(0)
  })

  it('点击行上抛语义命中（序列目录元数据 + 原始行），由页面决定是否转选区', async () => {
    const result = nodePriceResult(['300.125'])
    const wrapper = mount(InsightResultTable, { props: { result } })
    await rendered(wrapper)

    const bodyRow = wrapper.findAll('tr').find((row) => row.text().includes('300.125'))
    await bodyRow!.trigger('click')

    const emitted = wrapper.emitted('row-click')
    expect(emitted).toHaveLength(1)
    expect(emitted![0][0]).toMatchObject({
      series: { seriesId: 'ser-node-1', sourceId: 'yn.price.node.public.day-ahead' },
      row: { intervalStart: '2026-09-10T00:00:00+08:00' },
    })
  })
})
