// 套保工作台「维护」页签组件测试（build-midlong-spot-hedging 任务 8.6，HW-10/HB-01..07/HG-07/HC-03；
// #3420 自外壳 spec 搬入，ChenShi-Tech/dljy#3423 四个入口补齐）。
//
// 守的不变量：409 提示刷新后重试；422 按 details.field 定位到具体输入框；403 或接口声明不可写即整页只读并注明所需权限；
// 机制参数比例上调未填说明不发请求；确认请求带用户填写的生效期；基准月份随所选范围变化（默认按当前日期）；
// 写入成功即 notifyDataChanged；写请求进行中不重复提交，成功后表单照常关闭。
// 坏掉的症状：月份又写死；确认生效期写死 2025-06-01；比例上调无说明也能确认；无权限用户点了才发现不能写；双击生成两个版本。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
import { enableAutoUnmount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BAND_PRESETS } from 'shared/hedge/band-presets.mjs'

// 「今天」固定为 2027-05-15（北京时间）：默认月份范围只能从当前日期推出，不可能是旧实现写死的 2026-10..2026-12。
const clock = vi.hoisted(() => ({ today: '2027-05-15' }))
vi.mock('shared/midlong/dates.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('shared/midlong/dates.mjs')>()),
  beijingToday: () => clock.today,
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  return { selectedCompanyId: ref('comp-a') }
})

const api = vi.hoisted(() => ({
  fetchBandPresets: vi.fn(),
  fetchBandSchemes: vi.fn(),
  fetchBandActivation: vi.fn(),
  createBandScheme: vi.fn(),
  addBandSchemeVersion: vi.fn(),
  switchBandActivation: vi.fn(),
  fetchBaselines: vi.fn(),
  putBaselines: vi.fn(),
  fetchMechanismParams: vi.fn(),
  createMechanismParam: vi.fn(),
  appendMechanismVersion: vi.fn(),
  fetchCaps: vi.fn(),
  putCaps: vi.fn(),
  fetchMaintenanceStations: vi.fn(),
  fetchMaintenanceSubjects: vi.fn(),
  fetchMaintenanceWriteAccess: vi.fn(),
}))
vi.mock('@/services/hedge/hedgeMaintenanceApi', () => api)

import HedgeMaintenanceTab from './HedgeMaintenanceTab.vue'
import { mountHedgeTab } from '@/test/hedgeWorkbench'

enableAutoUnmount(afterEach)

/** 与 HedgeApiError 同形（维护页按 status/errorCode/details 判读，不依赖类本身）。 */
class FakeHedgeApiError extends Error {
  constructor(public status: number, public errorCode: string, message: string, public details: Record<string, unknown> | null = null) {
    super(message)
  }
}
const hedgeApiError = (status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) =>
  new FakeHedgeApiError(status, errorCode, message, details)

const TIERS_V1 = { DAY_AHEAD: { lower: '0.8', upper: '1' }, INTRA_MONTH: { lower: '0.7', upper: '0.95' }, FORWARD: { lower: null, upper: null } }
const ACTIVE_ROW = {
  activationId: 41, schemeId: 7, name: '公司自定义', versionNo: 1, effectiveFrom: '2027-04-01T00:00:00.000Z', effectiveTo: null,
  reason: '初始配置', activatedBy: 'boss', activatedAt: '2027-04-01T00:00:00.000Z', rowVersion: 1,
}

function mechanismRows() {
  const base = { mechanismPrice: '335.8', priceUnit: 'CNY_PER_MWH', projectClass: 'EXISTING', referenceBasis: 'MIDLONG_MONTHLY_AVG', sourceNote: '720 号文', endReason: null, overrideNote: null, recordedBy: 'boss', recordedAt: '2026-06-01T00:00:00.000Z' }
  return [
    { ...base, periodKey: 'p2025', stationId: 10, versionNo: 3, effectiveFrom: '2025-06-01', effectiveTo: '2026-05-31', ratio: '0.5', status: 'CONFIRMED' },
    { ...base, periodKey: 'p2026', stationId: 10, versionNo: 1, effectiveFrom: null, effectiveTo: null, ratio: '0.55', status: 'PENDING' },
  ]
}

