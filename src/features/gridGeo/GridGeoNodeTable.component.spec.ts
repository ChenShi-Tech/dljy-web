// Keep full node identity and accessible table navigation while grouping only the current page.
// A regression would hide names, expose editing controls in every row, or lose the selected asset. dljy#2897.
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GridGeoNodeTable from './GridGeoNodeTable.vue'
import type { GridGeoNode } from './types'

function node(id: string, name: string) { return { nodeId: id, nodeName: name, nodeKind: 'bus', regionId: 'yunnan', gridOperator: 'csg', voltageLevelKv: null, locationStatus: 'unresolved', location: null, marketRefs: {} } as GridGeoNode }

describe('compact node table', () => {
  it('offers all six columns, explicit name-derived evidence, and a keyboard-focusable detail action', async () => {
    const nodes = [node('internal-id-1', '220kV三都站.110kV#1母'), node('internal-id-2', '220kV三都站.110kV#2母')]
    const wrapper = mount(GridGeoNodeTable, { props: { nodes } })
    expect(wrapper.findAll('thead th').map(cell => cell.text())).toEqual(['节点名称', '所属站', '电压等级', '地区', '位置状态', '关联信息'])
    expect(wrapper.get('.table-scroll').attributes('tabindex')).toBe('0')
    expect(wrapper.get('caption').text()).toContain('当前页 2 条节点')
    expect(wrapper.findAll('.station-cell')).toHaveLength(2)
    expect(wrapper.findAll('.voltage-cell')).toHaveLength(2)
    expect(wrapper.find('[rowspan]').exists()).toBe(false)
    for (const row of wrapper.findAll('tbody tr')) {
      expect(row.findAll('th, td')).toHaveLength(6)
      expect(row.get('.station-cell').text()).toContain('三都站')
      expect(row.get('.voltage-cell').text()).toContain('110 kV')
    }
    expect(wrapper.get('.station-cell').text()).toContain('名称解析')
    expect(wrapper.get('.voltage-cell').text()).toContain('110 kV')
    expect(wrapper.text()).not.toContain('internal-id-1')
    expect(wrapper.text()).not.toContain('编辑')
    await wrapper.get('[aria-label="查看220kV三都站.110kV#1母详情"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[nodes[0]]])
    await wrapper.setProps({ selectedId: nodes[0].nodeId, grouped: false })
    expect(wrapper.get('[aria-label="查看220kV三都站.110kV#1母详情"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.station-cell')).toHaveLength(2)
    wrapper.unmount()
  })
  it('shows a price reference for parquet metadata and directs unknown metadata to detail without inventing relationships', () => {
    const first = { ...node('a', '甲站.110kV#1母'), marketRefs: { nodePriceParquet: 'node_price/market={da,rt}', regionName: '云南' } }
    const second = { ...node('b', '乙站.110kV#1母'), marketRefs: { regionName: '云南' } }
    const wrapper = mount(GridGeoNodeTable, { props: { nodes: [first, second], grouped: false } })
    const cells = wrapper.findAll('.links-cell')
    expect(cells[0].text()).toContain('节点价格引用')
    expect(cells[0].text()).toContain('引用不保证时序覆盖')
    expect(cells[1].text()).toBe('查看详情与笔记')
    expect(wrapper.text()).not.toContain('其他引用')
    expect(wrapper.text()).not.toContain('未配置引用')
    wrapper.unmount()
  })
})
