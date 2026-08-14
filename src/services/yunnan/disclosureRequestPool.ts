export const DISCLOSURE_REQUEST_CONCURRENCY = 3

interface QueuedJob<T> {
  run: () => Promise<T>
  isCurrent: () => boolean
  resolve: (value: T | undefined) => void
  reject: (reason: unknown) => void
}

/**
 * 跨披露批次共享的请求池。
 *
 * fetchCaptured 当前没有 AbortSignal 参数；不扩张服务层公共接口，因此在飞旧请求
 * 只能自然完成。新批次通过 isCurrent 在每个请求真正发起前淘汰旧队列项，且所有批次
 * 共用同一组槽位，保证旧请求未完成时新批次也不会把并发放大到 3×批次数。
 */
export class DisclosureRequestPool {
  private readonly queue: Array<QueuedJob<unknown>> = []
  private active = 0

  constructor(private readonly concurrency = DISCLOSURE_REQUEST_CONCURRENCY) {}

  enqueue<T>(run: () => Promise<T>, isCurrent: () => boolean): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.queue.push({ run, isCurrent, resolve: resolve as (value: unknown) => void, reject })
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!
      // 必须在每个 shard 发起前再次检查；seq 过期的排队任务不调用 run。
      if (!job.isCurrent()) {
        job.resolve(undefined)
        continue
      }
      this.active += 1
      void Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1
          this.pump()
        })
    }
  }
}

/** 模块级单例：YunnanDisclosurePanel 的所有批次共享同一池。 */
export const sharedDisclosureRequestPool = new DisclosureRequestPool()

export async function runDisclosureRequestPool<T>(
  jobs: Array<() => Promise<T>>,
  isCurrent: () => boolean
): Promise<Array<T | undefined>> {
  return Promise.all(jobs.map((job) => sharedDisclosureRequestPool.enqueue(job, isCurrent)))
}
