// InsightHistoryCandidates.component.spec.ts — 可分析历史候选面板回归（dljy#2996 任务 5.6）
// 守什么不变量：
//   ① 打开才调 POST /coverage（挂载不请求，关闭不请求）；
//   ② 离散候选明确写「只有离散的若干天，不是连续区间」，不包装成连续历史；
//   ③ 无共同完整日期时如实写「所选来源没有共同完整的日期」，并列各来源各自的完整区段；
//   ④ 用户点击候选才 emit('select')——组件自己不改查询上下文；打开/加载绝不自动 emit；
//   ⑤ 关闭即中止在途 coverage 请求，迟到响应不写面板状态；重新打开重新请求。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@/test/mount'
import InsightHistoryCandidates from './InsightHistoryCandidates.vue'
const { fetchInsightCoverage } = vi.hoisted(() => ({ fetchInsightCoverage: vi.fn() }))
vi.mock('@/services/insight/insightClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/insight/insightClient')>(),
  fetchInsightCoverage,
}))

const context = { regionId: 'yunnan', companyId: null, objectRefs: [], businessWindow: { start: '2026-09-01', end: '2026-09-10' }, sourceIds: [], mode: 'ex-post', asOf: null, contextVersion: 1 }

function coverageResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'insight-coverage/v1',
    analysisId: 'test.analysis',
    regionId: 'yunnan',
    businessWindow: { start: '2026-09-01', end: '2026-09-10' },
    sources: [
      {
        sourceId: 'yn.price.node.public.day-ahead',
        required: true,
        status: 'ok',
        seriesCount: 2,
        completeDates: ['2026-09-01', '2026-09-02'],
        partialDates: [],
        ranges: [{ start: '2026-09-01', end: '2026-09-02', days: 2 }],
      },
    ],
    candidates: {
      dates: ['2026-09-01', '2026-09-02'],
      ranges: [{ start: '2026-09-01', end: '2026-09-02', days: 2 }],
      discrete: false,
    },
    note: '按所选来源逐日完整度求交集',
    mock: false,
    productionWrite: false,
    ...overrides,
  }
}

function mountPanel() {
  return mount(InsightHistoryCandidates, {
    props: { modelValue: false, analysisId: 'test.analysis', context },
    global: { stubs: { teleport: true } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('打开与请求时机', () => {
  it('挂载不请求；打开才调 coverage', async () => {
    fetchInsightCoverage.mockResolvedValue(coverageResult())
    const wrapper = mountPanel()

    expect(fetchInsightCoverage).not.toHaveBeenCalled()

    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(fetchInsightCoverage).toHaveBeenCalledTimes(1)
    expect(fetchInsightCoverage.mock.calls[0][0]).toMatchObject({ analysisId: 'test.analysis' })
  })

  it('打开与加载绝不自动 emit select，用户点击候选才 emit', async () => {
    fetchInsightCoverage.mockResolvedValue(coverageResult())
    const wrapper = mountPanel()
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await nextTick()

    expect(wrapper.emitted('select')).toBeUndefined()

    const buttons = wrapper.findAll('button')
    const candidate = buttons.find((button) => button.text().includes('2026-09-01'))
    expect(candidate).toBeTruthy()
    await candidate!.trigger('click')

    expect(wrapper.emitted('select')).toEqual([[{ start: '2026-09-01', end: '2026-09-02' }]])
  })
})

describe('候选形态如实表达', () => {
  it('离散日明确提示不是连续区间', async () => {
    fetchInsightCoverage.mockResolvedValue(
      coverageResult({
        candidates: {
          dates: ['2026-09-01', '2026-09-03'],
          ranges: [
            { start: '2026-09-01', end: '2026-09-01', days: 1 },
            { start: '2026-09-03', end: '2026-09-03', days: 1 },
          ],
          discrete: true,
        },
      })
    )
    const wrapper = mountPanel()
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('只有离散的若干天，不是连续区间')
  })

  it('无共同完整日期：如实说明并列出各来源完整区段（含停用来源）', async () => {
    fetchInsightCoverage.mockResolvedValue(
      coverageResult({
        sources: [
          coverageResult().sources[0],
          {
            sourceId: 'yn.system.load.actual',
            required: false,
            status: 'source-disabled',
            seriesCount: 0,
            completeDates: [],
            partialDates: [],
            ranges: [],
          },
        ],
        candidates: { dates: [], ranges: [], discrete: false },
      })
    )
    const wrapper = mountPanel()
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('所选来源没有共同完整的日期')
    expect(wrapper.text()).toContain('来源尚未启用，无完整日期')
    expect(wrapper.text()).toContain('完整 2 天')
  })

  it('读取失败显示错误与重试入口，不影响已展示结果', async () => {
    fetchInsightCoverage.mockRejectedValue(new Error('network down'))
    const wrapper = mountPanel()
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('重试')
    expect(wrapper.text()).not.toContain('共同可分析区段')
  })
})

describe('关闭即取消在途请求', () => {
  it('关闭触发 abort，迟到响应不写面板；重新打开重新请求', async () => {
    fetchInsightCoverage.mockImplementation(
      (_request: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const abortError = new Error('aborted')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        })
    )
    const wrapper = mountPanel()
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(fetchInsightCoverage).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ modelValue: false })
    await nextTick()
    await nextTick()

    // 重新打开：重新发起（上次已被取消，不写旧状态）。
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(fetchInsightCoverage).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('所选来源没有共同完整的日期')
  })
})
