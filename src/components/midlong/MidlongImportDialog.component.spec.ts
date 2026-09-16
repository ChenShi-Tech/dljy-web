// 中长期售电合同导入对话框的交互不变量（dljy#2939，MI-01..05）。
// 守什么：预览错误定位到工作表/行/列；有冲突或错误时不能提交；提交得到「预览已失效」时保留整批未入库提示、
// 刷新结果并禁用提交；提交成功只显示「待核对」，不暗示已确认。
// 坏掉的症状：用户看不出第几行哪一列错；冲突批次仍能点提交；预览过期后继续用旧结果提交。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { MidlongImportPreview, MidlongImportRowReport } from '@/services/midlong/midlongTypes'

const hoisted = vi.hoisted(() => ({ createImportPreview: vi.fn(), commitImport: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  createImportPreview: hoisted.createImportPreview,
  commitImport: hoisted.commitImport,
  fetchImportTemplate: vi.fn(),
  midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: vi.fn(async () => 'Y3N2') }))

import MidlongImportDialog from './MidlongImportDialog.vue'

const STUBS = { 'router-link': { template: '<a><slot /></a>' } }

function row(o: Partial<MidlongImportRowReport>): MidlongImportRowReport {
  return {
    rowId: 'C2', location: { sheet: '合同主表', rowNumber: 2, allocationRowNumbers: [] }, op: 'CREATE', contractId: null, confirmationStatus: null,
    conflictReason: null, diffs: [], candidateDuplicates: [], externalObligationId: 'T-1', contractName: '测试合同', documentKind: 'OBLIGATION',
    productKind: 'ANNUAL', subjectKey: null, stationName: null, sourceNamespace: 'TEST', deliveryStart: '2027-01-01', deliveryEnd: '2027-12-31',
    totalQuantity: '1000', sellerPrice: null, priceStatus: 'UNKNOWN', allocationCompleteness: 'NONE', unallocatedQuantity: '1000', allocationCount: 0,
    errors: [], warnings: [], ...o,
  }
}

function preview(rows: MidlongImportRowReport[], canCommit: boolean): MidlongImportPreview {
  const count = (op: MidlongImportRowReport['op']) => rows.filter((r) => r.op === op).length
  return {
    previewId: 'MLP-1', status: 'OPEN', companyId: 'comp-a', regionId: 'yunnan', expiresAt: '2026-09-16T10:00:00.000Z', format: 'csv',
    files: [{ role: 'contracts', fileName: 'contracts.csv', sha256: 'x', bytes: 3 }],
    mapping: { sourceNamespace: 'TEST', quantityUnit: 'MWh', priceUnit: null, acceptPrecisionRounding: false, sourceDocumentType: 'IMPORT_SOURCE_FILE' },
    columns: { contracts: [], allocations: [] },
    summary: { contractRows: rows.length, allocationRows: 0, createCount: count('CREATE'), skipCount: count('SKIP'), conflictCount: count('CONFLICT'), errorRowCount: count('ERROR'), fileErrorCount: 0, warningCount: 0, canCommit },
    fileErrors: [], fileWarnings: [], rows,
  }
}

async function openAndPreview() {
  const w = mount(MidlongImportDialog, { props: { modelValue: false }, global: { stubs: STUBS } })
  await w.setProps({ modelValue: true })
  await flushPromises()
  const csv = w.findAll('.el-radio-button').find((b) => b.text().includes('CSV'))!
  await csv.find('input').setValue(true)
  await flushPromises()
  const input = w.find('input[data-testid="ml-import-contracts"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['a'], 'contracts.csv')] })
  await input.trigger('change')
  const buttons = () => w.findAll('.el-dialog__footer button')
  await buttons().find((b) => b.text() === '生成预览')!.trigger('click')
  await flushPromises()
  return { w, commitButton: () => buttons().find((b) => b.text().startsWith('提交导入'))! }
}

afterEach(() => vi.clearAllMocks())

describe('中长期合同导入', () => {
  it('错误定位到工作表、行、列；有冲突或错误时不能提交', async () => {
    hoisted.createImportPreview.mockResolvedValue(preview([
      row({ op: 'ERROR', rowId: 'C2', errors: [{ sheet: '合同主表', rowNumber: 2, column: '合同电量', code: 'UNIT_REQUIRED', message: '未声明电量单位' }] }),
      row({ op: 'CONFLICT', rowId: 'C3', location: { sheet: '合同主表', rowNumber: 3, allocationRowNumbers: [] }, contractId: 9, diffs: [{ field: 'totalQuantity', existing: '1000', incoming: '1100' }] }),
    ], false))
    const { w, commitButton } = await openAndPreview()
    expect(w.text()).toContain('内容冲突')
    expect(w.text()).toContain('存在同编号不同内容的合同')
    expect(commitButton().attributes('disabled')).toBeDefined()
    await w.findAll('.el-table__expand-icon')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('合同主表 第 2 行 「合同电量」：未声明电量单位')
  })

  it('提交时预览已失效：提示整批未入库、刷新结果并禁用提交', async () => {
    hoisted.createImportPreview.mockResolvedValue(preview([row({ op: 'CREATE' })], true))
    const fresh = preview([row({ op: 'CONFLICT', contractId: 5, diffs: [{ field: 'totalQuantity', existing: '1000', incoming: '1200' }] })], false)
    hoisted.commitImport.mockRejectedValue({ failure: { status: 409, errorCode: 'PREVIEW_STALE', message: '预览之后合同底账已发生变化', details: { report: fresh } } })
    const { w, commitButton } = await openAndPreview()
    expect(commitButton().attributes('disabled')).toBeUndefined()
    await commitButton().trigger('click')
    await flushPromises()
    expect(w.text()).toContain('预览已失效，整批未入库')
    expect(w.text()).toContain('内容冲突')
    expect(commitButton().attributes('disabled')).toBeDefined()
  })

  it('提交成功只登记为待核对', async () => {
    hoisted.createImportPreview.mockResolvedValue(preview([row({ op: 'CREATE' })], true))
    hoisted.commitImport.mockResolvedValue({
      batchId: 'MLI-1', previewId: 'MLP-1', regionId: 'yunnan', createdCount: 1, skippedCount: 0, files: [], mapping: {}, committedAt: '', committedBy: 'u',
      results: [{ rowId: 'C2', location: { sheet: '合同主表', rowNumber: 2 }, op: 'CREATED', contractId: 11, externalObligationId: 'T-1' }],
      note: '导入只登记为「待核对」，合同须经核验确认后才计入月度持仓',
    })
    const { w, commitButton } = await openAndPreview()
    await commitButton().trigger('click')
    await flushPromises()
    expect(w.text()).toContain('已登记（待核对）')
    expect(w.text()).not.toContain('已确认')
    expect(w.emitted('committed')).toHaveLength(1)
  })
})
