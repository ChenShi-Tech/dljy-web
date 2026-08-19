// 顶层工具组的渲染期归并（从 AgentChatPanel 抽出，纯函数便于单测）。
//
// 一轮里连续调 8 个顶层工具就是 8 张平铺卡片，把对话冲得很长。这里把连续的顶层
// 工具归为一组：折叠只显「done/total + 当前工具名」，展开才逐条看参数与结果
// ，复刻子智能体分组（.sa-head）已验证的形态。
//
// 为什么不新增 seg 类型：HistorySeg 联合由后端 SegAccumulator 唯一落库，新增 kind
// 要同步改 Python + restoreSeg 并过 verify:agent-lock/smoke。渲染期归并对落库与回放
// 零影响，tool_result 的匹配逻辑（按 segs 倒序找 running）也无需改动。

export type GroupableToolSeg = {
  kind: string
  name: string
  status: 'running' | 'done' | 'error'
  /** 子智能体内部工具带此字段，它们已在 subagent-group 内渲染，不参与顶层归并 */
  subRole?: string
  basis?: string
}

export type ToolGroupSummary = {
  done: number
  total: number
  /** 正在跑的工具中文名；都跑完则取最后一个 */
  label: string
  running: boolean
  error: boolean
}

export function isTopLevelTool(seg: { kind: string; subRole?: string } | undefined | null): boolean {
  return !!seg && seg.kind === 'tool' && !seg.subRole
}

/**
 * 该下标是否为一组连续顶层工具的起点（组内其余下标由调用方跳过渲染）。
 * index=0 时 segs[-1] 为 undefined，isTopLevelTool 返回 false，故首位自然算起点。
 */
export function isToolGroupStart(
  segs: ReadonlyArray<{ kind: string; subRole?: string }>,
  index: number
): boolean {
  return isTopLevelTool(segs[index]) && !isTopLevelTool(segs[index - 1])
}

/** 从组首下标取整组连续顶层工具（遇到任何非顶层工具段即止）。 */
export function topToolGroupAt<T extends { kind: string; subRole?: string }>(
  segs: ReadonlyArray<T>,
  index: number
): T[] {
  const out: T[] = []
  for (let k = index; k < segs.length && isTopLevelTool(segs[k]); k += 1) out.push(segs[k])
  return out
}

/** 组头摘要。toolLabel 由调用方注入（TOOL_LABELS 在组件内）。 */
export function summarizeToolGroup(
  tools: ReadonlyArray<GroupableToolSeg>,
  toolLabel: (name: string) => string
): ToolGroupSummary {
  const running = tools.find((t) => t.status === 'running')
  const current = running ?? tools[tools.length - 1]
  return {
    done: tools.filter((t) => t.status === 'done').length,
    total: tools.length,
    label: current ? toolLabel(current.name) : '',
    running: !!running,
    error: tools.some((t) => t.status === 'error'),
  }
}

// 口径由弱到强。组头取最弱的那个：组默认折叠，若取最后一个（.sa-head 的
// delegateBasis 语义），前面工具用过 synthetic_mock、后面用了 captured 时，组头会显示
// captured 并把"用了合成数据"这一事实藏在折叠里，混合来源被呈现为全真实数据。
// 同 reportEngine.composeProvenance「取最弱口径保证溯源不漂移」。
const BASIS_RANK: Record<string, number> = {
  synthetic: 0,
  illustrative: 1,
  derived: 2,
  imported: 3,
  captured: 4,
  real: 5,
}

/** 组内最弱口径（无口径则 undefined，不伪造标注）。 */
export function toolGroupBasis(tools: ReadonlyArray<GroupableToolSeg>): string | undefined {
  let weakest: string | undefined
  let weakestRank = Number.POSITIVE_INFINITY
  for (const t of tools) {
    if (!t.basis) continue
    // 未知口径按最弱处理（宁可提示更保守，也不把未知当真实）
    const rank = BASIS_RANK[t.basis] ?? -1
    if (rank < weakestRank) {
      weakestRank = rank
      weakest = t.basis
    }
  }
  return weakest
}
