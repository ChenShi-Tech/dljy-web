// researchFacets.spec.ts — 量纲分面纯模块回归（dljy#3114，任务 13.7，RS08、D6.1）
// 守什么不变量：
//   ① 指标按云南登记目录取量纲：单位不同的统计行拆到不同分面（一张面一张轴）；
//   ② 同量纲共面共轴：面内指标并排、横轴为分组（全样本/日历月）；
//   ③ 值文本走登记精度 formatMetricValue；数值仅用于坐标，非法值坐标为 null；
//   ④ 序列显隐过滤整条指标；分面顺序可重排（未提及的面保持首现序）；
//   ⑤ 时间线/候选表指标（异常窗口、同类日）不进统计分面。
import { describe, expect, it } from 'vitest'
import { buildResearchStatFacets, buildStatFacetOption, statFacetTitleOf } from './researchFacets'

const PROGRESS_ROWS = [
  { metricId: 'supply.progress-change', value: '12.5' },
  { metricId: 'supply.mean-power', value: '4310.25' },
  { metricId: 'sample.valid-count', value: '18' },
]

const CORRELATION_ROWS = [
  { metricId: 'research.pearson-r', group: 'all', value: '-0.412335' },
  { metricId: 'research.covariance', group: 'all', value: '-118.402' },
  { metricId: 'sample.valid-count', group: 'all', value: '236' },
  { metricId: 'research.pearson-r', group: '2026-09', value: '-0.402144' },
  { metricId: 'research.covariance', group: '2026-09', value: '-110.21' },
  { metricId: 'sample.valid-count', group: '2026-09', value: '236' },
]

describe('量纲分面', () => {
  it('同进度结果按登记量纲拆三面（% / MW / 样本计数），一面一单位', () => {
    const facets = buildResearchStatFacets(PROGRESS_ROWS)
    expect(facets.map((facet) => facet.unit)).toEqual(['%', 'MW', 'count'])
    expect(facets[0].items).toHaveLength(1)
    expect(facets[0].items[0].label).toBe('较前一日同进度变化')
    expect(facets[1].items[0].label).toBe('平均出力/负荷')
  })

  it('相关结果拆「r / 随输入量纲 / 样本计数」三面；分组轴为全样本+日历月，组间不合并', () => {
    const facets = buildResearchStatFacets(CORRELATION_ROWS)
    expect(facets.map((facet) => facet.unit)).toEqual(['r', 'by-input', 'count'])
    const rFacet = facets[0]
    expect(rFacet.items[0].groups.map((group) => group.label)).toEqual(['全样本', '2026-09'])
    expect(rFacet.items[0].groups.map((group) => group.text)).toEqual(['-0.412335', '-0.402144'])
  })

  it('数值只用于坐标（十进制文本转数字）；非数值坐标为 null，文本保留原值', () => {
    const facets = buildResearchStatFacets([
      { metricId: 'research.pearson-r', group: 'all', value: '0.5' },
      { metricId: 'research.pearson-r', group: '2026-09', value: '非数值' },
    ])
    const groups = facets[0].items[0].groups
    expect(groups[0].value).toBe(0.5)
    expect(groups[1].value).toBeNull()
    expect(groups[1].text).toBe('非数值')
  })

  it('序列显隐：隐藏指标整条从分面移除；面内一条不剩时整面隐藏', () => {
    const facets = buildResearchStatFacets(CORRELATION_ROWS, {
      hiddenMetricIds: new Set(['research.pearson-r']),
    })
    // r 面只有 pearson-r 一个指标 → 整面隐藏；协方差面与计数面保留
    expect(facets.map((facet) => facet.unit)).toEqual(['by-input', 'count'])

    const allHidden = buildResearchStatFacets(PROGRESS_ROWS, {
      hiddenMetricIds: new Set(['supply.progress-change', 'supply.mean-power', 'sample.valid-count']),
    })
    expect(allHidden).toEqual([])
  })

  it('分面顺序：facetOrder 给出的单位先按给定序排列，其余保持首现序', () => {
    const facets = buildResearchStatFacets(CORRELATION_ROWS, { facetOrder: ['count', 'by-input'] })
    expect(facets.map((facet) => facet.unit)).toEqual(['count', 'by-input', 'r'])
  })

  it('时间线与候选表指标不进统计分面（异常窗口、同类日各有专门呈现）', () => {
    const facets = buildResearchStatFacets([
      { metricId: 'research.anomaly-window-mean', value: '120' },
      { metricId: 'research.similar-day-distance', value: '0.5' },
      { metricId: 'research.feature-contribution', value: '0.5' },
      { metricId: 'unregistered.metric', value: '1' },
    ])
    expect(facets).toEqual([])
  })

  it('滞后比较统计行按「随输入量纲」与「样本计数」拆面', () => {
    const facets = buildResearchStatFacets([
      { metricId: 'research.lag-mean-difference', value: '-6.5' },
      { metricId: 'research.lag-absolute-mean', value: '18.25' },
      { metricId: 'sample.valid-count', value: '96' },
    ])
    expect(facets.map((facet) => facet.unit)).toEqual(['by-input', 'count'])
    expect(facets[0].items.map((item) => item.metricId)).toEqual(['research.lag-mean-difference', 'research.lag-absolute-mean'])
    // 滞后/同进度没有分组维度：横轴是单组「所选窗」
    expect(facets[0].items[0].groups[0].label).toBe('所选窗')
  })
})

describe('分面图（单面单轴）', () => {
  it('ECharts option：一个分面只有一根 y 轴且单位随轴名；指标各一条序列（颜色/图例区分）', () => {
    const facets = buildResearchStatFacets(CORRELATION_ROWS)
    const option = buildStatFacetOption(facets[1]) as {
      yAxis: Array<{ name: string }>
      series: Array<{ name: string; type: string; data: Array<number | null> }>
      xAxis: { data: string[] }
    }
    expect(option.yAxis).toHaveLength(1)
    expect(option.yAxis[0].name).toBe('by-input')
    expect(option.xAxis.data).toEqual(['全样本', '2026-09'])
    expect(option.series).toHaveLength(1)
    expect(option.series[0]).toMatchObject({ name: '样本协方差', type: 'bar' })
    expect(option.series[0].data).toEqual([-118.402, -110.21])
  })

  it('分面标题用业务语言（登记单位 token 不直接裸露给用户）', () => {
    expect(statFacetTitleOf('by-input')).toContain('量纲分面')
    expect(statFacetTitleOf('count')).toContain('样本计数')
    expect(statFacetTitleOf('custom-unit')).toContain('custom-unit')
  })
})
