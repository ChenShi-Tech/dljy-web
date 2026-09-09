import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlantCatalogPanel from './PlantCatalogPanel.vue'
import type { GridGeoPlant } from './types'

type Loc = GridGeoPlant['location']

function location(overrides: Partial<Loc> = {}): Loc {
  return {
    longitude: 101, latitude: 25, coordinateSystem: 'WGS84', locationLabel: '楚雄州双柏县',
    accuracyLevel: 'site', confidence: 'verified', uncertaintyMeters: 0,
    displayPolicy: 'exact-marker', coordinateSource: null, evidence: [],
    ...overrides,
  } as Loc
}

function plant(plantId: string, standardName: string, overrides: Partial<GridGeoPlant> = {}): GridGeoPlant {
  return {
    plantId, standardName, plantType: 'solar', aliases: [], capacityMw: null,
    nodeRefs: [], status: 'operating', location: location(), ...overrides,
  } as GridGeoPlant
}

const PLANTS = [
  plant('p1', '110kV金牛山风电场', { plantType: 'wind', aliases: ['金牛山'] }),
  plant('p2', '220kV银鹭光伏电站'),
]

function setKeyword(wrapper: ReturnType<typeof mount>, value: string) {
  return wrapper.find('.search-box input').setValue(value)
}

describe('PlantCatalogPanel', () => {
  it('挂载即把初始集合交给宿主——否则首屏地图是空的', () => {
    const wrapper = mount(PlantCatalogPanel, { props: { plants: PLANTS } })
    const emitted = wrapper.emitted('update:filtered')
    expect(emitted?.[0]?.[0]).toHaveLength(2)
  })

  it('检索后把收窄的集合交回宿主', async () => {
    const wrapper = mount(PlantCatalogPanel, { props: { plants: PLANTS } })
    await setKeyword(wrapper, '金牛山')
    const emitted = wrapper.emitted('update:filtered')
    expect((emitted?.at(-1)?.[0] as GridGeoPlant[]).map((item) => item.plantId)).toEqual(['p1'])
  })

  /**
   * 选中项被筛掉时必须通知宿主。不通知的话，驾驶舱地图上会一直高亮着一个列表里找不到、
   * 图上也不再绘制的「幽灵资产」，浮动卡还开着它的详情。
   */
  it('筛选排除掉当前选中项时通知宿主', async () => {
    const wrapper = mount(PlantCatalogPanel, { props: { plants: PLANTS, selectedPlantId: 'p2' } })
    expect(wrapper.emitted('selection-filtered-out')).toBeUndefined()
    await setKeyword(wrapper, '金牛山')
    expect(wrapper.emitted('selection-filtered-out')).toHaveLength(1)
  })

  it('选中项仍在结果里时不通知', async () => {
    const wrapper = mount(PlantCatalogPanel, { props: { plants: PLANTS, selectedPlantId: 'p1' } })
    await setKeyword(wrapper, '金牛山')
    expect(wrapper.emitted('selection-filtered-out')).toBeUndefined()
  })

  it('没有选中项时不会误报', async () => {
    const wrapper = mount(PlantCatalogPanel, { props: { plants: PLANTS } })
    await setKeyword(wrapper, '不存在的电站')
    expect(wrapper.emitted('selection-filtered-out')).toBeUndefined()
  })

  it('点条目向宿主上报选中的电厂', async () => {
    const wrapper = mount(PlantCatalogPanel, { props: { plants: PLANTS } })
    await wrapper.findAll('.asset-item')[1].trigger('click')
    expect((wrapper.emitted('select')?.[0]?.[0] as GridGeoPlant).plantId).toBe('p2')
  })

  it('嵌入态交出外壳，浮动态保留玻璃面板', () => {
    const embedded = mount(PlantCatalogPanel, { props: { plants: PLANTS, variant: 'embedded' } })
    expect(embedded.find('.asset-panel').classes()).toContain('embedded')
    expect(embedded.find('.asset-panel').classes()).not.toContain('glass-panel')
    const floating = mount(PlantCatalogPanel, { props: { plants: PLANTS } })
    expect(floating.find('.asset-panel').classes()).toContain('glass-panel')
  })
})
