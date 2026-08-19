// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；store 经
//   regionContext 读/写 localStorage（地区上下文），靠此 pragma 按文件切到 happy-dom。
// stores/capturedData.spec.ts — 只读回放缓存 store 回归（Phase 0）
// 守什么不变量：
//   ① 同 family|match|region 键：缓存命中不二次请求、并发 inflight 合流只发一次
//      坏掉的症状是 sdpt_zcqxhdl 等 family 被 5+ 页各自重复取数（本 store 的立身之本）。
//   ② force 绕过缓存重取并更新缓存；失败向上抛、不污染缓存、inflight 已清可立即重试。
//   ③ 地区隔离：缓存键含地区维度，切区即清 cache+inflight，旧地区数据不可复用。
// 坏掉的症状：切区后页面显示他省回放数据；网络面板同一族重复请求。

// 分层：fetchCaptured 整层 vi.mock（只测 store 编排，回放层自有 spec）；regionContext
// 走真实模块，切区用真实 setCurrentRegionId 触发，验证 store watch 挂在真实地区链路上。
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCaptured } from '../services/captured'
import { setCurrentRegionId } from '../services/region/regionContext'
import { useCapturedDataStore } from './capturedData'

vi.mock('../services/captured', () => ({ fetchCaptured: vi.fn() }))

const fetchMock = vi.mocked(fetchCaptured)

