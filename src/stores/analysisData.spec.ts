// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；store 经
//   regionContext 读/写 localStorage（地区上下文），靠此 pragma 按文件切到 happy-dom。
// stores/analysisData.spec.ts — 分析用户产物 store 回归（Phase 6 PR-B）
// 守什么不变量：
//   ① 用户产物按 (company, region) 隔离，切区即清空三列表 + inflight；请求挂起期间
//      切区，旧地区响应 resolve 后不得写入（源码切区守卫，防「我的视图」抽屉串区）。
//   ② loadViews inflight 去重：同 routePath+地区 并发只发一次 /api/v1/analysis/views，
//      且两次调用合流同一 Promise。
//   ③ saveView/saveSnapshot/saveAnnotation 置顶 + 同 id 去重，列表永不出现重复条目。
// 坏掉的症状：抽屉里出现他省视图/快照/标注；快速双开面板重复打后端；保存后列表重复。
//
// 分层：analysisClient 整层 vi.mock（只测 store 编排）；regionContext 走真实模块
// 切区用真实 setCurrentRegionId 动作触发，连带验证 store watch 挂在真实地区链路上。
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentRegionId } from '../services/region/regionContext'
import * as analysisClient from '../services/analysisClient'
import type { AnalysisAnnotation, AnalysisSnapshot, AnalysisView } from '../services/analysisClient'
import { useAnalysisStore } from './analysisData'

vi.mock('../services/analysisClient', () => ({
  listViews: vi.fn(),
  saveView: vi.fn(),
  deleteView: vi.fn(),
  listSnapshots: vi.fn(),
  saveSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  listAnnotations: vi.fn(),
  saveAnnotation: vi.fn(),
  deleteAnnotation: vi.fn()
}))

const mocked = {
  listViews: vi.mocked(analysisClient.listViews),
  saveView: vi.mocked(analysisClient.saveView),
  deleteView: vi.mocked(analysisClient.deleteView),
  listSnapshots: vi.mocked(analysisClient.listSnapshots),
  saveSnapshot: vi.mocked(analysisClient.saveSnapshot),
  deleteSnapshot: vi.mocked(analysisClient.deleteSnapshot),
  listAnnotations: vi.mocked(analysisClient.listAnnotations),
  saveAnnotation: vi.mocked(analysisClient.saveAnnotation),
  deleteAnnotation: vi.mocked(analysisClient.deleteAnnotation)
}

/** 受控 deferred：手动 resolve/reject，精确观察「挂起期间切区」的时序。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** AnalysisView 契约字段在 @dljy/contracts（类型侧），此处只构造 store 消费的最小形状。 */
function makeView(viewId: string, overrides: Record<string, unknown> = {}): AnalysisView {
  return {
    viewId,
    name: `视图 ${viewId}`,
    routePath: '/sjfx/zrsjg',
    config: { kind: 'page-state', state: {} },
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  } as unknown as AnalysisView
}

function makeSnapshot(snapshotId: string): AnalysisSnapshot {
  return {
    snapshotId,
    ownerUsername: 'alice',
    companyId: 'comp-cgn-yunnan',
    viewId: null,
    routePath: '/sjfx/zrsjg',
    region: 'yunnan',
    data: { note: '快照' },
    sourceBasis: 'REAL',
    createdAt: '2026-08-01T00:00:00.000Z'
  }
}

function makeAnnotation(annotationId: string): AnalysisAnnotation {
  return {
    annotationId,
    ownerUsername: 'alice',
    companyId: 'comp-cgn-yunnan',
    targetType: 'point',
    targetRef: 'node-a',
    content: '标注内容',
    region: 'yunnan',
    createdAt: '2026-08-01T00:00:00.000Z'
  }
}

