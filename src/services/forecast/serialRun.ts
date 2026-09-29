// 多算法对比的串行执行器（并发 1）。
//
// 背景（ChenShi-Tech/dljy#3578）：对比模式原先 Promise.all 同时发 N 个 POST /forecast/predict，
// 后端是本机同步重训、只能排队跑，排在后面的请求在队列里干等，累计耗时超过前端超时就被浏览器
// 报「signal timed out」。改为逐个执行后，每个请求的超时只计它自己的计算耗时，且每完成一个
// 就能回显进度。单个失败不影响后续；何时停止（页面上下文已切换）由调用方的 shouldContinue 决定。

export type SerialOutcome<T, R> =
  | { item: T; ok: true; value: R }
  | { item: T; ok: false; error: unknown }

export type SerialRunOptions = {
  /** 每完成一项（成功或失败）后回调，done 为已完成数（含失败）。 */
  onProgress?: (done: number, total: number) => void
  /** 每项开始前检查；返回 false 则停止后续项（结果里不含未执行项）。 */
  shouldContinue?: () => boolean
}

export async function runSerially<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: SerialRunOptions = {},
): Promise<SerialOutcome<T, R>[]> {
  const outcomes: SerialOutcome<T, R>[] = []
  for (let i = 0; i < items.length; i++) {
    if (options.shouldContinue && !options.shouldContinue()) break
    const item = items[i] as T
    try {
      outcomes.push({ item, ok: true, value: await worker(item, i) })
    } catch (error) {
      outcomes.push({ item, ok: false, error })
    }
    options.onProgress?.(outcomes.length, items.length)
  }
  return outcomes
}