/** 受控 deferred：手动 resolve/reject，精确观察挂起期间切区的时序。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useCapturedDataStore · loadCaptured 缓存与去重', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan') // 归位（上一用例可能已切区）
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('首次取数走 fetchCaptured 并写缓存', async () => {
    fetchMock.mockResolvedValueOnce('rows-a' as never)
    const store = useCapturedDataStore()

    await expect(store.loadCaptured('sdpt_zcqxhdl', 'match1')).resolves.toBe('rows-a')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('sdpt_zcqxhdl', 'match1')
    expect(store.has('sdpt_zcqxhdl', 'match1')).toBe(true)
  })

  it('缓存命中：第二次同键取数不再发请求，返回同一份数据', async () => {
    fetchMock.mockResolvedValueOnce('rows-a' as never)
    const store = useCapturedDataStore()
    await store.loadCaptured('fam', 'm')

    await expect(store.loadCaptured('fam', 'm')).resolves.toBe('rows-a') // 同引用（缓存共享对象，现行为）

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('不同 family / match 各成键：互不命中缓存', async () => {
    fetchMock.mockResolvedValueOnce('a' as never).mockResolvedValueOnce('b' as never)
    const store = useCapturedDataStore()

    await store.loadCaptured('fam', 'm1')
    await store.loadCaptured('fam', 'm2') // match 不同 ⇒ 新键
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await store.loadCaptured('fam', 'm1') // 命中缓存
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.has('fam', 'm1')).toBe(true)
    expect(store.has('fam', 'nope')).toBe(false)
  })

  it('并发同键 inflight 合流：两次 loadCaptured 只发一次请求', async () => {
    const d = deferred<unknown>()
    fetchMock.mockImplementation(() => d.promise as never)
    const store = useCapturedDataStore()

    const p1 = store.loadCaptured('fam', 'm')
    const p2 = store.loadCaptured('fam', 'm')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    d.resolve('shared')
    await expect(p1).resolves.toBe('shared')
    await expect(p2).resolves.toBe('shared')
    expect(store.cache.size).toBe(1)
  })

  it('force 绕过缓存：重发请求并以新数据更新缓存', async () => {
    fetchMock.mockResolvedValueOnce('v1' as never)
    const store = useCapturedDataStore()
    await store.loadCaptured('fam', 'm')

    fetchMock.mockResolvedValueOnce('v2' as never)
    await expect(store.loadCaptured('fam', 'm', true)).resolves.toBe('v2')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(store.loadCaptured('fam', 'm')).resolves.toBe('v2') // 缓存已被 force 刷新
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('失败：向上抛、不污染缓存、inflight 已清（可立即重试）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('replay down'))
    const store = useCapturedDataStore()

    await expect(store.loadCaptured('fam')).rejects.toThrow('replay down')
    expect(store.has('fam')).toBe(false)

    fetchMock.mockResolvedValueOnce('recovered' as never)
    await expect(store.loadCaptured('fam')).resolves.toBe('recovered') // 未合流到已失败的 inflight
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('useCapturedDataStore · drop / invalidate / has', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('drop：只删单键，不影响同地区其它 family', async () => {
    fetchMock.mockResolvedValueOnce('a' as never).mockResolvedValueOnce('b' as never)
    const store = useCapturedDataStore()
    await store.loadCaptured('fam-a', 'm')
    await store.loadCaptured('fam-b', 'm')

    store.drop('fam-a', 'm')

    expect(store.has('fam-a', 'm')).toBe(false)
    expect(store.has('fam-b', 'm')).toBe(true)
    fetchMock.mockResolvedValueOnce('a2' as never)
    await store.loadCaptured('fam-a', 'm') // 被删键重新取数
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('invalidate() 无参：清全部缓存', async () => {
    fetchMock.mockResolvedValue('x' as never)
    const store = useCapturedDataStore()
    await store.loadCaptured('fam-a')
    await store.loadCaptured('fam-b')
    expect(store.cache.size).toBe(2)

    store.invalidate()

    expect(store.cache.size).toBe(0)
    expect(store.has('fam-a')).toBe(false)
  })

  it('invalidate(region)：只清以 |<region> 结尾的键，他区键保留', () => {
    const store = useCapturedDataStore()
    // 正常运行下切区即全清（watch），多区键并存只出现在「挂起请求切区后回写」边界（见下）；
    // 直接构造键，聚焦后缀匹配逻辑本身。
    store.cache.set('famA|m|shanxi', { data: 1, loadedAt: 1, region: 'shanxi' })
    store.cache.set('famB|m2|yunnan', { data: 2, loadedAt: 2, region: 'yunnan' })

    store.invalidate('shanxi')

    expect([...store.cache.keys()]).toEqual(['famB|m2|yunnan'])
  })
})

describe('useCapturedDataStore · 切区失效', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('切区清空 cache 与 inflight：切回同地区后同键重新发请求（不复用旧挂起合流）', async () => {
    const d1 = deferred<unknown>()
    fetchMock.mockImplementation(() => d1.promise as never)
    const store = useCapturedDataStore()
    const p1 = store.loadCaptured('fam', 'm') // yunnan 键挂起
    expect(fetchMock).toHaveBeenCalledTimes(1)

    setCurrentRegionId('shanxi')
    await nextTick() // store 切区 watch flush
    expect(store.cache.size).toBe(0)

    setCurrentRegionId('yunnan')
    await nextTick()
    const d2 = deferred<unknown>()
    fetchMock.mockImplementation(() => d2.promise as never)
    const p2 = store.loadCaptured('fam', 'm') // 若 inflight 未被切区 watch 清掉，这里会复用 p1 不发新请求
    expect(fetchMock).toHaveBeenCalledTimes(2)

    d1.resolve('stale')
    d2.resolve('fresh')
    await Promise.all([p1, p2])
  })

  it('现行为记录：切区后挂起请求 resolve 仍回写旧地区键（无 analysisData 式切区守卫）', async () => {
    const d = deferred<unknown>()
    fetchMock.mockImplementation(() => d.promise as never)
    const store = useCapturedDataStore()
    const p = store.loadCaptured('fam', 'm') // key: fam|m|yunnan

    setCurrentRegionId('shanxi')
    await nextTick()
    expect(store.cache.size).toBe(0)

    d.resolve('stale-yunnan')
    await p

    // 回写发生：键仍是旧地区（fam|m|yunnan），但 region 字段记的是 resolve 时刻的当前
    // 地区（shanxi），键与 region 不一致。旧键不会被当前地区命中（键含地区后缀），危害
    // 有限；若未来加 analysisData 式守卫（resolve 时地区已变则不写缓存），此处断言需改为
    // cache.size === 0。
    const entry = store.cache.get('fam|m|yunnan')
    expect(entry?.data).toBe('stale-yunnan')
    expect(entry?.region).toBe('shanxi')
  })
})