describe('useAnalysisStore · loadViews', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan') // 归位（上一用例可能已切区）
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('成功：填充 views，loading 先真后假，error 保持空', async () => {
    const d = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation(() => d.promise)
    const store = useAnalysisStore()

    const p = store.loadViews('/sjfx/zrsjg')
    expect(store.loading).toBe(true)
    d.resolve([makeView('v1'), makeView('v2')])
    await p

    expect(mocked.listViews).toHaveBeenCalledWith('/sjfx/zrsjg')
    expect(store.views.map((v) => v.viewId)).toEqual(['v1', 'v2'])
    expect(store.loading).toBe(false)
    expect(store.error).toBe('')
  })

  it('失败：client 抛 Error → error 记 message、views 清空、loading 复位', async () => {
    mocked.listViews.mockRejectedValue(new Error('后端不可用'))
    const store = useAnalysisStore()

    await store.loadViews()

    expect(store.error).toBe('后端不可用')
    expect(store.views).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('失败（非 Error 抛出值）：error 落默认文案', async () => {
    mocked.listViews.mockRejectedValue('plain string')
    const store = useAnalysisStore()

    await store.loadViews()

    expect(store.error).toBe('加载分析视图失败')
  })

  it('并发去重：同键两次 loadViews 只发一次请求且合流同一 Promise', async () => {
    const d = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation(() => d.promise)
    const store = useAnalysisStore()

    const p1 = store.loadViews()
    const p2 = store.loadViews()

    expect(mocked.listViews).toHaveBeenCalledTimes(1)
    // loadViews 是 async 函数，即使内部 return 同一 inflight Promise，调用方拿到的
    // 也是各自的包装 Promise，「合流」的可观测语义是只发一次请求且两 Promise 均完成。
    d.resolve([makeView('v1')])
    await Promise.all([p1, p2])
    expect(store.views.map((v) => v.viewId)).toEqual(['v1'])
    expect(store.loading).toBe(false)
  })

  it('不同 routePath 不合流：各发各的请求，后完成者覆盖列表', async () => {
    const dA = deferred<AnalysisView[]>()
    const dB = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation((routePath?: string) => (routePath === '/a' ? dA.promise : dB.promise))
    const store = useAnalysisStore()

    const pa = store.loadViews('/a')
    const pb = store.loadViews('/b')

    expect(mocked.listViews).toHaveBeenCalledTimes(2)
    dA.resolve([makeView('a1')])
    dB.resolve([makeView('b1')])
    await Promise.all([pa, pb])
    expect(store.views.map((v) => v.viewId)).toEqual(['b1']) // 两键各写各的，后 resolve 者最终可见
  })

  it('无成功缓存：resolve 后再次 loadViews 重新发请求', async () => {
    mocked.listViews.mockResolvedValue([makeView('v1')])
    const store = useAnalysisStore()

    await store.loadViews()
    await store.loadViews()

    expect(mocked.listViews).toHaveBeenCalledTimes(2)
  })

  it('切区守卫（成功路径）：挂起期间切区，旧地区响应不写入 views', async () => {
    const d = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation(() => d.promise)
    const store = useAnalysisStore()

    const p = store.loadViews()
    setCurrentRegionId('shanxi')
    await nextTick() // store 切区 watch flush（已清空三列表）
    d.resolve([makeView('v1')])
    await p

    expect(store.views).toEqual([]) // 旧地区数据被守卫丢弃，不串区
    // 切区 watch 现已同步复位 loading：在途请求的 finally 只在地区未变时落 false，
    // 若无此复位，「我的视图」抽屉骨架屏会在切区后永久转圈（原卡 true 病灶）。
    expect(store.loading).toBe(false)
  })

  it('切区守卫（失败路径）：挂起期间切区后 reject 不写错误态', async () => {
    const d = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation(() => d.promise)
    const store = useAnalysisStore()

    const p = store.loadViews()
    setCurrentRegionId('shanxi')
    await nextTick()
    d.reject(new Error('network down'))
    await p // store 吞错不 rethrow

    expect(store.error).toBe('')
    expect(store.views).toEqual([])
  })
})

describe('useAnalysisStore · views 写操作', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
    mocked.listViews.mockResolvedValue([makeView('v1'), makeView('v2')])
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('saveView：新视图置顶', async () => {
    const store = useAnalysisStore()
    await store.loadViews()

    const v3 = makeView('v3')
    mocked.saveView.mockResolvedValue(v3)
    await store.saveView('新视图', '/sjfx/zrsjg', v3.config)

    expect(mocked.saveView).toHaveBeenCalledWith({ name: '新视图', routePath: '/sjfx/zrsjg', config: v3.config })
    expect(store.views.map((v) => v.viewId)).toEqual(['v3', 'v1', 'v2'])
  })

  it('saveView：同 viewId 更新去重置顶，列表不出现重复条目', async () => {
    const store = useAnalysisStore()
    await store.loadViews()

    const v2Updated = makeView('v2', { name: '改名后的 v2' })
    mocked.saveView.mockResolvedValue(v2Updated)
    await store.saveView('改名后的 v2', '/sjfx/zrsjg', v2Updated.config)

    expect(store.views.map((v) => v.viewId)).toEqual(['v2', 'v1'])
    expect(store.views[0].name).toBe('改名后的 v2')
  })

  it('deleteView：从列表移除对应条目', async () => {
    mocked.deleteView.mockResolvedValue(undefined)
    const store = useAnalysisStore()
    await store.loadViews()

    await store.deleteView('v1')

    expect(mocked.deleteView).toHaveBeenCalledWith('v1')
    expect(store.views.map((v) => v.viewId)).toEqual(['v2'])
  })
})

