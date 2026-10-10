// @vitest-environment happy-dom
// ↑ 勿删：uploadClient 经 api.ts 取身份头（localStorage），node project 默认无 DOM。
//
// uploadClient 信封层级回归（dljy#2817 收尾时定位的长期缺陷）
// ---------------------------------------------------------------------------
// data-service 的 /api/v1/data-upload/* **一律把业务载荷放在 `data` 下**，而
// apiGet/apiPost 的 unwrap() 返回的是**整个信封**。此前本模块按顶层读（res.contracts /
// res.rows / 直接 return res），恒得 undefined → 落到 []：页面表格永远 "No Data"、
// 模板下载拿不到文件名、预检报告没有 header/rows。**上传中心从来没能从浏览器走通**，
// raw.import_batch 长期 0 行的根因就在这里。
//
// 这个缺陷之所以长期不可见：既有组件测试（DataOpsConsoleView / OpsOverviewPanel）
// 用 vi.mock 把整个 uploadClient 替换掉了，于是「客户端怎么解包响应」这件事
// 结构性地不在任何断言的射程内。本文件**不 mock uploadClient**，只 mock 它下面的
// api.ts，喂进与服务端逐字同形的信封——层级读错即红。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const apiGet = vi.fn()
const apiPost = vi.fn()
// spread 真实模块：commitUpload 需对 409 的 ApiError 做 instanceof 判别（#2898），
// mock 工厂必须保留真实 ApiError 类，否则 uploadClient 内 instanceof 恒 false。
vi.mock('@/services/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/api')>(),
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args)
}))

const {
  fetchUploadContracts, fetchUploadTemplate, fetchUploadBatches, precheckUpload, commitUpload, downloadTemplateFile, UploadConflictError
} = await import('./uploadClient')
const { ApiError } = await import('@/services/api')

/** 与 server/data-upload-api.mjs::envelope 逐字同形：载荷恒在 data 下。 */
const envelope = <T,>(data: T, extra: Record<string, unknown> = {}) =>
  ({ code: 200, msg: 'ok', traceId: 'REQ-test', data, ...extra })

beforeEach(() => { apiGet.mockReset(); apiPost.mockReset() })

it('中文CSV填报格式下载保留UTF-8文本', async () => {
  let saved!: Blob
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { saved = blob as Blob; return 'blob:test' })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    downloadTemplateFile('分时资料.csv', undefined, '\uFEFF业务对象,日期\n风场甲,2026-05-31')
    expect(await saved.text()).toContain('业务对象,日期\n风场甲,2026-05-31')
  } finally { create.mockRestore(); revoke.mockRestore(); click.mockRestore() }
})

it('复盘维护在载荷与请求头固定同一公司，不依赖稍后变化的全局选择', async () => {
  const scope = { companyId: 'child', region: 'yunnan' }
  apiPost.mockResolvedValue(envelope({ ok: true, canCommit: true }))
  await precheckUpload({ dataset: 'series', fileName: '资料.csv', content: 'data', isBinary: false, region: 'yunnan' }, scope)
  expect(apiPost).toHaveBeenCalledWith('/api/v1/data-upload/precheck', expect.objectContaining({ companyId: 'child' }), expect.objectContaining({ headers: expect.objectContaining({ 'x-company-id': 'child', 'x-tenant-id': 'child', 'x-region-id': 'yunnan', 'Idempotency-Key': expect.any(String) }) }))
  apiGet.mockResolvedValue(envelope({ rows: [] }))
  await fetchUploadBatches('series', scope)
  expect(apiGet).toHaveBeenCalledWith('/api/v1/data-upload/batches', { dataset: 'series', companyId: 'child' }, expect.objectContaining({ headers: expect.objectContaining({ 'x-company-id': 'child' }) }))
})

