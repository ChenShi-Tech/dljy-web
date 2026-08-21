// 多算法/多目标并发预测的失败原因汇总（建模工作台「多算法对比」与「多目标总览」共用）。
//
// 背景：两处此前都用 `.catch(() => null)` 吞掉每一路的失败，全失败时只报一句
// 「后端不可达？」——把「目标日超出可用数据范围」「该品种本地区无真实列」「模型缺
// 可选依赖」这类**可执行**原因伪装成服务故障，用户无从下手。原因必须原样带到页面。
export type ForecastFailure = {
  name: string      // 算法名 / 目标名
  reason: string    // 后端 detail 或客户端异常 message，原样透传
}

/**
 * 汇总失败原因：同因合并、异因逐条列出。
 * 多算法在同一上下文下失败通常同因（如同一个日期没有基本面数据），逐条罗列只会刷屏。
 * 返回 '' 表示无失败，由调用方决定是否显示兜底文案。
 */
export function summarizeForecastFailures(failures: ForecastFailure[]): string {
  if (!failures.length) return ''
  const reasons = [...new Set(failures.map((f) => f.reason))]
  return reasons.length === 1
    ? `${failures.length} 个算法未出结果：${reasons[0]}`
    : failures.map((f) => `${f.name}：${f.reason}`).join('；')
}
