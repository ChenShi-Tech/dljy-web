import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CgnYunnanPriceStatus from './CgnYunnanPriceStatus.vue'
import type { CgnYunnanPriceBundle } from '@/services/market/cgnYunnanLivePrice'

function bundle(overrides: Partial<CgnYunnanPriceBundle> = {}): CgnYunnanPriceBundle {
  return {
    date: '2026-08-05', unit: 'CNY/MWh', availability: 'complete', freshness: 'fresh',
    latestAt: '2026-08-05T04:00:00Z', ageSeconds: 60, staleAfterSeconds: 1800,
    source: {
      sourceInstanceId: 'cgn-yunnan-data-api-v1', displayName: '云南电力数据 API v1',
      ownerGroupId: 'comp-cgn-yunnan', companyId: 'comp-cgn-yunnan', regionId: 'yunnan',
      subjectId: 'GENERATOR-YN-CGN', officialGridApi: false, transport: 'HTTPS_POLLING', updatedAt: null
    },
    node: { dayAhead: [], realTime: [], snapshots: { total: 7, limited: 7, items: [] } },
    plants: { total: 3, items: [] },
    monitor: {
      spreadThreshold: 80, series: [], alerts: [],
      peakValley: { avg_price: { peak: null, flat: null, valley: null }, peak_valley_spread: null, spread_ratio: null }
    },
    ...overrides
  }
}

describe('CgnYunnanPriceStatus', () => {
  it('明确展示厂侧 PG、非电网官方、完整性与绑定覆盖', () => {
    const wrapper = mount(CgnYunnanPriceStatus, { props: { bundle: bundle() } })
    expect(wrapper.text()).toContain('厂侧 PostgreSQL')
    expect(wrapper.text()).toContain('非电网官方接口')
    expect(wrapper.text()).toContain('日前/实时完整')
    expect(wrapper.text()).toContain('节点 7 · 场站价 3')
  })

  it('过期/部分缺失必须可见，不能仍显示数据新鲜', () => {
    const wrapper = mount(CgnYunnanPriceStatus, {
      props: { bundle: bundle({ availability: 'partial', freshness: 'stale' }) }
    })
    expect(wrapper.text()).toContain('日前/实时部分缺失')
    expect(wrapper.text()).toContain('数据已过期')
    expect(wrapper.text()).not.toContain('数据新鲜')
  })

  it('无 bundle 时不渲染来源，避免残留上一账号状态', () => {
    const wrapper = mount(CgnYunnanPriceStatus, { props: { bundle: null } })
    expect(wrapper.text()).toBe('')
  })
})
