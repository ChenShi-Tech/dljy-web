// 守住日前盯盘弹窗的状态与上下文隔离（dljy#3484，规格 DW-11～DW-14，设计 D8）：
// 功能未开通/地区不支持/模型未配置/明日资料未到/运行中/失败各自如实呈现；live 默认北京时间次日且须点击才运行；
// 切地区/公司/目标日后旧响应不回填；评价失败不改结果；历史审阅标识常驻；Esc 关闭与焦点约束。
// 坏掉的症状：切到广东后云南结果覆盖新界面、明日无资料时自动跳到旧日期、评价失败把结果清空、
// 审阅结果看起来像当时已知的日前研判、Tab 跑出弹窗。
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveTradeDate } from 'shared/schema/disclosure-watch-contract.mjs'
import type { DisclosureWatchCapabilities, DisclosureWatchItem, DisclosureWatchRunResult } from 'shared/schema/disclosure-watch-contract.mjs'
import DisclosureWatchDialog from './DisclosureWatchDialog.vue'

const api = vi.hoisted(() => ({ caps: vi.fn(), run: vi.fn(), wait: vi.fn(), feedback: vi.fn(), key: vi.fn() }))
vi.mock('@/services/gridGeo/disclosureWatch', async (original) => ({
  ...await original<typeof import('@/services/gridGeo/disclosureWatch')>(),
  fetchDisclosureWatchCapabilities: api.caps,
  runDisclosureWatch: api.run,
  awaitDisclosureWatchRun: api.wait,
  submitDisclosureWatchFeedback: api.feedback,
  newDisclosureWatchIdempotencyKey: api.key,
}))
import { DisclosureWatchRequestError } from '@/services/gridGeo/disclosureWatch'

const LIVE = liveTradeDate()
const timelineStub = { name: 'TimelineStub', props: ['timeline'], template: '<div data-testid="timeline-stub" />' }
const snapshot = (dataset: string, coverageDate = LIVE) => ({ snapshotId: `snap-${dataset}`, dataset, coverageDate, receivedAt: '2026-09-29T07:00:00Z', completeness: 'complete', origin: 'capture', contentSha256: 'a'.repeat(64) })

