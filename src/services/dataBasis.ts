// 统一数据质量标志（P0-4）：归一项目里三套并存的真伪标注
// 服务端 mock/sourceType=MOCK、spotPrice 的 isDemo、地区画像的 dataSource/basis('curated'|'captured')。
// 目标：从数据加载 → 算法入参 → 决策输出 → UI 角标全链路透传，合成降级必须在页面可见。
//
// 口径定义：
// real         生产实时接入（当前项目尚无此来源，预留）
// captured     真实采集回放（data/private/capture-raw）
// illustrative 策划示意 / 默认样例（地区画像 curated、内置默认曲线）
// synthetic    合成降级 / 演示生成（回放未命中时的 synth 曲线、纯 Mock 序列）
// empty        诚实空态（演示开通地区如四川缺真实采集、严格地区不回退时返回空 points）

// DataBasis 单一权威定义上移至 services/data/types.ts（Phase 0 统一类型层），与
// forecast/* 的 ForecastBasis 合并为 DataSourceBasis。此处 re-export 保持现有
// `import { DataBasis } from '@/services/dataBasis'` 路径不破。
import type { DataBasis } from './data/types'
export type { DataBasis }

export const DATA_BASIS_LABEL: Record<DataBasis, string> = {
  real: '实时真实数据',
  captured: '真实采集回放',
  illustrative: '特征示意（非实时）',
  synthetic: '合成演示数据',
  empty: '暂无数据'
}

/** 可作为实盘决策依据的口径（real/captured）；illustrative/synthetic 仅供研究演示。 */
export function isDecisionGrade(basis: DataBasis): boolean {
  return basis === 'real' || basis === 'captured'
}

// worstBasis 排序：empty 最弱（完全无数据，弱于 synthetic 合成降级）。
const ORDER: DataBasis[] = ['real', 'captured', 'illustrative', 'synthetic', 'empty']

/** 多个输入混合时取最弱口径（结果可信度由最不可信的输入决定）。 */
export function worstBasis(...bases: DataBasis[]): DataBasis {
  return bases.reduce<DataBasis>(
    (acc, basis) => (ORDER.indexOf(basis) > ORDER.indexOf(acc) ? basis : acc),
    'real'
  )
}

/** 兼容 spotPrice 既有 isDemo 标注。 */
export function basisFromDemoFlag(isDemo: boolean): DataBasis {
  return isDemo ? 'synthetic' : 'captured'
}

/** 兼容地区画像既有 dataSource/basis 标注。 */
export function basisFromProfileSource(source: 'curated' | 'captured'): DataBasis {
  return source === 'captured' ? 'captured' : 'illustrative'
}
