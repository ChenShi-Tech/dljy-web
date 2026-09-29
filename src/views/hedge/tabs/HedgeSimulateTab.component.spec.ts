// 套保工作台「补仓试算」页签组件测试（openspec build-midlong-spot-hedging 任务 8.5，HM-07/HB-05；dljy#3422）。
// 组件测试文件名必须是 *.component.spec.ts 才会在 happy-dom 环境运行。
// 覆盖：试算只调 /simulate；三种形状请求体；422 按 details.field 定位；减仓超锁价提示；
// 方案对比面板零请求；切公司后结果消失回到正式口径；结果带「试算」「假设」标注；shapes 未分摊与逐时段并排。
import { enableAutoUnmount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const postSimulate = vi.fn()
const fetchContracts = vi.fn()
const fetchMaintenanceStations = vi.fn()

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { get value() { return { id: 'yunnan' } } },
}))

vi.mock('@/services/company/companyContext', async () => {
  const { ref } = await import('vue')
  const selectedCompanyId = ref('comp-a')
  return { selectedCompanyId }
})

vi.mock('@/services/hedge/hedgeApi', () => ({
  HedgeApiError: class HedgeApiError extends Error {
    status: number
    errorCode: string
    details: Record<string, unknown> | null
    constructor(status: number, errorCode: string, message: string, details: Record<string, unknown> | null = null) {
      super(message)
      this.status = status
      this.errorCode = errorCode
      this.details = details
    }
  },
  fetchContracts: (...args: unknown[]) => fetchContracts(...(args as [])),
  postSimulate: (...args: unknown[]) => postSimulate(...(args as [])),
}))

vi.mock('@/services/hedge/hedgeMaintenanceApi', () => ({
  fetchMaintenanceStations: (...args: unknown[]) => fetchMaintenanceStations(...(args as [])),
}))

import { selectedCompanyId } from '@/services/company/companyContext'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import HedgeSimulateTab from './HedgeSimulateTab.vue'
import { mountHedgeTab } from '@/test/hedgeWorkbench'
import type { HedgeWorkbench } from '../useHedgeWorkbench'
import type { VueWrapper } from '@vue/test-utils'

enableAutoUnmount(afterEach)

const AS_OF = '2026-09-15T10:00:00+08:00'

function simulatePayload() {
  return {
    basis: 'simulation',
    fromDate: '2026-09-15',
    toDate: '2026-09-16',
    granularity: 'HOUR',
    before: {
      ratio: { coverage: { coveredCount: 1, totalCount: 2 }, withMechanism: { value: '0.6', status: 'OK' }, midlongOnly: { value: '0.5', status: 'OK' } },
      intervals: [
        { start: '2026-09-15T07:00:00+08:00', covered: true, generationMwh: '50', midlongMwh: '20', mechanismMwh: '10' },
        { start: '2026-09-15T10:00:00+08:00', covered: false, generationMwh: null, midlongMwh: '15', mechanismMwh: null },
      ],
    },
    intervals: [
      { start: '2026-09-15T07:00:00+08:00', covered: true, generationMwh: '50', midlongMwh: '24', mechanismMwh: '10', exposure: { withMechanism: '16', midlongOnly: '26' } },
      { start: '2026-09-15T10:00:00+08:00', covered: false, generationMwh: null, midlongMwh: '15', mechanismMwh: null, exposure: { withMechanism: null, midlongOnly: null } },
    ],
    ratio: { coverage: { coveredCount: 2, totalCount: 2 }, withMechanism: { value: '0.68', status: 'OK' }, midlongOnly: { value: '0.64', status: 'OK' } },
    shapes: [{
      index: 0, kind: 'RECENT_ACTUAL_PROFILE', label: '近 14 天实际出力形状', assumption: '假设', days: 14,
      weightedIntervalCount: 46, skippedIntervalCount: 2, skippedStarts: ['2026-09-15T00:00:00+08:00', '2026-09-15T23:00:00+08:00'],
      note: '缺实际出力的时段不分摊，其余时段重归一化',
    }],
    note: '试算不落库',
  }
}

async function mountTab() {
  const mounted = mountHedgeTab(HedgeSimulateTab)
  await vi.dynamicImportSettled()
  mounted.workbench.asOfInput.value = AS_OF
  await nextTick()
  return mounted as { wrapper: VueWrapper; workbench: HedgeWorkbench }
}

async function runSimulate(wrapper: VueWrapper, quantity: string) {
  await wrapper.find('[data-test="simulate-qty"]').setValue(quantity)
  await wrapper.find('[data-test="simulate-run"]').trigger('click')
  await vi.dynamicImportSettled()
}