function caps(patch: Partial<DisclosureWatchCapabilities> = {}): DisclosureWatchCapabilities {
  const datasets = ['forecast_maintenance_plan', 'actual_unplanned_unit_outage', 'forecast_must_run_stop_unit_list', 'load_forecast'].map((dataset) => ({ dataset, label: '', latest: snapshot(dataset), forTradeDate: snapshot(dataset) }))
  return { contractVersion: '1.0.0', enabled: true, regionId: 'yunnan', supportedRegion: true, modelReady: true, calibrationStatus: 'uncalibrated', liveTradeDate: LIVE, tradeDate: LIVE, datasets, errors: [], ...patch } as DisclosureWatchCapabilities
}
function item(id: string, patch: Partial<DisclosureWatchItem> = {}): DisclosureWatchItem {
  return {
    itemId: id, level: 'focus', kind: 'maintenance-plan', object: { objectKey: id, plantName: `电厂${id}`, unitName: '1号机', deviceName: null },
    change: { kind: 'new', comparedCoverageDate: '2026-09-27', detail: null }, window: { kind: 'interval', start: `${LIVE}T08:00:00`, end: `${LIVE}T18:00:00`, label: '08:00–18:00' },
    headline: `${id} 计划检修`, facts: [], reviewReasons: [], flags: [], processing: 'rule', mechanism: null, consistency: null,
    evidence: [{ ref: 'S1', sourceRef: { snapshotId: 's', rowIndex: 0 }, dataset: 'forecast_maintenance_plan', coverageDate: LIVE, receivedAt: '2026-09-29T07:00:00Z', fields: { 设备名称: `电厂${id}` } }],
    nextAction: '核对计划执行', eventId: null, ...patch,
  }
}
function result(patch: Partial<DisclosureWatchRunResult> & { feedback?: unknown[] } = {}): DisclosureWatchRunResult {
  const coverage = { status: 'complete', snapshotId: 's', coverageDate: LIVE, receivedAt: '2026-09-29T07:00:00Z', note: null }
  return {
    contractVersion: '1.0.0', runId: 'run-1', status: 'complete', mode: 'live', tradeDate: LIVE, regionId: 'yunnan', asOf: '2026-09-29T08:00:00Z',
    createdAt: '2026-09-29T08:00:00Z', finishedAt: '2026-09-29T08:00:05Z', deadlineAt: '2026-09-29T08:00:45Z', scopeLabel: '云南', calibrationStatus: 'uncalibrated',
    versions: { contract: '1.0.0', ruleset: 'dw-rules-v1', questionSet: 'dw-questions-v1', format: 'dw-format-v1', dateRule: 'dw-date-v1', budget: 'dw-budget-v1', requestModel: null, modelVersions: [] },
    inputVersion: { hash: 'hash', snapshots: [] },
    inputCoverage: { forecast_maintenance_plan: coverage, actual_unplanned_unit_outage: coverage, forecast_must_run_stop_unit_list: coverage },
    backgroundCoverage: { load_forecast: coverage }, processingCoverage: { chains: 4, modelRequired: 0, evaluated: 0, modelFailed: 0, unprocessed: 0 },
    counts: { rawRows: 4, duplicateRows: 0, chains: 4, byDisposition: { eligible: 4, 'review-needed': 0, 'out-of-scope': 0, invalid: 0 }, byLevel: { focus: 4, general: 0, review: 0 } },
    attention: 'focus', summary: '明日有 4 项重点核对', items: [item('f1'), item('g1', { level: 'general' }), item('f2'), item('f3'), item('f4')],
    background: { loadForecast: null }, usage: { calls: 0, inputTokens: null, outputTokens: null, elapsedMs: null }, errors: [],
    dataMeta: { sourceType: 'IMPORT', mock: false, productionWrite: false, persisted: true }, ...patch,
  } as DisclosureWatchRunResult
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

let wrapper: VueWrapper | null = null
function mountDialog(props: Record<string, unknown> = {}, stubs: Record<string, unknown> = { DisclosureWatchTimeline: timelineStub }) {
  wrapper = mount(DisclosureWatchDialog, { props: { regionId: 'yunnan', regionLabel: '云南', companyId: 'company-a', initialReviewDate: '2026-07-01', ...props }, attachTo: document.body, global: { stubs: { teleport: true, ...stubs } } })
  return wrapper
}
async function run(view: VueWrapper) { await view.get('[data-testid="watch-run"]').trigger('click'); await flushPromises() }

beforeEach(() => {
  vi.resetAllMocks()
  let counter = 0
  api.key.mockImplementation(() => `key-${++counter}`)
  api.caps.mockResolvedValue(caps())
  api.run.mockResolvedValue({ settled: true, result: result() })
})
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = '' })

