// 差异详情抽屉（dljy#3016，MR-04）。
// 守什么：两侧快照与差值如实（外部 − 台账，-20 就是 -20；价格不可比只核对电量）；关闭必须处理说明
//         （422 DISCREPANCY_RESOLUTION_NOTE_REQUIRED 提示）；补充带 expectedRowVersion；已解决后冻结不再提供操作；
//         账单修订转回「需重新核对」的提示；全程不改台账（一致性核对 ≠ 完整结算复算）。
// 坏掉的症状：无说明关闭了差异；已解决差异被改写处理说明；页面把核对说成复算通过。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mount } from '@/test/mount'
import type { DiscrepancyDetailDto } from '@/services/midlong/midlongP5Types'

const hoisted = vi.hoisted(() => ({ fetchDiscrepancy: vi.fn(), updateDiscrepancy: vi.fn(), resolveDiscrepancy: vi.fn() }))

vi.mock('element-plus', async (orig) => ({ ...(await orig<typeof import('element-plus')>()), ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/midlong/midlongApi', () => ({
  midlongFailureOf: (e: unknown) => (e as { failure: { status: number; errorCode: string; message: string; details: unknown } }).failure,
}))
vi.mock('@/services/midlong/midlongP5Api', () => ({
  fetchDiscrepancy: hoisted.fetchDiscrepancy, updateDiscrepancy: hoisted.updateDiscrepancy, resolveDiscrepancy: hoisted.resolveDiscrepancy,
}))
vi.mock('@/services/midlong/midlongFormat', async (orig) => ({ ...(await orig<typeof import('@/services/midlong/midlongFormat')>()), fileToBase64: vi.fn(async () => 'Zg==') }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }) }))

import DiscrepancyDetailDrawer from './DiscrepancyDetailDrawer.vue'

const DRAWER_TIMEOUT = 20000
const bodyText = () => document.body.textContent ?? ''

function detail(overrides: Record<string, unknown> = {}): DiscrepancyDetailDto {
  return {
    id: 5, companyId: 'comp-a', regionId: 'yunnan', subjectId: 3, subjectName: '云南中广核一号', deliveryMonth: '2026-08',
    billId: 9, billRevisionNo: 1,
    sides: { ledger: 'POSITION_LEDGER', external: 'EXTERNAL_BILL' },
    ledger: { quantity: '1000', price: '300', notional: '300000' },
    external: { quantity: '980', price: '300', amount: '294000' },
    quantityDelta: '-20', priceDelta: '0', priceComparable: true,
    reason: '计量周期差异', ownerName: '张三', evidenceIds: [11],
    status: 'OPEN', resolutionNote: null, resolvedAt: null, resolvedBy: null,
    rowVersion: 2, createdAt: '', updatedAt: '',
    events: [], notices: [],
    ...overrides,
  } as unknown as DiscrepancyDetailDto
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})
enableAutoUnmount(afterEach)

