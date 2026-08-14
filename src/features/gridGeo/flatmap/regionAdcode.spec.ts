import { describe, expect, it } from 'vitest'
import { requiredProvincialRegionIds } from '@/data/regions'
import {
  ADCODE_WITHOUT_SUBDIVISIONS,
  MAPPED_REGION_IDS,
  REGION_ADCODE,
  adcodeForRegion,
  findRegionsMissingAdcode,
  hasSubdivisions,
  regionForAdcode,
} from './regionAdcode'

describe('regionAdcode', () => {
  it('covers every provincial region declared in regions.ts', () => {
    expect(findRegionsMissingAdcode()).toEqual([])
    expect(MAPPED_REGION_IDS.length).toBe(requiredProvincialRegionIds.length)
  })

  it('maps region id to adcode and back', () => {
    expect(adcodeForRegion('yunnan')).toBe('530000')
    expect(adcodeForRegion('shanxi')).toBe('140000')
    expect(regionForAdcode('530000')).toBe('yunnan')
    expect(regionForAdcode('140000')).toBe('shanxi')
  })

  it('returns null for template regions instead of falling back to another province', () => {
    // 地区隔离纪律：模板地区没有对应行政区，必须降级为空，不得串读他省地图。
    for (const templateRegion of ['generic', 'state-grid', 'china-southern-grid', 'generic-sgcc-spot']) {
      expect(adcodeForRegion(templateRegion)).toBeNull()
    }
    expect(adcodeForRegion(null)).toBeNull()
    expect(adcodeForRegion(undefined)).toBeNull()
    expect(adcodeForRegion('')).toBeNull()
    expect(regionForAdcode('999999')).toBeNull()
  })

  it('has no duplicated adcode', () => {
    const adcodes = Object.values(REGION_ADCODE)
    expect(new Set(adcodes).size).toBe(adcodes.length)
  })

  it('flags taiwan as having no subdivision data', () => {
    // DataV 对台湾只提供本级面（无 _full），因此其地图不可下钻到地市。
    expect(ADCODE_WITHOUT_SUBDIVISIONS.has('710000')).toBe(true)
    expect(hasSubdivisions('taiwan')).toBe(false)
    expect(hasSubdivisions('yunnan')).toBe(true)
    expect(hasSubdivisions('generic')).toBe(false)
  })
})
