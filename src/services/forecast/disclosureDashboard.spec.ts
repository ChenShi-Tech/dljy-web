// 守住披露 dashboard 的一图一系列边界：同范围/同指标不串 panel，换目标日不丢 selectionKey。
// 坏掉会把空曲线/错误集渲进总览，或让换日后的已选面板无法稳定复用。
import { describe, expect, it } from 'vitest'
import type { DisclosureDatasetResult, DisclosureSeries } from './dailyDisclosure'
import { buildDisclosurePanels, matchesDisclosurePanel } from './disclosureDashboard'

function series(extra: Partial<DisclosureSeries> = {}): DisclosureSeries {
  return {
    id: 'simple-series',
    label: '统调负荷预测',
    scope: 'yn',
    scopeLabel: '云南省内',
    targetDate: null,
    unit: '原始值',
    labels: ['00:00', '00:15'],
    points: [12, null],
    previous: [11, null],
    validPoints: 1,
    expectedPoints: 96,
    conflicts: 0,
    ...extra,
  }
}

function dataset(
  extra: Partial<DisclosureDatasetResult> = {},
  seriesList: DisclosureSeries[] = [series()],
): DisclosureDatasetResult {
  return {
    spec: {
      id: 'load_forecast',
      family: 'yn_system_forecast',
      title: '统调负荷预测',
      group: 'forecast',
      nature: 'forecast',
      unit: '原始值',
      slots: 96,
    },
    date: '2026-06-25',
    status: 'ready',
    rows: [{ operateDate: '2026-06-25', value: 12 }],
    series: seriesList,
    warnings: ['保留原始告警'],
    sourceLabel: '已导入披露 · 真实数据回放',
    capturedAt: '2026-06-25T10:00:00+08:00',
    ingestedAt: '2026-06-25T10:01:00+08:00',
    ...extra,
  }
}

describe('buildDisclosurePanels', () => {
  it('每条有真实有限值的 series 独立成 panel；同 label 不同 metric 也不合并', () => {
    const result = dataset({}, [
      series({ id: JSON.stringify(['yn', '2026-06-26', 'load_forecast']), label: '统调负荷预测' }),
      series({ id: JSON.stringify(['yn', '2026-06-26', 'load_bias']), label: '统调负荷预测', points: [22, null] }),
      series({ id: JSON.stringify(['all', '2026-06-26', 'load_forecast']), scope: 'all', scopeLabel: '南网全网', points: [33, null] }),
    ])
    const panels = buildDisclosurePanels([result])
    expect(panels).toHaveLength(3)
    expect(new Set(panels.map((item) => item.id)).size).toBe(3)
    expect(new Set(panels.map((item) => item.selectionKey)).size).toBe(3)
    expect(panels.map((item) => item.scopeLabel)).toEqual(['云南省内', '云南省内', '南网全网'])
  })

  it('过滤 error/rejected/empty 和无有限值 series，不造占位 panel', () => {
    const readyButNull = dataset({}, [series({ validPoints: 1, points: [null, null] })])
    const invalidNumber = dataset({}, [series({ validPoints: 1, points: [Number.NaN, null] as unknown as (number | null)[] })])
    const partial = dataset({ status: 'partial' }, [series({ points: [0, null], validPoints: 1 })])
    const rejected = dataset({ status: 'rejected' })
    const failed = dataset({ status: 'error' })
    const empty = dataset({ status: 'empty' })
    const panels = buildDisclosurePanels([readyButNull, invalidNumber, partial, rejected, failed, empty])
    expect(panels).toHaveLength(1)
    expect(panels[0].dataset.status).toBe('partial')
    expect(panels[0].dataset.series[0].points[0]).toBe(0)
  })

  it('保留缺值与原对象语义，不修改输入 dataset', () => {
    const rawRows = [{ operateDate: '2026-06-25', value: null, extra: 'keep' }]
    const warnings = ['保留原始告警']
    const input = dataset({ rows: rawRows, warnings }, [
      series({
        id: JSON.stringify(['yn', '2026-06-26', 'load_forecast']),
        points: [null, 18],
        previous: [null, 17],
        validPoints: 1,
      }),
    ])
    const before = JSON.stringify(input)
    const [panel] = buildDisclosurePanels([input])
    expect(JSON.stringify(input)).toBe(before)
    expect(panel.dataset).not.toBe(input)
    expect(panel.dataset.rows).toBe(rawRows)
    expect(panel.dataset.warnings).toBe(warnings)
    expect(panel.dataset.series).toHaveLength(1)
    expect(panel.dataset.series[0]).toBe(input.series[0])
    expect(panel.dataset.series[0].points).toEqual([null, 18])
    expect(panel.dataset.rows[0].extra).toBe('keep')
  })

  it('目标日变化时 panel.id 变化，但 selectionKey 保持稳定', () => {
    const first = dataset({ date: '2026-06-25' }, [
      series({ id: JSON.stringify(['yn', '2026-06-26', 'load_forecast']), targetDate: '2026-06-26' }),
    ])
    const second = dataset({ date: '2026-06-26' }, [
      series({ id: JSON.stringify(['yn', '2026-06-27', 'load_forecast']), targetDate: '2026-06-27' }),
    ])
    const [panelA] = buildDisclosurePanels([first])
    const [panelB] = buildDisclosurePanels([second])
    expect(panelA.id).not.toBe(panelB.id)
    expect(panelA.selectionKey).toBe(panelB.selectionKey)
  })

  it('simple id 也能工作；title 按 spec.title 和 series.label 组合', () => {
    const [panel] = buildDisclosurePanels([dataset({}, [
      series({ id: 'plain-id', label: '云南统调' }),
    ])])
    expect(panel.selectionKey).toContain('plain-id')
    expect(panel.title).toBe('统调负荷预测 · 云南统调')
  })
})

describe('matchesDisclosurePanel', () => {
  it('按标题、label、scope、scopeLabel、id、目标日搜索', () => {
    const [panel] = buildDisclosurePanels([dataset({}, [
      series({ id: JSON.stringify(['yn', '2026-06-26', 'load_forecast']), label: '负荷曲线' }),
    ])])
    expect(matchesDisclosurePanel(panel, '')).toBe(true)
    expect(matchesDisclosurePanel(panel, '统调负荷预测')).toBe(true)
    expect(matchesDisclosurePanel(panel, '负荷曲线')).toBe(true)
    expect(matchesDisclosurePanel(panel, '云南省内')).toBe(true)
    expect(matchesDisclosurePanel(panel, 'yn')).toBe(true)
    expect(matchesDisclosurePanel(panel, '2026-06-26')).toBe(true)
    expect(matchesDisclosurePanel(panel, 'load_forecast')).toBe(true)
    expect(matchesDisclosurePanel(panel, '不存在')).toBe(false)
  })
})
