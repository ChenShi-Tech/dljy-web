// ============================================================================
// 公司（租户）→ 交易中心注册的市场主体立场集合
// ----------------------------------------------------------------------------
// 为什么立场集合挂在**公司**上、而不是复用用户的 `allowedSubjectTypes`：
//
//   `allowedSubjectTypes` 是**数据可见范围**——`server/middleware/data-scope.mjs`
//   用它过滤数据行（`allowedSubjectTypes.has(rowSubjectType)`），
//   `verify:spot-declarations` 还有负例断言「有 allowedSubjectTypes 也不得换主体建单」。
//   它回答的是「我能看到哪些主体类型的数据」，不是「我能以哪个主体身份申报」。
//   把它当立场集合并扩大，等于顺手扩大数据可见范围——那是越权面，不是功能。
//
// 立场是**市场主体注册属性**：一家公司在交易中心注册了售电公司 + 独立储能两个主体，
// 才有两套申报单据可交。所以它属于公司维度，与用户的数据可见范围正交。
//
// 当前形态与迁移路径：
//   公司档案（`server/company-store.mjs` 的 `subject_type`）目前是**单值**，无法表达
//   手册所述「既买又卖」的主体。本表提供覆盖登记，让多立场形态在不动后端 schema 的
//   前提下可用；下一步迁到公司档案的 `subject_types` 列（前端读服务端下发，本表删除）。
//   在那之前，本表是**演示/联调用途**，不构成对真实公司主体注册情况的断言。
// ============================================================================

import type { SubjectType } from '@/services/governance'

/**
 * 显式登记的多立场公司。未登记的公司一律回落「用户会话主立场单值」——
 * 不猜测、不按行业推断，因为猜错会给交易员一套他无权提交的单据。
 */
const COMPANY_POSITION_OVERRIDES: Record<string, SubjectType[]> = {
  // 演示租户：覆盖售电 / 储能 / 发电三种申报形态，用于走通立场切换与单据装配。
  'dljy-demo': ['RETAILER', 'STORAGE', 'GENERATOR']
}

/**
 * 取公司注册的立场集合。
 * @param companyId 公司（租户）标识
 * @param fallback 未登记时的回落值（通常是会话主立场），空则返回空数组
 */
export function companyPositionsOf(
  companyId: string | null | undefined,
  fallback?: SubjectType | null
): SubjectType[] {
  const registered = companyId ? COMPANY_POSITION_OVERRIDES[companyId] : undefined
  if (registered?.length) return [...registered]
  return fallback ? [fallback] : []
}

/** 该公司是否显式登记了多立场（用于界面提示「本主体既买又卖」）。 */
export function isMultiPositionCompany(companyId: string | null | undefined): boolean {
  return Boolean(companyId && (COMPANY_POSITION_OVERRIDES[companyId]?.length ?? 0) > 1)
}
