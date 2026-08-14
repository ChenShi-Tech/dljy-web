// 天工 · LLM 驱动的多智能体编排
// 给一个任务,让大模型扮演「调度中枢」,根据任务复杂度【动态】决定派哪些智能体
// (3~10 个不等)、各自职责与发现,并汇总成决策报告。
// 没配大模型 / 调用失败时,回退到内置示例,保证 demo 始终可演示。
import { chatCompletion, refreshLlmStatus } from '@/services/llm'
import { TIANGONG_ORCHESTRATOR_SYSTEM } from '@/prompts/tiangong'

export type Agent = { char: string; name: string; role: string; task: string; finding: string }
export type MissionReport = { summary: string; columns: string[]; rows: string[][]; conclusion: string }
export type MissionPlan = { agents: Agent[]; report: MissionReport; live: boolean }

// 预设诏令(任务),点一下即可演示不同规模的协作
export const PRESET_TASKS = [
  '分析山西现货市场次日价格走势,并给出关键时段交易建议',
  '评估某储能电站参与现货市场的套利空间与最优充放策略',
  '复盘本月持仓收益,定位偏差来源并给出下月优化方向',
  '为售电公司制定下一年度零售套餐与偏差考核对冲方案'
]

// 调度中枢系统提示已统一迁到 src/prompts/tiangong.ts（TIANGONG_ORCHESTRATOR_SYSTEM）。

function extractJson(text: string): any {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) t = t.slice(a, b + 1)
  return JSON.parse(t)
}

function normalize(raw: any): MissionPlan {
  const agents: Agent[] = (Array.isArray(raw?.agents) ? raw.agents : [])
    .slice(0, 12)
    .map((x: any) => ({
      char: (String(x?.char ?? '').trim() || String(x?.name ?? '智')[0] || '智').slice(0, 1),
      name: String(x?.name ?? '智能体').trim().slice(0, 8),
      role: String(x?.role ?? 'Agent').trim().slice(0, 16),
      task: String(x?.task ?? '').trim().slice(0, 24),
      finding: String(x?.finding ?? '已完成子任务处理。').trim().slice(0, 48)
    }))
    .filter((a: Agent) => a.name)
  if (!agents.length) throw new Error('no agents')
  const r = raw?.report ?? {}
  const report: MissionReport = {
    summary: String(r.summary ?? '已完成多智能体协同分析。').trim(),
    columns: Array.isArray(r.columns) && r.columns.length ? r.columns.map((c: any) => String(c)) : ['指标', '数值'],
    rows: Array.isArray(r.rows) ? r.rows.filter(Array.isArray).map((row: any[]) => row.map((c) => String(c))) : [],
    conclusion: String(r.conclusion ?? '').trim()
  }
  return { agents, report, live: true }
}

export async function planMission(task: string): Promise<MissionPlan> {
  if (!(await refreshLlmStatus())) return mockPlan(task)
  try {
    const content = await chatCompletion(
      [
        { role: 'system', content: TIANGONG_ORCHESTRATOR_SYSTEM },
        { role: 'user', content: `任务:${task}\n请规划并只返回 JSON。` }
      ],
      { json: true }
    )
    return normalize(extractJson(content))
  } catch {
    return mockPlan(task) // 解析失败 / 网络异常 → 兜底,演示不中断
  }
}

// ── 兜底示例(未接大模型时)────────────────────────────────────
// 按关键词给不同阵容,体现"数量随任务而变";标 live:false,前端会提示为示例。
export function mockPlan(task: string): MissionPlan {
  const t = task || ''
  if (t.includes('储能')) {
    return {
      live: false,
      agents: [
        { char: '采', name: '数据采集', role: 'Collector', task: '汇集现货价与负荷', finding: '近30日峰谷价差均值 462 元/MWh。' },
        { char: '估', name: '套利测算', role: 'Arbitrage', task: '测算充放套利空间', finding: '两充两放日均套利 1.86 万元。' },
        { char: '池', name: '电池建模', role: 'Battery', task: '约束SOC与循环寿命', finding: 'DoD 90%,循环成本 0.21 元/kWh。' },
        { char: '策', name: '充放策略', role: 'Strategy', task: '生成最优充放计划', finding: '午谷充、晚峰放,日收益 +12%。' },
        { char: '控', name: '风险校验', role: 'Risk', task: '校验越限与偏差', finding: 'SOC 越限风险为零,通过。' }
      ],
      report: {
        summary: '5 个智能体完成储能套利评估:在两充两放策略下,日均套利约 1.86 万元,晚峰放电收益最高,SOC 全程合规。',
        columns: ['时段', '动作', '电价(元/MWh)', '收益(元)'],
        rows: [
          ['11:30-13:30', '充电', '208', '-4,160'],
          ['18:00-20:30', '放电', '641', '+12,820'],
          ['23:00-01:00', '充电', '236', '-4,720'],
          ['07:00-09:00', '放电', '512', '+10,240']
        ],
        conclusion: '建议执行两充两放,优先保障晚峰满功率放电。'
      }
    }
  }
  return {
    live: false,
    agents: [
      { char: '采', name: '数据采集', role: 'Collector', task: '汇集96点市场数据', finding: '现货/负荷/新能源样本完整度 99.6%。' },
      { char: '荷', name: '负荷预测', role: 'Load', task: '预测次日负荷', finding: '次日双峰,晚峰 19:00 抬升至高位。' },
      { char: '能', name: '新能源出力', role: 'Renewable', task: '预测风光出力', finding: '午间光伏大发,占比峰值 41.7%。' },
      { char: '析', name: '价格回归', role: 'Pricing', task: '回归次日价格', finding: '晚峰中枢上移至 598,午谷压至 208。' },
      { char: '策', name: '交易策略', role: 'Strategy', task: '生成交易建议', finding: '晚峰顶格申报,预期增益约 23.8 万元。' },
      { char: '控', name: '风险校验', role: 'Risk', task: '校验风险敞口', finding: '单时段申报量 ≤ 额定 80%,通过。' }
    ],
    report: {
      summary: '6 个智能体完成次日现货分析:晚峰(18:00–20:30)价格中枢上移至 598 元/MWh,午间光伏大发压价至 208 元/MWh 低谷,全天预期增益约 23.8 万元。',
      columns: ['时段', '日前预测', '实时预测', '建议'],
      rows: [
        ['07:00-09:00', '486.2', '512.8', '逢高出货'],
        ['11:30-13:30', '208.5', '176.3', '低谷补仓'],
        ['18:00-20:30', '598.7', '641.2', '顶格申报'],
        ['23:00-24:00', '312.4', '298.6', '持仓观望']
      ],
      conclusion: '晚峰顶格申报、午谷择机补仓,全天预期增益约 23.8 万元。'
    }
  }
}
