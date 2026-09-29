// 套保「维护」页签内部共享状态（ChenShi-Tech/dljy#3423，HW-10）。
//
// 维护页签 provide、四个维护区块 inject：
// - 可写判定 = 工作台 canWrite（首个 403 即转只读，工作台存续期间不恢复）且接口没有声明不可写（按公司，切公司即复位）；
// - failureOf：把失败转成提示，403 顺带转只读并记下后端给的原因；
// - useMaintenanceWrite：写请求的统一收口——进行中禁止重复提交；成功先通知依赖计算的页签重取（notifyDataChanged），
//   再交给调用方收尾（关表单、刷新），收尾不受「保存中」守卫阻挡；await 之后先判定作用域，过期响应一律丢弃。

import { computed, inject, provide, readonly, ref, watch } from 'vue'
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { HedgeWorkbench } from '../../useHedgeWorkbench'
import type { MaintenanceWriteAccess } from '@/services/hedge/hedgeMaintenanceApi'
import { maintenanceFailureOf } from '@/services/hedge/hedgeMaintenanceModel'
import type { MaintenanceFailure } from '@/services/hedge/hedgeMaintenanceModel'

export interface MaintenanceContext {
  workbench: HedgeWorkbench
  /** 整页是否可写：不可写时全部写操作禁用。 */
  writable: ComputedRef<boolean>
  /** 只读原因（后端 403 信息或接口声明）；可写时为 null。 */
  readOnlyReason: ComputedRef<string | null>
  /** 接口声明的写权限；null = 未知（以写入时的 403 为准）。 */
  declareWriteAccess(access: MaintenanceWriteAccess | null): void
  failureOf(err: unknown): MaintenanceFailure
  /**
   * 维护区块读写请求的有效期：只随公司/地区切换作废。认知时点与粒度只影响套保计算的查询视角，维护数据的读写都不依赖它们；
   * 若沿用工作台完整作用域，保存期间改粒度或在认知时点框输入就会丢掉已成功写入的收尾（#221 审查 R1-01）。
   */
  contextRequest(): () => boolean
}

const MAINTENANCE_KEY: InjectionKey<MaintenanceContext> = Symbol('hedge-maintenance')

export function provideMaintenanceContext(workbench: HedgeWorkbench): MaintenanceContext {
  const declared = ref<MaintenanceWriteAccess | null>(null)
  const forbiddenReason = ref<string | null>(null)
  const writable = computed(() => workbench.canWrite.value && declared.value?.writable !== false)
  // 公司/地区代次：同步 flush，保证先于各区块的清空与重取完成更新（与工作台会话代次同一时序）。
  let generation = 0
  watch(workbench.contextKey, () => { generation += 1 }, { flush: 'sync' })
  const readOnlyReason = computed(() => {
    if (writable.value) return null
    return forbiddenReason.value ?? declared.value?.reason ?? '当前角色无公司写权限'
  })
  const context: MaintenanceContext = {
    workbench,
    writable,
    readOnlyReason,
    declareWriteAccess(access) { declared.value = access },
    failureOf(err) {
      const failure = maintenanceFailureOf(err)
      if (failure.status === 403) {
        forbiddenReason.value = failure.message
        workbench.markReadOnly()
      }
      return failure
    },
    contextRequest() {
      const mine = generation
      const key = workbench.contextKey.value
      return () => mine === generation && workbench.contextKey.value === key
    },
  }
  provide(MAINTENANCE_KEY, context)
  return context
}

export function injectMaintenanceContext(): MaintenanceContext {
  const context = inject(MAINTENANCE_KEY, null)
  if (!context) throw new Error('维护区块必须挂在 HedgeMaintenanceTab 之下')
  return context
}

export interface MaintenanceWriteHandlers<T> {
  onSuccess(result: T): void
  onFailure(failure: MaintenanceFailure): void
}

export interface MaintenanceWriter {
  /** 进行中的写动作标识；null = 空闲。 */
  busy: Readonly<Ref<string | null>>
  /** 发起一次写请求；空闲且可写才发，返回是否成功。 */
  run<T>(action: string, send: () => Promise<T>, handlers: MaintenanceWriteHandlers<T>): Promise<boolean>
  /** 切公司/地区时调用：放弃在途写请求的收尾并解除占用。 */
  reset(): void
}

export function useMaintenanceWrite(context: MaintenanceContext): MaintenanceWriter {
  const busy = ref<string | null>(null)
  let sequence = 0
  async function run<T>(action: string, send: () => Promise<T>, handlers: MaintenanceWriteHandlers<T>) {
    if (busy.value !== null || !context.writable.value) return false
    const mine = ++sequence
    busy.value = action
    const current = context.contextRequest()
    try {
      const result = await send()
      if (!current()) return false
      context.workbench.notifyDataChanged()
      handlers.onSuccess(result)
      return true
    } catch (err) {
      if (!current()) return false
      handlers.onFailure(context.failureOf(err))
      return false
    } finally {
      // 只释放自己占用的「保存中」：切公司后新发起的写请求不能被旧请求的收尾提前解锁。
      if (mine === sequence) busy.value = null
    }
  }
  return {
    busy: readonly(busy),
    run,
    reset() {
      sequence += 1
      busy.value = null
    },
  }
}
