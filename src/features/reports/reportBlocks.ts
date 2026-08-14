/**
 * 报表区块构建器（BlockBuilder）：把 settlementFormula 口径接到具体区块，产出可渲染数据。
 *
 * 数据来源（重要 · 项目铁律）：当前区块基于「确定性合成场景」演算，sourceType='MOCK'，
 * note 明确标注「模拟数据」。口径公式（三部制结算、偏差考核、价格统计等）来自
 * settlementFormula.ts，真实且经 verify:report-formulas 校验。合成场景受当前地区结算口径
 * （限价 clearingPriceFloor/Cap）裁剪，因此切换地区时报表数字会相应变化，演示地区适配。
 * 真实生产取数在后续阶段按各区块 sourceModules 对应的 /api/v1 端点替换。
 *
 * 渲染数据约定（供 ReportBlockRenderer）：
 *   METRIC     → { kpis: KpiCell[] }
 *   CHART      → { option: <ECharts option> }
 *   TABLE      → { columns: Column[], rows: Record<string, unknown>[] }
 *   SETTLEMENT → { kpis: KpiCell[], columns: Column[], rows: [] }
 *   AI_TEXT    → { sections: { title: string; body: string }[] }
 */
import {
  round,
  threePartSettlement,
  deviationAssessment,
  unitEnergyMargin,
  retailSpread,
  hedgeCoverage,
  clearedRatio,
  priceStats,
  revenueAttribution
} from '@/services/settlementFormula'
import { registerBlock, type ReportBlockInstance, type BlockBuilder, type ReportParams, type BlockContext } from '@/services/reportEngine'
import { chatCompletion, refreshLlmStatus } from '@/services/llm'
import { buildReportInsightPrompt, type ReportInsightMetrics } from '@/prompts/reportInsight'
import { type Provenance } from '@/services/api'
import { fetchCaptured } from '@/services/captured'
import { extractDayAheadCurveFromListrsFull } from './reportCapture'
import { chartSpecToOption } from '@/services/chart/analysisChartSpec'
import type { AnalysisChartSpec } from '@dljy/contracts'

const MOCK_NOTE = '模拟数据：基于合成场景演算，口径公式真实可验证（settlementFormula.ts）'

type KpiCell = { label: string; value: string | number; unit?: string; tone?: 'stable' | 'warning' | 'danger' }

function block(blockId: string, blockType: ReportBlockInstance['blockType'], title: string, data: unknown, note = MOCK_NOTE, provenance?: Provenance): ReportBlockInstance {
  return { blockId, blockType, title, data, provenance: provenance ?? { sourceType: 'MOCK', realDataConnected: false }, note }
}

