/**
 * Mock payload 判定 helper（前端镜像 #542 阶段 1）。
 *
 * 收敛原本散落多处的"这个 payload 是不是 mock"推导：
 *   - src/services/market/plantOutputClient.ts: `env.mock === true || sourceType === 'MOCK'`
 *   - src/components/CsgDataSourceBanner.vue: `s.mock || s.sourceType === 'MOCK'`
 *   - src/services/market/spotPriceCore.ts: `envelope.mock === true`
 *
 * 与服务端 server/shared/mock-tag.mjs::isMockPayload 保持同语义（mock===true OR
 * sourceType/_sourceType==='MOCK'），两端共用判定口径，避免前后端判定漂移。
 *
 * 阶段 1 仅新增 helper + 迁移 CsgDataSourceBanner（最简单的 1 处），其余调用点阶段 2 渐进迁移。
 */

/**
 * 判断一个 payload 是否为 Mock。
 *
 * 判定规则（与服务端 isMockPayload 同语义）：
 *   - payload.mock === true（严格布尔，防 truthy 误判），OR
 *   - payload.sourceType === 'MOCK'（终端字段），OR
 *   - payload._sourceType === 'MOCK'（provenance 内部标记，attachTrace 装配前）
 *
 * @param payload 任意响应/数据对象
 * @returns 是否为 Mock 数据
 */
export function isMockPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  if (p.mock === true) return true
  return p.sourceType === 'MOCK' || p._sourceType === 'MOCK'
}
