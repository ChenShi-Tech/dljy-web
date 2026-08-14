import { describe, expect, it } from 'vitest'
import { reportBlocks, reportTemplates } from './templates'
import { chartSpecToOption, type AnalysisChartSpec } from '../../services/chart/analysisChartSpec'

// #23：契约图表出块——报表与 Agent 分析共用 AnalysisChartSpec。
describe('report contract chart block (#23)', () => {
  it('registers the contract chart block in the catalog', () => {
    const b = reportBlocks.find((x) => x.blockId === 'RB-ANALYSIS-PRICE-DURATION')
    expect(b).toBeTruthy()
    expect(b?.blockType).toBe('CHART')
  })

  it('at least one template uses the contract chart block', () => {
    const used = reportTemplates.some((t) => t.blockIds.includes('RB-ANALYSIS-PRICE-DURATION'))
    expect(used).toBe(true)
  })

  it('duration_curve spec maps to an ECharts option via shared mapper', () => {
    const spec: AnalysisChartSpec = {
      chartType: 'duration_curve', title: '日前价持续曲线',
      series: [{ name: '日前价', key: 'price' }], basis: 'synthetic',
    }
    const rows = [{ price: 100 }, { price: 300 }, { price: 200 }]
    const opt = chartSpecToOption(spec, rows) as { series: { data: number[] }[] }
    expect(opt.series[0].data).toEqual([300, 200, 100])
  })
})