function resetApi() {
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchBandPresets.mockResolvedValue({
    rows: BAND_PRESETS.map((p) => ({ key: p.key, label: p.label, basis: p.basis, scenario: p.scenario, tiers: p.tiers })),
    note: '预置方案数值均为推断（INFERENCE，仅供参考）',
  })
  api.fetchBandSchemes.mockResolvedValue({
    rows: [{ schemeId: 7, name: '公司自定义', origin: 'CUSTOM', presetKey: null, versions: [
      { versionNo: 1, basis: 'WITH_MECHANISM', tiers: TIERS_V1, note: null, recordedAt: '2027-04-01T00:00:00.000Z' },
    ] }],
  })
  api.fetchBandActivation.mockResolvedValue({
    current: ACTIVE_ROW, asOf: null, active: { ...ACTIVE_ROW, basis: 'WITH_MECHANISM', tiers: TIERS_V1 }, history: [ACTIVE_ROW],
  })
  api.createBandScheme.mockResolvedValue({ schemeId: 99, name: '预置·保守', origin: 'PRESET', presetKey: 'CONSERVATIVE', versionNo: 1, basis: 'WITH_MECHANISM' })
  api.addBandSchemeVersion.mockResolvedValue({ schemeId: 7, versionNo: 2, basis: 'WITH_MECHANISM' })
  api.switchBandActivation.mockResolvedValue({ activationId: 42, schemeId: 99, versionNo: 1, basis: 'WITH_MECHANISM', name: '预置·保守', effectiveFrom: '2030-01-01T00:00:00.000Z', rowVersion: 42 })
  api.fetchMaintenanceStations.mockResolvedValue([{ id: 10, name: '甲风电' }, { id: 11, name: '乙光伏' }])
  api.fetchBaselines.mockResolvedValue({
    rows: [{ stationId: 10, month: '2027-05', quantityMwh: '1500', basisNote: '经营计划', versionNo: 2, recordedBy: 'boss', recordedAt: '2027-04-20T00:00:00.000Z' }],
  })
  api.putBaselines.mockResolvedValue({ rows: [] })
  api.fetchMechanismParams.mockResolvedValue({ rows: mechanismRows() })
  api.createMechanismParam.mockResolvedValue({ periodKey: 'new', stationId: 10, versionNo: 1, status: 'PENDING' })
  api.appendMechanismVersion.mockResolvedValue({ periodKey: 'p2026', versionNo: 2, status: 'CONFIRMED' })
  api.fetchMaintenanceSubjects.mockResolvedValue([])
  api.fetchCaps.mockResolvedValue({ rows: [{ subjectId: 1, month: '2027-06', capMwh: '100', sourceNote: '核定通知', rowVersion: 3 }] })
  api.putCaps.mockResolvedValue({ rows: [{ subjectId: 1, month: '2027-06', capMwh: '120', sourceNote: '核定通知', rowVersion: 4 }] })
  api.fetchMaintenanceWriteAccess.mockResolvedValue({ writable: true, reason: null })
}

/** 挂载维护页签（对应原外壳里打开维护面板），等四个区块都载入。 */
async function openMaintenance() {
  const mounted = mountHedgeTab(HedgeMaintenanceTab)
  const { wrapper } = mounted
  await vi.waitFor(() => {
    expect(wrapper.find('[data-test="maintenance"]').exists()).toBe(true)
    expect(wrapper.findAll('button').filter((b) => b.text() === '保存').length).toBeGreaterThan(0)
    expect(wrapper.findAll('[data-test="band-preset"]').length).toBe(3)
    expect(wrapper.findAll('[data-test="mech-row"]').length).toBe(2)
    expect(wrapper.findAll('[data-test="baseline-row"]').length).toBe(2)
    expect(wrapper.find('[data-test="band-current"]').text()).toContain('公司自定义')
  })
  return mounted
}

const input = (wrapper: VueWrapper, selector: string) => wrapper.find(selector).element as HTMLInputElement
const button = (wrapper: VueWrapper, selector: string) => wrapper.find(selector).element as HTMLButtonElement

