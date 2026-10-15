// 审批队列 CSV 导出含模式列（dljy#3731 遗留缺陷⑨ · yunnan-launch-readiness
// spot-page-correctness delta「审批导出含模式列」）：表头含「模式」，行值与页面
// 表格同源同口径（DECLARATION_MODE_LABEL[declarationModeOf()]），线下核对能区分
// 真实申报与历史模拟。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { mount } from '@/test/mount'

const declarationsApi = vi.hoisted(() => ({ listDeclarationsPage: vi.fn() }))
const exportCsvMock = vi.hoisted(() => ({ exportCsv: vi.fn() }))

vi.mock('@/services/declarations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/declarations')>()),
  listDeclarationsPage: declarationsApi.listDeclarationsPage
}))
vi.mock('@/utils/exportCsv', () => ({ exportCsv: exportCsvMock.exportCsv }))
vi.mock('@/services/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/auth')>()),
  getCurrentUser: () => ({ username: 'auditor', roleCode: 'RISK' })
}))
vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => () => {} }))

import ApprovalQueueView from './ApprovalQueueView.vue'
import { DECLARATION_MODE_LABEL, STATUS_LABEL, type DeclarationOrder } from '@/services/declarations'

function decidedDeclaration(overrides: Partial<DeclarationOrder>): DeclarationOrder {
  return {
    id: 'DECL-FIX-1',
    targetDate: '2026-10-15',
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    status: 'APPROVED',
    mode: 'LIVE',
    companyId: 'comp-cgn-yunnan',
    region: 'yunnan',
    subjectId: null,
    subjectType: null,
    capacityMw: 30,
    energyCurveMwh96: [],
    priceCurve96: null,
    strategySource: 'manual',
    basis: 'illustrative',
    approvalRecord: [
      {
        at: '2026-10-15T09:00:00Z',
        approver: 'boss',
        role: 'BOSS',
        decision: 'approve',
        gateLevel: 'L3',
        comment: '通过'
      }
    ],
    createdBy: 'trader',
    ...overrides
  } as DeclarationOrder
}

async function mountView(): Promise<ReturnType<typeof mount>> {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: ApprovalQueueView }]
  })
  const wrapper = mount(ApprovalQueueView, {
    global: { plugins: [router], stubs: { RegionDataBanner: true } }
  })
  await flushPromises()
  return wrapper
}

function findExportButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button').find((b) => b.text().includes('导出CSV'))
}

describe('审批记录 CSV 导出含模式列（缺陷⑨）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('导出表头含模式列，行值与页面口径一致（默认仅真实申报）', async () => {
    declarationsApi.listDeclarationsPage.mockResolvedValue({
      rows: [decidedDeclaration({})],
      total: 1,
      limit: 500,
      offset: 0
    })
    const wrapper = await mountView()

    const btn = findExportButton(wrapper)
    expect(btn, '导出按钮存在').toBeTruthy()
    await btn!.trigger('click')

    expect(exportCsvMock.exportCsv).toHaveBeenCalledTimes(1)
    const [filename, headers, rows] = exportCsvMock.exportCsv.mock.calls[0] as [
      string,
      string[],
      string[][]
    ]
    expect(String(filename)).toContain('审批记录')
    expect(headers).toEqual(['申报单', '目标日', '模式', '状态', '审批人', '角色', '决策', '意见'])
    expect(rows).toHaveLength(1)
    expect(rows[0][2]).toBe(DECLARATION_MODE_LABEL.LIVE)
    expect(rows[0][3]).toBe(STATUS_LABEL.APPROVED)
  })

  it('勾选显示历史模拟单后，导出行含模拟单模式标签', async () => {
    declarationsApi.listDeclarationsPage.mockResolvedValue({
      rows: [
        decidedDeclaration({}),
        decidedDeclaration({
          id: 'DECL-REH-1',
          mode: 'REHEARSAL',
          status: 'REJECTED',
          approvalRecord: [
            {
              at: '2026-10-15T09:30:00Z',
              approver: 'risk',
              role: 'RISK',
              decision: 'reject',
              gateLevel: 'L3',
              comment: ''
            }
          ]
        })
      ],
      total: 2,
      limit: 500,
      offset: 0
    })
    const wrapper = await mountView()

    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.setValue(true)
    await flushPromises()

    const btn = findExportButton(wrapper)
    await btn!.trigger('click')

    expect(exportCsvMock.exportCsv).toHaveBeenCalledTimes(1)
    const [, , rows] = exportCsvMock.exportCsv.mock.calls[0] as [string, string[], string[][]]
    const modes = rows.map((r) => r[2])
    expect(modes).toContain(DECLARATION_MODE_LABEL.LIVE)
    expect(modes).toContain(DECLARATION_MODE_LABEL.REHEARSAL)
  })
})
