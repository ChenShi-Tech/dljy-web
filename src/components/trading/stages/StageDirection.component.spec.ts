// S3 方向判断组件测试（slim-s3-s7-stages 任务 6.1）
// 验收：参考区（ML 分布/套利窗口/双曲线/凯利）默认收起、跑出预测自动展开、手动收起后
// 再跑预测不强制重开；曲线主任务与写回必填不因收纳变化；灰字收 ⓘ 后不再常驻。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'

const savePreflightMock = vi.fn()
vi.mock('@/services/declarations', () => ({
  savePreflight: (...args: unknown[]) => savePreflightMock(...args)
}))

const runForecastPredictMock = vi.fn()
const runMidtermMock = vi.fn()
vi.mock('@/services/forecast/mlForecastClient', () => ({
  runForecastPredict: (...args: unknown[]) => runForecastPredictMock(...args),
  runMidterm: (...args: unknown[]) => runMidtermMock(...args),
  unavailableReasonOf: () => '不可用'
}))

vi.mock('@/services/forecast/forecastProviders', async () => {
  const { ref } = await import('vue')
  const model = { modelId: 'knn', name: 'KNN 相似日', provenance: { mock: false } }
  return {
    ensureForecastCatalog: async () => {},
    forecastCatalogState: () => ({ models: ref([model]), error: ref(''), defaultModelId: ref('knn') }),
    isModelSelectableForTarget: () => true,
    predictBlockerReason: () => null
  }
})

const listStorageAssetsMock = vi.fn()
vi.mock('@/services/trading/storageAssetsClient', () => ({
  listStorageAssets: (...args: unknown[]) => listStorageAssetsMock(...args)
}))

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan' } }
}))

import StageDirection from './StageDirection.vue'
import { mount } from '@/test/mount'

const STUBS = { AgentChatPanel: true }

/** 96 点预测夹具：日内地价波形，P10/P90 抱住中位。 */
function fixtureForecast() {
  const wave = (base: number, amp: number) =>
    Array.from({ length: 96 }, (_, i) => Math.round((base + amp * Math.sin(i / 4)) * 10) / 10)
  return { points: wave(300, 40), lower: wave(240, 30), upper: wave(360, 50) }
}

