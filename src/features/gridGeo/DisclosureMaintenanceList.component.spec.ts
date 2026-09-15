import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { toRaw } from 'vue'
import DisclosureMaintenanceList from './DisclosureMaintenanceList.vue'
import type { MaintenanceListRow } from './disclosureMaintenance'
import type { GridDisclosureEvent } from './types'

function row(extra: Partial<GridDisclosureEvent> = {}): MaintenanceListRow {
  const event: GridDisclosureEvent = { eventId: 'cross-day', providerId: 'csg', category: 'maintenance', title: '大朝山电厂 #1 机检修计划', summary: '主机定期检修', regionId: 'yunnan', spatialBinding: { kind: 'region', ref: 'yunnan', label: '云南', coordinates: null }, businessDate: '2026-07-01', effectiveAt: '2026-06-30T23:30:00+08:00', expiresAt: '2026-07-02T01:45:00+08:00', publishedAt: null, sourceImportedAt: '2026-09-09T12:00:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'actual', issues: [] }, personalFavorite: true, source: { file: 'maintenance.csv', recordId: '123', url: null, sourceTable: 'maintenance', sourceType: 'IMPORT', mock: false, productionWrite: false, dataAvailability: 'available', license: '授权导出', originalLinkStatus: 'unavailable' }, confidence: 'verified-source-row', importedAt: '2026-09-09T12:00:00+08:00', ...extra }
  return { event, timing: { startLabel: '实际停电时间', endLabel: '实际复电时间', start: '2026-06-30 23:30', end: '2026-07-02 01:45', note: '实际停复电区间' } }
}

describe('检修停运紧凑列表', () => {
  it('完整展示跨日停复电日期、原因、类别与收藏，显示全区间时长', () => {
    const wrapper = mount(DisclosureMaintenanceList, { props: { rows: [row()] } })
    expect(wrapper.text()).toContain('2026-06-30 23:30')
    expect(wrapper.text()).toContain('2026-07-02 01:45')
    expect(wrapper.text()).toContain('1 天 2 小时 15 分钟')
    expect(wrapper.text()).toContain('主机定期检修')
    expect(wrapper.text()).toContain('实际区间')
    expect(wrapper.find('[aria-label="已加入个人收藏"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('2026-09-09')
    wrapper.unmount()
  })
  it('点击原生按钮发原事件并反映选中状态，不创建假地图坐标或时间', async () => {
    const item = row()
    const wrapper = mount(DisclosureMaintenanceList, { props: { rows: [item], selectedId: item.event.eventId } })
    const button = wrapper.find('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.attributes('aria-label')).toContain('查看大朝山电厂 #1 机检修计划详情')
    await button.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([item.event])
    wrapper.unmount()
  })
  it('未知复电与单点只展示已知时间，不由入库时间计算持续时长', () => {
    const item = row({ category: 'outage', expiresAt: null, personalFavorite: false, timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'point', issues: ['restoration-time-not-provided'] } })
    item.timing = { startLabel: '已知时点', endLabel: '复电时间', start: '2026-06-30 23:30', end: '未提供', note: '仅有单点，持续区间未知' }
    const wrapper = mount(DisclosureMaintenanceList, { props: { rows: [item] } })
    expect(wrapper.text()).toContain('非计划停运')
    expect(wrapper.text()).toContain('仅已知时点')
    expect(wrapper.text()).toContain('持续区间未知')
    expect(wrapper.find('.duration-column strong').text()).toBe('未提供')
    expect(wrapper.find('[aria-label="未加入个人收藏"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('计划与异常时间有明确标识，窄屏卡片保留独立日期和时长标签', () => {
    const item = row({ timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'planned', issues: [] }, expiresAt: '2026-06-29T12:00:00+08:00' })
    item.timing = { startLabel: '计划停电时间', endLabel: '计划复电时间', start: '2026-06-30 23:30', end: '2026-06-29 12:00', note: '源起止区间异常' }
    const wrapper = mount(DisclosureMaintenanceList, { props: { rows: [item] } })
    expect(wrapper.text()).toContain('计划区间')
    expect(wrapper.text()).toContain('区间异常')
    expect(wrapper.find('.timing-column dt').text()).toBe('计划停电时间')
    expect(wrapper.find('.mobile-label').text()).toBe('已知总时长')
    expect(wrapper.find('.column-head').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('ul').attributes('aria-label')).toBe('检修停运记录列表')
    wrapper.unmount()
  })
  it('筛选无匹配时显示空态且不保留旧行', async () => {
    const wrapper = mount(DisclosureMaintenanceList, { props: { rows: [row()] } })
    await wrapper.setProps({ rows: [] })
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.find('[role="status"]').text()).toContain('没有符合当前筛选条件')
    wrapper.unmount()
  })
  it('生成摘要去重只影响紧凑行，完整日期列和点击详情原始摘要保持不变', async () => {
    const item = row({ providerId: 'csg-authorized-export', summary: '机组；实际停复电：2026-06-30T23:30:00+08:00 至 2026-07-02T01:45:00+08:00。' })
    item.event.source.sourceTable = 'tb_disclosure_forecast_maintenance_plan'
    const summary = item.event.summary
    const wrapper = mount(DisclosureMaintenanceList, { props: { rows: [item] } })
    expect(wrapper.get('.reason').text()).toBe('机组')
    expect(wrapper.get('.column-head').text()).toContain('对象 / 摘要')
    expect(wrapper.text()).toContain('2026-06-30 23:30')
    expect(wrapper.text()).toContain('2026-07-02 01:45')
    await wrapper.get('.open-event').trigger('click')
    expect(toRaw(wrapper.emitted('select')?.[0]?.[0])).toBe(item.event)
    expect(item.event.summary).toBe(summary)
    expect((wrapper.emitted('select')?.[0]?.[0] as GridDisclosureEvent).summary).toBe(summary)
    wrapper.unmount()
  })
  it('通用列表按真实类别显示干预与输电信息并保留原始时间标签和事件', async () => {
    const intervention = row({ eventId: 'intervention', category: 'intervention', title: '金安桥电厂人工干预', summary: '调整运行方式' })
    intervention.timing = { startLabel: '干预开始时间', endLabel: '干预结束时间', start: '2026-06-30 23:30', end: '2026-07-02 01:45', note: '干预生效区间' }
    const constraint = row({ eventId: 'constraint', category: 'constraint', title: '鲁西直流约束', effectiveAt: null, expiresAt: null, timeQuality: { effective: 'business-date', published: 'unknown', intervalBasis: 'unknown', issues: [] } })
    constraint.timing = { startLabel: '生效时间', endLabel: '结束时间', start: '未提供', end: '未提供', note: '仅提供业务日期，生效区间未提供' }
    const congestion = row({ eventId: 'congestion', category: 'congestion', title: '断面阻塞披露' })
    congestion.timing = { ...intervention.timing, startLabel: '开始时间', endLabel: '结束时间' }
    const wrapper = mount(DisclosureMaintenanceList, { props: { generic: true, rows: [intervention, constraint, congestion] } })
    expect(wrapper.find('[data-testid="disclosure-list"]').exists()).toBe(true)
    expect(wrapper.find('ul').attributes('aria-label')).toBe('披露记录列表')
    expect(wrapper.find('.column-head').text()).toContain('生效 / 结束时间')
    expect(wrapper.findAll('.category').map(category => category.text())).toEqual(['人工干预', '输电约束', '断面阻塞'])
    expect(wrapper.text()).not.toContain('其他披露')
    expect(wrapper.text()).not.toContain('停电')
    const rows = wrapper.findAll('li')
    expect(rows[0].findAll('.timing-column dt').map(label => label.text())).toEqual(['干预开始时间', '干预结束时间'])
    expect(rows[1].find('.basis').text()).toBe('仅业务日期')
    expect(rows[1].find('.duration-column strong').text()).toBe('未提供')
    expect(rows[1].text()).toContain('仅提供业务日期，生效区间未提供')
    expect(wrapper.text()).not.toContain('2026-09-09')
    await rows[0].get('.open-event').trigger('click')
    expect(toRaw(wrapper.emitted('select')?.[0]?.[0])).toBe(intervention.event)
    await wrapper.setProps({ rows: [] })
    expect(wrapper.get('[role="status"]').text()).toBe('没有符合当前筛选条件的披露记录。')
    wrapper.unmount()
  })
})
