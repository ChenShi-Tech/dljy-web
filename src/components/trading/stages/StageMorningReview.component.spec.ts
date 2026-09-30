// S1 晨会复盘组件测试（slim-s1-morning-review 任务 4.1）
// 验收：主脸四块构成与无抽屉（spec「S1 主脸构成与摘要消费定位」）、深链 query 参数
// （date/declarationId/task，昨单缺失不带 declarationId）、执行偏差口径警示行紧邻数字、
// 强制补写拦截保持、含 decisionReview 历史数据的单据读回不报错、立场焦点并入写回卡头；
// 另断言 resultLayers/decisionReview/roleSpecific 随抽屉裁撤停止写入（零读者，字段保留契约内）。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/services/declarations', () => ({
  listDeclarations: (...args: unknown[]) => listDeclarationsMock(...args),
  savePreflight: (...args: unknown[]) => savePreflightMock(...args),
  STATUS_LABEL: { DRAFT: '草稿', SUBMITTED: '已提交' }
}))

const listDeclarationsMock = vi.fn()
const savePreflightMock = vi.fn()

const fetchReviewMock = vi.fn()
vi.mock('@/services/quant/quantClient', () => ({
  fetchReview: (...args: unknown[]) => fetchReviewMock(...args),
  classifyReviewError: () => ({
    kind: 'data-not-onboarded',
    title: '该地区未接入申报 vs 实际口径',
    description: '云南实际侧是三段式结算，与本偏差口径不同——诚实空态，不串读山西口径。'
  })
}))

const loadLogAsyncMock = vi.fn()
vi.mock('@/services/trading/decisionLogStore', () => ({
  loadLogAsync: () => loadLogAsyncMock(),
  storageNoticeFor: () => '原型态：决策日志存浏览器本地，服务端台账端点未部署。'
}))

const fetchRiskEventsMock = vi.fn()
vi.mock('@/services/review/reviewStoreClient', () => ({
  fetchRiskEvents: () => fetchRiskEventsMock()
}))

vi.mock('@/composables/useRegionReload', () => ({ onRegionChange: () => {} }))

vi.mock('@/services/stance/stanceContext', async () => {
  const { ref } = await import('vue')
  return { activeStanceType: ref('GENERATOR') }
})

import StageMorningReview from './StageMorningReview.vue'
import MorningRiskPanel from './MorningRiskPanel.vue'
import MorningSummaryCard from './MorningSummaryCard.vue'
import OvernightReportCard from './OvernightReportCard.vue'
import ReviewTodoBadge from './ReviewTodoBadge.vue'
import { mount } from '@/test/mount'

// 纯展示/自取数子组件打桩：本 spec 只验 S1 容器的编排与行为，各子组件有独立 spec。
const STUBS = {
  AiAssistFill: true,
  MorningSummaryCard: true,
  OvernightReportCard: true,
  ReviewTodoBadge: true,
  MorningRiskPanel: true
}

/** 昨单：96 点申报曲线 + 出清曲线（清一色 10→8，中标率 80%）。 */
function reviewedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DECL-YDAY',
    status: 'SUBMITTED',
    updatedAt: '2026-09-29T08:00:00Z',
    energyCurveMwh96: Array(96).fill(10),
    clearing: { clearedCurveMwh96: Array(96).fill(8) },
    ...overrides
  }
}

/** 后端 /review 权威返回：执行偏差 + 口径警示两条。 */
function execReviewResult(overrides: Record<string, unknown> = {}) {
  return {
    deviation: {
      points: 96,
      total_abs_deviation_mwh: 12.34,
      assessed_mwh: 5.67,
      estimated_penalty_yuan: 890,
      tolerance_pct: 0.03,
      worst_point: { datetime: '18:45', deviation: -1.2 }
    },
    actual_source: 'platform-realtime',
    caliber_caveats: ['按平台实时电量口径自算，不是电网结算或考核结论', '山西口径路由，不代表云南三段式结算'],
    ...overrides
  }
}

function logEntry(i: number) {
  return {
    id: `e${i}`,
    seq: i + 1,
    targetDate: '2026-09-29',
    decisionPoint: `决策点${i + 1}`,
    judgement: '判断',
    p10: 1,
    p90: 2,
    actual: null,
    lesson: '',
    at: '2026-09-29T09:00:00Z',
    author: 't'
  }
}

