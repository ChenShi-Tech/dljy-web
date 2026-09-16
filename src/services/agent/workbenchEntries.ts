// 智能体工作台的入口注册表（#2023 入口合并）。
//
// 合并前「AI 交易助手」下并排挂着 6 个页面，每个都是 `AgentChatPanel` 的薄壳，各自复制一份
// 「历史侧栏 + 面板 + 启动问 computed + 折叠状态」。它们之间真正的差异只有四项：
// **用哪个 scenario、用哪个页面提示 key、启动问怎么拼、要不要额外挂件**。本表把这四项声明化，
// 六个入口合并进 `/ai-agent` 一个工作台，壳只写一遍。
//
// **入口 key ≠ scenario**：这是合并时才暴露出来的事实——`pre_submit_check` / `policy_intel`
// 从来不是 scenario，它们是 `scenario="chat"` + 各自的 `promptKey`（#2023 issue 正文的表格把
// 这两列写混了，按代码为准）。所以路由参数用 `?entry=`，(scenario, promptKey) 由本表决定；
// `?scenario=` 仍然认，映射规则见 `resolveEntry`。
//
// **historyKey 仍按入口隔离**，没有改成跨入口聚合：每个入口的历史都是按自己的 page_key 落的，
// 改聚合会让六个入口的会话混进一个列表（找不着），而分开则一条历史都不丢、语义与合并前一致。

import { PAGE_PROMPT_KEYS } from '@/prompts/pageKeys'
import type { AgentScenario } from '@/services/agent/agentClient'

/** 入口专属挂件：由工作台按 key 条件渲染对应组件（见 AgentWorkbenchView）。 */
export type WorkbenchExtra = 'morning-brief-rail' | 'strategic-qa-gaps' | 'checkup-auto-approve'

/** 入口需要的输入控件（工作台统一渲染，值回传给 buildQuestion）。 */
export type WorkbenchInput =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'text'; key: string; label: string; placeholder?: string }

export type WorkbenchEntryContext = {
  /** 输入控件的当前值，按 WorkbenchInput.key 索引 */
  values: Record<string, string>
  regionName: string
}

