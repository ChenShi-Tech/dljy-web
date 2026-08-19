// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；useRoute/
//   useRouter 需要真实 vue-router 实例 + 组件挂载上下文，靠此 pragma 按文件切 happy-dom。
// composables/useQuerySync.spec.ts — 筛选条件 ⇄ 路由 query 双向同步回归
// 守什么不变量：
//   ① 进页面按 query 还原筛选（「刷新/分享链接后筛选状态可还原」的立身之本）：
//      按各 ref 初始类型反序列化（number 取有限数字、boolean 只认 '1'/'true'）。
//   ② 变更写回 query 用 replace；boolean 序列化为 '1'/'0'；空字符串从 query 删键。
//   ③ 同步只碰声明的字段，query 里其它键（别的视图/入口写入）必须原样保留。
// 坏掉的症状：分享链接打开后筛选错乱；切一次筛选把 URL 里别人的参数洗掉。
//
// 真 router：createRouter + createMemoryHistory + 组件挂载（useRoute/useRouter 走真实
// provide/inject 链），不 mock vue-router，初始还原与 replace 写回都在真导航管线里验证。
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuerySync, type QuerySyncValue } from './useQuerySync'

let router: Router

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }]
  })
  // 先 push('/') 完成首次导航，只 createRouter 不导航时 isReady() 永远 pending。
  await router.push('/')
})

/** 把 fields 挂进组件 setup（useQuerySync 需组件上下文取 route/router），返回 wrapper。 */
function mountSync(fields: Record<string, Ref<QuerySyncValue>>) {
  const Comp = defineComponent({
    setup() {
      useQuerySync(fields)
      return () => h('div')
    }
  })
  return mount(Comp, { global: { plugins: [router] } })
}

describe('useQuerySync · 进页面按 query 还原', () => {
  it('string 字段：query 值原样还原', async () => {
    await router.push({ path: '/', query: { date: '2026-06-01' } })
    const date = ref('2026-05-01')

    mountSync({ date })

    expect(date.value).toBe('2026-06-01')
  })

  it('number 字段：还原为有限数字且类型为 number', async () => {
    await router.push({ path: '/', query: { days: '42' } })
    const days = ref(30)

    mountSync({ days })

    expect(days.value).toBe(42)
    expect(typeof days.value).toBe('number')
  })

  it('number 字段负例：非有限数字（abc）保留默认值', async () => {
    await router.push({ path: '/', query: { days: 'abc' } })
    const days = ref(30)

    mountSync({ days })

    expect(days.value).toBe(30)
  })

  it('boolean 字段：只认 1/true 为真，其余（0/false/其它串）为假', async () => {
    await router.push({ path: '/', query: { a: '1', b: 'true', c: '0', d: 'yes' } })
    const a = ref(false)
    const b = ref(false)
    const c = ref(true)
    const d = ref(true)

    mountSync({ a, b, c, d })

    expect(a.value).toBe(true)
    expect(b.value).toBe(true)
    expect(c.value).toBe(false)
    expect(d.value).toBe(false)
  })

  it('空字符串与数组形 query 跳过，保留默认值', async () => {
    await router.push({ path: '/', query: { date: '', tags: ['x', 'y'] } })
    const date = ref('2026-05-01')
    const tags = ref('none')

    mountSync({ date, tags })

    expect(date.value).toBe('2026-05-01')
    expect(tags.value).toBe('none')
  })
})

describe('useQuerySync · 变更写回 query', () => {
  it('string/number 变更写回（number 序列化为字符串）', async () => {
    const date = ref('2026-05-01')
    const days = ref(30)
    mountSync({ date, days })

    date.value = '2026-06-02'
    days.value = 7

    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toMatchObject({ date: '2026-06-02', days: '7' })
    })
  })

  it('boolean 序列化：true→1 / false→0', async () => {
    const flag = ref(false)
    mountSync({ flag })

    flag.value = true
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toMatchObject({ flag: '1' })
    })

    flag.value = false
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toMatchObject({ flag: '0' })
    })
  })

  it('空字符串从 query 删除该键', async () => {
    const date = ref('2026-05-01')
    mountSync({ date })

    date.value = ''
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).not.toHaveProperty('date')
    })
  })

  it('写回保留 query 中非同步键（不洗掉别人的参数）', async () => {
    await router.push({ path: '/', query: { keep: 'me', from: 'panel' } })
    const date = ref('2026-05-01')
    mountSync({ date })

    date.value = '2026-06-02'
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toMatchObject({ keep: 'me', from: 'panel', date: '2026-06-02' })
    })
  })

  it('往返闭环：写回后的 query 能还原出同值筛选（分享链接场景）', async () => {
    const date = ref('2026-05-01')
    const days = ref(30)
    const flag = ref(false)
    mountSync({ date, days, flag })

    date.value = '2026-06-02'
    days.value = 7
    flag.value = true
    await vi.waitFor(() => {
      expect(router.currentRoute.value.query).toMatchObject({ date: '2026-06-02', days: '7', flag: '1' })
    })
    // 不 unmount w1：vue-router 在最后一个安装它的 app 卸载时会把 currentRoute 重置回
    // START_LOCATION（query 清空），那是 router 的生命周期行为，会污染本用例的观察窗口。
    // 两个组件并存不影响验证：restore 只在各自 setup 时同步执行一次。

    // 模拟「刷新后重新进页面」：新 ref 组从写回后的 query 还原
    const date2 = ref('2026-05-01')
    const days2 = ref(30)
    const flag2 = ref(false)
    mountSync({ date: date2, days: days2, flag: flag2 })

    expect(date2.value).toBe('2026-06-02')
    expect(days2.value).toBe(7)
    expect(flag2.value).toBe(true)
  })
})