describe('uploadClient 从信封的 data 层取载荷', () => {
  it('契约清单：读 data.contracts，不是顶层 contracts', async () => {
    apiGet.mockResolvedValue(envelope({ contracts: [{ dataset: 'yn-t0-node-price' }, { dataset: 'forecast_reserve' }] }))
    expect(await fetchUploadContracts()).toHaveLength(2)
  })

  it('契约清单：data 缺失时安全落空数组（不抛）', async () => {
    apiGet.mockResolvedValue({ code: 200, msg: 'ok' })
    expect(await fetchUploadContracts()).toEqual([])
  })

  it('批次台账：读 data.rows', async () => {
    apiGet.mockResolvedValue(envelope({ rows: [{ id: 'DMS-1' }], total: 1 }))
    const rows = await fetchUploadBatches()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('DMS-1')
  })

  it('模板：读 data 而非整个信封（否则 fileName 恒 undefined）', async () => {
    apiGet.mockResolvedValue(envelope({ dataset: 'd', format: 'xlsx', fileName: 'd-template.xlsx', contentBase64: 'UEsDBA==' }))
    const tpl = await fetchUploadTemplate('d')
    expect(tpl.fileName).toBe('d-template.xlsx')
    expect(tpl.contentBase64).toBe('UEsDBA==')
    expect((tpl as Record<string, unknown>).code).toBeUndefined()
  })

  it('模板：信封形状异常时诚实抛错，不返回没有 fileName 的空壳', async () => {
    apiGet.mockResolvedValue({ code: 200, msg: 'ok' })
    await expect(fetchUploadTemplate('d')).rejects.toThrow(/fileName/)
  })

  it('预检：报告字段来自 data，msg 来自信封顶层', async () => {
    apiPost.mockResolvedValue(envelope(
      { dataset: 'd', canCommit: true, header: { colMatch: [], missingRequired: [] }, rows: { total: 2, valid: 2, invalid: 0, errors: [] } },
      { msg: '预检通过' }
    ))
    const report = await precheckUpload({ dataset: 'd', fileName: 'f.csv', content: 'a', isBinary: false })
    expect(report.canCommit).toBe(true)
    expect(report.rows.total).toBe(2)
    expect(report.msg).toBe('预检通过')
  })

  it('提交：返回 data（含 batch），不是信封', async () => {
    apiPost.mockResolvedValue(envelope({ code: 200, batch: { id: 'DMS-9' }, delivered: { paths: [], hint: 'h' } }, { msg: '导入成功' }))
    const result = await commitUpload({ dataset: 'd', fileName: 'f.csv', content: 'a', isBinary: false })
    expect(result.batch?.id).toBe('DMS-9')
  })

  it('提交：data 缺失时抛出服务端 msg，不静默当成功', async () => {
    apiPost.mockResolvedValue({ code: 422, msg: '校验未通过' })
    await expect(commitUpload({ dataset: 'd', fileName: 'f.csv', content: 'a', isBinary: false })).rejects.toThrow('校验未通过')
  })
})

// 落库冲突 409 → UploadConflictError（#2890 / #2898）：冲突不是格式错误，需要人裁决。
// 服务端信封 { code: 409, msg: 带换行的改价明细 }，unwrap 以 code≥400 优先抛 ApiError。
describe('commitUpload 对 409 冲突单独转档', () => {
  /** 与 server/data/upload-pipeline.mjs:718 同形：code 409 + 带换行的裁决明细。 */
  const conflictEnvelope = {
    code: 409,
    msg: '2026-07-01|da: 与库内已有数据冲突（该日维表命中 2 行中 2 行已存在，其中 1 行价格不同）。\n  改价明细（库内值 vs 来件值）：\n    昆明北 @ 2026-07-01 00:00：库内 352.4，来件 999.9',
    traceId: 'REQ-c'
  }

  it('HTTP 200 但信封 code=409 → UploadConflictError，detail 逐字保留换行明细', async () => {
    // unwrap 以 payload.code ≥ 400 优先于 HTTP status：此时 ApiError.status=200、code=409。
    apiPost.mockRejectedValue(new ApiError(conflictEnvelope.msg, { status: 200, code: 409, payload: conflictEnvelope }))
    const err = await commitUpload({ dataset: 'yn-t0-node-price', fileName: 'f.csv', content: 'a', isBinary: false }).then(
      () => { throw new Error('应当 reject') },
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(UploadConflictError)
    expect((err as InstanceType<typeof UploadConflictError>).detail).toContain('昆明北 @ 2026-07-01 00:00：库内 352.4，来件 999.9')
    expect((err as InstanceType<typeof UploadConflictError>).detail).toContain('\n')
  })

  it('HTTP 409（信封 code≥400 抛 ApiError）→ UploadConflictError', async () => {
    apiPost.mockRejectedValue(new ApiError(conflictEnvelope.msg, { status: 409, code: 409, payload: conflictEnvelope }))
    await expect(commitUpload({ dataset: 'yn-t0-node-price', fileName: 'f.csv', content: 'a', isBinary: false }))
      .rejects.toBeInstanceOf(UploadConflictError)
  })

  it('422 格式错误仍是普通错误，不误标成冲突', async () => {
    apiPost.mockRejectedValue(new ApiError('第 3 行：日期格式不合法', { status: 422, code: 422, payload: { code: 422, msg: 'x' } }))
    const err = await commitUpload({ dataset: 'd', fileName: 'f.csv', content: 'a', isBinary: false }).then(
      () => { throw new Error('应当 reject') },
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(UploadConflictError)
  })

  it('非 ApiError 的网络错误原样透传，不被包装', async () => {
    const boom = new Error('network down')
    apiPost.mockRejectedValue(boom)
    await expect(commitUpload({ dataset: 'd', fileName: 'f.csv', content: 'a', isBinary: false })).rejects.toBe(boom)
  })
})