export type WorkbenchEntry = {
  /** URL `?entry=` 取值，同时用作 historyKey 与历史侧栏 page_key（与合并前各页一致，历史不丢） */
  key: string
  title: string
  /** 场景卡上的一句话说明 */
  desc: string
  scenario: AgentScenario
  /** 页面提示白名单 key；两个 pi PoC 入口没有对应白名单条目，留空即不传 */
  promptKey?: string
  inputs?: WorkbenchInput[]
  /** 启动按钮文案（缺省「开始」） */
  actionLabel?: string
  /** 启动问：返回空串表示该入口不预置启动问（用户自己输入第一句） */
  buildQuestion?: (ctx: WorkbenchEntryContext) => string
  extra?: WorkbenchExtra
  /** 历史侧栏默认折叠（挂件多的入口默认折叠省空间，与合并前各页默认值一致） */
  collapsedByDefault?: boolean
  /** 是否随消息下发地区摘要（合并前由各页的 regionPayload 决定） */
  sendRegionSummary?: boolean
  /**
   * 结论区不可移除水印的口径（`trustGate.trustWatermark` 取文案）。
   * 申报前体检的输入含合成/示意数据，结论口径恒为 advisory_only——水印与顶栏警示互补，
   * 杜绝被当成正式申报/结算依据。`verify:trust-gate` 把这条列为消费点，删了会红。
   */
  watermarkBasis?: 'synthetic'
}

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const WORKBENCH_ENTRIES: readonly WorkbenchEntry[] = [
  {
    key: 'workbench',
    title: '通用对话',
    desc: '综合决策入口：问行情、要分析、让它取数出图，或直接接手浮层助手转来的问题',
    scenario: 'chat',
    promptKey: PAGE_PROMPT_KEYS.workbench,
    sendRegionSummary: true
  },
  {
    key: 'morning_brief',
    title: '交易晨报',
    desc: '数据预检 + 四视角研判：先确定性装配当日数据包，再出三段式晨报',
    scenario: 'morning_brief',
    promptKey: PAGE_PROMPT_KEYS.morningBrief,
    inputs: [{ kind: 'date', key: 'date', label: '目标日' }],
    actionLabel: '生成晨报',
    // 晨报场景的首条消息就是目标日（服务端据此启动装配），不是自然语言问题
    buildQuestion: (ctx) => ctx.values.date || todayISO(),
    extra: 'morning-brief-rail',
    collapsedByDefault: true
  },
  {
    key: 'pre_submit_check',
    title: '申报前体检',
    desc: '提交申报前做合规预检 + 偏差考核风险 + 出清博弈推演，给 go/no-go 三维评分卡',
    scenario: 'chat',
    promptKey: PAGE_PROMPT_KEYS.preSubmitCheck,
    inputs: [
      { kind: 'date', key: 'date', label: '目标日' },
      { kind: 'text', key: 'intent', label: '拟申报概述', placeholder: '选填：这次打算怎么报' }
    ],
    actionLabel: '开始体检',
    sendRegionSummary: true,
    watermarkBasis: 'synthetic',
    buildQuestion: (ctx) =>
      `请对「${ctx.regionName}」${ctx.values.date || todayISO()} 的拟申报做「提交前体检」并给出 go/no-go 评分卡：\n` +
      (ctx.values.intent?.trim() ? `拟申报概述：${ctx.values.intent.trim()}\n` : '') +
      '1) 合规预检：用 check_declaration_compliance 校验限价、申报量、规则口径；\n' +
      '2) 偏差考核风险：评估申报与预计出力/负荷的偏差及考核费用敞口；\n' +
      '3) 出清博弈：用 estimate_rival_bidding / simulate_clearing_game 推演中标概率与出清价；\n' +
      '4) 评分卡：合规 / 风险 / 收益 三维各给 0–100 分与一句话理由，最后给总评与 go/no-go 建议。\n' +
      '结合本地区限价与结算规则；用 Markdown 表格呈现评分；不要编造数据，合成/示意数据需注明。'
  },
  {
    key: 'policy_intel',
    title: '政策情报官',
    desc: '检索交易中心/国网/能源局披露，按对本地区策略的相关性打分并标注规则变更',
    scenario: 'chat',
    promptKey: PAGE_PROMPT_KEYS.policyIntel,
    inputs: [{ kind: 'text', key: 'keyword', label: '关键词', placeholder: '选填：聚焦某个主题' }],
    actionLabel: '汇集情报',
    sendRegionSummary: true,
    // 检索工具从 fetch_disclosures 换成「列类目 + 读正文」两步：前者会写共享披露库，按准入判据
    // 已移出批量桥（承载底座调不到），照着旧启动问写模型只会卡在一个不存在的工具上。
    // 相应地必须说清检索覆盖范围——读的是已入库披露，不等于「已核对最新公告」。
    buildQuestion: (ctx) =>
      `请汇集近期与「${ctx.regionName}」电力现货交易相关的交易中心 / 国网 / 能源局披露公告与政策文件` +
      (ctx.values.keyword?.trim() ? `（聚焦关键词：${ctx.values.keyword.trim()}）` : '') +
      '，并：\n' +
      '1) 用 list_disclosures_by_category 按类目列出候选，再用 read_disclosure 读正文；\n' +
      '2) 对每条按「对本地区现货交易策略的相关性」打分（高/中/低）并一句话说明；\n' +
      '3) 重点标注影响限价 / 结算 / 偏差考核 / 新能源申报的规则变更；\n' +
      '4) 汇总：哪些工作台或策略需据此调整。\n' +
      '用 Markdown 表格呈现情报清单（来源/标题/相关性/影响）；**只能读已采集入库的披露**，' +
      '须说清检索覆盖的时间范围，不得声称「已核对最新公告」；不要编造，合成/示意数据需注明。'
  },
  {
    key: 'strategic_qa',
    title: '战略问答',
    desc: '一句战略方向 → 解读意图 → 查真实数据 → 给分析与图表；查不到的如实记入缺口清单',
    scenario: 'strategic_qa',
    extra: 'strategic-qa-gaps'
  },
  {
    key: 'declaration_checkup',
    title: '申报体检',
    desc: '查行情 → 沙箱实算体检 → 审批卡人工批准后落库申报台草稿（对外提交永不可执行）',
    scenario: 'declaration_checkup',
    extra: 'checkup-auto-approve'
  }
] as const

