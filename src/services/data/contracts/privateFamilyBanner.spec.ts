import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CAPTURE_FAMILIES } from 'shared/schema/entities/capture-families.mjs'
import { MIDLONG_TIME_BLOCK_FAMILY } from './midlong'
import { SPOT_DAY_AHEAD_ENERGY_FAMILY, SPOT_DAY_AHEAD_REPORT_FAMILY } from './spotTrading'

// 消费公司私有族的页面**必须**把族代码传给 <RegionDataBanner :families>。
//
// 该组件在未传 families 时**永不**显示无权限态（`if (!families?.length) return false`）。
// 于是「已登录、但不属于数据归属公司」的用户会看到一张空表/空图，完全不知道是被拒——
// 既像功能坏了，也掩盖了真实原因。sdpt_zfsdjy 由 public 改 company 后正踩这个坑（codex P2）。
//
// 这里用源码断言而非组件挂载：要守的是「页面有没有声明」，挂载测不到漏声明这件事。
const PRIVATE_FAMILY_PAGES: Array<{ view: string; family: string }> = [
  { view: 'src/views/DayAheadReportView.vue', family: SPOT_DAY_AHEAD_REPORT_FAMILY },
  { view: 'src/views/DayAheadEnergyView.vue', family: SPOT_DAY_AHEAD_ENERGY_FAMILY },
  { view: 'src/views/yunnan/ZfsdjyTradesView.vue', family: MIDLONG_TIME_BLOCK_FAMILY },
  { view: 'src/views/yunnan/ZfsdjyPositionView.vue', family: MIDLONG_TIME_BLOCK_FAMILY }
]

describe('公司私有族消费页必须声明无权限横幅范围', () => {
  it('清单里的族确实都是 company 私有族（不是拿公共族凑数）', () => {
    // 注册表是 .mjs 无索引签名，这里按运行时形状取（值来自同一份注册表，不另造事实）
    const registry = CAPTURE_FAMILIES as unknown as Record<
      string,
      { visibility?: string; ownerCompanyId?: string } | undefined
    >
    for (const { family } of PRIVATE_FAMILY_PAGES) {
      expect(registry[family]?.visibility, family).toBe('company')
      expect(registry[family]?.ownerCompanyId, family).toBeTruthy()
    }
  })

  it('每个消费页都把私有族传给 RegionDataBanner，而非裸用 <RegionDataBanner />', () => {
    for (const { view } of PRIVATE_FAMILY_PAGES) {
      const src = readFileSync(view, 'utf8')
      expect(src, view).toContain('<RegionDataBanner :families=')
      // 裸标签会让无权限态永不显示——即使同页另有带参数的横幅，裸的那个也是坑
      expect(src.includes('<RegionDataBanner />'), `${view} 存在裸 <RegionDataBanner />`).toBe(false)
    }
  })
})
