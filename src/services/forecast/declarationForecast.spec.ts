// 申报台多模型对比编排回归。
//
// 锁的是误导性呈现：这些逻辑坏掉不会报错，只会让用户拿错误的模型排名或假数据去报价。
// 量级依据（云南 captured / train_days=60 实测，算法名在这里只是占位 id）：knn 11.44 ·
// 真实树模型 21~27 · 线性基线 42.96 · tslib:PatchTST(占位) 45.87。
// 注意最后一项，占位模型比最简单的真实模型还差，若参与排名，用户会误以为它只是
// "表现一般的真实模型"，而不是"结果根本不能用于报价的占位实现"。
import { describe, expect, it } from 'vitest'

import {
  buildCompareRows,
  canBeDecisionModel,
  defaultSelection,
  isTrustworthyForecast,
  untrustworthyTag,
  parsePredictableUntil,
  resolveDecisionModel,
  toChartSeries,
  type ModelRunOutcome,
} from '@/services/forecast/declarationForecast'

const ok = (modelId: string, mae: number, over: Record<string, unknown> = {}): ModelRunOutcome => ({
  modelId,
  name: modelId,
  result: {
    points: [100, 110, 120],
    unit: '元/MWh',
    basis: 'captured',
    granularity: 96,
    modelId,
    metrics: { mae },
    ...over,
  } as ModelRunOutcome['result'],
})

const failed = (modelId: string, error: string): ModelRunOutcome => ({
  modelId, name: modelId, result: null, error,
})