// ── 确定性合成场景（不使用 Math.random，保证同参数可复现） ──
function seedFrom(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Scenario = {
  points: number
  pDayAhead: number[]
  pRealtime: number[]
  pLong: number[]
  qLong: number[]
  qDayAhead: number[]
  qActual: number[]
  floor: number
  cap: number
}

function synthScenario(params: ReportParams, ctx: BlockContext): Scenario {
  const key = `${params.tradeDate ?? params.month ?? '2026-06'}|${params.regionId ?? ctx.settlementRule.regionId}|${params.subjectId ?? ''}|${params.subjectType ?? ''}`
  const rnd = mulberry32(seedFrom(key))
  const N = 96
  const floor = ctx.settlementRule.clearingPriceFloor ?? -100
  const cap = ctx.settlementRule.clearingPriceCap ?? 1500
  const clampP = (v: number) => Math.min(Math.max(v, floor), cap)
  const pDayAhead: number[] = []
  const pRealtime: number[] = []
  const pLong: number[] = []
  const qLong: number[] = []
  const qDayAhead: number[] = []
  const qActual: number[] = []
  const dailyMl = 720 // 中长期日合约总量 MWh
  for (let i = 0; i < N; i++) {
    const h = i / 4
    // 双峰形态：早高峰(9点)、晚高峰(19点)、凌晨低谷(3点)
    const shape = Math.exp(-((h - 9) ** 2) / 8) + 1.1 * Math.exp(-((h - 19) ** 2) / 6) - 0.4 * Math.exp(-((h - 3) ** 2) / 10)
    const base = 350 + 180 * shape + (rnd() - 0.5) * 40
    pDayAhead.push(clampP(round(base)))
    pRealtime.push(clampP(round(base + (rnd() - 0.5) * 90)))
    pLong.push(360)
    const ml = dailyMl / N
    qLong.push(round(ml, 3))
    const da = ml * (1 + (rnd() - 0.5) * 0.25)
    qDayAhead.push(round(da, 3))
    qActual.push(round(da * (1 + (rnd() - 0.5) * 0.12), 3))
  }
  return { points: N, pDayAhead, pRealtime, pLong, qLong, qDayAhead, qActual, floor, cap }
}

const CAPTURE_PROV: Provenance = { sourceType: 'CAPTURE', realDataConnected: true }

// 取真实日前出清价 96 点（region-aware）。
// 对齐前端 listrs_full 口径：按 date（标的日，见 reportCapture.ts 派生源对拍）+ type=0 从 dmx 提取 p1..p96；
// 任一字段缺失或点数不足 96 视为未命中，回退合成。
async function fetchRealDayAhead(date: string | undefined, regionId: string | undefined): Promise<number[] | null> {
  if (!date) return null
  try {
    const res = await fetchCaptured<{ data?: unknown } & Record<string, unknown>>('sdpt_zcqxhdl', 'listrs_full', { region: regionId })
    // provenance 守卫：仅真实采集（realDataConnected===true）才提取日前价。否则 /api/real 回退
    // mock-capture 的 dmx 行（{date,type,p1..p96}）会按 date 命中返回 96 点，把 RB-PRICE-STATS
    // 误升 CAPTURE（违反 Mock 标注纪律）。与 spotPriceCore.replayPayload 同源（#687 codex P1）。
    const env = res as { code?: number; mock?: boolean; provenance?: { realDataConnected?: boolean }; data?: unknown }
    if (typeof env.code === 'number' && env.code >= 400) return null
    if (env.mock === true) return null
    if (env.provenance && env.provenance.realDataConnected !== true) return null
    return extractDayAheadCurveFromListrsFull(env.data ?? res, date)
  } catch {
    return null
  }
}

// 合成场景 + 真实日前价增强：命中真实日前价则覆盖 pDayAhead，并据此派生实时价（日前价 + 合成扰动）。
// 返回增强后的场景与命中标志，供区块按真实情况标注 provenance/note。
// 标注纪律：只有内容全部来自真实日前价的区块（RB-PRICE-STATS）才升 CAPTURE；
// 含合成成分（实时价/电量/中长期）的混合区块保持默认合成标注，仅在 note 说明日前价部分为真实。
async function loadScenarioWithRealPrice(params: ReportParams, ctx: BlockContext): Promise<{ s: Scenario; realHit: boolean }> {
  const s = synthScenario(params, ctx)
  const realDa = await fetchRealDayAhead(params.tradeDate, ctx.settlementRule.regionId ?? params.regionId)
  if (realDa) {
    s.pDayAhead = realDa
    const rnd = mulberry32(seedFrom(`rt|${params.tradeDate ?? ''}|${params.regionId ?? ''}`))
    s.pRealtime = realDa.map((p) => round(p + (rnd() - 0.5) * 90))
  }
  return { s, realHit: !!realDa }
}

const POINT_LABELS = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})

/** 96 点聚合为 24 小时（求和电量 / 求均价格）。 */
function toHourly(values: number[], mode: 'sum' | 'avg'): number[] {
  const out: number[] = []
  for (let h = 0; h < 24; h++) {
    const slice = values.slice(h * 4, h * 4 + 4)
    const s = slice.reduce((a, b) => a + b, 0)
    out.push(round(mode === 'sum' ? s : s / slice.length))
  }
  return out
}

// AI 经营解读（RB-AI-SUMMARY）的 LLM 提示构造已统一迁到 src/prompts/reportInsight.ts
//（buildReportInsightPrompt + ReportInsightMetrics）；指标仍由本报表确定性合成场景算出，
// 与价格/结算区块同源——保证解读基于本报表已计算的真实数字，不让模型凭空编造。

