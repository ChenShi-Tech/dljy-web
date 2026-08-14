// bidPlanClient 收编守卫（epic #336 PR-D）：首页当日报价方案卡的取数出口。
// 守的不变量：
//   1. 端点必须带 target_date（锚定运行日+1）——latest 裸调会返回库内最大目标日，
//      历史/未来回填的方案会被误展示成「当日报价方案」（codex P2）；
//   2. 真实或空：非 ok / 无 plan / status!=='ok' / frontier 非 Array → null，不合成摘要
//      （agent-backend 离线时卡片直接不显示，不产出误导数字）；
//   3. Mock 冻结纪律：body.mock === true 与 plan.basis.settlement_mock_fields 必须透传
//      （codex P1——云南结算系数占位时卡上必须有可见提示，收编不得丢标注）；
//   4. 数值字段脏值诚实落 null（typeof number 守卫），lambda 非有限数被过滤。
import { afterEach, describe, expect, it, vi } from 'vitest'

const identityHeaders = vi.hoisted(() => vi.fn(() => ({ 'x-user-id': 'u1' })))
vi.mock('@/services/agent/agentClient', () => ({
  identityHeaders,
  AGENT_API_BASE: '/agent-api/agent'
}))
vi.mock('@/services/api', () => ({ timeoutSignal: vi.fn(() => 'timeout-signal-stub') }))

import { fetchLatestBidPlanSummary, nextDeclarationTargetDate } from './bidPlanClient'

const fetchMock = vi.fn()

function okBody(plan: Record<string, unknown> | null, mock = false) {
  return new Response(JSON.stringify({ plan, mock }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const OK_PLAN = {
  status: 'ok',
  target_date: '2026-08-15',
  price_model_id: 'lstm-v3',
  plan_id: 'bp-1',
  note: '单位测试口径',
  basis: { settlement_mock_fields: ['settlement_coef'] },
  frontier: [
    { lambda: 0.8, risk_level: 'aggressive', total_declared_mwh: 1200, expected_profit_yuan: 90000, var_loss_yuan: 5000 },
    { lambda: 1.0, risk_level: 'neutral', total_declared_mwh: 1100, expected_profit_yuan: 80000, var_loss_yuan: 3000 }
  ]
}

afterEach(() => {
  fetchMock.mockReset()
  identityHeaders.mockClear()
  vi.unstubAllGlobals()
})

describe('nextDeclarationTargetDate', () => {
  it('目标日 = 运行日 + 1（本地时区），补零（codex P2 锚定）', () => {
    expect(nextDeclarationTargetDate(new Date('2026-08-14T10:00:00'))).toBe('2026-08-15')
    expect(nextDeclarationTargetDate(new Date('2026-01-31T23:30:00'))).toBe('2026-02-01') // 月末跨月
    expect(nextDeclarationTargetDate(new Date('2026-12-31T09:00:00'))).toBe('2027-01-01') // 年末跨年
  })
})

describe('fetchLatestBidPlanSummary', () => {
  it('带 target_date 查询参数、走 AGENT_API_BASE、带身份头与超时', async () => {
    fetchMock.mockResolvedValue(okBody(OK_PLAN))
    vi.stubGlobal('fetch', fetchMock)

    const summary = await fetchLatestBidPlanSummary('2026-08-15')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/agent-api/agent/forecast/bid-plans/latest?target_date=2026-08-15')
    expect(init.headers).toEqual({ 'x-user-id': 'u1' })
    expect(init.signal).toBe('timeout-signal-stub')

    expect(summary).not.toBeNull()
    expect(summary!.planId).toBe('bp-1')
    // neutral 行的申报电量作为 declaredMwh（无 neutral 才回落首行——下一用例）
    expect(summary!.declaredMwh).toBe(1100)
    expect(summary!.lambdas).toEqual([0.8, 1.0])
  })

  it('无 neutral 行时 declaredMwh 回落首行；非数值字段诚实落 null', async () => {
    const plan = {
      ...OK_PLAN,
      frontier: [
        { lambda: 0.8, risk_level: 'aggressive', total_declared_mwh: '1200' }, // 脏值：字符串非 number
        { lambda: 'x' } // lambda 非有限数 → 过滤出 lambdas
      ]
    }
    fetchMock.mockResolvedValue(okBody(plan))
    vi.stubGlobal('fetch', fetchMock)

    const summary = await fetchLatestBidPlanSummary('2026-08-15')

    expect(summary!.declaredMwh).toBeNull() // '1200' 是字符串 → null，不 Number() 拉回
    expect(summary!.lambdas).toEqual([0.8]) // 'x' 被过滤，合法的 0.8 保留
    expect(summary!.frontier[1].risk_level).toBe('—')
    expect(summary!.frontier[1].expected_profit_yuan).toBeNull()
  })

  it('真实或空：非 ok / 无 plan / status!=='+"'ok'"+' / frontier 非 Array → null', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
      .mockResolvedValueOnce(okBody(null))
      .mockResolvedValueOnce(okBody({ ...OK_PLAN, status: 'skipped' }))
      .mockResolvedValueOnce(okBody({ ...OK_PLAN, frontier: 'not-array' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchLatestBidPlanSummary('2026-08-15')).resolves.toBeNull()
    await expect(fetchLatestBidPlanSummary('2026-08-15')).resolves.toBeNull()
    await expect(fetchLatestBidPlanSummary('2026-08-15')).resolves.toBeNull()
    await expect(fetchLatestBidPlanSummary('2026-08-15')).resolves.toBeNull()
  })

  it('Mock 冻结纪律：body.mock 与 basis.settlement_mock_fields 透传（codex P1）', async () => {
    fetchMock.mockResolvedValueOnce(okBody(OK_PLAN, true)) // mock=true + mockFields 齐备
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      // mockFields 缺失（basis 无 settlement_mock_fields）→ 空数组而非 undefined
      plan: { ...OK_PLAN, basis: {} }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const mocked = await fetchLatestBidPlanSummary('2026-08-15')
    expect(mocked!.mock).toBe(true)
    expect(mocked!.mockFields).toEqual(['settlement_coef'])

    const clean = await fetchLatestBidPlanSummary('2026-08-15')
    expect(clean!.mock).toBe(false)
    expect(clean!.mockFields).toEqual([])
  })

  it('note 缺省回落「决策支持参考·非申报/结算依据」（免责文案不丢）', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      plan: { status: 'ok', target_date: '2026-08-15', frontier: [{ lambda: 1 }] }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const summary = await fetchLatestBidPlanSummary('2026-08-15')
    expect(summary!.basisNote).toBe('决策支持参考·非申报/结算依据')
    expect(summary!.priceModel).toBe('—')
  })
})
