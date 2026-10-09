// S7 日报收尾组件测试（slim-s3-s7-stages 任务 6.1）
// 验收：决策日志必填四件套常驻、深化字段（概率分位/置信度/决策时点）收进「更多字段」
// 折叠且摘要常显；链上记录与 T+2 回填默认收起、有待回填条目自动展开；KPI 徽章与
// 写入校验不因收纳变化。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'

const loadLogAsyncMock = vi.fn()
vi.mock('@/services/trading/decisionLogStore', () => ({
  appendAndPersistAsync: vi.fn(),
  backfillAndPersistAsync: vi.fn(),
  clearLog: vi.fn(),
  correctAndPersistAsync: vi.fn(),
  fetchServerVerdict: vi.fn().mockResolvedValue(null),
  importLocalPrototypeToServer: vi.fn(),
  loadLogAsync: (...args: unknown[]) => loadLogAsyncMock(...args),
  localPrototypeCount: () => 0,
  storageNoticeFor: (mode: string) => (mode === 'server' ? '服务端台账' : '浏览器原型')
}))

const listAssistTraceMock = vi.fn()
vi.mock('@/services/trading/assistTraceStore', () => ({
  backfillAssistActual: vi.fn(),
  linkAssistToDecision: vi.fn(),
  listAssistTrace: (...args: unknown[]) => listAssistTraceMock(...args)
}))

const savePreflightMock = vi.fn()
vi.mock('@/services/declarations', () => ({
  savePreflight: (...args: unknown[]) => savePreflightMock(...args),
  STATUS_LABEL: { DRAFT: '草稿' }
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan', shortName: '云南' } }
}))

import StageDailyClose from './StageDailyClose.vue'
import { mount } from '@/test/mount'

const STUBS = { AgentChatPanel: true, AssistTracePanel: true }

/** 决策日志条目夹具（actual=null = 待 T+2 回填）。 */
function logEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    seq: 1,
    targetDate: '2026-10-10',
    at: '2026-10-10T09:00:00Z',
    decisionPoint: '储能充放时段选择',
    judgement: '低谷 02-05 充、尖峰 19-20 放',
    rationale: '尖谷价差 340，要求价差 109',
    p10: 180,
    p50: 240,
    p90: 380,
    confidence: 70,
    author: 'trader',
    correctionOf: null,
    actual: null,
    lesson: null,
    ...overrides
  }
}

async function settle(wrapper: ReturnType<typeof mount>, rounds = 5) {
  await flushPromises()
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

function mountS7(log: unknown[] = []) {
  loadLogAsyncMock.mockResolvedValue({ mode: 'local', log, error: null })
  listAssistTraceMock.mockResolvedValue([])
  return settle(
    mount(StageDailyClose, {
      props: {
        declaration: {
          id: 'DECL-S7',
          status: 'DRAFT',
          targetDate: '2026-10-10',
          deadline: '2026-12-31T10:00:00Z',
          energyCurveMwh96: Array.from({ length: 96 }, () => 10),
          priceCurve96: [],
          preflight: {}
        },
        targetDate: '2026-10-10'
      },
      global: { stubs: STUBS }
    })
  )
}

beforeEach(() => {
  savePreflightMock.mockReset()
  loadLogAsyncMock.mockReset()
  listAssistTraceMock.mockReset()
})

describe('StageDailyClose 字段分层（slim-s3-s7-stages）', () => {
  it('必填四件套常驻，深化字段在「更多字段」折叠内默认展开且摘要常显当前值', async () => {
    const w = await mountS7()
    const more = w.find('details.dc7-more')
    expect(more.exists()).toBe(true)
    expect(more.attributes('open')).toBeDefined()
    expect(more.text()).toContain('更多字段')
    expect(more.text()).toContain('P50 240 · 置信 70')
    // 必填字段在折叠外；P10 输入在折叠内
    const dp = w.find('input[placeholder="如：储能充放时段选择"]')
    expect(dp.exists()).toBe(true)
    expect(more.element.contains(dp.element)).toBe(false)
    const p10 = w.find('.dc7-more-grid input')
    expect(p10.exists()).toBe(true)
    expect(more.element.contains(p10.element)).toBe(true)
  })

  it('链上记录与 T+2 回填默认收起（无待回填、链完整）', async () => {
    const w = await mountS7()
    const chain = w.find('details.dc7-chain')
    expect(chain.exists()).toBe(true)
    expect(chain.attributes('open')).toBeUndefined()
    expect(chain.text()).toContain('0 条 · 无待回填')
    const backfill = w.find('.dc7-backfill')
    expect(backfill.exists()).toBe(true)
    expect(chain.element.contains(backfill.element)).toBe(true)
  })

  it('存在待回填条目时链上记录折叠自动展开', async () => {
    const w = await mountS7([logEntry()])
    const chain = w.find('details.dc7-chain')
    expect(chain.attributes('open')).toBeDefined()
    expect(chain.text()).toContain('1 条待回填')
  })

  it('KPI 徽章与写入校验不因收纳变化：填写率可见、空表单禁写', async () => {
    const w = await mountS7()
    expect(w.find('.dc7-stats').text()).toContain('0/3 当日填写率')
    const submitBtn = w
      .findAll('button')
      .find((b) => b.text().includes('写入链'))
    expect(submitBtn).toBeTruthy()
    expect(submitBtn!.attributes('disabled')).toBeDefined()
  })
})
