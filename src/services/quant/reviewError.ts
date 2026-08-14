// 复盘错误分类：纯逻辑、零浏览器/网络依赖，独立成模块以便 node 环境纯函数单测直测
// （quantClient.ts 的模块加载链会触达 window，进不了 vitest node 环境）。

export class QuantHttpError extends Error {
  status: number
  detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'QuantHttpError'
    this.status = status
    this.detail = detail
  }
}

export type ReviewFailure = {
  kind: 'service-unreachable' | 'data-not-onboarded' | 'data-unavailable' | 'unauthorized' | 'load-failed'
  title: string
  description: string
  detail?: string
}

/**
 * 将 review 的传输失败与业务空态分开，供三个复盘消费页统一呈现。
 * 503 不可一概归为「实际电量未接入」：后端 _require_available 对申报侧无源、价格族缺失、
 * 公司/地区未授权同样抛 503（三态判据见 docs/agent-harness/data-access-paradigm.md §4.1），
 * 故按 detail 文案区分 not_onboarded / unauthorized / unavailable，仅兜底才落 unavailable。
 */
export function classifyReviewError(error: unknown): ReviewFailure {
  if (error instanceof QuantHttpError && error.status === 503) {
    const detail = error.detail ?? ''
    if (/无权|unauthorized/i.test(detail)) {
      return {
        kind: 'unauthorized',
        title: '无权读取该数据（公司/地区授权不足）',
        description: '请确认当前登录账号对该地区与数据族的授权后重试。',
        detail: error.detail,
      }
    }
    if (/尚未接入|not[_ ]?onboarded|actual_mwh_96/.test(detail)) {
      return {
        kind: 'data-not-onboarded',
        title: '实际电量数据尚未接入（需提供 actual_mwh_96，接入进展见 #1488）',
        description: '完成实际电量曲线接入后，复盘指标将在此显示。',
        detail: error.detail,
      }
    }
    return {
      kind: 'data-unavailable',
      title: '该日期/地区暂无可用复盘数据',
      description: '申报或价格侧数据缺失（后端说明见下）；请更换日期，或确认该地区数据接入情况。',
      detail: error.detail,
    }
  }
  const isConnectionError = error instanceof TypeError
    || (typeof DOMException !== 'undefined'
      && error instanceof DOMException
      && ['AbortError', 'TimeoutError'].includes(error.name))
  if (isConnectionError) {
    return {
      kind: 'service-unreachable',
      title: '量化服务不可达',
      description: '请检查网络连接或稍后重试。',
      detail: error instanceof Error ? error.message : undefined,
    }
  }
  return {
    kind: 'load-failed',
    title: '复盘数据加载失败',
    description: '请核对输入后重试；如持续失败，请联系系统管理员。',
    detail: error instanceof Error ? error.message : String(error),
  }
}
