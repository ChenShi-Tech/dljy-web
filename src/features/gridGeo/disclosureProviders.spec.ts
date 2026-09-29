// 守什么：南网披露两路来源（整年导出 / 2026-07-03 起日文件）同属一个发布方；事件来源名按事件自己的 providerId 取。
// 坏掉的症状：日文件来源被当成「其他来源」不走南网口径；卡片把日文件事件标成整年导出（同地区第一个来源）的名称，
// 或来源登记缺失时编造一个名称。
// issue：ChenShi-Tech/dljy#3563（后端 dljy#3517 / PR #3562）。
import { describe, expect, it } from 'vitest'
import { CSG_DISCLOSURE_PROVIDER_IDS, disclosureEventSourceName, isCsgDisclosureProvider } from './disclosureProviders'
import type { GridDisclosureProvider } from './types'

function provider(providerId: string, name: string, regionIds = ['yunnan', 'guangdong']): GridDisclosureProvider {
  return { providerId, gridOperator: 'csg', name, regionIds, sourceType: 'IMPORT', mock: false, productionWrite: false, access: 'public', originalLinkPolicy: 'only-when-source-supplies-url', license: '南方电网公开披露信息', eventCount: 1, dataAvailability: { status: 'available', reason: '测试夹具' } }
}
const PROVIDERS = [provider('csg-authorized-export', '南方电网公开披露'), provider('csg-disclosure-file', '南方电网公开披露（日文件接续）')]

describe('南网发布方判定', () => {
  it('整年导出与日文件两路来源都属南网发布方', () => {
    expect([...CSG_DISCLOSURE_PROVIDER_IDS]).toEqual(['csg-authorized-export', 'csg-disclosure-file'])
    expect(isCsgDisclosureProvider('csg-authorized-export')).toBe(true)
    expect(isCsgDisclosureProvider('csg-disclosure-file')).toBe(true)
  })
  it('其他来源、空值与近似写法都不算南网发布方', () => {
    for (const id of ['sgcc-public-disclosure', 'csg', 'other-source', '', ' csg-disclosure-file', 'CSG-DISCLOSURE-FILE', null, undefined]) {
      expect(isCsgDisclosureProvider(id), String(id)).toBe(false)
    }
  })
  it('来源清单不可被调用方改写', () => {
    expect(Object.isFrozen(CSG_DISCLOSURE_PROVIDER_IDS)).toBe(true)
  })
})

describe('事件来源名', () => {
  it('按事件自己的来源取名，不借用同地区第一个来源', () => {
    expect(disclosureEventSourceName(PROVIDERS, 'csg-disclosure-file')).toBe('南方电网公开披露（日文件接续）')
    expect(disclosureEventSourceName(PROVIDERS, 'csg-authorized-export')).toBe('南方电网公开披露')
    expect(disclosureEventSourceName([...PROVIDERS].reverse(), 'csg-authorized-export')).toBe('南方电网公开披露')
  })
  it('来源未登记或登记未加载时如实写待确认并保留来源 ID', () => {
    expect(disclosureEventSourceName(PROVIDERS, 'unknown-source')).toBe('来源名称待确认（unknown-source）')
    expect(disclosureEventSourceName([], 'csg-disclosure-file')).toBe('来源名称待确认（csg-disclosure-file）')
    expect(disclosureEventSourceName([provider('csg-disclosure-file', '  ')], 'csg-disclosure-file')).toBe('来源名称待确认（csg-disclosure-file）')
  })
  it('事件没有来源 ID 时不编造来源', () => {
    for (const id of ['', '   ', null, undefined]) expect(disclosureEventSourceName(PROVIDERS, id)).toBe('来源未提供')
  })
})