describe('日前盯盘弹窗状态', () => {
  it('功能未开通时如实显示且不提供运行入口', async () => {
    api.caps.mockResolvedValue(caps({ enabled: false }))
    const view = mountDialog(); await flushPromises()
    expect(view.get('[data-testid="watch-disabled"]').text()).toContain('日前盯盘功能未开通')
    expect(view.find('[data-testid="watch-run"]').exists()).toBe(false)
    expect(api.run).not.toHaveBeenCalled()
  })

  it('非云南地区直接显示不支持，不请求能力也不回读云南', async () => {
    const view = mountDialog({ regionId: 'guangdong', regionLabel: '广东' }); await flushPromises()
    expect(view.get('[data-testid="watch-unsupported"]').text()).toContain('当前地区不支持日前盯盘')
    expect(view.get('[data-testid="watch-scope"]').text()).toContain('研判范围：广东')
    expect(api.caps).not.toHaveBeenCalled()
    expect(view.find('[data-testid="watch-run"]').exists()).toBe(false)
  })

  it('live 默认北京时间次日只读展示，须点击才运行，请求只含 tradeDate 与 mode', async () => {
    const view = mountDialog(); await flushPromises()
    expect(view.get('[data-testid="watch-scope"]').text()).toBe(`研判范围：云南 · 目标日 ${LIVE} · 全部机组披露（不受列表筛选影响）`)
    expect((view.get('[data-testid="watch-mode-live"]').element as HTMLInputElement).checked).toBe(true)
    expect(view.find('[data-testid="watch-review-date"]').exists()).toBe(false)
    expect(api.caps).toHaveBeenCalledWith({ regionId: 'yunnan', companyId: 'company-a' }, LIVE, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.run).not.toHaveBeenCalled()
    await run(view)
    expect(api.run).toHaveBeenCalledTimes(1)
    const [scope, request, key] = api.run.mock.calls[0]
    expect(scope).toEqual({ regionId: 'yunnan', companyId: 'company-a' })
    expect(request).toEqual({ tradeDate: LIVE, mode: 'live' })
    expect(key).toBe('key-1')
  })

  it('模型未配置仍可运行，并提示停运原因不做研判', async () => {
    api.caps.mockResolvedValue(caps({ modelReady: false }))
    const view = mountDialog(); await flushPromises()
    expect(view.get('[data-testid="watch-model-missing"]').text()).toContain('非计划停运原因不做研判')
    expect(view.get('[data-testid="watch-run"]').attributes('disabled')).toBeUndefined()
  })

  it('明日资料未到时保持目标日，只提供显式历史审阅入口，不自动跳日也不自动运行', async () => {
    const base = caps()
    api.caps.mockResolvedValue({ ...base, datasets: base.datasets.map((entry) => ({ ...entry, forTradeDate: entry.dataset === 'actual_unplanned_unit_outage' ? entry.forTradeDate : null })) })
    const view = mountDialog(); await flushPromises()
    expect(view.get('[data-testid="watch-live-missing"]').text()).toContain('明日资料未到')
    expect(view.get('[data-testid="watch-scope"]').text()).toContain(`目标日 ${LIVE}`)
    await view.get('[data-testid="watch-switch-review"]').trigger('click'); await flushPromises()
    expect((view.get('[data-testid="watch-mode-review"]').element as HTMLInputElement).checked).toBe(true)
    expect(view.get('[data-testid="watch-scope"]').text()).toContain('目标日 2026-07-01')
    expect(api.caps).toHaveBeenLastCalledWith(expect.anything(), '2026-07-01', expect.anything())
    expect(api.run).not.toHaveBeenCalled()
  })

  it('能力读取失败显示错误并可重试', async () => {
    api.caps.mockRejectedValueOnce(new DisclosureWatchRequestError('internal-error', '服务内部错误（HTTP 500）', 500))
    const view = mountDialog(); await flushPromises()
    expect(view.get('[data-testid="watch-cap-error"]').text()).toContain('服务内部错误')
    await view.get('[data-testid="watch-cap-error"] button').trigger('click'); await flushPromises()
    expect(view.find('[data-testid="watch-run"]').exists()).toBe(true)
  })
})