describe('HedgeSimulateTab（HM-07/HB-05）', () => {
  beforeEach(() => {
    postSimulate.mockReset()
    fetchContracts.mockReset()
    fetchMaintenanceStations.mockReset()
    selectedCompanyId.value = 'comp-a'
  })

  it('挂载零请求；试算只调 /simulate，不发其它任何请求', async () => {
    const { wrapper } = await mountTab()
    expect(postSimulate).not.toHaveBeenCalled()
    expect(fetchContracts).not.toHaveBeenCalled()
    expect(fetchMaintenanceStations).not.toHaveBeenCalled()

    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(true)
    })
    expect(postSimulate).toHaveBeenCalledTimes(1)
    expect(fetchContracts).not.toHaveBeenCalled()
    expect(fetchMaintenanceStations).not.toHaveBeenCalled()
  })

  it('FLAT 形状：窗口/电量/粒度/认知时点进请求体，形状只带 kind', async () => {
    const { wrapper } = await mountTab()
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => expect(postSimulate).toHaveBeenCalledTimes(1))
    const [body, query] = postSimulate.mock.calls[0] as unknown as [
      { window: { fromDate: string; toDate: string }; adjustments: Array<{ quantityMwh: string; shape: Record<string, unknown> }> },
      { granularity?: string; asOf?: string },
    ]
    expect(body.window).toEqual({ fromDate: '2026-09-15', toDate: '2026-09-16' })
    expect(body.adjustments).toHaveLength(1)
    expect(body.adjustments[0].quantityMwh).toBe('2000')
    expect(body.adjustments[0].shape).toEqual({ kind: 'FLAT' })
    expect(query).toEqual({ granularity: 'HOUR', asOf: AS_OF })
  })

  it('RECENT_ACTUAL_PROFILE 形状：按需取场站清单，请求体带 days 与 stationId', async () => {
    const { wrapper } = await mountTab()
    fetchMaintenanceStations.mockResolvedValue([{ id: 5, name: 'A 电站' }])
    await wrapper.find('[data-test="shape-RECENT_ACTUAL_PROFILE"]').setValue(true)
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="shape-station"] option[value="5"]').exists()).toBe(true)
    })
    await wrapper.find('[data-test="shape-days"]').setValue('30')
    await wrapper.find('[data-test="shape-station"]').setValue('5')
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '500')
    await vi.waitFor(() => expect(postSimulate).toHaveBeenCalledTimes(1))
    const [body] = postSimulate.mock.calls[0] as unknown as [{ adjustments: Array<{ shape: Record<string, unknown> }> }]
    expect(body.adjustments[0].shape).toEqual({ kind: 'RECENT_ACTUAL_PROFILE', days: 30, stationId: 5 })
    // 场站清单是形状输入的按需读取（GET），不是试算之外的写请求。
    expect(fetchMaintenanceStations).toHaveBeenCalledTimes(1)
  })

  it('CONTRACT_CURVE 形状：按需取窗口内合同，请求体带 contractId', async () => {
    const { wrapper } = await mountTab()
    fetchContracts.mockResolvedValue({ status: 'OK', contracts: [{ contractId: 201, contractName: '某购电合同', externalContractNo: 'HT-2026-01' }] })
    await wrapper.find('[data-test="shape-CONTRACT_CURVE"]').setValue(true)
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="shape-contract"] option[value="201"]').exists()).toBe(true)
    })
    await wrapper.find('[data-test="shape-contract"]').setValue('201')
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '-100')
    await vi.waitFor(() => expect(postSimulate).toHaveBeenCalledTimes(1))
    const [body] = postSimulate.mock.calls[0] as unknown as [{ adjustments: Array<{ quantityMwh: string; shape: Record<string, unknown> }> }]
    expect(body.adjustments[0].quantityMwh).toBe('-100')
    expect(body.adjustments[0].shape).toEqual({ kind: 'CONTRACT_CURVE', contractId: 201 })
    expect(fetchContracts).toHaveBeenCalledTimes(1)
    expect((fetchContracts.mock.calls[0] as unknown[])[0]).toMatchObject({ fromDate: '2026-09-15', toDate: '2026-09-16' })
  })

  it('422 按 details.field 定位到中文输入框（shape.days / granularity）', async () => {
    const { wrapper } = await mountTab()
    postSimulate.mockRejectedValueOnce(new HedgeApiError(422, 'VALIDATION_FAILED', '回看天数超出范围', { field: 'shape.days' }))
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      const status = wrapper.find('[data-test="simulate-status"]').text()
      expect(status).toContain('shape.days')
      expect(status).toContain('「回看天数」')
    })
    expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(false)

    postSimulate.mockRejectedValueOnce(new HedgeApiError(422, 'VALIDATION_FAILED', '15 分钟粒度不支持形状试算', { field: 'granularity' }))
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      const status = wrapper.find('[data-test="simulate-status"]').text()
      expect(status).toContain('granularity')
      expect(status).toContain('「粒度」')
    })
  })

  it('减仓超过锁价（SIMULATION_EXCEEDS_LOCKED）醒目提示', async () => {
    const { wrapper } = await mountTab()
    postSimulate.mockRejectedValue(new HedgeApiError(422, 'SIMULATION_EXCEEDS_LOCKED', '减仓量超过该时段的中长期锁价电量', { field: 'quantityMwh' }))
    await runSimulate(wrapper, '-9999')
    await vi.waitFor(() => {
      const exceeds = wrapper.find('[data-test="simulate-exceeds"]')
      expect(exceeds.exists()).toBe(true)
      expect(exceeds.text()).toContain('减仓被拒绝')
      expect(exceeds.text()).toContain('SIMULATION_EXCEEDS_LOCKED')
    })
    expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(false)
  })

  it('本地校验不过不发请求：电量为空/为 0、CONTRACT_CURVE 未选合同', async () => {
    const { wrapper } = await mountTab()
    await runSimulate(wrapper, '')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-status"]').text()).toContain('试算电量')
    })
    await runSimulate(wrapper, '0')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-status"]').text()).toContain('不能为 0')
    })
    fetchContracts.mockResolvedValue({ status: 'OK', contracts: [{ contractId: 201, contractName: '某购电合同' }] })
    await wrapper.find('[data-test="shape-CONTRACT_CURVE"]').setValue(true)
    await vi.waitFor(() => expect(wrapper.find('[data-test="shape-contract"]').exists()).toBe(true))
    await runSimulate(wrapper, '100')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-status"]').text()).toContain('请选择合同')
    })
    expect(postSimulate).not.toHaveBeenCalled()
  })

  it('结果带「试算」「假设」标注；逐时段正式→试算并排；未知时段如实为未知；shapes 未分摊计数与原因', async () => {
    const { wrapper } = await mountTab()
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(true)
    })
    const resultText = wrapper.find('[data-test="simulate-result"]').text()
    expect(resultText).toContain('试算')
    expect(resultText).toContain('假设')
    expect(resultText).toContain('不落库')

    // 逐时段并排：第一时段正式锁价 20 → 试算后 24；第二时段发电未知、敞口未知（不用 0 冒充）。
    const rows = wrapper.findAll('[data-test="simulate-intervals"] tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('20')
    expect(rows[0].text()).toContain('24')
    expect(rows[1].text()).toContain('未知')

    // shapes：未分摊计数、缺失时段与原因说明。
    const shapeText = wrapper.find('[data-test="shape-info-0"]').text()
    expect(shapeText).toContain('未分摊 2 个时段')
    expect(shapeText).toContain('重归一化')
    expect(shapeText).toContain('近 14 天实际出力形状')
    expect(wrapper.find('[data-test="simulate-shapes"]').text()).toContain('缺实际出力的时段不分摊')
  })

  it('对比面板零请求且随试算出判级：正式口径 0.6 在保守方案下欠保', async () => {
    const { wrapper } = await mountTab()
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="scheme-compare-table"]').exists()).toBe(true)
    })
    // 自定义方案输入也不产生任何请求。
    await wrapper.find('[data-test="custom-DAY_AHEAD-lower"]').setValue('70')
    await wrapper.find('[data-test="simulate-qty"]').setValue('300')
    expect(postSimulate).toHaveBeenCalledTimes(1)
    expect(fetchContracts).not.toHaveBeenCalled()
    expect(fetchMaintenanceStations).not.toHaveBeenCalled()

    const table = wrapper.find('[data-test="scheme-compare-table"]').text()
    expect(table).toContain('保守')
    expect(table).toContain('欠保') // 正式口径 0.6 < 保守 DAY_AHEAD 下限 0.85
    expect(wrapper.find('[data-test="scheme-compare"]').text()).toContain('对比预览') // 面板标注
  })

  it('非标准窗口不判级并如实说明（HB-02）', async () => {
    const { wrapper } = await mountTab()
    await wrapper.find('[data-test="simulate-window"]').setValue('CUSTOM')
    await wrapper.find('[data-test="simulate-from"]').setValue('2026-09-15')
    await wrapper.find('[data-test="simulate-to"]').setValue('2026-09-17')
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(true)
    })
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="scheme-compare-nonstandard"]').exists()).toBe(true)
    })
    expect(wrapper.find('[data-test="scheme-compare-table"]').exists()).toBe(false)
  })

  it('切公司后试算结果消失，回到正式口径空态（HW-06：不残留上一家公司的数据）', async () => {
    const { wrapper } = await mountTab()
    postSimulate.mockResolvedValue(simulatePayload())
    await runSimulate(wrapper, '2000')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(true)
    })
    selectedCompanyId.value = 'comp-b'
    await nextTick()
    await vi.dynamicImportSettled()
    expect(wrapper.find('[data-test="simulate-result"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="simulate-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="scheme-compare-empty"]').exists()).toBe(true)
    // 结果不落任何存储：刷新即从正式口径重来（不写 sessionStorage/localStorage）。
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })
})
