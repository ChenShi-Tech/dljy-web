/**
 * 报表引擎（前端运行时）：Template × Params → 取数 → 口径计算 → ReportInstance。
 *
 * 职责分层：
 *   - settlementFormula.ts 负责「怎么算」（纯数学）；
 *   - regionSettlementRules.ts 负责「按省用什么参数」；
 *   - 本文件负责「编排」：按模板的 blockIds 调用注册的区块构建器，取数（/api/v1 或采集回放），
 *     把口径参数注入公式，产出可被 ReportBlockRenderer 直接渲染的 ReportInstance。
 *
 * 区块构建器（BlockBuilder）由各业务报表在 Phase 1/2 通过 registerBlock 注册，
 * 引擎本身不内置业务逻辑，保持可扩展。未注册的区块降级为占位块（明确标注）。
 *
 * 数据溯源：每个区块携带 provenance，实例整体溯源取所有区块的「最弱」口径，
 * 保证 Mock/回放不被误判为真实（项目铁律）。
 */
import { apiGet } from '@/services/api'
import type { Provenance } from '@/services/api'
import type { ReportTemplate, ReportsClosedLoop } from '@/services/reports/types'
import { getRegionSettlementRule, type RegionSettlementRule } from '@/services/region/regionSettlementRules'

export type ReportParams = {
  /** 交易日 YYYY-MM-DD */
  tradeDate?: string
  /** 结算月 YYYY-MM */
  month?: string
  granularity?: 'POINT_96' | 'POINT_24' | 'MIN_15' | 'DAY' | 'MONTH'
  /** 地区 id（与 regions.ts RegionProfile.id 一致） */
  regionId?: string
  subjectId?: string
  /** 主体类型 GENERATOR / RETAILER / LOAD ... */
  subjectType?: string
  /** 市场 中长期 / 日前 / 实时 */
  market?: string
}

export type ReportBlockType = 'METRIC' | 'CHART' | 'TABLE' | 'AI_TEXT' | 'SETTLEMENT'

export type ReportBlockInstance = {
  blockId: string
  blockType: ReportBlockType
  title: string
  /** 渲染数据：METRIC→KPI[]，CHART→ECharts option，TABLE→{columns,rows}，AI_TEXT→string */
  data: unknown
  provenance: Provenance
  /** 占位 / 降级 / 待核 等说明，渲染时透出给用户 */
  note?: string
}

export type ReportInstance = {
  templateId: string
  templateName: string
  params: ReportParams
  generatedAt: string
  blocks: ReportBlockInstance[]
  /** 整体溯源（所有区块的最弱口径） */
  provenance: Provenance
}

export type BlockContext = {
  template: ReportTemplate
  /** 当前地区的结算口径参数（限价 / 价格口径 / 免考核带 / 容量电价 …） */
  settlementRule: RegionSettlementRule
}

export type BlockBuilder = (params: ReportParams, ctx: BlockContext) => Promise<ReportBlockInstance> | ReportBlockInstance

const registry = new Map<string, BlockBuilder>()

/** 注册区块构建器（同 blockId 重复注册以最后一次为准）。 */
export function registerBlock(blockId: string, builder: BlockBuilder): void {
  registry.set(blockId, builder)
}

export function getRegisteredBlockIds(): string[] {
  return [...registry.keys()]
}

export function hasBlockBuilder(blockId: string): boolean {
  return registry.has(blockId)
}

const MOCK_PROVENANCE: Provenance = { sourceType: 'MOCK', realDataConnected: false }

/** 取一组溯源中最弱的口径：只要有一个 MOCK 即整体 MOCK，全部 DB/CAPTURE 才上调。 */
export function composeProvenance(list: Provenance[]): Provenance {
  if (!list.length) return { ...MOCK_PROVENANCE }
  // 可信度从高到低；index 越大越弱
  const order: Provenance['sourceType'][] = ['DB', 'CAPTURE', 'DEMO', 'MOCK']
  let worst = list[0]
  for (const p of list) {
    if (order.indexOf(p.sourceType) > order.indexOf(worst.sourceType)) worst = p
  }
  return { sourceType: worst.sourceType, realDataConnected: list.every((p) => p.realDataConnected) }
}

function placeholderBlock(blockId: string, note: string): ReportBlockInstance {
  return { blockId, blockType: 'METRIC', title: blockId, data: null, provenance: { ...MOCK_PROVENANCE }, note }
}

/**
 * 按模板生成报表实例：遍历 blockIds，逐块调用注册的构建器，注入地区结算口径。
 * 单个区块失败不影响其余区块（降级为占位块）。
 */
export async function runTemplate(template: ReportTemplate, params: ReportParams): Promise<ReportInstance> {
  const regionId = params.regionId ?? template.region ?? 'generic-sgcc'
  const settlementRule = getRegionSettlementRule(regionId)
  const ctx: BlockContext = { template, settlementRule }

  const blocks: ReportBlockInstance[] = []
  for (const blockId of template.blockIds) {
    const builder = registry.get(blockId)
    if (!builder) {
      blocks.push(placeholderBlock(blockId, '该区块尚未注册构建器（占位，待 Phase 1/2 实现）'))
      continue
    }
    try {
      blocks.push(await builder(params, ctx))
    } catch (error) {
      blocks.push(placeholderBlock(blockId, `区块构建失败：${error instanceof Error ? error.message : '未知错误'}`))
    }
  }

  return {
    templateId: template.templateId,
    templateName: template.templateName,
    params,
    generatedAt: new Date().toISOString(),
    blocks,
    provenance: composeProvenance(blocks.map((b) => b.provenance))
  }
}

/** 从后端报表闭环取列表数据（报表中心模板库 / 生成队列 / 导出归档 共用）。 */
export async function fetchReportsClosedLoop(params?: { period?: string }): Promise<ReportsClosedLoop> {
  const res = await apiGet<ReportsClosedLoop>('/v1/reports/closed-loop', params)
  return (res.data ?? res) as ReportsClosedLoop
}
