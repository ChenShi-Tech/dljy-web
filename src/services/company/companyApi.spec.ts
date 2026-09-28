// 守什么：refreshCompanyOptions 的请求序号守卫（ChenShi-Tech/dljy#3403）——并发刷新时
// 只有最后一次请求的结果可以调用 setCompanyOptions。
// 坏掉的症状：先发后到的旧公司列表回来会触发四规则协调，把刚切到的练习公司顶掉，
// 导引写入落到错误公司；或新列表被旧响应覆盖。
// Issue: ChenShi-Tech/dljy#3403
import { beforeEach, describe, expect, it, vi } from 'vitest'

// companyApi 运行时依赖 regionContext（模块顶层读 window.localStorage），node 环境需最小 stub。
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    }
  }
}
;(globalThis as unknown as { window: { localStorage: ReturnType<typeof memoryStorage> } }).window = {
  localStorage: memoryStorage()
}

vi.mock('@/services/api', () => ({ apiGet: vi.fn() }))
vi.mock('@/services/company/companyContext', () => ({ setCompanyOptions: vi.fn() }))

const { apiGet } = await import('@/services/api')
const { refreshCompanyOptions } = await import('./companyApi')
const { setCompanyOptions } = await import('@/services/company/companyContext')

type Rows = { rows?: { companyId: string }[] }

describe('refreshCompanyOptions 请求序号守卫（#3403）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('先发后到：迟到的旧响应不调用 setCompanyOptions，新结果生效', async () => {
    let resolveFirst!: (value: Rows) => void
    const firstFetch = new Promise<Rows>((resolve) => {
      resolveFirst = resolve
    })
    vi.mocked(apiGet).mockReturnValueOnce(firstFetch as never)
    vi.mocked(apiGet).mockResolvedValueOnce({ rows: [{ companyId: 'comp-new' }] } as never)

    const slow = refreshCompanyOptions()
    const fast = refreshCompanyOptions()
    resolveFirst({ rows: [{ companyId: 'comp-old' }] })
    const [slowResult, fastResult] = await Promise.all([slow, fast])

    expect(setCompanyOptions).toHaveBeenCalledTimes(1)
    expect(setCompanyOptions).toHaveBeenCalledWith([{ companyId: 'comp-new' }])
    // 迟到方拿到的仍是自己的结果（调用方大多不消费返回值），但不再触碰全局公司上下文。
    expect(slowResult).toEqual([{ companyId: 'comp-old' }])
    expect(fastResult).toEqual([{ companyId: 'comp-new' }])
  })

  it('串行刷新：每次响应都照常生效（守卫不误伤正常路径）', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ rows: [{ companyId: 'comp-a' }] } as never)
    vi.mocked(apiGet).mockResolvedValueOnce({ rows: [{ companyId: 'comp-b' }] } as never)
    await refreshCompanyOptions()
    await refreshCompanyOptions()
    expect(setCompanyOptions).toHaveBeenCalledTimes(2)
    expect(setCompanyOptions).toHaveBeenNthCalledWith(1, [{ companyId: 'comp-a' }])
    expect(setCompanyOptions).toHaveBeenNthCalledWith(2, [{ companyId: 'comp-b' }])
  })
})
