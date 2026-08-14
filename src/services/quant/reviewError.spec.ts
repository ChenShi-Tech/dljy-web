import { describe, expect, it } from 'vitest'
import { classifyReviewError, QuantHttpError } from './reviewError'

describe('复盘错误分类', () => {
  it('detail 指向 actual_mwh_96/尚未接入的 503 归为数据未接入，并保留后端 detail', () => {
    const failure = classifyReviewError(new QuantHttpError('actual_mwh_96 尚未接入', 503, 'actual_mwh_96 尚未接入'))

    expect(failure.kind).toBe('data-not-onboarded')
    expect(failure.title).toContain('actual_mwh_96')
    expect(failure.detail).toBe('actual_mwh_96 尚未接入')
  })

  it('detail 提示无权读取的 503 归为未授权，不误导为补 actual', () => {
    const failure = classifyReviewError(new QuantHttpError('无权读取数据族 sdpt_zrqsb', 503, '无权读取数据族 sdpt_zrqsb'))

    expect(failure.kind).toBe('unauthorized')
    expect(failure.title).not.toContain('actual_mwh_96')
  })

  it('其余 503（如申报/价格侧无数据）归为数据不可用，保留后端说明', () => {
    const failure = classifyReviewError(new QuantHttpError('回放服务无该品类数据', 503, '回放服务无该品类数据'))

    expect(failure.kind).toBe('data-unavailable')
    expect(failure.detail).toBe('回放服务无该品类数据')
    expect(failure.title).not.toContain('actual_mwh_96')
  })

  it('将 fetch 连接错误归为服务不可达', () => {
    expect(classifyReviewError(new TypeError('Failed to fetch')).kind).toBe('service-unreachable')
  })

  it('将非 503 HTTP 错误归为其它加载失败', () => {
    const failure = classifyReviewError(new QuantHttpError('参数不合法', 422, '参数不合法'))

    expect(failure.kind).toBe('load-failed')
    expect(failure.detail).toBe('参数不合法')
  })
})