describe('HedgeMaintenanceTab（HW-10）', () => {
  beforeEach(() => {
    clock.today = '2027-05-15'
    resetApi()
  })

  describe('核定上限（HB-07）', () => {
    it('维护入口 409 冲突提示刷新（8.6/HW-10）', async () => {
      const { wrapper } = await openMaintenance()
      api.putCaps.mockRejectedValue(hedgeApiError(409, 'VERSION_CONFLICT', '标注已被他人更新，请刷新后核对'))
      await wrapper.find('[data-test="caps-row"] [data-test="cap-mwh"]').setValue('120')
      const saveButtons = wrapper.findAll('button').filter((b) => b.text() === '保存')
      expect(saveButtons.length).toBeGreaterThan(0)
      await saveButtons[0]!.trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="caps-status"]').text()).toContain('409')
        expect(wrapper.find('[data-test="caps-status"]').text()).toContain('刷新后核对')
      })
    })

    it('维护入口 422 按 details.field 定位字段（8.6/HB-07）', async () => {
      const { wrapper } = await openMaintenance()
      api.putCaps.mockRejectedValue(hedgeApiError(422, 'BAND_TIER_INVALID', '比例不在允许档位', { field: 'capMwh' }))
      await wrapper.find('[data-test="caps-row"] [data-test="cap-mwh"]').setValue('120')
      const saveButtons = wrapper.findAll('button').filter((b) => b.text() === '保存')
      await saveButtons[0]!.trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="caps-status"]').text()).toContain('422')
        expect(wrapper.find('[data-test="caps-status"]').text()).toContain('字段 capMwh')
        expect(wrapper.find('[data-test="caps-row"] [data-test="cap-mwh"]').classes()).toContain('field-error')
      })
    })

    it('保存一行：带 rowVersion 与来源说明，成功后通知今明页签重取', async () => {
      const { wrapper, workbench } = await openMaintenance()
      const before = workbench.dataRevision.value
      await wrapper.find('[data-test="caps-row"] [data-test="cap-mwh"]').setValue('120')
      await wrapper.findAll('[data-test="caps-row"] button')[0]!.trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="caps-status"]').text()).toContain('核定上限已保存')
      })
      expect(api.putCaps).toHaveBeenCalledTimes(1)
      expect(api.putCaps).toHaveBeenCalledWith([{ subjectId: 1, month: '2027-06', capMwh: '120', sourceNote: '核定通知', rowVersion: 3 }])
      expect(workbench.dataRevision.value).toBe(before + 1)
      expect(wrapper.find('[data-test="caps-row"]').text()).toContain('v4')
    })

    it('来源文件必填、未改动不发请求', async () => {
      const { wrapper } = await openMaintenance()
      await wrapper.findAll('[data-test="caps-row"] button')[0]!.trigger('click')
      expect(wrapper.find('[data-test="caps-status"]').text()).toContain('未改动')
      await wrapper.find('[data-test="caps-row"] [data-test="cap-source"]').setValue('')
      await wrapper.findAll('[data-test="caps-row"] button')[0]!.trigger('click')
      expect(api.putCaps).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="caps-row"] [data-test="cap-source"]').classes()).toContain('field-error')
    })

    it('剩余可签量：接口给出才展示，没给如实显示「未提供」；交易单元来自清单并与月份展开', async () => {
      api.fetchMaintenanceSubjects.mockResolvedValue([{ id: 1, name: '一号单元', unitCode: 'U1' }])
      api.fetchCaps.mockResolvedValue({ rows: [
        { subjectId: 1, month: '2027-06', capMwh: '5000', sourceNote: '核定通知', rowVersion: 1, remainingMwh: '800' },
        { subjectId: 1, month: '2027-07', capMwh: '5000', sourceNote: '核定通知', rowVersion: 1 },
      ] })
      const { wrapper } = await openMaintenance()
      const rows = wrapper.findAll('[data-test="caps-row"]')
      expect(rows.map((row) => row.find('td').text())).toEqual(['一号单元（U1）', '一号单元（U1）', '一号单元（U1）'])
      expect(rows.map((row) => row.find('[data-test="cap-remaining"]').text())).toEqual(['未提供', '800 MWh', '未提供'])
      expect(rows[0]!.text()).toContain('2027-05')
      expect(rows[0]!.text()).toContain('核定上限未登记')
    })
  })

  describe('权限（HW-10/HB-06）', () => {
    it('维护入口 403 转只读态并说明所需权限（8.6）', async () => {
      const { wrapper } = await openMaintenance()
      await putBaselineDraft(wrapper)
      api.putBaselines.mockRejectedValue(hedgeApiError(403, 'FORBIDDEN', '当前角色无公司写权限'))
      await wrapper.find('[data-test="baseline-note"]').setValue('2027 经营计划')
      await wrapper.find('[data-test="baseline-save"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="baseline-status"]').text()).toContain('403')
        expect(wrapper.find('.readonly-note').exists()).toBe(true)
        expect(wrapper.find('.readonly-note').text()).toContain('ADMIN / 本公司 BOSS')
        expect((wrapper.find('[data-test="baseline-save"]').element as HTMLButtonElement).disabled).toBe(true)
      })
      // 整页只读：四个入口的写操作全部禁用，原因取后端信息。
      expect(wrapper.find('.readonly-note').text()).toContain('当前角色无公司写权限')
      expect(button(wrapper, '[data-test="band-custom-new"]').disabled).toBe(true)
      expect(button(wrapper, '[data-test="mech-new"]').disabled).toBe(true)
      expect(button(wrapper, '[data-test="mech-confirm"]').disabled).toBe(true)
      expect(wrapper.findAll('[data-test="caps-row"] button').every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
    })

    it('接口声明不可写：一打开就是只读，写按钮禁用，查询照常可用', async () => {
      api.fetchMaintenanceWriteAccess.mockResolvedValue({ writable: false, reason: '当前账号在本公司没有写权限，或正处于集团汇总只读视图' })
      const { wrapper } = await openMaintenance()
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="readonly-note"]').exists()).toBe(true)
      })
      expect(wrapper.find('[data-test="readonly-note"]').text()).toContain('集团汇总只读视图')
      expect(wrapper.find('[data-test="readonly-note"]').text()).toContain('ADMIN / 本公司 BOSS')
      expect(button(wrapper, '[data-test="baseline-save"]').disabled).toBe(true)
      expect(button(wrapper, '[data-test="scheme-activate"]').disabled).toBe(true)
      expect(input(wrapper, '[data-test="baseline-cell-10-2027-05"]').disabled).toBe(true)
      expect(button(wrapper, '[data-test="baseline-query"]').disabled).toBe(false)
      expect(button(wrapper, '[data-test="caps-query"]').disabled).toBe(false)
    })

    it('写权限声明取不到时按未知处理（不误判只读，写入时以 403 为准）', async () => {
      api.fetchMaintenanceWriteAccess.mockRejectedValue(new Error('capabilities 503'))
      const { wrapper } = await openMaintenance()
      expect(wrapper.find('[data-test="readonly-note"]').exists()).toBe(false)
      expect(button(wrapper, '[data-test="baseline-save"]').disabled).toBe(false)
    })
  })

  describe('月度发电基准（HG-07）', () => {
    it('月份不写死：默认当月起 3 个月，改范围后请求参数随之变化', async () => {
      const { wrapper } = await openMaintenance()
      expect(api.fetchBaselines).toHaveBeenLastCalledWith({ fromMonth: '2027-05', toMonth: '2027-07' })
      expect(input(wrapper, '[data-test="baseline-from"]').value).toBe('2027-05')
      expect(wrapper.find('[data-test="baseline-grid"] thead').text()).toContain('2027-07')
      await wrapper.find('[data-test="baseline-from"]').setValue('2027-08')
      await wrapper.find('[data-test="baseline-to"]').setValue('2027-10')
      await wrapper.find('[data-test="baseline-query"]').trigger('click')
      await vi.waitFor(() => {
        expect(api.fetchBaselines).toHaveBeenLastCalledWith({ fromMonth: '2027-08', toMonth: '2027-10' })
        expect(wrapper.find('[data-test="baseline-grid"] thead').text()).toContain('2027-10')
      })
      // 倒置范围不发请求。
      const calls = api.fetchBaselines.mock.calls.length
      await wrapper.find('[data-test="baseline-from"]').setValue('2027-12')
      await wrapper.find('[data-test="baseline-query"]').trigger('click')
      expect(api.fetchBaselines).toHaveBeenCalledTimes(calls)
      expect(wrapper.find('[data-test="baseline-range-error"]').text()).toContain('不能晚于')
    })

    it('场站来自场站清单；只提交改动格，已有版本带 expectedVersionNo，依据说明必填；成功后通知重取', async () => {
      const { wrapper, workbench } = await openMaintenance()
      expect(wrapper.findAll('[data-test="baseline-row"]').map((row) => row.find('td').text()).sort()).toEqual(['乙光伏', '甲风电'].sort())
      const before = workbench.dataRevision.value
      await putBaselineDraft(wrapper)
      await wrapper.find('[data-test="baseline-cell-11-2027-06"]').setValue('800')
      await wrapper.find('[data-test="baseline-save"]').trigger('click')
      expect(api.putBaselines).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="baseline-note"]').classes()).toContain('field-error')
      await wrapper.find('[data-test="baseline-note"]').setValue('2027 经营计划（5 月修订）')
      await wrapper.find('[data-test="baseline-save"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="baseline-status"]').text()).toContain('已保存')
      })
      expect(api.putBaselines).toHaveBeenCalledWith([
        { stationId: 10, month: '2027-05', quantityMwh: '1300', basisNote: '2027 经营计划（5 月修订）', expectedVersionNo: 2 },
        { stationId: 11, month: '2027-06', quantityMwh: '800', basisNote: '2027 经营计划（5 月修订）' },
      ])
      expect(workbench.dataRevision.value).toBe(before + 1)
    })

    it('保存期间改粒度或认知时点：已成功的写入照常收尾（写请求只随公司/地区作废，#221 审查 R1-01）', async () => {
      const { wrapper, workbench } = await openMaintenance()
      let release: (value: unknown) => void = () => {}
      api.putBaselines.mockImplementation(() => new Promise((resolve) => { release = resolve }))
      const before = workbench.dataRevision.value
      await putBaselineDraft(wrapper)
      await wrapper.find('[data-test="baseline-note"]').setValue('修订')
      await wrapper.find('[data-test="baseline-save"]').trigger('click')
      expect(api.putBaselines).toHaveBeenCalledTimes(1)
      // 写请求在途时改页头的粒度与认知时点：只改变套保计算的查询视角，不应作废维护写入。
      workbench.granularity.value = 'DAY'
      workbench.asOfInput.value = '2026-09-01'
      release({ rows: [] })
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="baseline-status"]').text()).toContain('已保存')
      })
      expect(workbench.dataRevision.value).toBe(before + 1)
    })

    it('409 按 details.index 定位到冲突的格子并提示刷新后重试', async () => {
      const { wrapper } = await openMaintenance()
      api.putBaselines.mockRejectedValue(hedgeApiError(409, 'VERSION_CONFLICT', '场站 10 2027-05 的基准已被他人更新，请刷新后核对', { field: 'items.expectedVersionNo', index: 0 }))
      await putBaselineDraft(wrapper)
      await wrapper.find('[data-test="baseline-note"]').setValue('修订')
      await wrapper.find('[data-test="baseline-save"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="baseline-status"]').text()).toContain('刷新后核对')
        expect(wrapper.find('[data-test="baseline-cell-10-2027-05"]').classes()).toContain('field-error')
      })
    })
  })

  describe('场站机制参数（HC-03）', () => {
    it('待确认与已确认清楚区分，待确认注明不参与计算', async () => {
      const { wrapper } = await openMaintenance()
      const rows = wrapper.findAll('[data-test="mech-row"]')
      expect(rows.map((row) => row.find('[data-test="mech-status"]').text())).toEqual(['已确认', '待确认'])
      expect(rows[1]!.find('[data-test="mech-pending-note"]').text()).toContain('不参与计算')
      expect(rows[0]!.find('[data-test="mech-pending-note"]').exists()).toBe(false)
      expect(rows[0]!.find('[data-test="mech-confirm"]').exists()).toBe(false)
    })

    it('比例高于上一年度未填说明：不发请求并定位到说明框', async () => {
      const { wrapper } = await openMaintenance()
      await wrapper.find('[data-test="mech-confirm"]').trigger('click')
      await wrapper.find('[data-test="mech-confirm-from"]').setValue('2026-06-01')
      expect(wrapper.find('[data-test="mech-previous-ratio"]').text()).toContain('50%')
      await wrapper.find('[data-test="mech-confirm-submit"]').trigger('click')
      expect(api.appendMechanismVersion).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="mech-form-error"]').text()).toContain('高于上一年度')
      expect(wrapper.find('[data-test="mech-override-note"]').classes()).toContain('field-error')
    })

    it('确认：请求体带用户填写的生效起止与说明（不是写死的日期），成功后关闭并通知重取', async () => {
      const { wrapper, workbench } = await openMaintenance()
      const before = workbench.dataRevision.value
      await wrapper.find('[data-test="mech-confirm"]').trigger('click')
      await wrapper.find('[data-test="mech-confirm-from"]').setValue('2026-06-01')
      await wrapper.find('[data-test="mech-confirm-to"]').setValue('2027-05-31')
      await wrapper.find('[data-test="mech-override-note"]').setValue('按全容量并网分档上调')
      await wrapper.find('[data-test="mech-confirm-submit"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="mech-confirm-form"]').exists()).toBe(false)
      })
      expect(api.appendMechanismVersion).toHaveBeenCalledWith('p2026', {
        action: 'CONFIRM', baseVersionNo: 1, effectiveFrom: '2026-06-01', effectiveTo: '2027-05-31', overrideNote: '按全容量并网分档上调',
      })
      expect(workbench.dataRevision.value).toBe(before + 1)
      expect(wrapper.find('[data-test="mechanism-status"]').text()).toContain('已确认')
    })

    it('确认必须填写生效起始：未填不发请求', async () => {
      const { wrapper } = await openMaintenance()
      await wrapper.find('[data-test="mech-confirm"]').trigger('click')
      await wrapper.find('[data-test="mech-confirm-submit"]').trigger('click')
      expect(api.appendMechanismVersion).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="mech-confirm-from"]').classes()).toContain('field-error')
    })

    it('后端 422 MECHANISM_RATIO_INCREASE_NEEDS_NOTE 也定位到说明框', async () => {
      const { wrapper } = await openMaintenance()
      api.appendMechanismVersion.mockRejectedValue(hedgeApiError(422, 'MECHANISM_RATIO_INCREASE_NEEDS_NOTE', '比例 0.55 高于上一年 0.5，须填写确认说明', { field: 'overrideNote' }))
      await wrapper.find('[data-test="mech-confirm"]').trigger('click')
      // 起始日早于前端能看到的任何已确认期：前端推不出上一年度，由后端兜底。
      await wrapper.find('[data-test="mech-confirm-from"]').setValue('2025-01-01')
      await wrapper.find('[data-test="mech-confirm-to"]').setValue('2025-05-31')
      await wrapper.find('[data-test="mech-confirm-submit"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="mech-form-error"]').text()).toContain('422')
        expect(wrapper.find('[data-test="mech-form-error"]').text()).toContain('比例上调说明')
        expect(wrapper.find('[data-test="mech-override-note"]').classes()).toContain('field-error')
      })
      expect(wrapper.find('[data-test="mech-confirm-form"]').exists()).toBe(true)
    })

    it('结束：必须选择结束原因，请求体带所选原因与 baseVersionNo', async () => {
      const { wrapper } = await openMaintenance()
      await wrapper.findAll('[data-test="mech-row"]')[0]!.find('[data-test="mech-end"]').trigger('click')
      await wrapper.find('[data-test="mech-end-submit"]').trigger('click')
      expect(api.appendMechanismVersion).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="mech-end-reason"]').classes()).toContain('field-error')
      await wrapper.find('[data-test="mech-end-reason"]').setValue('EXPIRY')
      await wrapper.find('[data-test="mech-end-submit"]').trigger('click')
      await vi.waitFor(() => {
        expect(api.appendMechanismVersion).toHaveBeenCalledWith('p2025', { action: 'END', baseVersionNo: 3, endReason: 'EXPIRY' })
      })
    })

    it('新建：比例按百分数录入并换成小数，场站取自清单', async () => {
      const { wrapper } = await openMaintenance()
      await wrapper.find('[data-test="mech-new"]').trigger('click')
      expect(wrapper.findAll('[data-test="mech-station"] option').map((o) => o.text())).toContain('乙光伏')
      await wrapper.find('[data-test="mech-station"]').setValue('11')
      await wrapper.find('[data-test="mech-ratio"]').setValue('45')
      await wrapper.find('[data-test="mech-price"]').setValue('335.8')
      await wrapper.find('[data-test="mech-project-class"]').setValue('EXISTING')
      await wrapper.find('[data-test="mech-reference-basis"]').setValue('MIDLONG_MONTHLY_AVG')
      await wrapper.find('[data-test="mech-source-note"]').setValue('云南电网机制比例通知')
      await wrapper.find('[data-test="mech-editor-save"]').trigger('click')
      await vi.waitFor(() => {
        expect(api.createMechanismParam).toHaveBeenCalledWith({
          stationId: 11, ratio: '0.45', mechanismPrice: '335.8', projectClass: 'EXISTING', referenceBasis: 'MIDLONG_MONTHLY_AVG',
          effectiveFrom: null, effectiveTo: null, sourceNote: '云南电网机制比例通知',
        })
      })
    })
  })

  describe('区间方案（HB-01..04）', () => {
    it('预置方案带出处与「推断，仅供参考」标注，并显示当前生效方案与版本', async () => {
      const { wrapper } = await openMaintenance()
      const card = wrapper.findAll('[data-test="band-preset"]')[0]!
      expect(card.text()).toContain('保守')
      expect(card.findAll('[data-test="band-preset-origin"]').every((badge) => badge.text() === '推断，仅供参考')).toBe(true)
      expect(card.findAll('.hedge-hint').map(node => node.attributes('aria-label')).join(' ')).toContain('F6')
      expect(card.findAll('.hedge-hint').map(node => node.attributes('aria-label')).join(' ')).toContain('1861')
      expect(wrapper.find('[data-test="band-current"]').text()).toContain('v1')
      expect(wrapper.find('[data-test="band-version"]').text()).toContain('生效中')
    })

    it('自定义方案校验失败定位字段：下限不小于上限不发请求', async () => {
      const { wrapper } = await openMaintenance()
      await wrapper.find('[data-test="band-custom-new"]').trigger('click')
      await wrapper.find('[data-test="band-name"]').setValue('公司方案 B')
      await wrapper.find('[data-test="band-tier-INTRA_MONTH-lower"]').setValue('90')
      await wrapper.find('[data-test="band-tier-INTRA_MONTH-upper"]').setValue('80')
      await wrapper.find('[data-test="band-custom-save"]').trigger('click')
      expect(api.createBandScheme).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="band-custom-error"]').text()).toContain('月内档下限必须小于上限')
      expect(wrapper.find('[data-test="band-tier-INTRA_MONTH-lower"]').classes()).toContain('field-error')
      expect(wrapper.find('[data-test="band-tier-DAY_AHEAD-lower"]').classes()).not.toContain('field-error')
    })

    it('后端 422 BAND_TIER_INVALID 按 details.field 定位到档位输入框', async () => {
      const { wrapper } = await openMaintenance()
      api.addBandSchemeVersion.mockRejectedValue(hedgeApiError(422, 'BAND_TIER_INVALID', '界限必须在 0 到 200% 之间（FORWARD.upper）', { field: 'tiers.FORWARD.upper' }))
      await wrapper.find('[data-test="band-add-version"]').trigger('click')
      expect(input(wrapper, '[data-test="band-tier-DAY_AHEAD-lower"]').value).toBe('80')
      await wrapper.find('[data-test="band-tier-FORWARD-upper"]').setValue('90')
      await wrapper.find('[data-test="band-custom-save"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="band-custom-error"]').text()).toContain('字段 tiers.FORWARD.upper')
        expect(wrapper.find('[data-test="band-tier-FORWARD-upper"]').classes()).toContain('field-error')
      })
      expect(api.addBandSchemeVersion).toHaveBeenCalledWith(7, expect.objectContaining({ baseVersionNo: 1, basis: 'WITH_MECHANISM' }))
    })

    it('切换生效须填写原因；预约时刻按北京时间提交，乐观令牌取未关闭生效行，成功后关闭并通知重取', async () => {
      const { wrapper, workbench } = await openMaintenance()
      const before = workbench.dataRevision.value
      await wrapper.find('[data-test="scheme-activate"]').trigger('click')
      await wrapper.find('[data-test="band-activate-submit"]').trigger('click')
      expect(api.createBandScheme).not.toHaveBeenCalled()
      expect(api.switchBandActivation).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="band-reason"]').classes()).toContain('field-error')
      await wrapper.find('[data-test="band-reason"]').setValue('预期现货偏弱，转保守')
      await wrapper.find('[data-test="band-effective-from"]').setValue('2030-01-01T08:00')
      await wrapper.find('[data-test="band-activate-submit"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="band-activate-form"]').exists()).toBe(false)
      })
      expect(api.createBandScheme).toHaveBeenCalledWith({ name: '预置·保守', origin: 'PRESET', presetKey: 'CONSERVATIVE' })
      expect(api.switchBandActivation).toHaveBeenCalledWith({
        schemeId: 99, versionNo: 1, reason: '预期现货偏弱，转保守', effectiveFrom: '2030-01-01T08:00:00+08:00', rowVersion: 41,
      })
      expect(workbench.dataRevision.value).toBe(before + 1)
      expect(wrapper.find('[data-test="scheme-status"]').text()).toContain('已切换')
    })

    it('切换生效 409：提示刷新后重试，表单保留', async () => {
      const { wrapper } = await openMaintenance()
      api.switchBandActivation.mockRejectedValue(hedgeApiError(409, 'VERSION_CONFLICT', '生效方案已被他人切换，请刷新后核对', { field: 'rowVersion' }))
      await wrapper.find('[data-test="scheme-activate"]').trigger('click')
      await wrapper.find('[data-test="band-reason"]').setValue('转保守')
      await wrapper.find('[data-test="band-activate-submit"]').trigger('click')
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="band-activate-error"]').text()).toContain('409')
        expect(wrapper.find('[data-test="band-activate-error"]').text()).toContain('刷新后核对')
      })
      expect(wrapper.find('[data-test="band-activate-form"]').exists()).toBe(true)
    })

    it('写请求进行中禁止重复提交；成功分支自己的收尾（关闭表单）不被「保存中」挡住', async () => {
      const { wrapper } = await openMaintenance()
      let release: (value: unknown) => void = () => {}
      api.switchBandActivation.mockImplementation(() => new Promise((resolve) => { release = resolve }))
      await wrapper.findAll('[data-test="band-preset"]')[1]!.find('[data-test="scheme-activate"]').trigger('click')
      await wrapper.find('[data-test="band-reason"]').setValue('一般年份')
      await wrapper.find('[data-test="band-activate-submit"]').trigger('click')
      await vi.waitFor(() => { expect(api.switchBandActivation).toHaveBeenCalledTimes(1) })
      expect(button(wrapper, '[data-test="band-activate-submit"]').disabled).toBe(true)
      await wrapper.find('[data-test="band-activate-submit"]').trigger('click')
      expect(api.switchBandActivation).toHaveBeenCalledTimes(1)
      expect(api.createBandScheme).toHaveBeenCalledTimes(1)
      release({ activationId: 43, schemeId: 99, versionNo: 1, basis: 'WITH_MECHANISM', name: '预置·均衡', effectiveFrom: '2027-05-15T00:00:00.000Z', rowVersion: 43 })
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="band-activate-form"]').exists()).toBe(false)
      })
    })
  })
  it('核定上限说明进入悬浮提示，保存和状态仍在正文', async () => {
    const {wrapper}=await openMaintenance()
    const section=wrapper.get('[data-test="caps-section"]')
    expect(section.findAll('p.hint')).toHaveLength(0)
    expect(section.findAll('.hedge-hint').some(node=>node.attributes('aria-label')?.includes('不使用装机容量'))).toBe(true)
    expect(section.get('[data-test="caps-status"]').text()).toContain('1 行已登记')
  })

})

/** 把甲风电 2027-05 的基准从 1500 改成 1300（已有 v2）。 */
async function putBaselineDraft(wrapper: VueWrapper) {
  const cell = wrapper.find('[data-test="baseline-cell-10-2027-05"]')
  expect((cell.element as HTMLInputElement).value).toBe('1500')
  await cell.setValue('1300')
}