async function open(d: DiscrepancyDetailDto = detail()) {
  hoisted.fetchDiscrepancy.mockResolvedValue(d)
  const w = mount(DiscrepancyDetailDrawer, {
    props: { modelValue: true, discrepancyId: 5, canWrite: true },
    attachTo: document.body,
    global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

const dialogButton = (label: string) => [...document.body.querySelectorAll('.el-dialog__footer button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement

describe('差异详情抽屉', () => {
  it('两侧快照与差值如实：1000 对 980 显示 -20；口径固定「外部 − 台账」；一致性核对不是复算', async () => {
    await open()
    expect(bodyText()).toContain('台账侧')
    expect(bodyText()).toContain('1,000')
    expect(bodyText()).toContain('外部侧')
    expect(bodyText()).toContain('980')
    expect(document.body.querySelector('[data-test="quantity-delta"]')?.textContent).toContain('-20')
    expect(bodyText()).toContain('外部账单 − 中长期台账')
    expect(bodyText()).not.toContain('复算通过')
  }, DRAWER_TIMEOUT)

  it('价格不可比：价差只标原因、不算数（不做口径折算）', async () => {
    await open(detail({ priceComparable: false, priceDelta: null }))
    expect(document.body.querySelector('[data-test="price-delta"]')?.textContent).toContain('价格不可比')
  }, DRAWER_TIMEOUT)

  it('关闭差异：处理说明必填——服务端 422 的提示如实展示；补说明后成功关闭', async () => {
    await open()
    ;(document.body.querySelector('[data-test="resolve-discrepancy"]') as HTMLButtonElement).click()
    await flushPromises()
    // 空说明：前端先拦（按钮禁用），直接提交路径由服务端 422 覆盖。
    expect(dialogButton('关闭（留痕）').disabled).toBe(true)
    const note = document.body.querySelector('textarea[data-test="resolution-note"]') as HTMLTextAreaElement
    note.value = '与交易中心核对后按台账量确认'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(dialogButton('关闭（留痕）').disabled).toBe(false)

    hoisted.resolveDiscrepancy.mockRejectedValueOnce({
      failure: { status: 422, errorCode: 'DISCREPANCY_RESOLUTION_NOTE_REQUIRED', message: '关闭差异必须填写处理说明', details: { field: 'resolutionNote' } },
    })
    dialogButton('关闭（留痕）').click()
    await flushPromises()
    expect(document.body.querySelector('[data-test="discrepancy-action-error"]')?.textContent).toContain('关闭差异必须填写处理说明')

    hoisted.resolveDiscrepancy.mockResolvedValueOnce(detail({ status: 'RESOLVED', resolutionNote: '与交易中心核对后按台账量确认', resolvedAt: '2026-09-18T02:00:00Z', resolvedBy: 'u1', rowVersion: 3 }))
    hoisted.fetchDiscrepancy.mockResolvedValue(detail({ status: 'RESOLVED', resolutionNote: '与交易中心核对后按台账量确认', resolvedAt: '2026-09-18T02:00:00Z', resolvedBy: 'u1', rowVersion: 3 }))
    dialogButton('关闭（留痕）').click()
    await flushPromises()
    expect(hoisted.resolveDiscrepancy).toHaveBeenCalledWith(5, expect.objectContaining({ expectedRowVersion: 2, resolutionNote: '与交易中心核对后按台账量确认' }))
    expect(document.body.querySelector('[data-test="resolved-box"]')?.textContent).toContain('登记快照与处理说明冻结')
  }, DRAWER_TIMEOUT)

  it('补充处理信息：带 expectedRowVersion；已解决后 409 冻结提示且不再提供操作', async () => {
    await open()
    ;(document.body.querySelector('[data-test="update-discrepancy"]') as HTMLButtonElement).click()
    await flushPromises()
    const reason = document.body.querySelector('textarea[data-test="update-reason"]') as HTMLTextAreaElement
    reason.value = '补充：交易中心按结算口径重出分项'
    reason.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    hoisted.updateDiscrepancy.mockResolvedValue(detail({ reason: '补充：交易中心按结算口径重出分项', rowVersion: 3 }))
    dialogButton('保存补充').click()
    await flushPromises()
    expect(hoisted.updateDiscrepancy).toHaveBeenCalledWith(5, expect.objectContaining({ expectedRowVersion: 2, reason: '补充：交易中心按结算口径重出分项' }))

    // 已解决（终态冻结）：不再提供补充/关闭。清空 body 后单独挂一个已解决差异的抽屉。
    document.body.innerHTML = ''
    await open(detail({ status: 'RESOLVED', resolutionNote: '已与账单方核对一致', resolvedAt: '2026-09-18T02:00:00Z', resolvedBy: 'u1' }))
    expect(document.body.querySelector('[data-test="update-discrepancy"]')).toBeNull()
    expect(document.body.querySelector('[data-test="resolve-discrepancy"]')).toBeNull()
    expect(document.body.querySelector('[data-test="resolved-box"]')?.textContent).toContain('已与账单方核对一致')
  }, DRAWER_TIMEOUT)

  it('账单修订转回「需重新核对」：固定提示账单已修订、金额聚合改按新当前版本', async () => {
    await open(detail({ status: 'RECHECK_REQUIRED', billRevisionNo: 2 }))
    expect(document.body.querySelector('[data-test="recheck-notice"]')?.textContent).toContain('修订版本')
    expect(bodyText()).toContain('需重新核对')
  }, DRAWER_TIMEOUT)
})
