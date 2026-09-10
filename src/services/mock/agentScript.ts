// 智能体演示流（PRD §4.3 agentStream）：mock 态下脚本化 SSE——
// token/tool_call/tool_result/done 事件帧协议与后端一致（agentClient.parseFrameBlock 只认
// `data:` 行 JSON），演示效果比真 LLM 稳定（不超时、不泄漏模型品牌，customer 版合规）。

import { mockJsonResponse } from './envelope'
import { seedOf } from './generators'

type AgentScriptEvent = { type: string; [k: string]: unknown }

const TOOL_PRELUDE = '正在读取云南日前出清价与机组出力曲线……'

function scriptFor(question: string): { events: AgentScriptEvent[]; tools: Array<{ name: string; summary: string }> } {
  const q = question.trim()
  const tools = [
    { name: 'fetch_spot_price', summary: '云南日前用户侧电价 96 点（演示数据）' },
    { name: 'build_bid_curve', summary: '生成申报建议曲线 480MW' }
  ]
  const body = q.includes('复盘')
    ? `昨日（D-1）申报 480MW，出清率 96.4%，偏差 +18.6MWh，主因午后光伏大发压价导致 mid-curve 段未中标。今日建议：9:00-11:00 早峰段报价上浮 5%，午间段维持平价申报。`
    : q.includes('风险') || q.includes('体检')
      ? `申报体检十项检查：容量上限、报价精度、敞口、偏笑、数据口径等 8 项 PASS；2 项 warning（午间逆负荷段、邻近报价上限），不构成硬阻断。结论：可以提交送审。`
      : `基于云南日前用户侧电价预测（早峰 9:00-11:00 约 420 元/MWh、晚峰 19:00-21:00 约 470 元/MWh、午间光伏压价至 90 元/MWh 附近），建议 480MW 机组今日申报曲线采取「早晚峰报价、午间平价」策略，预期日内结算收益约 21.6 万元（演示口径）。`
  const chunks = chunkText(body, 12)
  const events: AgentScriptEvent[] = [
    { type: 'graph_status', node: 'market_analyst', status: 'running' },
    { type: 'tool_call', name: tools[0].name, args: { region: 'yunnan' } },
    { type: 'tool_result', name: tools[0].name, summary: tools[0].summary },
    { type: 'token', content: TOOL_PRELUDE },
    { type: 'tool_call', name: tools[1].name, args: { capacity_mw: 480 } },
    { type: 'tool_result', name: tools[1].name, summary: tools[1].summary },
    ...chunks.map((content, i) => ({ type: 'token', content, seq: i })),
    { type: 'done', status: 'ok' }
  ]
  return { events, tools }
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

function frame(event: AgentScriptEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * 构造脚本化 SSE 响应。帧间 60ms 延迟模拟流式；abort（用户点停止）安全终止。
 */
export function mockAgentStreamResponse(question: string): Response {
  const { events } = scriptFor(question)
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let i = 0
      const push = () => {
        if (i >= events.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(frame(events[i])))
        i += 1
        setTimeout(push, 60)
      }
      push()
    }
  })
  return mockJsonResponse(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }
  })
}

/** 会话标题（演示态直接用问题截断，seed 仅保证 id 稳定形态）。 */
export function mockAgentSessionId(question = 'demo'): string {
  return `mock-sess-${seedOf(question).toString(36)}`
}
