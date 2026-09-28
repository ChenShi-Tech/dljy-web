// 练习公司判定的前端出口（#3403）。
//
// 叶子模块纪律：本文件不得 import companyContext——仓内 61 个 spec 对 companyContext
// 做局部 mock（只提供被测组件用到的成员），任何经它引用 companyContext 导出的新模块
// 都会让这些 spec 因缺导出而挂。判断只依赖 option.source 字段，口径来自共享契约。
// 地区归属只依赖静态地区表 regionCompany（纯数据模块），同样不经 companyContext。
import { shallowRef } from 'vue'
import { isPracticeCompany, PRACTICE_COMPANY_SOURCE } from 'shared/company/practice-space.mjs'
import { companyRegionId } from '@/services/region/regionCompany'

export { isPracticeCompany, PRACTICE_COMPANY_SOURCE }

// 公司选项（CompanyOption 及其 mock 形态）是否练习公司：source === 'PRACTICE'。
// 参数用结构形状而非 CompanyOption 类型，避免类型侧反向依赖 companyContext。
export function isPracticeCompanyOption(option: { source?: string | null } | null | undefined): boolean {
  return isPracticeCompany(option ?? null)
}

// ── 练习公司的地区归属（#3403 · codex R1-02）─────────────────────────────────────
// 练习公司 ID 不在静态地区表（regionCompany.COMPANY_REGION）里，按原口径会被当成「无地区」主体：
// 在所有地区的下拉里出现、手动切换与未选判定一律放行——用户可以在山西地区选中云南的练习公司。
// 口径：练习公司随上级公司的地区（上级无地区归属时同样视为无地区，与上级 GROUP 公司行为一致）。
// 「练习公司 → 上级」对照由 companyContext.setCompanyOptions 在授权列表到达时登记，并持久化——
// 页面在列表到达前就会用 localStorage 里恢复的公司发请求，没有持久化就认不出那段窗口里的练习公司。
const practiceParentsKey = 'dljy.practiceCompanyParents'

function readStoredParents(): Map<string, string | null> {
  try {
    const raw = window.localStorage.getItem(practiceParentsKey)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([id, parent]) => id && (typeof parent === 'string' || parent === null))
    return new Map(entries as Array<[string, string | null]>)
  } catch {
    // 损坏或存储不可用：视同尚未登记，等授权列表到达后重新登记。
    return new Map()
  }
}

const practiceParents = shallowRef<Map<string, string | null>>(readStoredParents())

type PracticeOptionShape = { companyId: string; source?: string | null; parentCompanyId?: string | null }

/** 以授权列表为准重建「练习公司 → 上级」对照（授权收回的练习公司随之移除）。 */
export function registerPracticeCompanies(options: readonly PracticeOptionShape[]): void {
  const next = new Map<string, string | null>()
  for (const option of options) {
    if (isPracticeCompanyOption(option)) next.set(option.companyId, option.parentCompanyId ?? null)
  }
  practiceParents.value = next
  try {
    window.localStorage.setItem(practiceParentsKey, JSON.stringify(Object.fromEntries(next)))
  } catch {
    // 写入失败只影响「列表到达前」那段窗口的判定，内存对照照常生效。
  }
}

/** 练习公司的上级（未登记为练习公司时返回 null）。 */
export function practiceParentOf(companyId: string | null | undefined): string | null {
  if (!companyId) return null
  return practiceParents.value.get(companyId) ?? null
}

/** 已登记的练习公司（授权列表或持久化记录里出现过）。 */
export function isKnownPracticeCompanyId(companyId: string | null | undefined): boolean {
  return !!companyId && practiceParents.value.has(companyId)
}

/**
 * 公司的有效地区：静态地区表优先；练习公司取上级公司的地区；都没有则为 null（无地区归属）。
 * 除「自动选择」规则外，凡是判断「公司属不属于当前地区」的地方都应走这里。
 */
export function effectiveCompanyRegionId(companyId: string | null | undefined): string | null {
  const direct = companyRegionId(companyId)
  if (direct !== null || !companyId) return direct
  const parents = practiceParents.value
  if (!parents.has(companyId)) return null
  return companyRegionId(parents.get(companyId) ?? null)
}
