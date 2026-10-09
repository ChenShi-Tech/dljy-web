// S2 早间分析组件测试（slim-s2-market-analysis 任务 3.1，二轮收紧后修订）
// 验收：主脸块构成（状态行/判断卡/基本面与供需比双栏，无首屏按钮横幅）、参考区默认折叠
// （日内要素/24 时段表）、三项下线（预置示例/耦合推演 UI/验签清单不再渲染）、写回 payload
// 字段集合与门禁封顶不因下线变化（17 键快照 + gate=可参考 + AI 上下文仍含 exportCoupling/
// integrityGate）、采集拉取失败消息在基本面卡内直显、AI 空闲态一句话 + 按钮后置。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const savePreflightMock = vi.fn()
vi.mock('@/services/declarations', () => ({
  savePreflight: (...args: unknown[]) => savePreflightMock(...args)
}))

const fetchCapturedMock = vi.fn()
vi.mock('@/services/captured', () => ({
  fetchCaptured: (...args: unknown[]) => fetchCapturedMock(...args)
}))

const fetchFundamentalsMock = vi.fn()
const saveFundamentalsMock = vi.fn()
vi.mock('@/services/trading/fundamentalsClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/trading/fundamentalsClient')>()
  return {
    ...actual,
    fetchFundamentals: (...args: unknown[]) => fetchFundamentalsMock(...args),
    saveFundamentals: (...args: unknown[]) => saveFundamentalsMock(...args)
  }
})

vi.mock('@/services/stance/stanceContext', async () => {
  const { ref } = await import('vue')
  return { activeStanceType: ref('SELLER') }
})

vi.mock('@/services/region/regionContext', () => ({
  currentRegion: { value: { id: 'yunnan' } }
}))

import { USAGE_GATE_LABEL } from 'shared/trading-rules/data-integrity.mjs'
import StageMarketAnalysis from './StageMarketAnalysis.vue'
import { mount } from '@/test/mount'

// AI 聊天面板打桩：本 spec 只验空闲态编排与注入上下文的契约锚，面板自身行为不在覆盖范围
const STUBS = { AgentChatPanel: true }

/** 今日申报单夹具：S2 只消费 id 与 preflight（morningReview/dataGate 读回）。 */
function todayOrder(overrides: Record<string, unknown> = {}) {
  return { id: 'DECL-TODAY', preflight: {}, ...overrides }
}

async function settle(wrapper: ReturnType<typeof mount>, rounds = 5) {
  for (let i = 0; i < rounds; i++) await nextTick()
  return wrapper
}

function mountS2(props: Record<string, unknown> = {}) {
  return settle(
    mount(StageMarketAnalysis, {
      props: { declaration: todayOrder(), targetDate: '2026-10-09', ...props },
      global: { stubs: STUBS }
    })
  )
}

beforeEach(() => {
  savePreflightMock.mockReset()
  fetchCapturedMock.mockReset()
  fetchFundamentalsMock.mockReset().mockResolvedValue([])
  saveFundamentalsMock.mockReset().mockResolvedValue(0)
})

