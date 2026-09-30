import { describe, expect, it, vi } from 'vitest'

// cockpitData.ts 的导入链（captured→api→regionContext、cgnYunnanLivePrice→companyContext→auth）
// 在模块求值时会读 window.localStorage / 裸 localStorage 初始化当前地区与账号，
// 须先 stub window 与 localStorage 再动态 import（node 环境两者皆无）。
vi.stubGlobal('window', {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { origin: 'http://localhost' }
})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })

const { monthWindowOf } = await import('./cockpitData')

describe('monthWindowOf 缺省月度窗口派生', () => {
  it('正常月份返回所在日历月的月初~月末', () => {
    expect(monthWindowOf('2026-06-15')).toEqual(['2026-06-01', '2026-06-30'])
    expect(monthWindowOf('2026-01-01')).toEqual(['2026-01-01', '2026-01-31'])
    expect(monthWindowOf('2026-06')).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('2 月按平/闰年取真实月末', () => {
    expect(monthWindowOf('2026-02-08')).toEqual(['2026-02-01', '2026-02-28'])
    expect(monthWindowOf('2024-02-29')).toEqual(['2024-02-01', '2024-02-29'])
  })

  it('12 月窗口不跨年（跨年相邻月各自成窗）', () => {
    expect(monthWindowOf('2026-12-31')).toEqual(['2026-12-01', '2026-12-31'])
    expect(monthWindowOf('2027-01-01')).toEqual(['2027-01-01', '2027-01-31'])
  })

  it('非法日期回退历史常量窗口（2026-05 演示口径）', () => {
    const legacy: [string, string] = ['2026-05-01', '2026-05-31']
    expect(monthWindowOf('')).toEqual(legacy)
    expect(monthWindowOf('abc')).toEqual(legacy)
    expect(monthWindowOf('2026-13-01')).toEqual(legacy)
    expect(monthWindowOf('2026-00-15')).toEqual(legacy)
  })
})