async function settle(wrapper: ReturnType<typeof mount>, rounds = 6) {
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

async function mountS1(props: Record<string, unknown> = {}) {
  return settle(
    mount(StageMorningReview, {
      props: { declaration: null, targetDate: '2026-09-30', ...props },
      global: { stubs: STUBS }
    })
  )
}

beforeEach(() => {
  listDeclarationsMock.mockReset()
  savePreflightMock.mockReset()
  fetchReviewMock.mockReset()
  loadLogAsyncMock.mockReset()
  fetchRiskEventsMock.mockReset()
  push.mockReset()
  // 默认「有昨单 + 有决策日志」的正常态；各用例按需覆盖
  listDeclarationsMock.mockResolvedValue([reviewedOrder()])
  loadLogAsyncMock.mockResolvedValue({ mode: 'server', log: [logEntry(0), logEntry(1), logEntry(2), logEntry(3)] })
  fetchRiskEventsMock.mockResolvedValue({ available: true, events: [] })
  fetchReviewMock.mockResolvedValue(execReviewResult())
  window.sessionStorage.clear()
})

describe('StageMorningReview（slim：主脸四块，摘要消费者）', () => {
  it('主脸四块构成，抽屉与九类深度区块不再呈现', async () => {
    const wrapper = await mountS1()
    // 四块：偏差结论卡 / 决策日志摘要行 / 昨日复盘摘要块 / 写回卡
    expect(wrapper.find('.mr-dev').exists()).toBe(true)
    expect(wrapper.find('.mr-logline').exists()).toBe(true)
    expect(wrapper.find('.mr-summary').exists()).toBe(true)
    expect(wrapper.text()).toContain('复盘结论 → 写回今日单据')
    // 序号体系已随抽屉裁撤移除（无 ①–⑥ 圆圈序号残留）
    for (const banned of ['④', '⑥', '六维']) {
      expect(wrapper.text()).not.toContain(banned)
    }
    // 写回契约/锁定期说明恢复为卡内下方常驻段落（用户拍板）；立场要点仍收进 el-tooltip
    // （内嵌浏览器不渲染原生 title，故用 DOM 提示）；责任归属与台账模式同理。
    const tooltips = wrapper.findAllComponents({ name: 'ElTooltip' })
    expect(tooltips.length).toBeGreaterThanOrEqual(3) // 立场要点 / 责任归属 / 台账模式
    expect(wrapper.text()).toContain('S7 日报收尾会把它带进当日闭环记录')
    expect(wrapper.text()).toContain('提交申报后本段锁定')
    // 无抽屉、无九类深度区块
    expect(wrapper.find('.mr-more').exists()).toBe(false)
    for (const banned of ['更多复盘维度', '六维摘要', '策略复盘', '市场复盘', '角色', '三问复盘单', '临场改价', '分层明细与最坏时段']) {
      expect(wrapper.text()).not.toContain(banned)
    }
    // 写回卡下仍提供深链入口（承接语），但不是「分层明细」区块本身
    expect(wrapper.text()).toContain('分层明细 · 最坏时段 · 完整复盘')
  })

  it('风险事件面板升入昨日复盘摘要块并置于报告/待办之前（重要发现主脸可见）', async () => {
    const wrapper = await mountS1()
    const summary = wrapper.find('section.mr-summary')
    const risk = summary.findComponent(MorningRiskPanel)
    expect(risk.exists()).toBe(true)
    expect(risk.props('windowLabel')).toBe('昨日 2026-09-29')
    expect(risk.props('available')).toBe(true)
    expect(summary.findComponent(OvernightReportCard).exists()).toBe(true)
    expect(summary.findComponent(ReviewTodoBadge).exists()).toBe(true)
    expect(summary.findComponent(MorningSummaryCard).props('targetDate')).toBe('2026-09-30')
  })

  it('结论行呈现两段偏差数字，口径警示一行摘要紧邻数字且可展开原文', async () => {
    const wrapper = await mountS1()
    const dev = wrapper.find('.mr-dev')
    expect(dev.text()).toContain('中标率 80.0%')
    expect(dev.text()).toContain('偏差 12.34 MWh')
    expect(dev.text()).toContain('罚款估算 890 元')
    const caveat = dev.find('.mr-caveat')
    expect(caveat.exists()).toBe(true)
    expect(caveat.find('summary').text()).toContain('2 条')
    expect(caveat.text()).toContain('按平台实时电量口径自算，不是电网结算或考核结论')
  })

  it('执行偏差诚实空态（云南未接入）：呈现空态标题与说明，无口径行无数字', async () => {
    fetchReviewMock.mockRejectedValue(new Error('region not onboarded'))
    const wrapper = await mountS1()
    const dev = wrapper.find('.mr-dev')
    expect(dev.text()).toContain('该地区未接入申报 vs 实际口径')
    expect(dev.text()).toContain('不串读山西口径')
    expect(dev.find('.mr-caveat').exists()).toBe(false)
    // 空态下执行偏差栏无数字（中标侧的「时段偏差率超限」提示属于中标摘要，保留）
    expect(dev.text()).not.toContain('偏差 12.34')
    expect(dev.text()).not.toContain('罚款估算')
  })

  it('决策日志改摘要行：条数与填写率上脸，回顾经深链落复盘中心决策评价', async () => {
    const wrapper = await mountS1()
    const line = wrapper.find('.mr-logline')
    expect(line.text()).toContain('4 条')
    expect(line.text()).toContain('服务端台账')
    await wrapper.findAll('.mr-logline .link').filter((b) => b.text().includes('复盘中心回顾'))[0]!.trigger('click')
    expect(push).toHaveBeenCalledWith({
      path: '/xhjy/review',
      query: { date: '2026-09-29', declarationId: 'DECL-YDAY', task: 'decision' }
    })
  })

  it('偏差卡深链带昨日对象参数；昨单缺失时不带 declarationId（不猜对象）', async () => {
    const withOrder = await mountS1()
    const btn = withOrder.findAll('.mr-dev .link').filter((b) => b.text().includes('完整复盘'))[0]!
    await btn.trigger('click')
    expect(push).toHaveBeenCalledWith({
      path: '/xhjy/review',
      query: { date: '2026-09-29', declarationId: 'DECL-YDAY', task: 'result' }
    })

    listDeclarationsMock.mockResolvedValue([])
    push.mockReset()
    const noOrder = await mountS1({ declaration: { id: 'DECL-TODAY', preflight: {} } })
    expect(noOrder.text()).toContain('无可复盘对象')
    const btn2 = noOrder.findAll('.mr-dev .link').filter((b) => b.text().includes('完整复盘'))
    expect(btn2.length).toBe(0) // 无昨单时偏差卡不进结论分支，无深链入口
  })

  it('强制补写拦截保持：昨日有单无日志 → 横幅可见且写回按钮禁用', async () => {
    loadLogAsyncMock.mockResolvedValue({ mode: 'server', log: [] })
    const wrapper = await mountS1({ declaration: { id: 'DECL-TODAY', preflight: {} } })
    expect(wrapper.find('.mr-backfill-block').exists()).toBe(true)
    expect(wrapper.text()).toContain('强制补写')
    const writeBtn = wrapper.findAll('button').filter((b) => b.text().includes('写回'))[0]!
    expect(writeBtn.attributes('disabled')).toBeDefined()
    expect(savePreflightMock).not.toHaveBeenCalled()
  })

  it('正常态写回：payload 保留 S2/S7 依赖字段，停写零读者的 resultLayers/decisionReview/roleSpecific', async () => {
    savePreflightMock.mockResolvedValue({ id: 'DECL-TODAY' })
    const wrapper = await mountS1({ declaration: { id: 'DECL-TODAY', preflight: {} } })
    expect(wrapper.find('.mr-backfill-block').exists()).toBe(false)
    const selects = wrapper.findAll('.mr-form select')
    await selects[0]!.setValue('load')
    await selects[1]!.setValue('forecast')
    await wrapper.find('.mr-form input[type="text"]').setValue('晚高峰预测偏低，今日上调 5% 再核')
    await settle(wrapper, 2)
    const writeBtn = wrapper.findAll('button').filter((b) => b.text().includes('写回'))[0]!
    expect(writeBtn.attributes('disabled')).toBeUndefined()
    await writeBtn.trigger('click')
    await settle(wrapper, 4)
    expect(savePreflightMock).toHaveBeenCalledTimes(1)
    const [declId, section, payload] = savePreflightMock.mock.calls[0]
    expect(declId).toBe('DECL-TODAY')
    expect(section).toBe('morningReview')
    // S2/S7 读者依赖的字段继续写
    expect(payload).toMatchObject({ reviewedDate: '2026-09-29', clearRate: 0.8, cause: 'load', lessons: '晚高峰预测偏低，今日上调 5% 再核' })
    expect(payload.executionDeviationMwh).toBe(12.34)
    expect(payload.deviationCostYuan).toBe(890)
    // 抽屉裁撤后零读者字段停写（历史数据不动，契约字段保留）
    expect(payload).not.toHaveProperty('resultLayers')
    expect(payload).not.toHaveProperty('decisionReview')
    expect(payload).not.toHaveProperty('roleSpecific')
    expect(wrapper.emitted('updated')).toBeTruthy()
  })

  it('含 decisionReview 历史数据的单据读回不报错，写回结论正常展示', async () => {
    const wrapper = await mountS1({
      declaration: {
        id: 'DECL-TODAY',
        preflight: {
          morningReview: {
            cause: 'load',
            causeLabel: '负荷预测偏差',
            responsibility: 'forecast',
            deviationCostYuan: 100,
            lessons: '历史要点',
            writtenBy: 'tester',
            decisionReview: { totalDecisions: 2, reviewedDecisions: 1, threeQuestions: [] }
          }
        }
      }
    })
    expect(wrapper.find('.mr-written').exists()).toBe(true)
    expect(wrapper.text()).toContain('已写回：负荷')
    expect(wrapper.text()).toContain('历史要点')
  })

  it('立场焦点并入写回卡头一行（电厂侧目标随单呈现）', async () => {
    const wrapper = await mountS1()
    const focus = wrapper.find('.mr-focus-line')
    expect(focus.exists()).toBe(true)
    expect(focus.text()).toContain('电厂侧复盘目标')
  })
})
