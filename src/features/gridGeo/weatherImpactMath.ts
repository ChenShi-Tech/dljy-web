export function pearsonCorrelation(left: Array<number | null>, right: Array<number | null>) {
  const pairs = left.flatMap((value, index) => value === null || right[index] === null ? [] : [[value, Number(right[index])] as const])
  if (pairs.length < 6) return { value: null, samples: pairs.length }
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length
  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0
  for (const [a, b] of pairs) {
    numerator += (a - leftMean) * (b - rightMean)
    leftVariance += (a - leftMean) ** 2
    rightVariance += (b - rightMean) ** 2
  }
  const denominator = Math.sqrt(leftVariance * rightVariance)
  return { value: denominator > 1e-12 ? numerator / denominator : null, samples: pairs.length }
}

export function hourlyAverage(values: Array<number | null>) {
  return Array.from({ length: 24 }, (_, hour) => {
    const slice = values.slice(hour * 4, hour * 4 + 4).filter((value): value is number => value !== null && Number.isFinite(value))
    return slice.length ? slice.reduce((sum, value) => sum + value, 0) / slice.length : null
  })
}

export async function optionalCaptureOnNotFound<T>(request: Promise<T>, fallback: T) {
  // weather_asof 是可选的 gitignored 真实采集：未导入时只让预报轨诚实为空，
  // 不能连带清空仍可展示的实况/出力/价格。鉴权、网络和服务端错误继续抛出。
  try {
    return await request
  } catch (error) {
    const candidate = error as { name?: unknown; status?: unknown } | null
    if (candidate?.name === 'ApiError' && candidate.status === 404) return fallback
    throw error
  }
}
