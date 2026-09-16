// 守复盘模板的业务名称：注册表每个数据来源都要有交易员看得懂的名称，否则代号会漏到页面上。dljy#2875。
import { describe, expect, it } from 'vitest'
import { REVIEW_TEMPLATES, SOURCE_CATALOG } from 'shared/review-templates/registry.mjs'
import { CADENCE_LABELS, CALIBER_LABELS, SOURCE_LABELS, TEMPLATE_GAP_NOTES, TEMPLATE_NOTES, TEMPLATE_ROLE_LABELS, cadenceLabel, caliberLabel, roleLabel, sourceLabel } from './templateLabels'

describe('复盘模板的业务名称', () => {
  it('注册表登记的每个数据来源都有业务名称', () => {
    const missing = SOURCE_CATALOG.map(source => source.id).filter(id => !SOURCE_LABELS[id])
    expect(missing).toEqual([])
  })
  it('业务名称里不含接口名、数据族代号或英文枚举', () => {
    for (const label of [...Object.values(SOURCE_LABELS), ...Object.values(CALIBER_LABELS)]) expect(label).not.toMatch(/[a-z_]{3,}|\//)
  })
  it('注册表用到的每个周期与岗位都有中文名称', () => {
    const cadences = [...new Set(REVIEW_TEMPLATES.flatMap(template => template.cadences))]
    expect(cadences.filter(code => !CADENCE_LABELS[code])).toEqual([])
    const roles = [...new Set(REVIEW_TEMPLATES.flatMap(template => [template.roles.fill, template.roles.review]))]
    expect(roles.filter(code => roleLabel(code) === '指定岗位')).toEqual([])
    for (const label of [...Object.values(CADENCE_LABELS), ...Object.values(TEMPLATE_ROLE_LABELS)]) expect(label).not.toMatch(/[A-Za-z_]/)
  })
  it('注册表里带备注的模板都有整理后的业务说明，说明中不含议题号、缺口编号或代号', () => {
    const missing = REVIEW_TEMPLATES.filter(template => template.notes && !TEMPLATE_NOTES[template.id]).map(template => template.id)
    expect(missing).toEqual([])
    for (const note of Object.values(TEMPLATE_NOTES)) expect(note).not.toMatch(/#\d|\b[TRNESCD]\d{1,2}\b|[a-z_]{4,}|MOCK|illustrative|P[123]\b/)
  })
  it('注册表里带资料缺口说明的模板都有业务版说明，说明中不含缺口编号或代号', () => {
    const missing = REVIEW_TEMPLATES.filter(template => template.gapNote && !TEMPLATE_GAP_NOTES[template.id]).map(template => template.id)
    expect(missing).toEqual([])
    for (const note of Object.values(TEMPLATE_GAP_NOTES)) expect(note).not.toMatch(/#\d|\b[TRNESCD]\d{1,2}\b|[a-z_]{4,}|MOCK|illustrative|P[123]\b/)
  })
  it('准确率缺省标准保留百分比口径，不把 MAPE 错写成平均绝对误差', () => {
    expect(TEMPLATE_NOTES.N1).toContain('平均绝对百分比误差不超过 10%')
  })
  it('未登记的来源与口径不回显代号', () => {
    expect(sourceLabel('some_new_source')).toBe('系统来源')
    expect(sourceLabel(undefined)).toBe('系统来源')
    expect(caliberLabel('unknown-caliber')).toBe('口径待核实')
    expect(cadenceLabel('hourly')).toBe('按需')
    expect(roleLabel('NEW_ROLE')).toBe('指定岗位')
  })
})
