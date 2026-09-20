// 套保工作台数据会话（openspec build-midlong-spot-hedging 任务 8.4，specs HW-05/HW-06）。
//
// HW-06 切换不串数据：切换公司、地区或认知时点时立即清空旧结果，并丢弃迟到的旧响应——
// 复用 midlongP2Session 的「代次快照」模式，扩展为「查询代次」：每次范围切换 renew()，
// 请求发起时 begin(scopeKey)，响应返回时 isCurrent 校验，过期一律丢弃。

export interface QuerySessionToken {
  generation: number
  scopeKey: string
}

export function createQuerySession() {
  let generation = 0
  return {
    renew() {
      generation += 1
    },
    begin(scopeKey: string): QuerySessionToken {
      return { generation, scopeKey }
    },
    isCurrent(token: QuerySessionToken, scopeKey: string) {
      return token.generation === generation && token.scopeKey === scopeKey
    },
  }
}

/** 组装范围键：公司|地区|认知时点|粒度——任一变化都视为新会话。 */
export function scopeKeyOf(parts: { companyId: string; regionId: string; asOf?: string | null; granularity?: string | null }) {
  return [parts.companyId, parts.regionId, parts.asOf ?? 'current', parts.granularity ?? ''].join('|')
}