describe('useAnalysisStore · snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('loadSnapshots 成功：填充列表并透传查询参数', async () => {
    mocked.listSnapshots.mockResolvedValue([makeSnapshot('s1'), makeSnapshot('s2')])
    const store = useAnalysisStore()

    await store.loadSnapshots({ viewId: 'v1' })

    expect(mocked.listSnapshots).toHaveBeenCalledWith({ viewId: 'v1' })
    expect(store.snapshots.map((s) => s.snapshotId)).toEqual(['s1', 's2'])
  })

  it('loadSnapshots 切区守卫：挂起期间切区，旧地区快照丢弃', async () => {
    const d = deferred<AnalysisSnapshot[]>()
    mocked.listSnapshots.mockImplementation(() => d.promise)
    const store = useAnalysisStore()

    const p = store.loadSnapshots()
    setCurrentRegionId('shanxi')
    await nextTick()
    d.resolve([makeSnapshot('s1')])
    await p

    expect(store.snapshots).toEqual([])
  })

  it('saveSnapshot：新快照置顶并返回该快照；deleteSnapshot 移除', async () => {
    mocked.listSnapshots.mockResolvedValue([makeSnapshot('s1')])
    const store = useAnalysisStore()
    await store.loadSnapshots()

    const s2 = makeSnapshot('s2')
    mocked.saveSnapshot.mockResolvedValue(s2)
    const got = await store.saveSnapshot('/sjfx/zrsjg', { k: 1 })
    expect(got).toBe(s2)
    expect(mocked.saveSnapshot).toHaveBeenCalledWith({ routePath: '/sjfx/zrsjg', data: { k: 1 }, viewId: undefined })
    expect(store.snapshots.map((s) => s.snapshotId)).toEqual(['s2', 's1'])

    mocked.deleteSnapshot.mockResolvedValue(undefined)
    await store.deleteSnapshot('s1')
    expect(store.snapshots.map((s) => s.snapshotId)).toEqual(['s2'])
  })
})

describe('useAnalysisStore · annotations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('loadAnnotations 成功：填充列表并透传查询参数', async () => {
    mocked.listAnnotations.mockResolvedValue([makeAnnotation('a1')])
    const store = useAnalysisStore()

    await store.loadAnnotations({ targetType: 'point' })

    expect(mocked.listAnnotations).toHaveBeenCalledWith({ targetType: 'point' })
    expect(store.annotations.map((a) => a.annotationId)).toEqual(['a1'])
  })

  it('loadAnnotations 切区守卫：挂起期间切区，旧地区标注丢弃', async () => {
    const d = deferred<AnalysisAnnotation[]>()
    mocked.listAnnotations.mockImplementation(() => d.promise)
    const store = useAnalysisStore()

    const p = store.loadAnnotations()
    setCurrentRegionId('shanxi')
    await nextTick()
    d.resolve([makeAnnotation('a1')])
    await p

    expect(store.annotations).toEqual([])
  })

  it('saveAnnotation：置顶去重；deleteAnnotation 移除', async () => {
    mocked.listAnnotations.mockResolvedValue([makeAnnotation('a1')])
    const store = useAnalysisStore()
    await store.loadAnnotations()

    const a2 = makeAnnotation('a2')
    mocked.saveAnnotation.mockResolvedValue(a2)
    await store.saveAnnotation('range', 'node-a', '新标注')
    expect(mocked.saveAnnotation).toHaveBeenCalledWith({ targetType: 'range', targetRef: 'node-a', content: '新标注' })
    expect(store.annotations.map((a) => a.annotationId)).toEqual(['a2', 'a1'])

    const a1Updated = makeAnnotation('a1')
    mocked.saveAnnotation.mockResolvedValue(a1Updated)
    await store.saveAnnotation('point', 'node-a', '更新 a1')
    expect(store.annotations.map((a) => a.annotationId)).toEqual(['a1', 'a2'])

    mocked.deleteAnnotation.mockResolvedValue(undefined)
    await store.deleteAnnotation('a2')
    expect(store.annotations.map((a) => a.annotationId)).toEqual(['a1'])
  })
})

describe('useAnalysisStore · 切区清空', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCurrentRegionId('yunnan')
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('切区时三列表全清（用户产物地区隔离，旧地区产物不可见）', async () => {
    mocked.listViews.mockResolvedValue([makeView('v1')])
    mocked.listSnapshots.mockResolvedValue([makeSnapshot('s1')])
    mocked.listAnnotations.mockResolvedValue([makeAnnotation('a1')])
    const store = useAnalysisStore()
    await Promise.all([store.loadViews(), store.loadSnapshots(), store.loadAnnotations()])
    expect(store.views.length).toBe(1)
    expect(store.snapshots.length).toBe(1)
    expect(store.annotations.length).toBe(1)

    setCurrentRegionId('shanxi')
    await nextTick()

    expect(store.views).toEqual([])
    expect(store.snapshots).toEqual([])
    expect(store.annotations).toEqual([])
  })

  it('切区清空 inflight：切回同地区后同键重新发请求（不复用旧挂起合流）', async () => {
    const d1 = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation(() => d1.promise)
    const store = useAnalysisStore()
    const p1 = store.loadViews()
    expect(mocked.listViews).toHaveBeenCalledTimes(1)

    setCurrentRegionId('shanxi')
    await nextTick()
    setCurrentRegionId('yunnan')
    await nextTick()

    const d2 = deferred<AnalysisView[]>()
    mocked.listViews.mockImplementation(() => d2.promise)
    const p2 = store.loadViews() // 若 inflight 未被切区 watch 清掉，这里会复用 p1 而不发新请求
    expect(mocked.listViews).toHaveBeenCalledTimes(2)

    d1.resolve([makeView('stale')])
    d2.resolve([makeView('fresh')])
    await Promise.all([p1, p2])
    expect(store.views.map((v) => v.viewId)).toEqual(['fresh'])
  })
})
