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

export class MidlongWriteTargetChangedError extends Error {
  constructor() {
    super('表单已关闭或已换成其他对象，已放弃本次保存（未写入任何数据）')
    this.name = 'MidlongWriteTargetChangedError'
  }
}

/** 范围或写入目标已变化而放弃的保存（尚未发出写请求）。 */
export const isWriteAbandoned = (error: unknown): error is MidlongScopeChangedError | MidlongWriteTargetChangedError =>
  error instanceof MidlongScopeChangedError || error instanceof MidlongWriteTargetChangedError

export type WriteTicket = {
  /** 范围、对话框代次、写入目标都未变；必须在每次 await 之后、发写请求之前同步调用 assertCurrent。 */
  assertCurrent: () => void
  /** 对话框没有被关闭或重新打开：只有同一次打开，保存结果、错误与关闭动作才落到这个对话框上。 */
  sameSession: () => boolean
}

/**
 * 对话框写入会话（dljy-web#128）：公司/地区范围守卫只能发现换公司，发现不了「同一公司内关掉对话框、又对另一条记录打开」。
 * - open()：对话框打开时调用，快照范围与写入目标（如「更正:公告 id:行版本」），代次自增。
 * - close()：对话框关闭或卸载时调用，代次自增，让进行中的保存失效（读取附件期间点取消也不会再写入）。
 * - begin()：点保存时同步调用拿到票据；await 之后先 assertCurrent() 再发写请求：
 *   范围变了抛 MidlongScopeChangedError；对话框已关闭/重开、或写入目标与打开时不同，抛 MidlongWriteTargetChangedError。
 * 写请求要用 begin() 时同步读取的目标与表单值，不要在 await 之后再读 props。
 */
export function createWriteSession(currentTarget: () => string) {
  let generation = 0
  let opened = false
  let openScope = captureScope()
  let openTarget = ''
  return {
    open() {
      generation += 1
      opened = true
      openScope = captureScope()
      openTarget = currentTarget()
    },
    close() {
      generation += 1
      opened = false
    },
    begin(): WriteTicket {
      const at = generation
      const scope = openScope
      const target = openTarget
      const sameSession = () => opened && at === generation
      return {
        sameSession,
        assertCurrent: () => {
          scope.assertCurrent()
          if (!sameSession() || currentTarget() !== target) throw new MidlongWriteTargetChangedError()
        },
      }
    },
  }
}
