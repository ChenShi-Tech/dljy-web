// S6 中长期补仓组件测试（slim-s3-s7-stages 任务 6.1）
// 验收：上游产出与未产出处理口径合并为一行状态（DataStatusLine），回 S3 跳转保留在
// 预测电量字段行；观望带/执行落库灰字收 ⓘ；敞口评估结论与写回动作不因收纳变化。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/services/company/companyApi', () => ({
  createContract: vi.fn(),
  fetchContracts: vi.fn().mockResolvedValue([])
}))

const savePreflightMock = vi.fn()
vi.mock('@/services/declarations', () => ({
  savePreflight: (...args: unknown[]) => savePreflightMock(...args)
}))

vi.mock('@/services/stance/stanceContext', async () => {
  const { ref } = await import('vue')
  return { activeStanceType: ref<string | null>('SELLER') }
})

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan', shortName: '云南' } }
}))

import { activeStanceType } from '@/services/stance/stanceContext'
import StageContract from './StageContract.vue'
import { mount } from '@/test/mount'

const STUBS = { AgentChatPanel: true }

function order(preflight: Record<string, unknown> = {}) {
  return {
    id: 'DECL-S6',
    status: 'DRAFT',
    targetDate: '2026-10-10',
    deadline: '2026-12-31T10:00:00Z',
    energyCurveMwh96: Array.from({ length: 96 }, () => 10),
    priceCurve96: [],
    preflight,
    ...preflight
  }
}

async function settle(wrapper: ReturnType<typeof mount>, rounds = 5) {
  await flushPromises()
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

function mountS6(declarationOverrides: Record<string, unknown> = {}) {
  return settle(
    mount(StageContract, {
      props: { declaration: order(declarationOverrides), targetDate: '2026-10-10' },
      global: { stubs: STUBS }
    })
  )
}

beforeEach(() => {
  savePreflightMock.mockReset()
  ;(activeStanceType as Ref<string | null>).value = 'SELLER'
})

describe('StageContract 上游状态一行化（slim-s3-s7-stages）', () => {
  it('上游全空：一行状态 3 条可展开，回 S3 跳转保留在预测电量字段行', async () => {
    const w = await mountS6()
    expect(w.find('.cg-upstream').exists()).toBe(false)
    expect(w.find('.dsl').exists()).toBe(true)
    expect(w.find('.dsl').text()).toContain('上游产出 4 条')
    await w.find('.dsl-bar').trigger('click')
    await settle(w)
    const dsl = w.find('.dsl')
    expect(dsl.text()).toContain('S3 未产出预测')
    expect(dsl.text()).toContain('按平衡市处理')
    expect(dsl.text()).toContain('建议先观望')
    expect(dsl.text()).toContain('日前中标量未联动')
    const jump = w
      .findAll('button')
      .find((b) => b.text().includes('回 S3 补'))
    expect(jump).toBeTruthy()
  })

  it('上游齐备：状态行转为产出事实，预测电量锁定取自 S3、跳转消失', async () => {
    const forecast = { direction: 'add', confidence: 70, biasRatio: 0.1, rationale: '测试', curveMwh96: Array.from({ length: 96 }, () => 10) }
    const w = await mountS6({ forecast, dataGate: { regime: 'tight', gate: 'DECLARABLE' } })
    await w.find('.dsl-bar').trigger('click')
    await settle(w)
    expect(w.find('.dsl').text()).toContain('预测电量取自 S3：960.0 MWh')
    expect(w.find('.dsl').text()).toContain('S2 态势：偏紧')
    expect(w.find('.dsl').text()).toContain('S3 方向：增持')
    expect(
      w.findAll('button')
        .find((b) => b.text().includes('回 S3 补'))
    ).toBeUndefined()
  })

  it('灰字收ⓘ：观望带与执行落库说明不再常驻', async () => {
    const w = await mountS6()
    expect(w.text()).not.toContain('动仓的交易成本大于敞口损益')
    expect(w.text()).not.toContain('对方主体与结算条款请在合同管理页补全')
    expect(w.findAll('.cg-info').length).toBeGreaterThanOrEqual(2)
  })

  it('敞口评估结论与写回动作不因收纳变化', async () => {
    const w = await mountS6()
    expect(w.find('.cg-verdict').exists()).toBe(true)
    expect(w.find('.cg-verdict').text()).toContain('观望')
    const writeBtn = w
      .findAll('button')
      .find((b) => b.text().includes('写回并进入 S7'))
    expect(writeBtn).toBeTruthy()
  })
})