export const DEFAULT_ENTRY_KEY = 'workbench'

/** 工作台入口自身不占用的 scenario：仍可由 `?scenario=` 指定，落在通用对话入口下。 */
const WORKBENCH_SCENARIOS: readonly AgentScenario[] = ['chat', 'declaration_prep', 'daily_review']

export function findEntry(key?: string | null): WorkbenchEntry | undefined {
  return WORKBENCH_ENTRIES.find((e) => e.key === key)
}

/**
 * 解析路由 query → (入口, 实际 scenario)。
 *
 * 两个来源都要认，因为它们是历史形成的两套深链：
 * - `?entry=` 是合并后的主参数（旧页面的 redirect 一律带它）；
 * - `?scenario=` 是浮层助手「交给智能体深度处理」与合并前工作台已在用的参数，不能失效。
 *   其中 `declaration_prep`/`daily_review` 没有独立入口——它们是通用对话入口下可选的场景，
 *   保留原语义（合并前 AgentWorkbenchView 就是这么认的）。
 */
export function resolveEntry(query: { entry?: unknown; scenario?: unknown }): {
  entry: WorkbenchEntry
  scenario: AgentScenario
} {
  const entryKey = typeof query.entry === 'string' ? query.entry : ''
  const scenarioParam = typeof query.scenario === 'string' ? query.scenario : ''

  const byEntry = findEntry(entryKey)
  if (byEntry) {
    // ?entry= 与 ?scenario= 同时出现且后者属通用对话可选场景时，以 scenario 为准（深链更具体）
    if (byEntry.key === DEFAULT_ENTRY_KEY && WORKBENCH_SCENARIOS.includes(scenarioParam as AgentScenario)) {
      return { entry: byEntry, scenario: scenarioParam as AgentScenario }
    }
    return { entry: byEntry, scenario: byEntry.scenario }
  }

  // 只给了 ?scenario=：先看有没有以它为主场景的入口，再看是不是通用对话下的可选场景
  const byScenario = WORKBENCH_ENTRIES.find(
    (e) => e.scenario === scenarioParam && e.key !== DEFAULT_ENTRY_KEY
  )
  if (byScenario) return { entry: byScenario, scenario: byScenario.scenario }

  const fallback = findEntry(DEFAULT_ENTRY_KEY) as WorkbenchEntry
  if (WORKBENCH_SCENARIOS.includes(scenarioParam as AgentScenario)) {
    return { entry: fallback, scenario: scenarioParam as AgentScenario }
  }
  return { entry: fallback, scenario: fallback.scenario }
}

/**
 * 会话 → 工作台入口（统一 AI 侧边栏「在工作台打开」与历史会话续接用）。
 * 场景唯一对应的入口直接命中；chat 场景按页面提示词 key 区分通用对话/申报前体检/政策情报官；
 * 其余（页面解读 key、未知 key、历史会话缺 key）落通用对话入口——对话内容照常续接，只是标签取通用。
 */
export function entryForSession(scenario: string, promptKey?: string | null): WorkbenchEntry {
  const byScenario = WORKBENCH_ENTRIES.find((e) => e.scenario === scenario && e.scenario !== 'chat')
  if (byScenario) return byScenario
  if (scenario === 'chat' && promptKey) {
    const byKey = WORKBENCH_ENTRIES.find((e) => e.scenario === 'chat' && e.promptKey === promptKey)
    if (byKey) return byKey
  }
  return findEntry(DEFAULT_ENTRY_KEY) as WorkbenchEntry
}

/** 入口的输入控件初值（date 类一律取今天，text 类空串）。 */
export function initialInputValues(entry: WorkbenchEntry): Record<string, string> {
  const out: Record<string, string> = {}
  for (const input of entry.inputs || []) {
    out[input.key] = input.kind === 'date' ? todayISO() : ''
  }
  return out
}