async function settle(wrapper: ReturnType<typeof mount>, rounds = 5) {
  await flushPromises()
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

function mountS3(props: Record<string, unknown> = {}) {
  return settle(
    mount(StageDirection, {
      props: { declaration: { id: 'DECL-S3', preflight: {} }, targetDate: '2026-10-10', ...props },
      global: { stubs: STUBS }
    })
  )
}

beforeEach(() => {
  savePreflightMock.mockReset()
  runForecastPredictMock.mockReset()
  runMidtermMock.mockReset()
  listStorageAssetsMock.mockReset().mockResolvedValue([])
})

describe('StageDirection 参考区收纳（slim-s3-s7-stages）', () => {
  it('参考区默认收起，四块参考内容都在折叠内；曲线主任务常驻折叠外', async () => {
    const w = await mountS3()
    const ref = w.find('details.dr-ref')
    expect(ref.exists()).toBe(true)
    expect(ref.attributes('open')).toBeUndefined()
    expect(ref.text()).toContain('预测与窗口参考')
    // slim-spot-page-explainers：summary 只留徽章「未跑」，长句移入折叠体首行
    expect(ref.text()).toContain('未跑')
    expect(ref.text()).toContain('尚未跑 2026-10-10 价格预测——跑预测后本参考区自动展开')
    expect(ref.text()).toContain('ML 价格概率分布')
    // 套利窗口/双曲线/凯利随预测产出条件渲染，收进同一折叠（见下一条预测后断言）
    expect(ref.text()).toContain('ML 分布 · 套利窗口 · 双曲线 · 凯利红线')
    expect(w.find('.dr-curve-sum').exists()).toBe(true)
  })

  it('跑出预测后折叠自动展开，分布摘要与凯利红线可见', async () => {
    runForecastPredictMock.mockResolvedValue(fixtureForecast())
    const w = await mountS3()
    await w.find('.dr-forecast .dr-fc-btn').trigger('click')
    await settle(w, 8)
    expect(w.find('details.dr-ref').attributes('open')).toBeDefined()
    expect(w.find('.dr-ref').text()).toContain('平均带宽')
    expect(w.find('.dr-ref').text()).toContain('套利窗口清单')
    expect(w.find('.dr-ref').text()).toContain('日前 vs 中长期价 双曲线对比')
    expect(w.find('.dr-ref').text()).toContain('凯利仓位上限红线')
  })

  it('手动收起后再跑预测不强制重开（手动态优先）', async () => {
    runForecastPredictMock.mockResolvedValue(fixtureForecast())
    const w = await mountS3()
    await w.find('.dr-forecast .dr-fc-btn').trigger('click')
    await settle(w, 8)
    const details = w.find('details.dr-ref')
    expect(details.attributes('open')).toBeDefined()
    // 模拟用户收起：改 DOM open 再派发 toggle（handler 读 target.open）
    ;(details.element as HTMLDetailsElement).open = false
    await details.trigger('toggle')
    await settle(w)
    expect(w.find('details.dr-ref').attributes('open')).toBeUndefined()
    // 再跑一次预测：手动态优先，不强制展开
    await w.find('.dr-forecast .dr-fc-btn').trigger('click')
    await settle(w, 8)
    expect(w.find('details.dr-ref').attributes('open')).toBeUndefined()
  })

  it('灰字收ⓘ：曲线预览与带状图 legend 不再常驻；写回必填不因收纳变化', async () => {
    const w = await mountS3()
    expect(w.text()).not.toContain('预览为逐小时抽样')
    expect(w.text()).not.toContain('实线 = P50 中位')
    expect(w.findAll('.dr-info').length).toBeGreaterThanOrEqual(2)
    const writeBtn = w
      .findAll('.dr-actions button')
      .find((b) => b.text().includes('写回'))
    expect(writeBtn).toBeTruthy()
    expect(writeBtn!.attributes('disabled')).toBeDefined()
  })
})

describe('S3 迟到守卫（fix-stale-response-guards）', () => {
  it('预测在途时切标的日：旧响应被丢弃、面板清空复位，旧日期结论不落新单', async () => {
    let resolveOld!: (v: unknown) => void
    runForecastPredictMock.mockImplementation(() => new Promise((r) => { resolveOld = r }))
    const w = await mountS3({ targetDate: '2026-10-10' })
    await w.find('.dr-forecast .dr-fc-btn').trigger('click')

    // 预测在途时切标的日（S3 面板常驻不重挂，watch 须作废在途并清状态）
    await w.setProps({ targetDate: '2026-10-11' })
    await nextTick()
    expect(w.find('details.dr-ref').text()).toContain('未跑')
    expect(w.find('details.dr-ref').text()).toContain('尚未跑 2026-10-11 价格预测——跑预测后本参考区自动展开')

    // 旧日期的响应迟到：不得落屏（参考区不得展开出分布摘要），loading 不得被旧轮卡死
    resolveOld(fixtureForecast())
    await settle(w, 8)
    expect(w.find('details.dr-ref').text()).not.toContain('平均带宽')
    expect(w.find('.dr-forecast .dr-fc-btn').attributes('disabled')).toBeUndefined()

    // 新标的日重新跑预测：照常落屏（守卫不误伤正常取数）
    runForecastPredictMock.mockResolvedValue(fixtureForecast())
    await w.find('.dr-forecast .dr-fc-btn').trigger('click')
    await settle(w, 8)
    expect(w.find('details.dr-ref').text()).toContain('平均带宽')
    w.unmount()
  })
})

// slim-spot-page-explainers：折叠头只留区块名+状态徽章（spec trading-day-workbench
// 「折叠头只留标题与状态徽章」）——AI 折叠头长句收 ⓘ。
describe('S3 折叠头徽章化（slim-spot-page-explainers）', () => {
  it('dr-ref summary 无说明长句，徽章显未跑；dr-ai 说明收 ⓘ', async () => {
    const w = await mountS3()
    const ref = w.find('details.dr-ref')
    expect(ref.find('summary .dr-sum-badge').text()).toBe('未跑')
    expect(ref.find('summary em').exists()).toBe(false)
    const ai = w.find('details.dr-ai')
    expect(ai.find('summary em').exists()).toBe(false)
    const info = ai.find('summary').findComponent({ name: 'InfoHint' })
    expect(info.exists()).toBe(true)
    expect(info.props('text')).toContain('注入 S2 判断 + ML 预测摘要')
  })
})
