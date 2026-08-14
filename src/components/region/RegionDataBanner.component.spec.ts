// RegionDataBanner 四态互斥渲染（Epic #1702 P1）：锁住「诚实数据标注/回退」红线。
// 切地区假绿、Mock 漏标、私有族越权这类 UI 层 bug 纯函数单测够不到——用组件测试钉死四分支优先级
// （无权限 > 演示 > 接口级 Mock > 基线回退），任一状态偏移都会让「诚实标注」失效、误导交易决策。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@/test/mount'
import RegionDataBanner from './RegionDataBanner.vue'

// currentRegion 是 computed（不可直接赋值），mock regionContext 为可写 ref。
// vi.hoisted 回调提升到 import 之前、不能用 import 的 ref，故用 holder 中转：
// hoisted 持空对象，mock 工厂内 await import('vue') 创建 ref 存入 holder，测试经 holder 改值。
const { holder } = vi.hoisted(() => ({ holder: {} as { region?: { value: { id: string; shortName: string } } } }))
vi.mock('@/services/region/regionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/region/regionContext')>()
  const { ref } = await import('vue')
  holder.region = ref({ id: 'yunnan', shortName: '云南' })
  return { ...actual, currentRegion: holder.region }
})

// 真实模块级 ref，beforeEach 重置（复刻 api.spec.ts resetStatus，共享同一模块实例）。
import { regionDataStatus } from '@/services/captured'
import { deniedCaptureFamilies } from '@/services/api'

function resetStatus() {
  holder.region!.value = { id: 'yunnan', shortName: '云南' }
  regionDataStatus.value = {
    requested: null,
    served: null,
    fallback: false,
    mock: false,
    visibility: null,
    accessDenied: null
  }
  deniedCaptureFamilies.value = []
}

beforeEach(resetStatus)

describe('RegionDataBanner 四态互斥（Epic #1702 P1）', () => {
  it('不传 families → 即便 accessDenied 置位也永不显无权限态（opt-in 契约 #520）', () => {
    regionDataStatus.value.accessDenied = 403
    const wrapper = mount(RegionDataBanner) // 不传 families（公共页面）
    expect(wrapper.text()).not.toContain('无权查看')
  })

  it('声明的私有 family 被授权闸门拒 → 显公司私有·无权，优先级最高不堆叠 Mock', () => {
    regionDataStatus.value.accessDenied = 403
    regionDataStatus.value.mock = true // 试图堆叠
    deniedCaptureFamilies.value = ['capA']
    const wrapper = mount(RegionDataBanner, { props: { families: ['capA'] } })
    expect(wrapper.text()).toContain('无权查看')
    expect(wrapper.text()).not.toContain('模拟数据') // 优先级压制，不堆叠
  })

  it('演示地区压制 Mock/回退堆叠（只渲染一个演示横幅）', () => {
    holder.region!.value = { id: 'guangdong', shortName: '广东' } // 非真实地区 → 演示
    regionDataStatus.value.mock = true
    regionDataStatus.value.fallback = true
    const wrapper = mount(RegionDataBanner)
    expect(wrapper.text()).toContain('演示地区')
    expect(wrapper.findAll('.region-data-banner')).toHaveLength(1) // 不堆叠
  })

  it('真实地区 + 接口级 mock(x-data-mock) → 诚实显模拟数据（#348 P1）', () => {
    regionDataStatus.value.mock = true
    regionDataStatus.value.fallback = false
    const wrapper = mount(RegionDataBanner)
    expect(wrapper.text()).toContain('模拟数据')
  })

  it('真实地区 + 基线回退 → 显山西基线数据提示', () => {
    regionDataStatus.value.fallback = true
    regionDataStatus.value.mock = false
    const wrapper = mount(RegionDataBanner)
    expect(wrapper.text()).toContain('基线数据')
    expect(wrapper.text()).toContain('山西') // baselineLabel = getRegionById('shanxi').shortName
  })

  it('四态全空 → 不渲染任何横幅（默认静默）', () => {
    const wrapper = mount(RegionDataBanner)
    expect(wrapper.findAll('.region-data-banner')).toHaveLength(0)
  })
})