const builders: Record<string, BlockBuilder> = {
  'RB-PRICE-STATS': async (params, ctx) => {
    const { s, realHit } = await loadScenarioWithRealPrice(params, ctx)
    const st = priceStats(s.pDayAhead)
    const kpis: KpiCell[] = [
      { label: '日前均价', value: st.mean, unit: '元/MWh' },
      { label: '峰谷价差', value: st.peakValleySpread, unit: '元/MWh', tone: st.peakValleySpread > 500 ? 'warning' : 'stable' },
      { label: 'P95 高价', value: st.p95, unit: '元/MWh' },
      { label: 'P5 低价', value: st.p5, unit: '元/MWh' },
      { label: '负电价时段', value: st.negativeCount, unit: '个', tone: st.negativeCount > 0 ? 'danger' : 'stable' }
    ]
    return block('RB-PRICE-STATS', 'METRIC', '价格统计指标', { kpis },
      realHit ? '日前出清价为真实采集（sdpt_zcqxhdl）；统计指标基于该真实序列' : MOCK_NOTE,
      realHit ? CAPTURE_PROV : undefined)
  },
  'RB-SPOT-PRICE-CHART': async (params, ctx) => {
    const { s, realHit } = await loadScenarioWithRealPrice(params, ctx)
    const hasNegative = s.pDayAhead.some((v) => v < 0) || s.pRealtime.some((v) => v < 0)
    const option = {
      legend: { data: ['日前价', '实时价'] },
      grid: { left: 56, right: 24, top: 36, bottom: 48 },
      xAxis: { type: 'category', data: POINT_LABELS, axisLabel: { interval: 11 } },
      yAxis: { type: 'value', name: '元/MWh', scale: true },
      dataZoom: [{ type: 'inside' }],
      series: [
        {
          name: '日前价', type: 'line', step: 'end', showSymbol: false, data: s.pDayAhead,
          markPoint: { symbolSize: 46, data: [{ type: 'max', name: '峰' }, { type: 'min', name: '谷' }] },
          ...(hasNegative
            ? { markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: '#c0392b' }, data: [{ yAxis: 0, label: { formatter: '0（负电价分界）', position: 'insideEndTop' } }] } }
            : {})
        },
        { name: '实时价', type: 'line', step: 'end', showSymbol: false, data: s.pRealtime }
      ]
    }
    return block('RB-SPOT-PRICE-CHART', 'CHART', '日前/实时价格走势（96点）', { option },
      realHit ? '日前出清价为真实采集（sdpt_zcqxhdl），实时价为日前价叠加合成扰动（含合成成分，整体按合成标注）' : MOCK_NOTE)
  },
  // 契约图表出块（#23）：报表与 Agent 分析共用 AnalysisChartSpec（#32），经同源 chartSpecToOption
  // （#59/#60 映射器）渲染域图表（持续曲线），并带 SQL 溯源与真伪标注（basis / provenance）。
  'RB-ANALYSIS-PRICE-DURATION': async (params, ctx) => {
    const { s, realHit } = await loadScenarioWithRealPrice(params, ctx)
    const rows = s.pDayAhead.map((price) => ({ price }))
    const spec: AnalysisChartSpec = {
      chartType: 'duration_curve',
      title: '日前价持续曲线',
      series: [{ name: '日前价', key: 'price', unit: '元/MWh' }],
      basis: realHit ? 'captured' : 'synthetic',
      // 溯源写真实取数路径而非未执行的 SQL（codex P2 3635805744）
      sql: "取数路径：fetchCaptured('sdpt_zcqxhdl','listrs_full') 真实回放日前价，缺数据按地区特征合成（真伪见区块 provenance 标注）；口径对应语义层 v_system_forecast.da_user_price 降序即持续曲线",
    }
    const option = chartSpecToOption(spec, rows)
    return block(
      'RB-ANALYSIS-PRICE-DURATION', 'CHART', '日前价持续曲线（契约图表）',
      { option, spec, sql: spec.sql },
      realHit ? '日前出清价为真实采集（sdpt_zcqxhdl）；经 AnalysisChartSpec 契约同源渲染' : MOCK_NOTE + '；经 AnalysisChartSpec 契约同源渲染',
      realHit ? CAPTURE_PROV : undefined,
    )
  },
  'RB-CLEARING-TABLE': async (params, ctx) => {
    const { s, realHit } = await loadScenarioWithRealPrice(params, ctx)
    const qh = toHourly(s.qDayAhead, 'sum')
    const ph = toHourly(s.pDayAhead, 'avg')
    const rows = qh.map((q, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, qty: q, price: ph[h], fee: round(q * ph[h]) }))
    rows.push({ hour: '合计', qty: round(qh.reduce((a, b) => a + b, 0)), price: round(ph.reduce((a, b) => a + b, 0) / 24), fee: round(rows.reduce((a, r) => a + (r.fee as number), 0)) })
    return block('RB-CLEARING-TABLE', 'TABLE', '日前出清电量电价（按小时聚合）', {
      columns: [
        { key: 'hour', label: '时段', width: 90 },
        { key: 'qty', label: '出清电量(MWh)', align: 'right' },
        { key: 'price', label: '出清电价(元/MWh)', align: 'right' },
        { key: 'fee', label: '电费(元)', align: 'right' }
      ],
      rows
    },
      realHit ? '出清电价为真实采集（sdpt_zcqxhdl），出清电量为合成（含合成成分，整体按合成标注）' : MOCK_NOTE)
  },
  'RB-BID-COMPARE': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const sources = ['火电', '风电', '光伏']
    const rnd = mulberry32(seedFrom(`bid|${params.regionId ?? ctx.settlementRule.regionId}`))
    const rows = sources.map((name) => {
      const declared = round(200 + rnd() * 300)
      const cr = clearedRatio({ clearedMwh: declared * (0.6 + rnd() * 0.35), declaredMwh: declared })
      return { source: name, declared: cr.declaredMwh, cleared: cr.clearedMwh, ratio: `${round(cr.clearedRatio * 100)}%` }
    })
    void s
    return block('RB-BID-COMPARE', 'TABLE', '申报 vs 出清中标率', {
      columns: [
        { key: 'source', label: '电源类型', width: 100 },
        { key: 'declared', label: '申报电量(MWh)', align: 'right' },
        { key: 'cleared', label: '中标电量(MWh)', align: 'right' },
        { key: 'ratio', label: '中标率', align: 'right' }
      ],
      rows
    })
  },
  'RB-SETTLEMENT-THREE-PART': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const r = threePartSettlement({ qLong: s.qLong, pLong: s.pLong, qDayAhead: s.qDayAhead, pDayAhead: s.pDayAhead, qActual: s.qActual, pRealtime: s.pRealtime })
    const priceBasis = (params.subjectType === 'GENERATOR') ? ctx.settlementRule.generatorPriceBasis : ctx.settlementRule.userPriceBasis
    const kpis: KpiCell[] = [
      { label: '总电费', value: round(r.totalFee), unit: '元' },
      { label: '结算电量', value: r.settlementQuantity, unit: 'MWh' },
      { label: '综合结算电价', value: r.settlementPrice, unit: '元/MWh' },
      { label: '价格口径', value: priceBasis === 'nodal' ? '节点电价' : priceBasis === 'zonal' ? '分区电价' : '统一结算点价' }
    ]
    const rows = [
      { item: '中长期合约电费', formula: 'Σ Q长·P长', amount: r.mediumLongFee },
      { item: '日前偏差电费', formula: 'Σ(Q日前−Q长)·P日前', amount: r.dayAheadDeviationFee },
      { item: '实时偏差电费', formula: 'Σ(Q实际−Q日前)·P实时', amount: r.realtimeDeviationFee },
      { item: '合计', formula: '三段之和', amount: r.totalFee }
    ]
    return block('RB-SETTLEMENT-THREE-PART', 'SETTLEMENT', `三部制结算单（${ctx.settlementRule.label}）`, {
      kpis,
      columns: [
        { key: 'item', label: '结算科目', width: 160 },
        { key: 'formula', label: '口径公式' },
        { key: 'amount', label: '金额(元)', align: 'right' }
      ],
      rows
    })
  },
  'RB-DEVIATION-ASSESS': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const declared = s.qDayAhead.reduce((a, b) => a + b, 0)
    const actual = s.qActual.reduce((a, b) => a + b, 0)
    const tol = ctx.settlementRule.deviationTolerance
    const da = deviationAssessment({ qDeclared: declared, qActual: actual, tolerance: tol, assessmentPrice: 60 })
    const rows = [
      { item: '申报电量', value: round(declared) },
      { item: '实际电量', value: round(actual) },
      { item: '偏差电量', value: da.deviationQuantity },
      { item: `偏差率`, value: `${round(da.deviationRate * 100, 2)}%` },
      { item: `免考核带(±${round(tol * 100)}%)`, value: da.toleranceBandQuantity },
      { item: '考核电量', value: da.assessableQuantity },
      { item: '考核费用(元)', value: da.assessmentFee }
    ]
    return block('RB-DEVIATION-ASSESS', 'TABLE', '偏差考核明细', {
      columns: [
        { key: 'item', label: '项目', width: 200 },
        { key: 'value', label: '数值', align: 'right' }
      ],
      rows,
      footnote: da.withinTolerance ? '✅ 偏差落在免考核带内，无考核费用' : '⚠️ 偏差超免考核带，按考核单价结算'
    })
  },
  'RB-REVENUE-DECOMP': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const r = threePartSettlement({ qLong: s.qLong, pLong: s.pLong, qDayAhead: s.qDayAhead, pDayAhead: s.pDayAhead, qActual: s.qActual, pRealtime: s.pRealtime })
    const bars = [r.mediumLongFee, r.dayAheadDeviationFee, r.realtimeDeviationFee, r.totalFee]
    const option = {
      grid: { left: 72, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: ['中长期', '日前偏差', '实时偏差', '合计'] },
      yAxis: { type: 'value', name: '元' },
      series: [{
        type: 'bar',
        data: bars.map((v) => ({ value: v, itemStyle: { color: v < 0 ? '#c0392b' : '#3a7afe' } })),
        label: { show: true, position: 'top' }
      }]
    }
    return block('RB-REVENUE-DECOMP', 'CHART', '收益三段分解', { option })
  },
  'RB-REVENUE-ATTRIBUTION': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const r = threePartSettlement({ qLong: s.qLong, pLong: s.pLong, qDayAhead: s.qDayAhead, pDayAhead: s.pDayAhead, qActual: s.qActual, pRealtime: s.pRealtime })
    const attr = revenueAttribution([
      { label: '中长期', amount: r.mediumLongFee },
      { label: '日前偏差', amount: r.dayAheadDeviationFee },
      { label: '实时偏差', amount: r.realtimeDeviationFee }
    ])
    const rows = attr.legs.map((l) => ({ label: l.label, amount: l.amount, share: `${round(l.share * 100, 2)}%` }))
    rows.push({ label: '综合收益', amount: attr.total, share: '100%' })
    return block('RB-REVENUE-ATTRIBUTION', 'TABLE', '收益归因', {
      columns: [
        { key: 'label', label: '分项', width: 140 },
        { key: 'amount', label: '金额(元)', align: 'right' },
        { key: 'share', label: '占比', align: 'right' }
      ],
      rows
    })
  },
  'RB-HEDGE-EXPOSURE': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const contracted = s.qLong.reduce((a, b) => a + b, 0)
    const forecast = s.qActual.reduce((a, b) => a + b, 0)
    const h = hedgeCoverage({ contractedMwh: contracted, forecastMwh: forecast })
    const kpis: KpiCell[] = [
      { label: '中长期持仓', value: round(contracted), unit: 'MWh' },
      { label: '预测电量', value: round(forecast), unit: 'MWh' },
      { label: '持仓覆盖率', value: `${round(h.coverageRate * 100, 1)}%`, tone: h.coverageRate < 0.8 ? 'warning' : 'stable' },
      { label: '未对冲敞口', value: h.openExposureMwh, unit: 'MWh', tone: Math.abs(h.openExposureMwh) > forecast * 0.2 ? 'danger' : 'stable' }
    ]
    return block('RB-HEDGE-EXPOSURE', 'METRIC', '持仓覆盖与敞口', { kpis })
  },
  'RB-RETAIL-SPREAD': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const purchase = round(s.pDayAhead.reduce((a, b) => a + b, 0) / s.points)
    const sp = retailSpread({ retailPrice: purchase + 28, purchaseCost: purchase, gridTariff: 130, govFund: 5, energyMwh: s.qActual.reduce((a, b) => a + b, 0) })
    const kpis: KpiCell[] = [
      { label: '加权购电成本', value: purchase, unit: '元/MWh' },
      { label: '批零价差', value: sp.spreadYuanPerMwh, unit: '元/MWh', tone: sp.spreadYuanPerMwh < 10 ? 'warning' : 'stable' },
      { label: '度电毛利', value: sp.spreadYuanPerKwh, unit: '元/度' },
      { label: '毛利总额', value: round((sp.grossProfit ?? 0) / 10000, 2), unit: '万元' }
    ]
    return block('RB-RETAIL-SPREAD', 'METRIC', '售电批零价差', { kpis })
  },
  'RB-UNIT-COST': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const energy = s.qActual.reduce((a, b) => a + b, 0)
    const r = threePartSettlement({ qLong: s.qLong, pLong: s.pLong, qDayAhead: s.qDayAhead, pDayAhead: s.pDayAhead, qActual: s.qActual, pRealtime: s.pRealtime })
    const cost = energy * 285 // 度电变动成本占位 285 元/MWh（煤电区间）
    const m = unitEnergyMargin({ revenue: r.totalFee, cost, energyMwh: energy })
    const kpis: KpiCell[] = [
      { label: '度电收入', value: m.unitRevenue, unit: '元/MWh' },
      { label: '度电变动成本', value: m.unitCost, unit: '元/MWh' },
      { label: '度电毛利', value: m.unitMargin, unit: '元/MWh', tone: m.unitMargin < 0 ? 'danger' : 'stable' },
      { label: '度电毛利', value: m.unitMarginYuanPerKwh, unit: '元/度' }
    ]
    return block('RB-UNIT-COST', 'METRIC', '发电度电成本与毛利', { kpis })
  },
  'RB-AI-SUMMARY': async (params, ctx) => {
    const s = synthScenario(params, ctx)
    const st = priceStats(s.pDayAhead)
    const r = threePartSettlement({ qLong: s.qLong, pLong: s.pLong, qDayAhead: s.qDayAhead, pDayAhead: s.pDayAhead, qActual: s.qActual, pRealtime: s.pRealtime })
    // 降级用的规则模板（与价格/结算区块同源的确定性指标）
    const fallbackSections = () => [
      { title: '关键结论', body: `当日日前均价 ${st.mean} 元/MWh，峰谷价差 ${st.peakValleySpread} 元/MWh；综合结算电价 ${r.settlementPrice} 元/MWh，总电费 ${round(r.totalFee / 10000, 2)} 万元。` },
      { title: '风险提示', body: `${st.negativeCount > 0 ? `出现 ${st.negativeCount} 个负电价时段，需关注新能源大发时段的让利风险。` : '未出现负电价时段。'}实时偏差电费 ${round(r.realtimeDeviationFee, 0)} 元，${Math.abs(r.realtimeDeviationFee) > 5000 ? '实时偏差敞口偏大，建议收紧日前申报。' : '实时偏差可控。'}` },
      { title: '建议动作', body: `地区口径：${ctx.settlementRule.label}（${ctx.settlementRule.maturity}）。建议结合中长期持仓覆盖率与峰段价格，优化次日申报曲线。` }
    ]
    // 已配置 LLM → 大模型实时解读；否则/失败 → 规则模板（note 如实区分，不伪装为模型输出）
    let sections = fallbackSections()
    let note = MOCK_NOTE + '；解读为规则模板生成（大模型未配置或调用失败）'
    if (await refreshLlmStatus()) {
      try {
        const metrics: ReportInsightMetrics = {
          regionLabel: ctx.settlementRule.label,
          maturity: ctx.settlementRule.maturity,
          subjectType: params.subjectType,
          tradeDate: params.tradeDate,
          month: params.month,
          mean: st.mean,
          peakValleySpread: st.peakValleySpread,
          negativeCount: st.negativeCount,
          settlementPrice: r.settlementPrice,
          totalFee: r.totalFee,
          mediumLongFee: r.mediumLongFee,
          dayAheadDeviationFee: r.dayAheadDeviationFee,
          realtimeDeviationFee: r.realtimeDeviationFee
        }
        const raw = await chatCompletion(buildReportInsightPrompt(metrics), { json: true })
        const parsed = JSON.parse(raw) as { sections?: { title?: string; body?: string }[] }
        if (Array.isArray(parsed.sections) && parsed.sections.length) {
          sections = parsed.sections.map((x) => ({ title: String(x.title ?? ''), body: String(x.body ?? '') })).slice(0, 5)
          note = MOCK_NOTE + '；解读由大模型实时生成（基于本报表已计算指标）'
        }
      } catch {
        /* 大模型未配置/调用失败/解析失败 → 降级到规则模板（note 已标注） */
      }
    }
    // 结论溯源（#23）：附结论所依据的数据查询与口径，配合区块 provenance 的真伪标注；
    // 大模型不可用时降级为规则模板（note 已如实区分），溯源与降级路径保持不变。
    const sqlTrace = [
      // 如实溯源：本区块日前价来自 synthScenario() 合成，未执行 SQL（codex P2 3635805744）
      '日前价：synthScenario() 按地区特征合成的示意价格序列（未执行 SQL；真伪以区块 note 的 Mock 标注为准）',
      '结算：三部制结算规则计算（settlementFormula.ts，口径可验证）',
    ]
    return block('RB-AI-SUMMARY', 'AI_TEXT', 'AI 经营解读', { sections, sql: sqlTrace }, note)
  },
  'RB-STORAGE-ARBITRAGE': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const st = priceStats(s.pDayAhead)
    const eta = 0.88 // 充放电综合效率
    const capacityMwh = 100 // 储能容量占位（MWh）
    const cycles = 1 // 日均完整充放循环
    const arbitrage = round(st.peakValleySpread * eta) // 度电套利毛收益（元/MWh，扣效率）
    const dailyRevenue = round(arbitrage * capacityMwh * cycles)
    const kpis: KpiCell[] = [
      { label: '峰谷价差', value: st.peakValleySpread, unit: '元/MWh' },
      { label: '度电套利(扣效率)', value: arbitrage, unit: '元/MWh', tone: arbitrage > 200 ? 'stable' : 'warning' },
      { label: '日循环次数', value: cycles, unit: '次' },
      { label: '日均套利收益', value: dailyRevenue, unit: '元', tone: dailyRevenue > 0 ? 'stable' : 'danger' }
    ]
    return block('RB-STORAGE-ARBITRAGE', 'METRIC', '储能峰谷套利', { kpis }, MOCK_NOTE)
  },
  'RB-CONTRACT-PROGRESS': (params, ctx) => {
    const rnd = mulberry32(seedFrom(`contract|${params.month ?? params.tradeDate ?? ''}|${params.regionId ?? ctx.settlementRule.regionId}`))
    const rows = ['基荷长协', '尖峰避害合约', '绿电中长期', '调峰补充'].map((name) => {
      const planned = round(500 + rnd() * 1500)
      const executed = round(planned * (0.55 + rnd() * 0.5))
      const rate = executed / planned
      const expiryDay = String(20 + Math.floor(rnd() * 8)).padStart(2, '0')
      return {
        name, planned, executed, rate: `${round(rate * 100)}%`,
        expiry: `${(params.month ?? '2026-06').slice(0, 7)}-${expiryDay}`,
        status: rate > 0.9 ? '临近完成' : rate > 0.5 ? '正常' : '进度滞后'
      }
    })
    return block('RB-CONTRACT-PROGRESS', 'TABLE', '合同执行跟踪', {
      columns: [
        { key: 'name', label: '合同', width: 140 },
        { key: 'planned', label: '合同电量(MWh)', align: 'right' },
        { key: 'executed', label: '已执行(MWh)', align: 'right' },
        { key: 'rate', label: '执行率', align: 'right' },
        { key: 'expiry', label: '到期', width: 110 },
        { key: 'status', label: '状态', width: 100 }
      ],
      rows
    }, MOCK_NOTE)
  },
  'RB-GREEN-TRADE': (params, ctx) => {
    const rnd = mulberry32(seedFrom(`green|${params.month ?? params.tradeDate ?? ''}|${params.regionId ?? ctx.settlementRule.regionId}`))
    const greenMwh = round(2000 + rnd() * 3000)
    const greenCert = greenMwh // 1 个绿证 = 1 MWh
    const envPremium = round(30 + rnd() * 40) // 环境溢价（元/MWh）
    const envValue = round(greenMwh * envPremium)
    const kpis: KpiCell[] = [
      { label: '绿电交易量', value: greenMwh, unit: 'MWh' },
      { label: '对应绿证', value: greenCert, unit: '个' },
      { label: '环境溢价', value: envPremium, unit: '元/MWh' },
      { label: '环境价值', value: round(envValue / 10000, 2), unit: '万元', tone: 'stable' }
    ]
    return block('RB-GREEN-TRADE', 'METRIC', '绿电交易与环境价值', { kpis }, MOCK_NOTE)
  },
  // ── issue #455 现货日报新增区块：结算三价 / 出力完成率 / 出力预测 MAPE（复用 synthScenario
  // 与 settlementFormula 口径，sourceType=MOCK 如实标注；日前价走真实采集时 provenance 上调）。
  // 使 RPT-DAILY-SPOT 一键生成即含三价/出力/MAPE 摘要，走确定性 reportEngine 不在 Dify 重造。──
  'RB-SETTLEMENT-PRICES': async (params, ctx) => {
    const { s, realHit } = await loadScenarioWithRealPrice(params, ctx)
    const da = round(s.pDayAhead.reduce((a, b) => a + b, 0) / s.points)
    const rt = round(s.pRealtime.reduce((a, b) => a + b, 0) / s.points)
    const ml = round(s.pLong.reduce((a, b) => a + b, 0) / s.points)
    const basis = (params.subjectType === 'GENERATOR') ? ctx.settlementRule.generatorPriceBasis : ctx.settlementRule.userPriceBasis
    const basisLabel = basis === 'nodal' ? '节点电价' : basis === 'zonal' ? '分区电价' : '统一结算点价'
    const kpis: KpiCell[] = [
      { label: '日前出清均价', value: da, unit: '元/MWh' },
      { label: '实时出清均价', value: rt, unit: '元/MWh', tone: rt > da ? 'warning' : 'stable' },
      { label: '中长期合约均价', value: ml, unit: '元/MWh' },
      { label: '价格口径', value: basisLabel }
    ]
    return block('RB-SETTLEMENT-PRICES', 'METRIC', '结算三价（日前/实时/中长期）', { kpis },
      realHit ? '日前出清价为真实采集（sdpt_zcqxhdl）；实时/中长期为合成（含合成成分，整体按合成标注）' : MOCK_NOTE)
  },
  'RB-OUTPUT-COMPLETION': (params, ctx) => {
    const s = synthScenario(params, ctx)
    const planned = round(s.qDayAhead.reduce((a, b) => a + b, 0), 1)
    const actual = round(s.qActual.reduce((a, b) => a + b, 0), 1)
    const completion = planned > 0 ? round((actual / planned) * 100, 1) : 0
    const deviation = round(actual - planned, 1)
    const kpis: KpiCell[] = [
      { label: '日前计划出力', value: planned, unit: 'MWh' },
      { label: '实际出力', value: actual, unit: 'MWh' },
      { label: '完成率', value: `${completion}%`, tone: completion < 90 || completion > 110 ? 'warning' : 'stable' },
      { label: '偏差电量', value: deviation, unit: 'MWh', tone: planned > 0 && Math.abs(deviation) > planned * 0.1 ? 'danger' : 'stable' }
    ]
    return block('RB-OUTPUT-COMPLETION', 'METRIC', '出力完成率', { kpis }, MOCK_NOTE)
  },
  'RB-FORECAST-MAPE': (params, ctx) => {
    const s = synthScenario(params, ctx)
    // MAPE = mean(|预测-实际|/|实际|)；实际为 0 的点跳过（避免除零放大），与厂站预测 MAPE 擂台口径一致
    let sumAbs = 0
    let n = 0
    for (let i = 0; i < s.points; i++) {
      const a = s.qActual[i]
      const f = s.qDayAhead[i]
      if (Math.abs(a) < 1e-6) continue
      sumAbs += Math.abs(f - a) / Math.abs(a)
      n += 1
    }
    const mape = n ? round((sumAbs / n) * 100, 2) : 0
    const totalDev = round(s.qActual.reduce((a, b) => a + b, 0) - s.qDayAhead.reduce((a, b) => a + b, 0), 1)
    const kpis: KpiCell[] = [
      { label: 'MAPE', value: `${mape}%`, tone: mape > 15 ? 'warning' : 'stable' },
      { label: '评估点数', value: n, unit: '个' },
      { label: '总偏差电量', value: totalDev, unit: 'MWh', tone: Math.abs(totalDev) > 50 ? 'danger' : 'stable' },
      { label: '口径', value: '日前预测 vs 实际' }
    ]
    return block('RB-FORECAST-MAPE', 'METRIC', '出力预测 MAPE 摘要', { kpis }, MOCK_NOTE)
  }
}

let registered = false

/** 注册全部报表区块构建器（幂等）。在报表中心视图初始化时调用。 */
export function registerReportBlocks(): void {
  if (registered) return
  for (const [blockId, builder] of Object.entries(builders)) {
    registerBlock(blockId, builder)
  }
  registered = true
}
