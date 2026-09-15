// Object navigation must preserve identity/time and reject foreign scopes or unsafe returns. dljy#2897.
import { describe, expect, it } from 'vitest'
import { buildGridObjectLocation, clearGridObjectQuery, hasGridObjectQuery, readGridObjectQuery, readGridObjectWindow, safeGridReturnPath, validObjectDate } from './objectNavigation'

describe('对象导航契约', () => {
  const reference = { kind: 'disclosure' as const, id: 'source/机组#1', regionId: 'yunnan' }
  const scope = { regionId: 'yunnan', companyId: 'company-a' }
  it('同一对象与跨午夜区间原样携带，返回保留原筛选', () => {
    const result = buildGridObjectLocation('/grid-assets/disclosures', reference, { companyId: 'company-a', date: '2026-07-01', from: '2026-07-01T23:00:00+08:00', to: '2026-07-02T01:00:00+08:00', returnTo: '/grid-assets/nodes?keyword=A&page=2' })
    expect(result.query).toEqual({ objectKind: 'disclosure', objectId: 'source/机组#1', objectRegion: 'yunnan', objectCompany: 'company-a', objectDate: '2026-07-01', objectFrom: '2026-07-01T23:00:00+08:00', objectTo: '2026-07-02T01:00:00+08:00', returnTo: '/grid-assets/nodes?keyword=A&page=2' })
    expect(readGridObjectQuery(result.query, scope)).toEqual(reference)
    expect(readGridObjectWindow(result.query)?.to).toBe('2026-07-02T01:00:00+08:00')
  })
  it('拒绝跨公司、跨地区、未知对象类别与重复查询参数', () => {
    const query = buildGridObjectLocation('/grid-assets/nodes', reference, { companyId: 'company-a' }).query
    expect(readGridObjectQuery(query, { ...scope, companyId: 'company-b' })).toBeNull()
    expect(readGridObjectQuery(query, { ...scope, regionId: 'shanxi' })).toBeNull()
    expect(readGridObjectQuery({ ...query, objectKind: 'admin' }, scope)).toBeNull()
    expect(readGridObjectQuery({ ...query, objectId: ['a', 'b'] }, scope)).toBeNull()
    expect(hasGridObjectQuery({ objectId: '' })).toBe(true)
  })
  it('无时区、不完整、倒序及异常日期不能伪装成有效观察窗口', () => {
    for (const date of ['2026-02-30', '2026-1-01', '', 'not-a-date']) expect(validObjectDate(date)).toBe(false)
    expect(validObjectDate('2024-02-29')).toBe(true)
    expect(readGridObjectWindow({ objectFrom: '2026-07-01', objectTo: '2026-07-02' })).toBeNull()
    expect(readGridObjectWindow({ objectFrom: '2026-07-01T12:00:00', objectTo: '2026-07-01T13:00:00' })).toBeNull()
    expect(readGridObjectWindow({ objectFrom: '2026-07-02T00:00:00Z', objectTo: '2026-07-01T00:00:00Z' })).toBeNull()
  })
  it('返回只允许既有空间页面，清除关联不清除业务筛选', () => {
    expect(safeGridReturnPath('/grid-assets/plants?keyword=甲厂')).toBe('/grid-assets/plants?keyword=甲厂')
    for (const path of ['//evil.test', 'https://evil.test', '/grid-assets/nodes\\evil', '/grid-assets/nodes-evil', '/admin']) expect(safeGridReturnPath(path)).toBeUndefined()
    expect(clearGridObjectQuery({ objectId: 'a', objectKind: 'node', objectRegion: 'yunnan', objectCompany: 'a', objectDate: '2026-07-01', returnTo: '/grid-assets/command', keyword: '设备', page: '3' })).toEqual({ keyword: '设备', page: '3' })
  })
})
