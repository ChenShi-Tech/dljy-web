// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；regionContext/
//   companyContext 顶层要读 window/localStorage，useRoute/useRouter 也要真实挂载上下文。
// useInsightContext.spec.ts — 洞察统一查询上下文回归（dljy#2996 任务 5.4）
// 守什么不变量：
//   ① 进页面按 query 还原（start/end/objects/sources），编码对象名往返不丢；
//   ② 非法参数（坏日期 / 坏编码）丢弃并提示「已忽略不合法参数：…」，不带口径不明的条件查询；
//   ③ 字段变化用 replace 写回地址（可分享、可后退），不产生历史堆积；
//   ④ 地区/公司变化清空对象（对象属于原地区/公司），日期保留；contextVersion 随变化递增；
//   ⑤ 默认窗口为北京时间当日，不自动跳到「有数据的日子」；
//   ⑥ toQueryContext 不带 objectIds（由调用方放 filters）、能过契约校验。
// 真 router（createMemoryHistory + 挂载），不 mock vue-router。
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { beijingToday } from 'shared/midlong/dates.mjs'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { useInsightContext, type InsightContextState } from './useInsightContext'

let router: Router

beforeEach(async () => {
  localStorage.clear()
  selectedRegionId.value = 'yunnan'
  selectedCompanyId.value = 'c1'
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')
})

afterEach(() => {
  selectedRegionId.value = 'yunnan'
  selectedCompanyId.value = 'c1'
})

/** 在组件 setup 内创建上下文（useRoute/useRouter 依赖注入），返回状态句柄。 */
function mountContext(): InsightContextState {
  // 普通变量存句柄：包在 ref() 里会把返回对象内部的 ref 属性深层解包，状态访问会错位。
  let handle: InsightContextState | null = null
  const Comp = defineComponent({
    setup() {
      handle = useInsightContext()
      return () => h('div')
    },
  })
  mount(Comp, { global: { plugins: [router] } })
  return handle!
}

describe('进页面按 query 还原', () => {
  it('合法 start/end/objects/sources 全部还原；对象标识含需编码字符（/）往返不丢', async () => {
    await router.push({
      path: '/',
      query: {
        start: '2026-09-01',
        end: '2026-09-05',
        objects: encodeURIComponent('YN.KM/01'),
        sources: 'yn.price.node.public.day-ahead',
      },
    })

    const state = mountContext()

    expect(state.businessWindow.value).toEqual({ start: '2026-09-01', end: '2026-09-05' })
    expect(state.objectIds.value).toEqual(['YN.KM/01'])
    expect(state.sourceIds.value).toEqual(['yn.price.node.public.day-ahead'])
    expect(state.ignoredParamsNotice.value).toBeNull()
  })

  it('契约外的对象标识（中文节点名不是合法对象 id）按非法参数丢弃', async () => {
    await router.push({ path: '/', query: { objects: encodeURIComponent('昆明节点') } })

    const state = mountContext()

    expect(state.objectIds.value).toEqual([])
    expect(state.ignoredParamsNotice.value).toContain('objects')
  })

  it('无参数时默认窗口为北京时间当日，不自动跳到有数据的日子', () => {
    const state = mountContext()
    const today = beijingToday()
    expect(state.businessWindow.value).toEqual({ start: today, end: today })
  })

  it('非法日期窗丢弃并提示；状态回落默认当日', async () => {
    await router.push({ path: '/', query: { start: '2026-13-99', end: '2026-09-05' } })

    const state = mountContext()

    const today = beijingToday()
    expect(state.businessWindow.value).toEqual({ start: today, end: today })
    expect(state.ignoredParamsNotice.value).toContain('已忽略不合法参数')
    expect(state.ignoredParamsNotice.value).toContain('start')
  })

  it('坏百分号编码的 objects 丢弃并提示，不带口径不明的对象查询', async () => {
    await router.push({ path: '/', query: { objects: '%E6%98' } })

    const state = mountContext()

    expect(state.objectIds.value).toEqual([])
    expect(state.ignoredParamsNotice.value).toContain('objects')
  })
})

