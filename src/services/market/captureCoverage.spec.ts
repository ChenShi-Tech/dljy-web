import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.fn()
vi.mock('@/services/api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }))

const { fetchCaptureCoverage, captureCoverage, clampToCoverage } = await import('./captureCoverage')

function respond(datasets: Array<{ datasetKey: string; start: string | null; end: string | null }>) {
  apiGet.mockResolvedValueOnce({ code: 200, data: { datasets } })
}

describe('fetchCaptureCoverage', () => {
  beforeEach(() => apiGet.mockReset())

  it('取日前与实时的交集：最晚 start ~ 最早 end', async () => {
    // 监盘要算价差，两条曲线缺一条那天就是空态，故取交集而非并集。
    respond([
      { datasetKey: 'da_user_price', start: '2025-07-01', end: '2026-08-18' },
      { datasetKey: 'rt_user_price', start: '2025-07-05', end: '2026-08-17' }
    ])
    await expect(fetchCaptureCoverage('yunnan', 'price')).resolves.toEqual({
      start: '2025-07-05',
      end: '2026-08-17'
    })
  })

  it('实测形态：日前多一天时默认日期落在实时的末日，不落到 08-18', async () => {
    // 2026-08-18 上游有日前、无实时——按并集会把它当可用日，首屏依旧空态。
    respond([
      { datasetKey: 'da_user_price', start: '2025-07-01', end: '2026-08-18' },
      { datasetKey: 'rt_user_price', start: '2025-07-01', end: '2026-08-17' }
    ])
    const range = await fetchCaptureCoverage('yunnan', 'price')
    expect(range?.end).toBe('2026-08-17')
  })

  it('缺任一数据集时返回 null，不用单条曲线冒充可用区间', async () => {
    respond([{ datasetKey: 'da_user_price', start: '2025-07-01', end: '2026-08-18' }])
    await expect(fetchCaptureCoverage('yunnan', 'price')).resolves.toBeNull()
  })

  it('数据集存在但日期为空时返回 null', async () => {
    respond([
      { datasetKey: 'da_user_price', start: null, end: null },
      { datasetKey: 'rt_user_price', start: '2025-07-01', end: '2026-08-17' }
    ])
    await expect(fetchCaptureCoverage('yunnan', 'price')).resolves.toBeNull()
  })

  it('未登记的地区不发请求（静态历史批次仍用同步表）', async () => {
    await expect(fetchCaptureCoverage('shanxi', 'price')).resolves.toBeNull()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('review 用途不发请求（结算仍是静态批次）', async () => {
    await expect(fetchCaptureCoverage('yunnan', 'review')).resolves.toBeNull()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('接口抛错时返回 null，由调用方保持原默认值', async () => {
    apiGet.mockRejectedValueOnce(new Error('网络不可达'))
    await expect(fetchCaptureCoverage('yunnan', 'price')).resolves.toBeNull()
  })

  it('响应结构不符时返回 null，不猜测区间', async () => {
    apiGet.mockResolvedValueOnce({ code: 200, data: {} })
    await expect(fetchCaptureCoverage('yunnan', 'price')).resolves.toBeNull()
  })

  it('交集为空区间（start 晚于 end）时返回 null', async () => {
    respond([
      { datasetKey: 'da_user_price', start: '2026-09-01', end: '2026-09-10' },
      { datasetKey: 'rt_user_price', start: '2025-07-01', end: '2026-08-01' }
    ])
    await expect(fetchCaptureCoverage('yunnan', 'price')).resolves.toBeNull()
  })

  it('带 family 与 region 调用后端', async () => {
    respond([
      { datasetKey: 'da_user_price', start: '2025-07-01', end: '2026-08-18' },
      { datasetKey: 'rt_user_price', start: '2025-07-01', end: '2026-08-17' }
    ])
    await fetchCaptureCoverage('yunnan', 'price')
    expect(apiGet).toHaveBeenCalledWith('/api/real-coverage', {
      family: 'yn_system_forecast',
      region: 'yunnan'
    })
  })
})

describe('同步覆盖表仍服务静态批次地区', () => {
  it('山西 price 区间保持不变（未因本次改造回归）', () => {
    expect(captureCoverage('shanxi', 'price')).toEqual({ start: '2022-07-01', end: '2026-06-02' })
    expect(clampToCoverage('shanxi', 'price', '2026-12-31')).toBe('2026-06-02')
  })
})
