import { describe, expect, it } from 'vitest'

import { filterPlantCatalog } from './plantCatalog'
import type { GridGeoPlant } from './types'

type Loc = GridGeoPlant['location']

function location(overrides: Partial<Loc> = {}): Loc {
  return {
    longitude: 101,
    latitude: 25,
    coordinateSystem: 'WGS84',
    locationLabel: '楚雄州双柏县',
    accuracyLevel: 'site',
    confidence: 'verified',
    uncertaintyMeters: 0,
    displayPolicy: 'exact-marker',
    coordinateSource: null,
    evidence: [],
    ...overrides,
  } as Loc
}

function plant(overrides: Partial<GridGeoPlant> & { plantId: string; standardName: string }): GridGeoPlant {
  return {
    plantType: 'solar',
    aliases: [],
    capacityMw: null,
    nodeRefs: [],
    status: 'operating',
    location: location(),
    ...overrides,
  } as GridGeoPlant
}

const CATALOG = [
  plant({
    plantId: 'p1',
    standardName: '110kV金牛山风电场',
    plantType: 'wind',
    aliases: ['金牛山'],
    location: location({ longitude: 104, latitude: 26, locationLabel: '曲靖市宣威市田坝镇' }),
    nodeRefs: [{ nodeName: '220kV平川变', relationType: 'pricing' }],
  }),
  plant({
    plantId: 'p2',
    standardName: '220kV银鹭光伏电站',
    location: location({ longitude: 100, latitude: 26, confidence: 'probable', locationLabel: '大理州洱源县右所镇' }),
  }),
  plant({
    plantId: 'p3',
    standardName: '三道景风电',
    plantType: 'wind',
    location: location({ confidence: 'unverified', locationLabel: '楚雄州姚安县仁和村' }),
  }),
]

describe('filterPlantCatalog', () => {
  it('无筛选条件时原样返回', () => {
    expect(filterPlantCatalog(CATALOG).map((item) => item.plantId)).toEqual(['p1', 'p2', 'p3'])
  })

  it('按机组类型筛选', () => {
    expect(filterPlantCatalog(CATALOG, { type: 'wind' }).map((item) => item.plantId)).toEqual(['p1', 'p3'])
    expect(filterPlantCatalog(CATALOG, { type: 'solar' }).map((item) => item.plantId)).toEqual(['p2'])
  })

  it('按定位置信度筛选', () => {
    expect(filterPlantCatalog(CATALOG, { confidence: 'probable' }).map((item) => item.plantId)).toEqual(['p2'])
  })

  /**
   * 检索必须覆盖别名与节点名：交易员记住的往往不是标准名——他记得「金牛山」或
   * 「平川变」，标准名却是「110kV金牛山风电场」。只搜标准名等于这个框一半时间没用。
   */
  it('别名可检索', () => {
    expect(filterPlantCatalog(CATALOG, { keyword: '金牛山' }).map((item) => item.plantId)).toEqual(['p1'])
  })

  it('绑定节点名可检索', () => {
    expect(filterPlantCatalog(CATALOG, { keyword: '平川变' }).map((item) => item.plantId)).toEqual(['p1'])
  })

  it('行政区位可检索', () => {
    expect(filterPlantCatalog(CATALOG, { keyword: '洱源' }).map((item) => item.plantId)).toEqual(['p2'])
  })

  it('大小写不敏感，且两种写法结果完全一致', () => {
    const upper = filterPlantCatalog(CATALOG, { keyword: '220KV' }).map((item) => item.plantId)
    const lower = filterPlantCatalog(CATALOG, { keyword: '220kv' }).map((item) => item.plantId)
    expect(upper).toEqual(lower)
    // p2 由标准名命中，p1 由节点名「220kV平川变」命中——命中两条正是节点名参与检索的证据
    expect(upper).toEqual(['p1', 'p2'])
  })

  it('首尾空白不影响匹配，纯空白等同无关键词', () => {
    expect(filterPlantCatalog(CATALOG, { keyword: '  金牛山  ' }).map((item) => item.plantId)).toEqual(['p1'])
    expect(filterPlantCatalog(CATALOG, { keyword: '   ' })).toHaveLength(3)
  })

  it('多条件同时生效，取交集', () => {
    expect(filterPlantCatalog(CATALOG, { keyword: '楚雄', type: 'wind' }).map((item) => item.plantId)).toEqual(['p3'])
    expect(filterPlantCatalog(CATALOG, { keyword: '楚雄', type: 'solar' })).toHaveLength(0)
  })

  it('无匹配时返回空数组而不是全量', () => {
    expect(filterPlantCatalog(CATALOG, { keyword: '不存在的电站' })).toHaveLength(0)
  })

  it('不修改入参数组', () => {
    const before = CATALOG.map((item) => item.plantId)
    filterPlantCatalog(CATALOG, { type: 'wind' })
    expect(CATALOG.map((item) => item.plantId)).toEqual(before)
  })
})
