// 单维模板清单（Epic #2033 · #2038 外壳）：就绪度读注册表声明值、缺口说明进悬浮、点击开填报器。
import { describe, expect, it } from 'vitest'
import { mount } from '@/test/mount'
import TemplateChips from './TemplateChips.vue'
import type { TemplateCard } from '@/services/review/cockpitModel'

const cards: TemplateCard[] = [
  { id: 'T07', name: '偏差归因分析报告', readiness: 'ready', automation: 'B', cadences: ['weekly'], slots24: false, gapNote: null, notes: null },
  { id: 'R4', name: '售电偏差考核成本核算表', readiness: 'data_gap', automation: 'A', cadences: ['daily'], slots24: false, gapNote: '缺 D4 分客户考核明细', notes: null },
  { id: 'E2', name: '24时段充放电执行与偏差复盘表', readiness: 'deferred', automation: 'B', cadences: ['daily'], slots24: true, gapNote: null, notes: null }
]

describe('TemplateChips', () => {
  it('空清单诚实提示，不渲染 chip', () => {
    const w = mount(TemplateChips, { props: { templates: [] } })
    expect(w.text()).toContain('该维暂无登记模板')
    expect(w.findAll('.chip')).toHaveLength(0)
  })

  it('就绪度决定 chip 类名与文案；24 时段模板带 24h 标记', () => {
    const w = mount(TemplateChips, { props: { templates: cards } })
    const chips = w.findAll('.chip')
    expect(chips).toHaveLength(3)
    expect(chips[0].classes()).toContain('ready')
    expect(chips[0].get('.rd').text()).toBe('就绪')
    expect(chips[1].classes()).toContain('data_gap')
    expect(chips[1].get('.rd').text()).toBe('缺数据')
    expect(chips[2].classes()).toContain('deferred')
    expect(chips[2].find('.h24').exists()).toBe(true)
    expect(chips[0].find('.h24').exists()).toBe(false)
  })

  it('资料缺口用业务说明悬浮提示，不暴露缺口编号或模板编号', () => {
    const w = mount(TemplateChips, { props: { templates: cards } })
    const gapChip = w.findAll('.chip')[1]
    expect(gapChip.attributes('title')).toContain('部分资料尚未接入')
    for (const shown of [gapChip.attributes('title') ?? '', w.text()]) expect(shown).not.toMatch(/\bD\d\b|\b[TRNE]\d{1,2}\b/)
  })

  it('点击 chip emit open-template 带原模板', async () => {
    const w = mount(TemplateChips, { props: { templates: cards } })
    await w.findAll('.chip')[1].trigger('click')
    expect(w.emitted('open-template')![0][0]).toMatchObject({ id: 'R4' })
  })

  it('label 可覆盖默认标题', () => {
    expect(mount(TemplateChips, { props: { templates: cards, label: '风险复盘模板' } }).text()).toContain('风险复盘模板')
    expect(mount(TemplateChips, { props: { templates: cards } }).text()).toContain('本维模板')
  })
})
