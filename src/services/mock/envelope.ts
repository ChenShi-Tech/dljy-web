// Mock 演示响应装配：统一信封 + 诚实标注（PRD §4.3，红线「mock 必须可见标注」）。
//
// 所有合成响应都带：
//   * 信封字段 mock:true + productionWrite:false + provenance.sourceType:'DEMO'
//     （与服务端 mock-tag 语义一致，前端 isMockPayload 可识别）
//   * 响应头 x-data-mock:true + x-region-served —— 走 api.ts unwrap → applyRegionHeaders
//     现有通道，「模拟数据」横幅自动出现，无需页面改动。
// quant/forecast 等「裸 JSON」端点（客户端不走 unwrap）用 mockJsonResponse 携带同样响应头，
// mock 标注落在 body.mock 字段上（与 bidPlanClient/latestForecast 既有 mock 字段口径一致）。

import { currentRegion } from '@/services/region/regionContext'

export type MockEnvelopeInit = {
  status?: number
  /** 额外响应头（极少用，如 SSE 帧头） */
  headers?: Record<string, string>
}

function demoHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-data-mock': 'true',
    'x-region-served': currentRegion.value.id,
    'x-region-fallback': 'false',
    'x-data-visibility': 'public',
    ...extra
  }
}

/** 原始 JSON 响应（调用方自行保证 body 形状，如裸 JSON 的 quant/forecast 客户端）。 */
export function mockJsonResponse(body: unknown, init: MockEnvelopeInit = {}): Response {
  const payload = body instanceof ReadableStream ? body : JSON.stringify(body)
  return new Response(payload, {
    status: init.status ?? 200,
    headers: demoHeaders(init.headers)
  })
}

/** 信封响应（apiGet/apiPost/.../fetchCaptured 等走 unwrap 的通道）。data 与 rows 可并存。 */
export function mockEnvelopeResponse(payload: Record<string, unknown>, init: MockEnvelopeInit = {}): Response {
  const body = {
    code: init.status ?? 200,
    msg: '演示数据（Mock 演示账号专用，不接真实数据）',
    mock: true,
    productionWrite: false,
    provenance: { sourceType: 'DEMO', realDataConnected: false },
    ...payload
  }
  return mockJsonResponse(body, init)
}

/** 空列表信封：未覆盖接口的 fail-open 兜底（PRD §4.3：宁可空态，绝不回源真实后端）。 */
export function mockEmptyEnvelopeResponse(method: string, path: string): Response {
  if (method === 'GET') {
    return mockEnvelopeResponse({ data: null, rows: [], total: 0 })
  }
  // 写请求模拟成功并回显空对象，页面状态机可继续；真实后端不产生任何痕迹。
  return mockEnvelopeResponse({ data: {}, msg: `演示模式：${path} 写操作已模拟成功` })
}

/**
 * 「管道可消费」演示信封：供山西出清曲线等**只接受真实载荷**的前端管道使用
 * （spotPriceCore.replayPayload 硬拒 mock 信封与地区不匹配——「真实或空」纪律）。
 * 演示数据要流过这些管道，载荷必须声明 realDataConnected:true + served=当前地区；
 * 诚实标注不靠载荷字段，而由会话级「演示模式」徽标 + x-data-mock 响应头
 * （unwrap → regionDataStatus → 模拟数据横幅）承担（PRD 附录 C.3 决策）。
 */
export function mockPipelineEnvelopeResponse(payload: Record<string, unknown>): Response {
  const body = {
    code: 200,
    msg: '演示数据（Mock 演示账号专用，不接真实数据）',
    productionWrite: false,
    provenance: {
      sourceType: 'DEMO',
      realDataConnected: true,
      served: currentRegion.value.id,
      fallback: false
    },
    ...payload
  }
  return mockJsonResponse(body)
}
