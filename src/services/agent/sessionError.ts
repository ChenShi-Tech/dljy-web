// 创建智能体会话失败的用户可读文案（#1631）。
// 纯函数模块：无 window/localStorage 依赖，供 vitest 直接单测（模式同 quant/reviewError.ts）。
// 服务端结构化 detail（如缺 API Key 的 424）优先透传；无 detail 时才回退按状态码
// 猜测的兜底话术——404=harness 依赖组未装，5xx=后端进程没起/代理连不上。

export function formatCreateSessionError(status: number, detail = ''): string {
  const hint = detail
    ? `（${detail}）`
    : status === 404
      ? '（后端未启用智能体：先 npm run install:agent-api 再重启后端）'
      : status >= 500
        ? '（智能体后端未启动：npm run dev:agent-api）'
        : ''
  return `创建会话失败: ${status}${hint}`
}

// 从失败响应中安全提取 FastAPI 结构化错误 detail；非 JSON（如代理错误页）或形状不符返回空串。
export async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    return typeof body?.detail === 'string' ? body.detail : ''
  } catch {
    return ''
  }
}
