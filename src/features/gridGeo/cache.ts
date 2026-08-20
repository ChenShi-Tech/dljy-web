// 缓存键必须包含服务端实施隔离的两个维度（地区 + 公司），避免切换后复用上一租户响应。
// 定义在本零依赖模块而非 client.ts：client 引入 @/services/api → regionContext 会触达
// window.localStorage，隔离门禁（node 环境）无法直接断言生产实现（测试必须
// 验证生产函数，复制一份期望实现会让漏掉维度时依然全绿）。
export function buildGridGeoCacheScope(regionId: string, companyId: string | null | undefined) {
  return `${regionId}:${companyId || 'no-company'}`
}

type Entry<T> = { expiresAt: number; value?: T; pending?: Promise<T> }
const entries = new Map<string, Entry<unknown>>()

export function gridGeoCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const existing = entries.get(key) as Entry<T> | undefined
  if (existing?.value !== undefined && existing.expiresAt > now) return Promise.resolve(existing.value)
  if (existing?.pending) return existing.pending
  const entry: Entry<T> = { expiresAt: now + ttlMs }
  entry.pending = loader().then((value) => {
    entry.value = value
    entry.pending = undefined
    entry.expiresAt = Date.now() + ttlMs
    return value
  }).catch((error) => {
    entries.delete(key)
    throw error
  })
  entries.set(key, entry)
  return entry.pending
}

export function invalidateGridGeoCache(prefix = '') {
  for (const key of entries.keys()) if (!prefix || key.startsWith(prefix)) entries.delete(key)
}

export function resetGridGeoCacheForTest() { entries.clear() }