describe('日前盯盘运行与结果', () => {
  it('首屏只列前三项重点；结论、资料截至时点与真实日前标识；无模型判断不标试验研判', async () => {
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-summary"]').text()).toBe('明日有 4 项重点核对')
    expect(view.get('[data-testid="watch-asof"]').text()).toBe('资料截至 2026-09-29 16:00:00（北京时间）')
    expect(view.get('[data-testid="watch-mode-badge"]').text()).toBe('真实日前')
    expect(view.find('[data-testid="watch-trial-badge"]').exists()).toBe(false)
    const top = view.get('[aria-label="重点核对前三项"]')
    expect(top.findAll('.watch-item').map((node) => node.attributes('data-testid'))).toEqual(['watch-item-f1', 'watch-item-f2', 'watch-item-f3'])
    expect(top.text()).toContain('共 4 项，其余见“全部事项”')
  })

  it('有模型判断时显示试验研判标识', async () => {
    const judged = item('r1', { level: 'review', kind: 'unplanned-outage', window: { kind: 'point', start: null, end: null, label: '09:00 停机' }, mechanism: { origin: 'model', trial: true, choice: 'equipment-limit', probabilities: {}, confidence: null, modelVersion: 'jev-1.13.0', questionSetVersion: 'dw-questions-v1' } })
    api.run.mockResolvedValue({ settled: true, result: result({ items: [judged] }) })
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-trial-badge"]').text()).toBe('试验研判')
    expect(view.get('[data-testid="watch-no-focus"]').text()).toContain('不表示明日没有风险')
  })

  it('历史资料审阅：显式选日期后运行，结果区审阅标识常驻不可隐藏', async () => {
    api.run.mockResolvedValue({ settled: true, result: result({ mode: 'review', tradeDate: '2026-07-01' }) })
    const view = mountDialog({ initialReviewDate: '2026-07-03' }); await flushPromises()
    await view.get('[data-testid="watch-mode-review"]').setValue(true); await flushPromises()
    expect((view.get('[data-testid="watch-review-date"]').element as HTMLInputElement).value).toBe('2026-07-03')
    await view.get('[data-testid="watch-review-date"]').setValue('2026-07-01'); await flushPromises()
    expect(api.run).not.toHaveBeenCalled()
    await run(view)
    expect(api.run.mock.calls[0][1]).toEqual({ tradeDate: '2026-07-01', mode: 'review' })
    const badge = view.get('[data-testid="watch-mode-badge"]')
    expect(badge.text()).toBe('历史资料审阅，非当时已知回放')
    expect(badge.element.closest('details')).toBeNull()
    for (const section of ['watch-review-section', 'watch-all-section', 'watch-coverage-section']) {
      const details = view.get(`[data-testid="${section}"]`).element as HTMLDetailsElement
      details.open = true; details.dispatchEvent(new Event('toggle')); await flushPromises()
      details.open = false; details.dispatchEvent(new Event('toggle')); await flushPromises()
    }
    expect(view.get('[data-testid="watch-mode-badge"]').text()).toBe('历史资料审阅，非当时已知回放')
  })

  it('运行 60 秒仍未完成时提示仍在运行，可继续查看', async () => {
    api.run.mockResolvedValue({ settled: false, runId: 'run-9' })
    api.wait.mockResolvedValue({ settled: true, result: result({ runId: 'run-9' }) })
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-still-running"]').text()).toContain('仍在运行，可稍后查看')
    await view.get('[data-testid="watch-still-running"] button').trigger('click'); await flushPromises()
    expect(api.wait).toHaveBeenCalledWith({ regionId: 'yunnan', companyId: 'company-a' }, 'run-9', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(view.find('[data-testid="watch-result"]').exists()).toBe(true)
  })

  it('传输失败重试沿用同一幂等键；拿到终态后重新研判换新键', async () => {
    api.run.mockRejectedValueOnce(new DisclosureWatchRequestError('network', '网络异常，未能连接服务'))
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-run-error"]').text()).toContain('网络异常')
    expect(view.get('[data-testid="watch-run"]').text()).toBe('重试')
    await run(view)
    expect(api.run.mock.calls.map((call) => call[2])).toEqual(['key-1', 'key-1'])
    expect(view.get('[data-testid="watch-run"]').text()).toBe('重新研判')
    await run(view)
    expect(api.run.mock.calls.map((call) => call[2])).toEqual(['key-1', 'key-1', 'key-2'])
  })

  it('业务拒绝（冲突）显示中文错误，下次发起换新键', async () => {
    api.run.mockRejectedValueOnce(new DisclosureWatchRequestError('idempotency-conflict', '同一请求标识已用于不同参数，请重新发起研判', 409))
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-run-error"]').text()).toContain('同一请求标识已用于不同参数')
    await run(view)
    expect(api.run.mock.calls.map((call) => call[2])).toEqual(['key-1', 'key-2'])
  })

  it('只有运行头的失败运行显示错误与状态，不显示事项', async () => {
    const head = { contractVersion: '1.0.0', runId: 'run-2', status: 'failed', mode: 'live', tradeDate: LIVE, regionId: 'yunnan', asOf: '2026-09-29T08:00:00Z', createdAt: '2026-09-29T08:00:00Z', finishedAt: '2026-09-29T08:00:45Z', deadlineAt: '2026-09-29T08:00:45Z', scopeLabel: '云南', errors: [{ code: 'model-all-failed', message: '6 条停运链全部失败' }] }
    api.run.mockResolvedValue({ settled: true, result: head })
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-head-only"]').text()).toContain('研判失败')
    expect(view.get('[data-testid="watch-result-errors"]').text()).toBe('需要模型判断的事项全部研判失败：6 条停运链全部失败')
    expect(view.find('.watch-item').exists()).toBe(false)
  })

  it('日级事项不画小时区间，列在日级 / 持续性未知', async () => {
    api.run.mockResolvedValue({ settled: true, result: result({ items: [item('f1'), item('d1', { kind: 'must-run-stop', window: { kind: 'day', start: null, end: null, label: '目标日必开' } })] }) })
    const view = mountDialog({}, {}); await flushPromises(); await run(view)
    expect(view.get('[data-testid="watch-timeline-rows"]').findAll('li')).toHaveLength(1)
    expect(view.get('[data-testid="watch-undrawn"]').text()).toContain('日级要求，不画小时区间')
  })
})

describe('日前盯盘上下文隔离', () => {
  it('切地区后中止在途运行，云南旧响应不写入新地区界面', async () => {
    const pending = deferred<unknown>()
    api.run.mockReturnValue(pending.promise)
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.find('[data-testid="watch-running"]').exists()).toBe(true)
    const signal = api.run.mock.calls[0][3].signal as AbortSignal
    await view.setProps({ regionId: 'guangdong', regionLabel: '广东' }); await flushPromises()
    expect(signal.aborted).toBe(true)
    pending.resolve({ settled: true, result: result() }); await flushPromises()
    expect(view.find('[data-testid="watch-result"]').exists()).toBe(false)
    expect(view.find('[data-testid="watch-running"]').exists()).toBe(false)
    expect(view.get('[data-testid="watch-unsupported"]').text()).toContain('当前地区不支持日前盯盘')
  })

  it('切公司后在途运行被中止，旧公司运行结果不回填到新公司界面', async () => {
    const pending = deferred<unknown>()
    api.run.mockReturnValueOnce(pending.promise)
    const view = mountDialog(); await flushPromises(); await run(view)
    const signal = api.run.mock.calls[0][3].signal as AbortSignal
    await view.setProps({ companyId: 'company-b' }); await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(view.find('[data-testid="watch-running"]').exists()).toBe(false)
    pending.resolve({ settled: true, result: result({ summary: '旧公司结果' }) }); await flushPromises()
    expect(view.find('[data-testid="watch-result"]').exists()).toBe(false)
    expect(view.text()).not.toContain('旧公司结果')
    expect(view.get('[data-testid="watch-run"]').text()).toBe('开始研判')
  })

  it('切公司后旧公司的能力响应被丢弃，只用新公司的结果', async () => {
    const first = deferred<DisclosureWatchCapabilities>(), second = deferred<DisclosureWatchCapabilities>()
    api.caps.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const view = mountDialog(); await flushPromises()
    await view.setProps({ companyId: 'company-b' }); await flushPromises()
    expect(api.caps.mock.calls[1][0]).toEqual({ regionId: 'yunnan', companyId: 'company-b' })
    first.resolve(caps({ enabled: false })); await flushPromises()
    expect(view.find('[data-testid="watch-disabled"]').exists()).toBe(false)
    second.resolve(caps()); await flushPromises()
    expect(view.get('[data-testid="watch-run"]').attributes('disabled')).toBeUndefined()
  })

  it('切换目标日清空旧结果，不把旧日结果留在新目标日下', async () => {
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.find('[data-testid="watch-result"]').exists()).toBe(true)
    await view.get('[data-testid="watch-mode-review"]').setValue(true); await flushPromises()
    expect(view.find('[data-testid="watch-result"]').exists()).toBe(false)
  })
})

