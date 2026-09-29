import { describe, it, expect } from 'vitest'
import { summarizeForecastFailures, type ForecastFailure } from './failureSummary'

describe('summarizeForecastFailures', () => {
  it('无失败返回空串（由调用方决定兜底文案）', () => {
    expect(summarizeForecastFailures([])).toBe('')
  })

  it('同因合并：多算法同一原因只说一次，并带上算法数量', () => {
    const failures: ForecastFailure[] = [
      { name: 'LightGBM', reason: 'target_date=2026-08-20 不在可用数据范围内（2026-01-03..2026-07-01）' },
      { name: 'PatchTST', reason: 'target_date=2026-08-20 不在可用数据范围内（2026-01-03..2026-07-01）' },
      { name: 'KNN 相似日', reason: 'target_date=2026-08-20 不在可用数据范围内（2026-01-03..2026-07-01）' },
    ]
    const text = summarizeForecastFailures(failures)
    expect(text).toBe('3 个算法未出结果：target_date=2026-08-20 不在可用数据范围内（2026-01-03..2026-07-01）')
    // 原因必须原样出现——这是用户唯一能据以操作的信息
    expect(text).toContain('2026-01-03..2026-07-01')
  })

  it('异因逐条列出，且每条都带算法名', () => {
    const text = summarizeForecastFailures([
      { name: 'XGBoost', reason: '需安装可选 extra xgboost' },
      { name: 'LightGBM', reason: 'target_date 不在可用数据范围内' },
    ])
    expect(text).toBe('XGBoost：需安装可选 extra xgboost；LightGBM：target_date 不在可用数据范围内')
  })

  it('不把真实原因替换成"后端不可达"这类猜测', () => {
    const text = summarizeForecastFailures([{ name: 'LightGBM', reason: '地区 yunnan 的真实回放数据未提供目标列 reg_price' }])
    expect(text).toContain('未提供目标列 reg_price')
    expect(text).not.toContain('不可达')
  })
})
