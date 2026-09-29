import { describe, expect, it } from 'vitest'
import { createDefaultMaintenanceFilters, formatMaintenanceDuration, hasMaintenanceFilters, maintenanceDuration, maintenanceListSummary, maintenanceTimeBasis } from './disclosureMaintenance'
import type { GridDisclosureEvent } from './types'

function event(extra: Partial<GridDisclosureEvent> = {}): GridDisclosureEvent {
  return { eventId: 'maintenance-a', providerId: 'csg-authorized-export', category: 'maintenance', title: '电厂 #1 机检修', summary: '计划检修', regionId: 'yunnan', spatialBinding: { kind: 'region', ref: 'yunnan', label: '云南', coordinates: null }, effectiveAt: '2026-06-30T23:30:00+08:00', expiresAt: '2026-07-02T01:45:00+08:00', publishedAt: null, businessDate: '2026-07-01', sourceImportedAt: '2026-09-09T08:00:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'actual', issues: [] }, source: { file: 'source.csv', recordId: '1', url: null, sourceTable: 'maintenance', sourceType: 'IMPORT', mock: false, productionWrite: false, dataAvailability: 'available', license: '南方电网公开披露信息（整年导出包）；按公开披露口径所有公司可见', originalLinkStatus: 'unavailable' }, confidence: 'verified-source-row', importedAt: '2026-09-09T08:00:00+08:00', ...extra }
}

describe('检修专业筛选与已知总时长', () => {
  it('每次创建独立默认筛选，准确辨认文字、时间与排序筛选', () => {
    const filters = createDefaultMaintenanceFilters()
    expect(hasMaintenanceFilters(filters)).toBe(false)
    filters.equipmentKeyword = '厂'
    expect(hasMaintenanceFilters(filters)).toBe(true)
    expect(createDefaultMaintenanceFilters().equipmentKeyword).toBe('')
    expect(hasMaintenanceFilters({ ...createDefaultMaintenanceFilters(), reasonKeyword: '大修' })).toBe(true)
    expect(hasMaintenanceFilters({ ...createDefaultMaintenanceFilters(), timingFilter: 'covers-window' })).toBe(true)
    expect(hasMaintenanceFilters({ ...createDefaultMaintenanceFilters(), sort: 'duration-desc' })).toBe(true)
  })
  it('跨日完整实际区间按完整起止计算，不按业务日或源入库日裁切', () => {
    expect(maintenanceDuration(event())).toEqual({ minutes: 1575, label: '1 天 2 小时 15 分钟', status: 'known' })
    expect(maintenanceTimeBasis(event())).toBe('实际区间')
  })
  it('计划区间与实际区间明确区分，无时区源时间按北京时间解释', () => {
    const planned = event({ effectiveAt: '2026-07-01 00:00:00', expiresAt: '2026-07-01T00:30:00+08:00', timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'planned', issues: [] } })
    expect(maintenanceDuration(planned)).toMatchObject({ minutes: 30, label: '30 分钟', status: 'known' })
    expect(maintenanceTimeBasis(planned)).toBe('计划区间')
  })
  it('不完整、仅业务日、单点和未知时间不构造持续时长', () => {
    for (const item of [event({ expiresAt: null }), event({ effectiveAt: null }), event({ timeQuality: { effective: 'business-date', published: 'unknown', issues: [] } }), event({ timeQuality: { effective: 'source', published: 'unknown', intervalBasis: 'point', issues: [] } }), event({ timeQuality: { effective: 'unknown', published: 'unknown', intervalBasis: 'unknown', issues: [] } })]) {
      expect(maintenanceDuration(item)).toEqual({ minutes: null, label: '未提供', status: 'missing' })
    }
  })
  it('倒置、非法日期、只有日期及异常时分不显示虚构时长', () => {
    for (const extra of [{ expiresAt: '2026-06-29T12:00:00+08:00' }, { effectiveAt: '2026-02-30T12:00:00+08:00' }, { effectiveAt: '2026-06-30' }, { effectiveAt: '2026-06-30T24:00:00+08:00' }, { expiresAt: 'invalid' }]) expect(maintenanceDuration(event(extra))).toEqual({ minutes: null, label: '区间异常', status: 'invalid' })
  })
  it('保留真实零时长与不足一分钟的区间，不把0当缺失', () => {
    expect(maintenanceDuration(event({ expiresAt: '2026-06-30T23:30:00+08:00' }))).toMatchObject({ minutes: 0, label: '0 分钟', status: 'known' })
    expect(formatMaintenanceDuration(0.5)).toBe('30 秒')
    expect(formatMaintenanceDuration(NaN)).toBe('未提供')
    expect(formatMaintenanceDuration(-1)).toBe('未提供')
  })
  // dljy#3563：整年导出（≤ 2026-07-02）与日文件接续（2026-07-03 起）同属南网发布方、同一编译模板，两路都要收拢。
  it.each([
    ['csg-authorized-export', 'actual', '实际'], ['csg-authorized-export', 'planned', '计划'],
    ['csg-disclosure-file', 'actual', '实际'], ['csg-disclosure-file', 'planned', '计划'],
  ] as const)('南网来源 %s 只收拢严格匹配编译模板及真实端点的 %s 时间后缀，原事件不变', (providerId, basis, label) => {
    const summary = `机组；${label}停复电：2026-06-30T23:30:00+08:00 至 2026-07-02T01:45:00+08:00。`
    const item = event({ providerId, summary, source: { ...event().source, sourceTable: 'tb_disclosure_forecast_maintenance_plan' }, timeQuality: { effective: 'source', published: 'unknown', intervalBasis: basis, issues: [] } })
    Object.freeze(item)
    expect(maintenanceListSummary(item)).toBe('机组')
    expect(item.summary).toBe(summary)
  })
  // dljy#3571：南网判定改用 shared/schema/grid-disclosure-providers.mjs，按来源 ID 全等判定，近似写法与空来源都不收拢。
  it.each(['csg-authorized-export', 'csg-disclosure-file'])('南网来源 %s 的真实原因、额外说明、非南网或近似来源、不匹配端点或未知时间均原样保留', (providerId) => {
    const summary = '线路；实际停复电：2026-06-30T23:30:00+08:00 至 2026-07-02T01:45:00+08:00。'
    const generated = event({ providerId, summary, source: { ...event().source, sourceTable: 'tb_disclosure_forecast_maintenance_plan' } })
    expect(maintenanceListSummary(generated)).toBe('线路')
    const variants = [
      { ...generated, summary: '计划外故障停运，需复核保护装置。' },
      { ...generated, summary: `原因：保护故障；${summary}` },
      { ...generated, summary: `${summary} 原因：开展定检。` },
      { ...generated, summary: summary.replace(' 至 ', '至') },
      { ...generated, summary: summary.replace('01:45:00', '01:46:00') },
      { ...generated, providerId: 'other-source' },
      { ...generated, providerId: 'sgcc-public-disclosure' },
      ...['csg', ' csg-disclosure-file', 'CSG-DISCLOSURE-FILE', 'csg-authorized-export ', ''].map((id) => ({ ...generated, providerId: id })),
      { ...generated, source: { ...generated.source, sourceTable: 'user-provided-reason' } },
      { ...generated, category: 'outage' as const },
      { ...generated, expiresAt: null },
      { ...generated, timeQuality: { effective: 'source' as const, published: 'unknown' as const, intervalBasis: 'planned' as const, issues: [] } },
    ]
    for (const item of variants) expect(maintenanceListSummary(item)).toBe(item.summary)
  })
})