describe('buildCompareRows：占位模型绝不参与排名', () => {
  it('占位模型即使 MAE 最低也不排名', () => {
    const rows = buildCompareRows([
      ok('tslib:PatchTST', 5, { mock: true, basis: 'illustrative' }),
      ok('knn', 11.44),
      ok('random_forest', 21.46),
    ])
    expect(rows.find((r) => r.modelId === 'tslib:PatchTST')?.rank).toBe(0)
    expect(rows.find((r) => r.modelId === 'knn')?.rank).toBe(1)
    expect(rows.find((r) => r.modelId === 'random_forest')?.rank).toBe(2)
  })

  it('真实模型按 holdout MAE 升序排名（实测量级）', () => {
    const rows = buildCompareRows([
      ok('elastic_persist', 42.96), ok('knn', 11.44), ok('stacking', 25.16),
    ])
    expect(rows.map((r) => r.modelId)).toEqual(['knn', 'stacking', 'elastic_persist'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('失败模型保留原因、不参与排名、排在有名次的之后', () => {
    const rows = buildCompareRows([
      failed('deep_model', 'No module named torch'),
      ok('knn', 11.44),
    ])
    expect(rows[0].modelId).toBe('knn')
    const nb = rows.find((r) => r.modelId === 'deep_model')!
    expect(nb.rank).toBe(0)
    expect(nb.error).toContain('torch')
    expect(nb.holdoutMae).toBeNull()
  })

  it('无 metrics 的模型不参与排名', () => {
    const rows = buildCompareRows([ok('knn', 11.44), { modelId: 'x', name: 'x', result: { points: [1], unit: '', basis: 'captured', granularity: 96, modelId: 'x' } as never }])
    expect(rows.find((r) => r.modelId === 'x')?.rank).toBe(0)
  })

  it('mock 标记透传，供 UI 打占位角标', () => {
    const rows = buildCompareRows([ok('tslib:DLinear', 45.87, { mock: true })])
    expect(rows[0].mock).toBe(true)
  })
})

describe('parsePredictableUntil：只在真解析出区间时才给出口', () => {
  const boundary = (from: string, to: string) =>
    `target_date=2027-01-01 不在可用数据范围内（${from}..${to}）；该日尚无基本面数据，无法预测。`

  it('从后端越界报错里取出区间末日', () => {
    expect(parsePredictableUntil([failed('knn', boundary('2026-05-03', '2026-07-01'))])).toBe('2026-07-01')
  })

  it('多个模型区间不同时取最晚末日（至少有一个模型能跑那天）', () => {
    expect(parsePredictableUntil([
      failed('knn', boundary('2026-05-03', '2026-07-01')),
      failed('random_forest', boundary('2026-01-01', '2026-06-15')),
    ])).toBe('2026-07-01')
  })

  it('非越界失败（如缺 torch）解析不出 → null，UI 不显示该出口', () => {
    expect(parsePredictableUntil([failed('deep_model', 'No module named torch')])).toBeNull()
  })

  it('文案变形/半角括号不匹配 → null，绝不猜日期给用户点', () => {
    expect(parsePredictableUntil([failed('knn', '不在可用数据范围内 (2026-05-03..2026-07-01)')])).toBeNull()
    expect(parsePredictableUntil([failed('knn', '（2026-05..2026-07）')])).toBeNull()
  })

  it('无失败模型 → null', () => {
    expect(parsePredictableUntil([ok('knn', 11.44)])).toBeNull()
  })
})

describe('isTrustworthyForecast：合成兜底结果不得参与排名/报价', () => {
  // 后端 run_forecast 在真实回放缺失时用合成数据兜底（basis='synthetic'），而普通
  // KNN 与其它真实算法的 result.mock 仍是 false，只看模型静态属性会把合成曲线当真实模型排名。
  it.each([
    [{ basis: 'captured' }, true],
    [{ basis: 'real' }, true],
    [{ basis: 'derived' }, true],
    [{ basis: 'synthetic' }, false],
    [{ basis: 'illustrative' }, false],
    [{ basis: 'captured', mock: true }, false],
    // 质量门禁：只在显式 false 时拦，字段缺省表示后端没跑门禁，不能据此把模型判死
    [{ basis: 'captured', metrics: { passes_gate: false } }, false],
    [{ basis: 'captured', metrics: { passes_gate: true } }, true],
    [{ basis: 'captured', metrics: {} }, true],
    [null, false],
    [undefined, false],
  ])('%o → %s', (result, expected) => {
    expect(isTrustworthyForecast(result as never)).toBe(expected)
  })

  // 实测（云南 2026-06-20，真连 agent-backend）：
  // knn     passes_gate=false  improve_vs_knn_pct=0.0    ← 拿自己比自己
  // 树模型  passes_gate=true   improve_vs_knn_pct=10.48
  // 门禁定义是「比 KNN 改善 ≥10%」，对 KNN 自身在定义上就不适用。不豁免的话，默认恒可用的
  // 基线会被判"未过门禁"，目录加载失败时只剩 knn，会直接导致决策包全程不可用。
  it('基线（KNN）豁免单日 holdout 门禁：它拿自己比自己，improve 恒为 0', () => {
    const knnResult = { basis: 'captured', metrics: { mae: 11.44, passes_gate: false, improve_vs_knn_pct: 0 } }
    expect(isTrustworthyForecast(knnResult as never)).toBe(false)                        // 不豁免时被误杀
    expect(isTrustworthyForecast(knnResult as never, { isBaseline: true })).toBe(true)   // 豁免后正常
  })

  it('豁免只覆盖门禁，不豁免 mock/合成——基线跑出合成兜底照样不可信', () => {
    expect(isTrustworthyForecast({ basis: 'synthetic' } as never, { isBaseline: true })).toBe(false)
    expect(isTrustworthyForecast({ basis: 'captured', mock: true } as never, { isBaseline: true })).toBe(false)
  })

})

describe('canBeDecisionModel：目标专用 store 模型不得作决策模型', () => {
  // /forecast/cockpit 拿同一个 model_type 跑两条腿（PRICE + LOAD）。store 模型在注册时
  // 绑定了 target，第二条腿必然被 run_forecast 以「target 不符」拒绝 → 决策包稳定 400。
  // 用户看到的是"价格对比好好的，一点生成就失败"，最难自查。
  it('store:* 排除出决策候选（价格对比仍可用，只是不能当决策模型）', () => {
    expect(canBeDecisionModel({ id: 'store:my-price-model', kind: 'compute' } as never)).toBe(false)
  })
  it('普通模型 id 不受影响', () => {
    expect(canBeDecisionModel({ id: 'random_forest', kind: 'compute' } as never)).toBe(true)
    expect(canBeDecisionModel({ id: 'restore-ish', kind: 'compute' } as never)).toBe(true) // 不是前缀匹配就不拦
  })
  // Epic #1898：remote: 远程模型绑定单一 target，LOAD 腿同样必败，按 supportedTargets 通用判据排除
  it('supportedTargets 不含 load 的目标专用模型（remote: 等）排除出决策候选', () => {
    expect(canBeDecisionModel(
      { id: 'remote:dlinear-yn-price-v1', kind: 'compute', supportedTargets: ['price'] } as never,
    )).toBe(false)
  })
  it('supportedTargets 覆盖两腿或缺省（全目标）时放行', () => {
    expect(canBeDecisionModel(
      { id: 'remote:multi', kind: 'compute', supportedTargets: ['price', 'load'] } as never,
    )).toBe(true)
    expect(canBeDecisionModel({ id: 'stacking', kind: 'compute' } as never)).toBe(true)
  })
})

describe('buildCompareRows：门禁事实随 outcome 传入', () => {
  it('基线行不因 passes_gate=false 掉出排名', () => {
    const rows = buildCompareRows([
      { ...ok('knn', 11.44, { metrics: { mae: 11.44, passes_gate: false } }), isBaseline: true },
      ok('random_forest', 21.46, { metrics: { mae: 21.46, passes_gate: true } }),
    ])
    expect(rows.find((r) => r.modelId === 'knn')?.rank).toBe(1)
    expect(rows.find((r) => r.modelId === 'knn')?.trustTag).toBeUndefined()
  })

})

describe('buildCompareRows：未过质量门禁的模型不排名', () => {
  it('passes_gate=false 即使 MAE 最低也不排名，并给出门禁原因', () => {
    const rows = buildCompareRows([
      ok('stacking', 3, { metrics: { mae: 3, passes_gate: false } }),
      ok('knn', 11.44),
    ])
    const gated = rows.find((r) => r.modelId === 'stacking')!
    expect(gated.rank).toBe(0)
    expect(gated.notRankableReason).toContain('质量门禁')
    expect(rows.find((r) => r.modelId === 'knn')?.rank).toBe(1)
  })

  it('缺 passes_gate 字段不影响排名（后端未跑门禁 ≠ 门禁失败）', () => {
    expect(buildCompareRows([ok('knn', 11.44)])[0].rank).toBe(1)
  })
})

describe('buildCompareRows：合成兜底结果同样不排名', () => {
  it('真实模型但本次落到 synthetic 兜底 → rank=0 且给出原因', () => {
    const rows = buildCompareRows([
      ok('knn', 5, { basis: 'synthetic' }),   // 合成兜底，MAE 反而最低
      ok('random_forest', 21.46),
    ])
    const knn = rows.find((r) => r.modelId === 'knn')!
    expect(knn.rank).toBe(0)
    expect(knn.trustworthy).toBe(false)
    expect(knn.notRankableReason).toContain('synthetic')
    expect(rows.find((r) => r.modelId === 'random_forest')?.rank).toBe(1)
  })

  it('参与排名的行不带 notRankableReason', () => {
    const rows = buildCompareRows([ok('knn', 11.44)])
    expect(rows[0].rank).toBe(1)
    expect(rows[0].notRankableReason).toBeUndefined()
  })

  it('各类不排名原因逐一可读', () => {
    const rows = buildCompareRows([
      failed('deep_model', 'No module named torch'),
      ok('tslib:X', 45.87, { mock: true, basis: 'illustrative' }),
      ok('knn', 5, { basis: 'synthetic' }),
    ])
    const by = (id: string) => rows.find((r) => r.modelId === id)!.notRankableReason
    expect(by('deep_model')).toContain('失败')
    expect(by('tslib:X')).toContain('占位')
    expect(by('knn')).toContain('合成')
  })
})

describe('toChartSeries：不可信曲线必须带标签进图', () => {
  // 图是最醒目的元素。模型可能返回 captured 数据但单日门禁判负，此时 result 本身看不出
  // 问题，若不带标签进图，它会和真实可信模型画成一模一样的实线，只看曲线的人会当它可信。
  it('门禁判负的 captured 曲线带「未过门禁」标签', () => {
    const series = toChartSeries([ok('stacking', 3, { metrics: { mae: 3, passes_gate: false } })])
    expect(series[0].untrustedTag).toBe('未过门禁')
  })

  it('基线豁免后不带标签（它拿自己比自己，判负无意义）', () => {
    const series = toChartSeries([
      { ...ok('knn', 11.44, { metrics: { mae: 11.44, passes_gate: false } }), isBaseline: true },
    ])
    expect(series[0].untrustedTag).toBeUndefined()
  })

  it('可信曲线不带标签', () => {
    expect(toChartSeries([ok('random_forest', 21.46)])[0].untrustedTag).toBeUndefined()
  })

  it('占位/合成各自带词', () => {
    const series = toChartSeries([
      ok('tslib:X', 45.87, { mock: true, basis: 'illustrative' }),
      ok('knn', 5, { basis: 'synthetic' }),
    ])
    expect(series.find((x) => x.provider === 'tslib:X')?.untrustedTag).toBe('占位')
    expect(series.find((x) => x.provider === 'knn')?.untrustedTag).toBe('合成')
  })
})

describe('untrustworthyTag：不同性质的问题必须给不同的词', () => {
  // 一律写「占位」会让用户把三种性质完全不同的问题看成同一件事：
  // mock=模型本身是假的；synthetic=模型真但这次拿合成数据算；未过门禁=真数据真模型但没打过基线。
  it.each([
    [{ basis: 'illustrative', mock: true }, '占位'],
    [{ basis: 'synthetic' }, '合成'],
    [{ basis: 'illustrative' }, '示意'],
    [{ basis: 'captured', metrics: { passes_gate: false } }, '未过门禁'],
    [{ basis: 'captured' }, undefined],
    [{ basis: 'captured', metrics: { passes_gate: true } }, undefined],
    [null, undefined],
  ])('%o → %s', (result, expected) => {
    expect(untrustworthyTag(result as never)).toBe(expected)
  })

  it('mock 优先于 basis：占位模型即使标了 captured 也是占位', () => {
    expect(untrustworthyTag({ basis: 'captured', mock: true } as never)).toBe('占位')
  })

  it('每个不可信的 CompareRow 都带 trustTag（表格角标不得漏标）', () => {
    const rows = buildCompareRows([
      ok('tslib:X', 45.87, { mock: true, basis: 'illustrative' }),
      ok('knn', 5, { basis: 'synthetic' }),
      ok('stacking', 3, { metrics: { mae: 3, passes_gate: false } }),
      ok('random_forest', 21.46),
    ])
    for (const r of rows) {
      expect(Boolean(r.trustTag)).toBe(!r.trustworthy)
    }
  })
})

describe('toChartSeries：失败模型不进图', () => {
  it('只保留成功结果——宁可少一条线，也不画假数据', () => {
    const series = toChartSeries([ok('knn', 11.44), failed('deep_model', 'boom')])
    expect(series).toHaveLength(1)
    expect(series[0].provider).toBe('knn')
  })

  it('占位模型仍进图（要能看见它的形状），靠 result.mock 让图层画虚线', () => {
    const series = toChartSeries([ok('tslib:PatchTST', 45.87, { mock: true })])
    expect(series).toHaveLength(1)
    expect(series[0].result.mock).toBe(true)
  })
})

describe('defaultSelection', () => {
  it('优先 knn + 一个其他真实模型，最多 2 个（限制首屏并发）', () => {
    expect(defaultSelection([
      { modelId: 'random_forest' }, { modelId: 'knn' }, { modelId: 'stacking' },
    ])).toEqual(['knn', 'random_forest'])
  })

  it('排除占位与不可用模型', () => {
    expect(defaultSelection([
      { modelId: 'tslib:PatchTST', mock: true },
      { modelId: 'deep_model', available: false },
      { modelId: 'knn' },
    ])).toEqual(['knn'])
  })

  it('无 knn 时取首个可用真实模型', () => {
    expect(defaultSelection([{ modelId: 'random_forest' }, { modelId: 'elastic_persist' }])).toEqual(['random_forest', 'elastic_persist'])
  })

  it('全不可用时返回空（不硬塞一个占位模型充数）', () => {
    expect(defaultSelection([{ modelId: 'tslib:X', mock: true }])).toEqual([])
  })

  // dljy#3647：默认算法由目录标注，不写死；目录标注不在可用池里（下线/占位/不可用）时退回旧规则。
  it('目录标注的默认算法优先补位：knn + 目录默认，而不是列表里排第一的那个', () => {
    expect(defaultSelection([
      { modelId: 'random_forest' }, { modelId: 'knn' }, { modelId: 'stacking' },
    ], 'stacking')).toEqual(['knn', 'stacking'])
    expect(defaultSelection([{ modelId: 'random_forest' }, { modelId: 'stacking' }], 'stacking'))
      .toEqual(['stacking', 'random_forest'])
  })

  it('目录默认算法不可用或不在池里 → 忽略，回到「首个可用真实模型」', () => {
    expect(defaultSelection([
      { modelId: 'knn' }, { modelId: 'random_forest' }, { modelId: 'deep_model', available: false },
    ], 'deep_model')).toEqual(['knn', 'random_forest'])
    expect(defaultSelection([{ modelId: 'knn' }, { modelId: 'random_forest' }], 'retired_algo'))
      .toEqual(['knn', 'random_forest'])
  })

  it('目录 recommended 标注在无默认 id 时同样生效', () => {
    expect(defaultSelection([
      { modelId: 'knn' }, { modelId: 'random_forest' }, { modelId: 'stacking', recommended: true },
    ])).toEqual(['knn', 'stacking'])
  })
})

// 原 isIncapableForTarget 测试块已随该临时挡板删除（#1461 根因闭环）。
// 「不支持某 target 的模型不进选择器」现由后端 contract_catalog 按 supportedTargets 过滤 +
// 前端 providersForTarget 按 provider.supportedTargets 过滤共同保证（申报台/工作台/驾驶舱统一），
// 不再需要前端手维护「必失败组合」清单。

describe('resolveDecisionModel：重跑不得静默改掉用户手选的口径', () => {
  const R = (o: Parameters<typeof resolveDecisionModel>[0]) => resolveDecisionModel(o)

  it('用户偏好仍可用 → 保持，不因排名更高的模型而改口径', () => {
    expect(R({ usableIds: ['knn', 'random_forest'], rankedIds: ['random_forest', 'knn'], preferred: 'knn' })).toBe('knn')
  })

  it('重跑场景：偏好在新批次里仍可用 → 仍是它（回归锚）', () => {
    // 用户手选 knn → 点「重跑」→ run() 清空 outcomes → 新结果回来
    const afterRerun = R({ usableIds: ['knn', 'random_forest'], rankedIds: ['random_forest', 'knn'], preferred: 'knn', current: '' })
    expect(afterRerun).toBe('knn')
  })

  it('偏好在本批不可用（未选/失败/口径不可信）→ 回退排名第一', () => {
    expect(R({ usableIds: ['random_forest', 'elastic_persist'], rankedIds: ['random_forest', 'elastic_persist'], preferred: 'knn' })).toBe('random_forest')
  })

  it('无偏好时沿用当前生效模型，避免每批都跳来跳去', () => {
    expect(R({ usableIds: ['knn', 'random_forest'], rankedIds: ['random_forest', 'knn'], current: 'knn' })).toBe('knn')
  })

  it('偏好优先于当前生效模型', () => {
    expect(R({ usableIds: ['knn', 'random_forest'], rankedIds: ['knn', 'random_forest'], preferred: 'random_forest', current: 'knn' }))
      .toBe('random_forest')
  })

  it('都不可用时取排名第一；无名次时取首个可用', () => {
    expect(R({ usableIds: ['a', 'b'], rankedIds: ['b'] })).toBe('b')
    expect(R({ usableIds: ['a', 'b'], rankedIds: [] })).toBe('a')
  })

  it('本批无可用模型 → 空串（调用方须先确认批次已跑完再据此回吐）', () => {
    expect(R({ usableIds: [], rankedIds: [], preferred: 'knn', current: 'random_forest' })).toBe('')
  })

  it('排名里含不可用模型时跳过它（名次来自全表，可用性另算）', () => {
    expect(R({ usableIds: ['knn'], rankedIds: ['random_forest', 'knn'] })).toBe('knn')
  })
})

describe('canBeDecisionModel：占位模型不得作为申报决策依据', () => {
  it.each([
    [{ mock: true }, false],
    [{ available: false }, false],
    // 回放 provider 不是 /forecast/predict 的 model_type：选它决策包稳定报
    // 「Unsupported forecast model: platform」，比给个坏结果更隐蔽，页面看着正常，
    // 只有决策包永远失败。
    [{ kind: 'replay' }, false],
    [{ kind: 'compute' }, true],
    [{}, true],
    [undefined, false],
    [null, false],
  ])('%o → %s', (model, expected) => {
    expect(canBeDecisionModel(model as never)).toBe(expected)
  })
})
