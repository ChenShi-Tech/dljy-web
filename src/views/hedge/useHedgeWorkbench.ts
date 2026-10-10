// 套保工作台共享状态（openspec build-midlong-spot-hedging HW-05/06/07/10；ChenShi-Tech/dljy#3420 外壳 + 页签拆分）。
//
// 外壳 HedgeWorkbenchView 调 useHedgeWorkbench() 创建并 provide；tabs/ 下的页签调 injectHedgeWorkbench() 取用，
// 再用 useHedgeTabLifecycle() 挂上统一生命周期：激活即加载、切公司/地区即清空并（激活中则）重取。
// 旧响应丢弃（HW-06）沿用 createQuerySession：发请求前 scopedRequest() 拿判定函数，await 之后先判定再写状态——
// 作用域（公司|地区|认知时点|粒度）或会话代次（切公司/地区即 renew）任一变化，晚到的响应一律丢弃。

import { computed, inject, onActivated, onDeactivated, onMounted, provide, readonly, ref, watch } from 'vue'
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'
import { createQuerySession, scopeKeyOf } from '@/services/hedge/hedgeSession'

/** 套保只开放云南（D15/HW-07）：其他地区外壳不挂任何页签、不发任何请求。 */
export const HEDGE_REGION_OPEN = 'yunnan'

export type HedgeTabKey = 'today2' | 'month' | 'settlement' | 'simulate' | 'maintenance'
export type HedgeGranularity = 'HOUR' | 'DAY'

export interface HedgeWorkbench {
  /** 地区门禁：当前地区是否开放套保。 */
  regionOpen: ComputedRef<boolean>
  /** 当前页签（外壳导航用；页签内可写它做跨页签跳转）。 */
  activeTab: Ref<HedgeTabKey>
  /** 逐时段粒度（计入作用域键）。 */
  granularity: Ref<HedgeGranularity>
  /** 认知时点输入框原文（v-model 目标；留空 = 当前视图）。 */
  asOfInput: Ref<string>
  /** 生效的认知时点：输入为空时为 null（传给接口时转 undefined）。 */
  asOf: ComputedRef<string | null>
  /** 历史视角横幅是否显示（HW-05）：由加载成功的页签调 syncAsOfBanner() 同步，反映「已显示数据」用的时点。 */
  showAsOfBanner: Readonly<Ref<boolean>>
  syncAsOfBanner(): void
  /** 回到当前视图（清空认知时点）。 */
  clearAsOf(): void
  /** 完整作用域键：公司|地区|认知时点|粒度（scopeKeyOf）。依赖计算结果的页签监听它清空并重取。 */
  scopeKey: ComputedRef<string>
  /** 上下文键：公司|地区。它变化时全部页签清空结果（HW-06/#3401），由 useHedgeTabLifecycle 统一处理。 */
  contextKey: ComputedRef<string>
  /**
   * 发起一次受作用域保护的请求：返回的判定函数在作用域键或会话代次变化后恒为 false。
   * 用法：`const current = workbench.scopedRequest()`；每个 await 之后 `if (!current()) return` 再写状态
   * （含加载态——过期请求不得改动当前作用域的加载态）。
   */
  scopedRequest(): () => boolean
  /** 是否可写（维护写口）：首个 403 即转只读，本工作台存续期间不再恢复。 */
  canWrite: Readonly<Ref<boolean>>
  markReadOnly(): void
  /** 维护写入成功的计数：依赖计算结果的页签（今明两日）监听它重取，「写入后下一次读取即反映到套保计算」。 */
  dataRevision: Readonly<Ref<number>>
  notifyDataChanged(): void
}

export const HEDGE_WORKBENCH_KEY: InjectionKey<HedgeWorkbench> = Symbol('hedge-workbench')

/** 今明两日窗口：东八区的今天与明天（YYYY-MM-DD）。 */
export function today2Range(): { fromDate: string; toDate: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const now = new Date(Date.now() + 8 * 3_600_000)
  const from = fmt(now)
  const to = fmt(new Date(now.getTime() + 86_400_000))
  return { fromDate: from, toDate: to }
}