describe('字段变化写回地址', () => {
  it('setBusinessWindow 后 query 更新（replace 不入历史），query 里其它键保留', async () => {
    await router.push({ path: '/', query: { view: 'detail' } })
    const state = mountContext()

    state.setBusinessWindow('2026-09-01', '2026-09-02')
    await flushPromises()
    await nextTick()

    expect(router.currentRoute.value.query.start).toBe('2026-09-01')
    expect(router.currentRoute.value.query.end).toBe('2026-09-02')
    expect(router.currentRoute.value.query.view).toBe('detail')
  })

  it('对象与来源写回为逗号分隔编码串，清空后删键', async () => {
    const state = mountContext()

    state.setObjectIds(['YN.KM/01', 'YN.QJ.02'])
    state.setSourceIds(['yn.price.node.public.day-ahead', 'yn.system.load.actual'])
    await flushPromises()
    await nextTick()

    const query = router.currentRoute.value.query
    expect(query.objects).toBe(`${encodeURIComponent('YN.KM/01')},${encodeURIComponent('YN.QJ.02')}`)
    expect(query.sources).toBe('yn.price.node.public.day-ahead,yn.system.load.actual')

    state.setObjectIds([])
    state.setSourceIds([])
    await flushPromises()
    await nextTick()
    expect(router.currentRoute.value.query.objects).toBeUndefined()
    expect(router.currentRoute.value.query.sources).toBeUndefined()
  })
})

describe('地区 / 公司变化与代次', () => {
  it('地区变化清空对象、保留日期，contextVersion 递增', async () => {
    const state = mountContext()
    state.setBusinessWindow('2026-09-01', '2026-09-03')
    state.setObjectIds(['YN.KM.01'])
    await flushPromises()
    const versionBefore = state.contextVersion.value

    selectedRegionId.value = 'guangdong'
    await flushPromises()
    await nextTick()

    expect(state.objectIds.value).toEqual([])
    expect(state.businessWindow.value).toEqual({ start: '2026-09-01', end: '2026-09-03' })
    expect(state.contextVersion.value).toBeGreaterThan(versionBefore)
  })

  it('公司变化同样清空对象', async () => {
    const state = mountContext()
    state.setObjectIds(['YN.KM.01'])
    await flushPromises()

    selectedCompanyId.value = 'c2'
    await flushPromises()
    await nextTick()

    expect(state.objectIds.value).toEqual([])
  })
})

describe('toQueryContext', () => {
  it('生成可过契约校验的 context；objectIds 不进 context（由调用方放 filters）', () => {
    const state = mountContext()
    state.setObjectIds(['YN.KM.01'])
    state.setSourceIds(['yn.price.node.public.day-ahead'])

    const context = state.toQueryContext()

    expect(context.regionId).toBe('yunnan')
    expect(context.companyId).toBe('c1')
    expect(context.businessWindow).toMatchObject({ start: beijingToday(), end: beijingToday(), timeZone: 'Asia/Shanghai' })
    expect(context.sourceIds).toEqual(['yn.price.node.public.day-ahead'])
    expect('objectRefs' in context ? context.objectRefs : []).toEqual([])
    // 自己校验自己：非法状态会在内部抛 InsightContractError，能返回即合法。
    expect(context.contextVersion).toBe(state.contextVersion.value)
  })
})

describe('下钻恢复（dljy#3087 任务 15.1，可选入口）', () => {
  it('URL 带下钻参数：四键照常还原（四键语义为准），hx_ 扩展字段进 drilldownRestore，无提示', async () => {
    await router.push({
      path: '/',
      query: {
        start: '2026-09-17',
        end: '2026-09-18',
        objects: encodeURIComponent('YN.KM/01'),
        hx_priceObject: 'user-price',
        hx_marketPhase: 'day-ahead',
        hx_view: 'spread',
        hx_from: 'overview',
      },
    })

    const state = mountContext()

    expect(state.businessWindow.value).toEqual({ start: '2026-09-17', end: '2026-09-18' })
    expect(state.objectIds.value).toEqual(['YN.KM/01'])
    expect(state.drilldownRestore.value).toEqual({ from: 'overview', view: 'spread', priceObject: 'user-price', marketPhase: 'day-ahead' })
    expect(state.ignoredParamsNotice.value).toBeNull()
  })

  it('非法 hx_view 丢弃并进一次性提示；合法扩展字段照常还原（不支持字段明确提示）', async () => {
    await router.push({
      path: '/',
      query: { start: '2026-09-17', end: '2026-09-18', hx_view: 'nope', hx_priceObject: 'user-price', hx_from: 'prices' },
    })

    const state = mountContext()

    expect(state.drilldownRestore.value).toEqual({ from: 'prices', view: null, priceObject: 'user-price', marketPhase: null })
    expect(state.ignoredParamsNotice.value).toContain('已忽略不合法参数')
    expect(state.ignoredParamsNotice.value).toContain('hx_view')
  })

  it('URL 不带下钻参数：drilldownRestore 为 null，行为与既有完全一致', () => {
    const state = mountContext()

    expect(state.drilldownRestore.value).toBeNull()
    expect(state.ignoredParamsNotice.value).toBeNull()
  })
})
