// 场站分配对话框的交互不变量（dljy#2971，MP-05）。
// 守什么：打开时预填当前生效的分配（新集是完整快照，不另起一份相加）；实时显示未分配余额与超出量；
// 超额草稿不能确认；服务端拒绝超额时显示「原分配不变」与当前可分配余额；正式交易分解确认必须选依据；
// 切换分配类型后按新类型的生效分配重新预填，提交的行不带上一类型的行。
// 坏掉的症状：给第三个场站分 200 时页面仍显示可确认；拒绝后用户不知道原分配是否被改动；
// 在正式交易分解预填后切到内部经营分配保存，把正式分解的行当成内部经营分配提交并替换其整套快照。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import type { ContractStationAllocationsOverview } from '@/services/midlong/midlongP2Types'

const hoisted = vi.hoisted(() => ({ createStationAllocationDraft: vi.fn(), confirmStationAllocationSet: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({ midlongFailureOf: (e: unknown) => (e as { failure: unknown }).failure }))
vi.mock('@/services/midlong/midlongP2Api', () => ({ createStationAllocationDraft: hoisted.createStationAllocationDraft, confirmStationAllocationSet: hoisted.confirmStationAllocationSet }))

import MidlongStationAllocationDialog from './MidlongStationAllocationDialog.vue'

const segment = (o = {}) => ({ segment: 'TOTAL', segmentQuantity: '1000', allocatedQuantity: '900', unallocatedQuantity: '100', excessQuantity: '0', stationCount: 2, status: 'WITHIN' as const, ...o })
const overview: ContractStationAllocationsOverview = {
  contractId: 7, companyId: 'comp-a', regionId: 'yunnan', externalContractNo: 'TEST-7', contractName: '【测试数据】', confirmationStatus: 'CONFIRMED', currentRevisionNo: 1,
  deliveryStart: '2027-06-01', deliveryEnd: '2027-06-30', totalQuantity: '1000', monthlyFormal: { '2027-06': '1000' }, subjectId: 1, contractStation: null,
  subjectStations: [{ stationId: 1, stationName: '测试风电场A' }, { stationId: 2, stationName: '测试风电场B' }, { stationId: 3, stationName: '测试光伏站C' }],
  canCreate: true, sets: [], impact: [],
  effective: {
    FORMAL_TRADING: { allocationSetId: 9, setNo: 1, segmentMode: 'CONTRACT_TOTAL', segments: [segment()], inheritedFromRevisionNo: null,
      rows: [{ id: 1, stationId: 1, stationName: '测试风电场A', segmentMonth: null, quantity: '400' }, { id: 2, stationId: 2, stationName: '测试风电场B', segmentMonth: null, quantity: '500' }] },
    INTERNAL_OPERATING: null,
  },
}
const evidence = [{ id: 5, contractId: 7, importBatchId: null, documentType: 'ELECTRONIC_CONFIRMATION' as const, sha256: 'a'.repeat(64), byteSize: 1, originalFileName: '确认单.pdf', mediaType: null, source: 'UPLOAD', note: null, uploadedAt: '', uploadedBy: null }]

const internalSegment = { segment: '2027-06', segmentQuantity: '1000', allocatedQuantity: '1000', unallocatedQuantity: '0', excessQuantity: '0', stationCount: 1, status: 'WITHIN' as const }
const overviewWithInternal: ContractStationAllocationsOverview = {
  ...overview,
  effective: {
    FORMAL_TRADING: overview.effective.FORMAL_TRADING,
    INTERNAL_OPERATING: { allocationSetId: 11, setNo: 1, segmentMode: 'MONTHLY', segments: [internalSegment], inheritedFromRevisionNo: null,
      rows: [{ id: 3, stationId: 3, stationName: '测试光伏站C', segmentMonth: '2027-06', quantity: '1000' }] },
  },
}

async function open(o: ContractStationAllocationsOverview = overview) {
  const w = mount(MidlongStationAllocationDialog, { props: { modelValue: false, overview: o, stations: [], evidence } })
  await w.setProps({ modelValue: true })
  await nextTick()
  return w
}

afterEach(() => { vi.clearAllMocks() })
enableAutoUnmount(afterEach)

describe('场站分配对话框', () => {
  it('预填当前生效分配，显示未分配余额 100；再加第三场站 200 显示超出 100 并有阻断提示', async () => {
    const w = await open()
    expect(w.text()).toContain('未分配余额')
    const segmentRow = () => w.findAll('.ml-segments .el-table__body tr')[0].findAll('td').map((td) => td.text())
    expect(segmentRow()).toEqual(['合同总量', '1,000', '900', '100', '—'])
    await w.findAll('button').find((b) => b.text() === '+ 添加场站')!.trigger('click')
    const inputs = w.findAll('.ml-row input')
    await inputs.at(-1)!.setValue('200')
    ;(w.vm as unknown as { form: { rows: Array<{ stationId: number | null }> } }).form.rows[2].stationId = 3
    await nextTick()
    expect(segmentRow()).toEqual(['合同总量', '1,000', '1,100', '0', '超出 100'])
    expect(w.text()).toContain('分配合计超过合同片段电量 × 1')
  })

  it('切换分配类型：行、片段方式与依据按新类型的生效分配重新预填，保存时只提交新类型的行', async () => {
    hoisted.createStationAllocationDraft.mockResolvedValue({ allocationSetId: 12, setNo: 2, status: 'DRAFT', revisionNo: 1, validation: { blocking: false, blockingCount: 0, warningCount: 0, summary: [], completeness: null, segments: [internalSegment] } })
    const w = await open(overviewWithInternal)
    type Form = { allocationKind: string; segmentMode: string; rows: Array<{ stationId: number | null; segmentMonth: string; quantity: string }>; evidenceIds: number[]; basisNote: string }
    const form = () => (w.vm as unknown as { form: Form }).form
    const pickKind = async (label: string) => {
      await w.findAll('.el-radio').find((r) => r.text().startsWith(label))!.find('input').setValue(true)
      await flushPromises()
    }
    form().evidenceIds = [5]
    await w.findAll('.ml-row input').at(-1)!.setValue('450')
    expect(form().rows.map((r) => [r.stationId, r.quantity])).toEqual([[1, '400'], [2, '450']])

    await pickKind('内部经营分配')
    expect([form().allocationKind, form().segmentMode, form().evidenceIds]).toEqual(['INTERNAL_OPERATING', 'MONTHLY', []])
    expect(form().rows).toEqual([{ stationId: 3, segmentMonth: '2027-06', quantity: '1000' }])
    expect(w.text()).toContain('已按「内部经营分配」当前生效的分配重新预填')

    await pickKind('正式交易分解')
    expect([form().segmentMode, form().rows.map((r) => [r.stationId, r.quantity])]).toEqual(['CONTRACT_TOTAL', [[1, '400'], [2, '500']]])

    await pickKind('内部经营分配')
    await w.find('textarea').setValue('【测试】内部考核口径')
    await w.findAll('button').find((b) => b.text() === '保存草稿并校验')!.trigger('click')
    await flushPromises()
    expect(hoisted.createStationAllocationDraft).toHaveBeenCalledWith(7, {
      expectedRevisionNo: 1, allocationKind: 'INTERNAL_OPERATING', segmentMode: 'MONTHLY',
      rows: [{ stationId: 3, segmentMonth: '2027-06', quantity: '1000' }], basisNote: '【测试】内部考核口径', evidenceIds: [],
    })
  })

  it('保存草稿返回前关闭并重开到另一份合同：旧草稿不出现在新会话（不能被误确认）；确认返回前重开，旧确认不关闭新会话', async () => {
    const draftResult = (setNo: number) => ({ allocationSetId: 20 + setNo, setNo, status: 'DRAFT' as const, revisionNo: 1, validation: { blocking: false, blockingCount: 0, warningCount: 0, summary: [], completeness: null, segments: [segment()] } })
    let resolveSave: (v: unknown) => void = () => {}
    hoisted.createStationAllocationDraft.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve }))
    const w = await open()
    const button = (text: string) => w.findAll('button').find((b) => b.text() === text)
    await button('保存草稿并校验')!.trigger('click')
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true, overview: { ...overview, contractId: 8 } })
    await nextTick()
    resolveSave(draftResult(2))
    await flushPromises()
    expect(button('确认分配')).toBeUndefined()
    expect(w.text()).not.toContain('草稿 #2 已保存')
    expect(w.emitted('changed')).toHaveLength(1)

    hoisted.createStationAllocationDraft.mockResolvedValueOnce(draftResult(3))
    await button('保存草稿并校验')!.trigger('click')
    await flushPromises()
    expect(hoisted.createStationAllocationDraft).toHaveBeenLastCalledWith(8, expect.anything())
    ;(w.vm as unknown as { form: { evidenceIds: number[] } }).form.evidenceIds = [5]
    await nextTick()
    let resolveConfirm: (v: unknown) => void = () => {}
    hoisted.confirmStationAllocationSet.mockImplementationOnce(() => new Promise((resolve) => { resolveConfirm = resolve }))
    await button('确认分配')!.trigger('click')
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true })
    await nextTick()
    resolveConfirm({ allocationSetId: 23, setNo: 3, status: 'CONFIRMED', confirmedAt: '', segments: [] })
    await flushPromises()
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(button('保存草稿并校验')).toBeDefined()
  })

  it('服务端拒绝超额确认：提示原分配不变与当前可分配余额；正式交易分解未选依据时确认按钮禁用', async () => {
    hoisted.createStationAllocationDraft.mockResolvedValue({ allocationSetId: 10, setNo: 2, status: 'DRAFT', revisionNo: 1, validation: { blocking: false, blockingCount: 0, warningCount: 0, summary: [], completeness: null, segments: [segment()] } })
    hoisted.confirmStationAllocationSet.mockRejectedValue({ failure: {
      status: 422, errorCode: 'VALIDATION_FAILED', message: '合同总量片段电量 1000 MWh，分配合计 1100 MWh，超出 100 MWh；原分配保持不变',
      details: { code: 'ALLOCATION_EXCEEDS_SEGMENT', segments: [segment({ status: 'EXCEEDS', excessQuantity: '100' })], currentEffective: { setNo: 1, segments: [segment()] } },
    } })
    const w = await open()
    await w.findAll('button').find((b) => b.text() === '保存草稿并校验')!.trigger('click')
    await flushPromises()
    const confirmButton = () => w.findAll('button').find((b) => b.text() === '确认分配')!
    expect(confirmButton().attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('正式交易分解必须选择依据资料')
    ;(w.vm as unknown as { form: { evidenceIds: number[] } }).form.evidenceIds = [5]
    await nextTick()
    await confirmButton().trigger('click')
    await flushPromises()
    expect(hoisted.confirmStationAllocationSet).toHaveBeenCalledWith(10, { evidenceIds: [5], basisNote: undefined })
    expect(w.text()).toContain('原分配保持不变')
    expect(w.text()).toContain('当前生效的分配（#1）保持不变，可分配余额：合同总量 100 MWh')
  })
})