describe('日前盯盘评价', () => {
  async function openAll(view: VueWrapper) {
    const details = view.get('[data-testid="watch-all-section"]').element as HTMLDetailsElement
    details.open = true; details.dispatchEvent(new Event('toggle')); await flushPromises()
  }

  it('评价失败只提示错误，不改动已有结果；成功后显示已评价', async () => {
    api.feedback.mockRejectedValueOnce(new DisclosureWatchRequestError('item-not-found', '该事项不在本次研判结果中', 404)).mockResolvedValueOnce({ feedbackId: 'fb-1' })
    const view = mountDialog(); await flushPromises(); await run(view)
    const card = () => view.get('[aria-label="重点核对前三项"] [data-testid="watch-item-f1"]')
    await card().findAll('.feedback button').find((button) => button.text() === '有用')!.trigger('click'); await flushPromises()
    expect(api.feedback).toHaveBeenCalledWith({ regionId: 'yunnan', companyId: 'company-a' }, 'run-1', { itemId: 'f1', verdict: 'useful', note: null }, expect.anything())
    expect(card().get('[role="alert"]').text()).toBe('评价提交失败：该事项不在本次研判结果中')
    expect(view.get('[data-testid="watch-summary"]').text()).toBe('明日有 4 项重点核对')
    expect(view.get('[aria-label="重点核对前三项"]').findAll('.watch-item')).toHaveLength(3)
    await card().findAll('.feedback button').find((button) => button.text() === '有用')!.trigger('click'); await flushPromises()
    expect(card().get('[data-testid="watch-feedback-done"]').text()).toBe('已评价：有用')
    await openAll(view)
    expect(view.get('[data-testid="watch-all-section"] [data-testid="watch-item-f1"] [data-testid="watch-feedback-done"]').text()).toBe('已评价：有用')
  })

  it('需修正可附 ≤200 字备注', async () => {
    api.feedback.mockResolvedValue({ feedbackId: 'fb-2' })
    const view = mountDialog(); await flushPromises(); await run(view)
    const card = view.get('[aria-label="重点核对前三项"] [data-testid="watch-item-f2"]')
    await card.findAll('.feedback button').find((button) => button.text() === '需修正')!.trigger('click')
    await card.get('[data-testid="watch-feedback-note"]').setValue('计划复电时间已更正为 20:00')
    await card.findAll('.feedback button').find((button) => button.text() === '提交修正')!.trigger('click'); await flushPromises()
    expect(api.feedback.mock.calls[0][2]).toEqual({ itemId: 'f2', verdict: 'needs-correction', note: '计划复电时间已更正为 20:00' })
  })

  it('重开运行时服务端已有的本人评价显示为已评价', async () => {
    api.run.mockResolvedValue({ settled: true, result: result({ feedback: [{ feedbackId: 'fb-0', runId: 'run-1', itemId: 'f3', verdict: 'not-useful', note: null, createdAt: '2026-09-29T09:00:00Z' }] }) })
    const view = mountDialog(); await flushPromises(); await run(view)
    expect(view.get('[aria-label="重点核对前三项"] [data-testid="watch-item-f3"] [data-testid="watch-feedback-done"]').text()).toBe('已评价：无用')
  })
})

describe('日前盯盘键盘可达', () => {
  it('Esc 关闭弹窗，Tab 焦点约束在弹窗内', async () => {
    const view = mountDialog(); await flushPromises()
    expect(document.activeElement).toBe(view.get('[data-testid="disclosure-watch-dialog"]').element)
    const focusable = view.get('[data-testid="disclosure-watch-dialog"]').findAll('button:not(:disabled), input:not(:disabled), summary')
    const last = focusable.at(-1)!.element as HTMLElement
    last.focus()
    await view.get('[data-testid="disclosure-watch-dialog"]').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(view.get('[data-testid="watch-close"]').element)
    await view.get('[data-testid="disclosure-watch-dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(view.emitted('close')).toHaveLength(1)
  })
})
