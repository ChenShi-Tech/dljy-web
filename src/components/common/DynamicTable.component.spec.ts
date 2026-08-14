// DynamicTable 通用表格契约（Epic #1702 P1）：列并集/筛选/分页/导出是「先看到数据」场景的基础设施，
// 逻辑偏移会让任意月度新形态数据浏览时列丢失/筛选失效/导出乱码——用组件测试钉死核心计算与导出。
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@/test/mount'
import DynamicTable from './DynamicTable.vue'

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `row${i}`, val: i % 2 === 0 ? 'foo' : 'bar' }))

// el-table / el-pagination(total=0) 在 happy-dom 渲染不稳（parent.insertBefore），且 el-table 内部 DOM 不进 text()。
// 测试目标是 columns/filtered/exportCsv 计算逻辑 + toolbar，故默认 stub 三者；
// ElTableColumn 渲染 label 文本以支持列顺序/labels 断言。分页复位用例单独用真实 ElPagination（见下）。
const tableStubs = {
  ElTable: { template: '<div class="stub-table"><slot /></div>' },
  ElTableColumn: { props: ['label', 'prop'], template: '<div class="stub-col">{{ label }}</div>' },
  ElPagination: { template: '<div class="stub-pager" />' }
}

function mountTable(props: Record<string, unknown>) {
  return mount(DynamicTable, { props, global: { stubs: tableStubs } })
}

describe('DynamicTable（Epic #1702 P1）', () => {
  it('列集合取所有行键并集且保持首次出现顺序', () => {
    const wrapper = mountTable({ rows: [{ a: 1, b: 2 }, { b: 3, c: 4 }], pageSize: 50 })
    // 断言列文本序列（锁顺序，而非仅计数——排序/倒序实现会被抓）
    expect(wrapper.findAll('.stub-col').map((c) => c.text())).toEqual(['a', 'b', 'c'])
  })

  it('关键词筛选不区分大小写、跨全列；清空回全集', async () => {
    const wrapper = mountTable({ rows: rows(10), pageSize: 50 })
    expect(wrapper.text()).toContain('10 行')
    await wrapper.find('input').setValue('FOO') // val=foo（i 偶数）共 5 行，大写也命中
    expect(wrapper.text()).toContain('5 行')
    await wrapper.find('input').setValue('')
    expect(wrapper.text()).toContain('10 行')
  })

  it('分页复位：切到第二页后，改关键词或 rows 都回第一页', async () => {
    // 用真实 ElPagination 验证 v-model:current-page 复位（stub 无法切页）；ElTable 仍 stub 避 insertBefore。
    const wrapper = mount(DynamicTable, {
      props: { rows: rows(25), pageSize: 20 },
      global: { stubs: { ElTable: tableStubs.ElTable, ElTableColumn: tableStubs.ElTableColumn } }
    })
    const pager = wrapper.findComponent({ name: 'ElPagination' })
    const currentPage = () => (pager.props() as Record<string, unknown>).currentPage
    await pager.vm.$emit('update:current-page', 2) // 切到第二页
    expect(currentPage()).toBe(2)
    await wrapper.find('input').setValue('row0') // 改关键词 → watch([keyword,rows]) 复位
    expect(currentPage()).toBe(1)
    await pager.vm.$emit('update:current-page', 2) // 再切第二页
    await wrapper.setProps({ rows: rows(30) }) // 改 rows → watch 复位
    expect(currentPage()).toBe(1)
  })

  it('labels 映射表头，缺省用键名', () => {
    const wrapper = mountTable({ rows: [{ a: 1, b: 2 }], labels: { a: '甲列' }, pageSize: 50 })
    expect(wrapper.findAll('.stub-col').map((c) => c.text())).toEqual(['甲列', 'b'])
  })

  it('导出 CSV：BOM + 逗号字段引号转义 + a.download 含行数', async () => {
    // 只 mock 'a' tag——全量 mock createElement 会让 Vue 内部建 DOM 节点也拿到 anchor（无 insertBefore）而崩。
    const realCreateElement = document.createElement.bind(document)
    const createURL = vi.spyOn(URL, 'createObjectURL')
    const clickSpy = vi.fn()
    const anchor = { click: clickSpy, href: '', download: '' } as any
    const createElSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? anchor : realCreateElement(tag as any) as any))
    const wrapper = mountTable({ rows: [{ a: '1,2', b: 'x' }], exportName: 'demo', pageSize: 50 })
    await wrapper.find('button').trigger('click') // 导出按钮
    expect(createURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('demo-1rows.csv')
    const blob = createURL.mock.calls[0][0] as Blob
    const text = await blob.text()
    expect(text.startsWith('﻿')).toBe(true) // BOM 保 Excel 中文
    expect(text).toContain('"1,2"') // 含逗号字段被引号转义
    createURL.mockRestore()
    createElSpy.mockRestore()
  })

  it('空 rows → 导出 disabled + 0 行', () => {
    const wrapper = mountTable({ rows: [] })
    expect(wrapper.text()).toContain('0 行')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })
})