/** 创建一份工作台共享状态。须在组件 setup（或 effectScope）内调用，监听随之释放。 */
export function createHedgeWorkbench(): HedgeWorkbench {
  const session = createQuerySession()
  const regionOpen = computed(() => currentRegion.value.id === HEDGE_REGION_OPEN)
  const activeTab = ref<HedgeTabKey>('today2')
  const granularity = ref<HedgeGranularity>('HOUR')
  const asOfInput = ref('')
  const asOf = computed(() => asOfInput.value || null)
  const showAsOfBanner = ref(false)
  const canWrite = ref(true)
  const dataRevision = ref(0)

  const contextKey = computed(() => `${selectedCompanyId.value}|${currentRegion.value.id}`)
  const scopeKey = computed(() => scopeKeyOf({
    companyId: selectedCompanyId.value, regionId: currentRegion.value.id, asOf: asOf.value, granularity: granularity.value,
  }))

  // HW-06：切公司或地区立即作废全部在途请求。flush: 'sync' 保证代次先于任何页签的清空/重取（页签监听是 pre flush）
  // 完成更新，新发的请求拿到的一定是新代次。
  watch([selectedCompanyId, () => currentRegion.value.id], () => session.renew(), { flush: 'sync' })

  function scopedRequest() {
    const token = session.begin(scopeKey.value)
    return () => session.isCurrent(token, scopeKey.value)
  }

  return {
    regionOpen,
    activeTab,
    granularity,
    asOfInput,
    asOf,
    showAsOfBanner: readonly(showAsOfBanner),
    syncAsOfBanner() { showAsOfBanner.value = Boolean(asOfInput.value) },
    clearAsOf() { asOfInput.value = '' },
    scopeKey,
    contextKey,
    scopedRequest,
    canWrite: readonly(canWrite),
    markReadOnly() { canWrite.value = false },
    dataRevision: readonly(dataRevision),
    notifyDataChanged() { dataRevision.value += 1 },
  }
}

/** 外壳用：创建共享状态并 provide 给页签。 */
export function useHedgeWorkbench(): HedgeWorkbench {
  const workbench = createHedgeWorkbench()
  provide(HEDGE_WORKBENCH_KEY, workbench)
  return workbench
}

/** 页签用：取外壳 provide 的共享状态；不在外壳下挂载直接报错，避免静默拿到一份孤立状态。 */
export function injectHedgeWorkbench(): HedgeWorkbench {
  const workbench = inject(HEDGE_WORKBENCH_KEY, null)
  if (!workbench) throw new Error('套保页签必须挂在 HedgeWorkbenchView 外壳（useHedgeWorkbench）之下')
  return workbench
}

export interface HedgeTabLifecycleOptions {
  /** 激活时加载：首次挂载、从别的页签切回（KeepAlive 重新激活）都会调用；地区未开放时不调用。 */
  load?: () => unknown
  /** 公司/地区切换时清空本页签全部结果（HW-06/#3401：不得残留上一家公司的数据）。清空后若本页签处于激活态再调 load。 */
  reset: () => void
  /**
   * 重新激活时是否重取（默认 true）。有未保存草稿的页签（维护）传 false：只在首次激活、以及公司/地区切换后的
   * 第一次激活时加载，切走再切回不重取，避免接口响应覆盖用户尚未保存的输入（#218 审查 R1-01）。
   */
  reloadOnActivate?: boolean
}

/**
 * 页签统一生命周期。外壳用 KeepAlive 保活页签，失活页签的监听仍在运行：公司/地区切换时失活页签只清空，
 * 等下次激活再加载；激活中的页签清空后立即重取。
 */
export function useHedgeTabLifecycle(workbench: HedgeWorkbench, options: HedgeTabLifecycleOptions) {
  const active = ref(false)
  // 当前公司/地区下是否已经加载过：reloadOnActivate=false 时据此跳过重新激活的重取；切公司/地区即复位。
  let loadedForContext = false
  function loadIfOpen() {
    loadedForContext = true
    if (options.load && workbench.regionOpen.value) void options.load()
  }
  // KeepAlive 下首次挂载 mounted 与 activated 都会触发，不在 KeepAlive 下只有 mounted：用 active 去重。
  function activate() {
    if (active.value) return
    active.value = true
    if (options.reloadOnActivate === false && loadedForContext) return
    loadIfOpen()
  }
  onMounted(activate)
  onActivated(activate)
  onDeactivated(() => { active.value = false })
  watch(workbench.contextKey, () => {
    options.reset()
    loadedForContext = false
    if (active.value) loadIfOpen()
  })
  return { active: readonly(active) }
}
