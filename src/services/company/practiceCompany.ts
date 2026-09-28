// 练习公司判定的前端出口（#3403）。
//
// 叶子模块纪律：本文件不得 import companyContext——仓内 61 个 spec 对 companyContext
// 做局部 mock（只提供被测组件用到的成员），任何经它引用 companyContext 导出的新模块
// 都会让这些 spec 因缺导出而挂。判断只依赖 option.source 字段，口径来自共享契约。
import { isPracticeCompany, PRACTICE_COMPANY_SOURCE } from 'shared/company/practice-space.mjs'

export { isPracticeCompany, PRACTICE_COMPANY_SOURCE }

// 公司选项（CompanyOption 及其 mock 形态）是否练习公司：source === 'PRACTICE'。
// 参数用结构形状而非 CompanyOption 类型，避免类型侧反向依赖 companyContext。
export function isPracticeCompanyOption(option: { source?: string | null } | null | undefined): boolean {
  return isPracticeCompany(option ?? null)
}
