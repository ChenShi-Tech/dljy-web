// 可用性热力组件测（Epic #3591 S2 / dljy#3594，ZW-06）：全空类型显示缺源原因而非零值矩阵。
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ZsjfxAvailabilityHeatmap from './ZsjfxAvailabilityHeatmap.vue'

const dates = ['2026-09-01', '2026-09-02', '2026-09-03']

describe('ZsjfxAvailabilityHeatmap（ZW-06）', () => {
  it('有数类型显示覆盖天数、全空类型显示缺源原因（不显示零矩阵）', () => {
    const wrapper = mount(ZsjfxAvailabilityHeatmap, {
      props: {
        month: '2026-09',
        types: ['日前价出清', '辐照'],
        dates,
        grid: {
          日前价出清: { '2026-09-01': true, '2026-09-02': true, '2026-09-03': false }
        },
        typeMeta: { 辐照: { source: 'yn_irradiance/yn_irradiance_hourly(ghi)', granularity: 'hourly' } }
      }
    })
    const text = wrapper.text()
    expect(text).toContain('2/3')
    expect(text).not.toContain('0/3')
    expect(text).toContain('无数据')
    expect(text).toContain('yn_irradiance')
    const cells = wrapper.findAll('.cell.has')
    expect(cells.length).toBe(2) // 两格有数
  })

  it('取数失败日标 failed：不计无数据、空行原因优先报失败可重试（codex #242 R1-02）', () => {
    const wrapper = mount(ZsjfxAvailabilityHeatmap, {
      props: {
        month: '2026-09',
        types: ['日前价出清'],
        dates,
        grid: { 日前价出清: { '2026-09-01': 'failed' as const, '2026-09-02': true, '2026-09-03': false } }
      }
    })
    expect(wrapper.findAll('.cell.failed').length).toBe(1) // 失败格独立样式
    expect(wrapper.text()).toContain('1/3')
    const allFailed = mount(ZsjfxAvailabilityHeatmap, {
      props: { month: '2026-09', types: ['联络线计划'], dates, grid: { 联络线计划: Object.fromEntries(dates.map((d) => [d, 'failed' as const])) } }
    })
    expect(allFailed.text()).toContain('取数失败（可重试，不计为无数据）')
    expect(allFailed.text()).not.toContain('来源未接入')
  })

  it('无 typeMeta 的全空类型用兜底原因', () => {
    const wrapper = mount(ZsjfxAvailabilityHeatmap, {
      props: { month: '2026-09', types: ['联络线计划'], dates, grid: {} }
    })
    expect(wrapper.text()).toContain('来源未接入或未覆盖该区间')
  })
})
