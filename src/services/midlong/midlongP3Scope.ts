// 中长期售电 P3 写请求的公司/地区范围快照（dljy#2973）。
//
// 写请求的 URL 在发出那一刻读取当前公司（company 参数），而表单里的主体、公告、方案、提交 ID 属于打开表单时的公司。
// 只要「打开表单 → 等待（读取附件、加载候选）→ 发写请求」之间切换了公司或地区，就可能用新公司的 URL 提交旧公司的数据。
// 规则：打开表单或开始提交时快照范围；每次 await 之后、发写请求之前核对范围未变，变了就放弃并提示，不发请求。
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'

export class MidlongScopeChangedError extends Error {
  constructor() {
    super('公司或地区已切换，已放弃本次提交（未写入任何数据），请在当前公司重新操作')
    this.name = 'MidlongScopeChangedError'
  }
}

export function currentScopeKey(): string {
  return `${selectedCompanyId.value}|${currentRegion.value.id}`
}

export type ScopeSnapshot = {
  key: string
  isCurrent: () => boolean
  /** 范围已变化时抛 MidlongScopeChangedError；必须在 await 之后、发写请求之前同步调用。 */
  assertCurrent: () => void
}

export function captureScope(): ScopeSnapshot {
  const key = currentScopeKey()
  const isCurrent = () => currentScopeKey() === key
  return {
    key,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) throw new MidlongScopeChangedError()
    },
  }
}
