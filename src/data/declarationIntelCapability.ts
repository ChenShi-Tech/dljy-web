// 申报前情报清单的**地区能力声明**（诚实空态的单一来源）。
//
// 为什么需要这张表：三项情报背后的数据源覆盖面并不一致——竞价空间与持仓敞口走各省
// 通用的采集回放，而检修计划/联络线披露的信源目前只接了山西（见 agent-runtime
// config/disclosure_sources.yaml 的 sx_maintenance_plan / sx_tie_line_plan，
// 均指向 pmos.sx.sgcc.com.cn）。
//
// 不声明的后果是最坏的一种：按钮照常可点 → 智能体拿不到数据 → 它可能"尽力回答"而
// 编出看似合理的检修安排 → 用户据此调整报价。宁可灰置并说明「本地区暂无信源」，
// 也不给模型编造的机会（对齐仓库「诚实空态 #56」：缺数即明确不可用，不合成兜底）。
//
// 新接入省份信源时改这里 + disclosure_sources.yaml，两处保持一致。

export type IntelCapabilityStatus = 'supported' | 'unsupported'

export type IntelCapability = {
  /** 与 intelChecklist 的 label 对应 */
  key: 'bidding_space' | 'maintenance_disclosure' | 'position_exposure'
  status: IntelCapabilityStatus
  /** 不支持时展示给用户的原因（必须具体到"缺什么"，不能只说"暂不支持"） */
  reason?: string
}

/** 检修/联络线披露已接入的地区（其余地区一律诚实置灰）。 */
const DISCLOSURE_REGIONS = new Set(['shanxi'])

/**
 * 按地区解析某项情报的可用性。
 *
 * 竞价空间与持仓敞口：工具内部对缺数已有 `available:false` 的诚实返回（不合成兜底），
 * 故这两项对所有地区都放行，由工具层给出该地区的真实空态，而不是在 UI 层预判。
 */
export function resolveIntelCapability(
  key: IntelCapability['key'],
  regionId: string
): IntelCapability {
  if (key !== 'maintenance_disclosure') return { key, status: 'supported' }
  const region = String(regionId || '').trim().toLowerCase()
  if (DISCLOSURE_REGIONS.has(region)) return { key, status: 'supported' }
  return {
    key,
    status: 'unsupported',
    reason: '当前地区暂无检修/联络线披露信源（目前仅接入山西电网 PMOS），无法核查该项'
  }
}

export const DISCLOSURE_SUPPORTED_REGIONS = Object.freeze([...DISCLOSURE_REGIONS])
