/**
 * 并发上限执行 mapper，results 保持 items 顺序。
 * 用于避免逐日请求无界并发（如现货面板整月拉取每日数据时的 ~31 并发同时打后端）。
 * 从联动面板（YunnanPriceOutputLinkagePanel）抽取为共享工具，供多面板复用。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