describe('StageMarketAnalysis 主任务轴（slim-s2）', () => {
  it('主脸构成：状态行 + 判断卡 + 基本面/供需比双栏，无首屏按钮横幅', async () => {
    const w = await mountS2()
    // 状态行：三条说明性口径（来源 / 可信格数 / 写回封顶），默认一行摘要、展开见原文
    expect(w.find('.dsl').exists()).toBe(true)
    expect(w.find('.dsl').text()).toContain('数据与口径状态 3 条')
    await w.find('.dsl-bar').trigger('click')
    await settle(w)
    expect(w.find('.dsl').text()).toContain('写回口径如实封顶')
    expect(w.find('.dsl').text()).toContain('自动验签探针未接')
    // 判断卡（视觉主角）
    expect(w.find('.ma-verdict').exists()).toBe(true)
    expect(w.find('.ma-verdict').text()).toContain('均价指引')
    // 无首屏按钮横幅；数据管道按钮收进基本面卡头
    expect(w.find('.ma-presets').exists()).toBe(false)
    expect(w.find('.ma-tools').text()).toContain('采集拉取')
    expect(w.find('.ma-tools').text()).toContain('库载入')
    expect(w.find('.ma-tools').text()).toContain('保存到库')
    // 一行两列：基本面（左，输入）∥ 供需比与边际机组（右，推演）——同一 .ma-row、列宽对齐
    const rows = w.findAll('.ma-row')
    expect(rows.length).toBe(1)
    const mainPanels = rows[0].findAll('.ma-panel')
    expect(mainPanels).toHaveLength(2)
    expect(mainPanels[0].text()).toContain('基本面（分时段 · 逐格标来源）')
    expect(mainPanels[1].text()).toContain('供需比与边际机组')
    // 判断卡与 AI 晨间分析均为整行（.ma 直接子级；直接子级面板仅 AI 一个）
    expect(w.find('.ma > .ma-verdict').exists()).toBe(true)
    const aiStandalone = w.findAll('.ma > .ma-panel')
    expect(aiStandalone.length).toBe(1)
    expect(aiStandalone[0].text()).toContain('AI 晨间分析')
    // AI 空闲态：一句话 + 按钮后置
    expect(w.find('.ma-ai-idle').text()).toContain('生成晨间简报')
  })

  it('三项下线：预置示例/耦合推演 UI/验签清单不再渲染', async () => {
    const w = await mountS2()
    expect(w.text()).not.toContain('示例形态')
    expect(w.text()).not.toContain('新能源大发')
    expect(w.text()).not.toContain('外送耦合推演')
    expect(w.text()).not.toContain('八源验签')
    expect(w.find('details.ma-integrity').exists()).toBe(false)
    expect(w.find('.ma-coupling').exists()).toBe(false)
  })

  it('参考区默认折叠：24 时段表不展开；日内要素以单行常驻判断卡', async () => {
    const w = await mountS2()
    const folds = w.findAll('details.ma-fold')
    expect(folds.length).toBe(1)
    expect(folds[0].attributes('open')).toBeUndefined()
    expect(folds[0].text()).toContain('24 时段聚合视图')
    // 日内要素行：判断卡内常驻单行（煤价/省内/省外/公告输入 + 取中枢中值）
    const dayline = w.find('.ma-verdict .ma-dayline')
    expect(dayline.exists()).toBe(true)
    expect(dayline.findAll('input').length).toBeGreaterThanOrEqual(4)
    expect(dayline.text()).toContain('煤价')
    expect(dayline.text()).toContain('省内')
    expect(dayline.text()).toContain('省外')
    expect(dayline.text()).toContain('公告')
    expect(dayline.text()).toContain('取中枢中值')
  })

  it('写回 payload 与门禁不因下线变化：dataGate 键集合快照 + 门禁封顶为可参考', async () => {
    savePreflightMock.mockResolvedValue({ id: 'DECL-TODAY', preflight: { dataGate: { regime: 'balanced', writtenBy: 't' } } })
    const w = await mountS2()
    const btn = w.findAll('.ma-actions .primary').find((b) => b.text().includes('写回并进入'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await settle(w, 8)
    expect(savePreflightMock).toHaveBeenCalledOnce()
    const [id, section, payload, note] = savePreflightMock.mock.calls[0]
    expect(id).toBe('DECL-TODAY')
    expect(section).toBe('dataGate')
    // 契约快照：字段集合一字不动（slim-s2 两轮裁剪的验收锚）
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual(
      [
        'regime',
        'coverage',
        'priceCenterLow',
        'priceCenterHigh',
        'tightestSlot',
        'loosestSlot',
        'gate',
        'completenessRate',
        'weakestCredibility',
        'degradeLevel',
        'coalPriceYuanPerTon',
        'coalAnchorYuanPerMwh',
        'coalAnchorVerdict',
        'yesterdayImpact',
        'provinceCompare',
        'exportNotice',
        'hourlyExposure'
      ].sort()
    )
    // 清单下线不放宽门禁：gate 仍为自建口径封顶「可参考」
    expect((payload as Record<string, unknown>).gate).toBe('reference')
    expect((payload as Record<string, unknown>).completenessRate).toBe(1)
    expect(String(note)).toContain('S2 早间分析')
  })

  it('采集拉取失败：错误消息在基本面卡内直显（不折叠、不进状态行）', async () => {
    fetchCapturedMock.mockRejectedValue(new Error('采集网络中断'))
    const w = await mountS2()
    const pullBtn = w.findAll('.ma-tools button').find((b) => b.text().includes('采集拉取'))
    expect(pullBtn).toBeTruthy()
    await pullBtn!.trigger('click')
    await settle(w, 8)
    const err = w.find('.ma-panel .ma-pipe-err')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('采集网络中断')
    // 直显约束：错误不在任何 details 折叠内
    expect(err.element.closest('details')).toBeNull()
  })

  it('AI 简报入口：点击后挂载聊天面板，注入上下文契约锚不因下线变化', async () => {
    const w = await mountS2()
    expect(w.find('.ma-ai-start').exists()).toBe(true)
    await w.find('.ma-ai-start').trigger('click')
    await settle(w)
    const panel = w.findComponent({ name: 'AgentChatPanel' })
    expect(panel.exists()).toBe(true)
    const ctx = panel.props('contextPayload') as Record<string, unknown>
    // 耦合推演 UI 下线但默认情景计算保留；验签结论仍随上下文注入
    expect(ctx.exportCoupling).toBeTruthy()
    expect(ctx.integrityGate).toBeTruthy()
    expect(Array.isArray(ctx.fundamentals)).toBe(true)
    const gateKey = (ctx.integrityGate as Record<string, unknown>).gate as keyof typeof USAGE_GATE_LABEL
    expect(USAGE_GATE_LABEL[gateKey]).toBe('可申报')
  })
})
