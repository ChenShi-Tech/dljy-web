import { ref, watch } from 'vue'
import { selectedRegionId } from '@/services/region/regionContext'
import { selectedCompanyId } from '@/services/company/companyContext'

// 市场洞察请求代次（dljy#2995 阶段 A，OpenSpec D3：统一上下文与独立数据状态）
// ----------------------------------------------------------------------------
// 页面状态为「上下文 → 结果」的纯函数：上下文 = 地区 × 公司 × 业务日期窗 × 对象 × 来源，
// 任一维度变化都必须让在途与迟到响应作废，绝不把 A 上下文的响应写进 B 上下文的状态。
// 特别是 A→B→A：第三次切换回来时，第一次 A 的迟到响应不能凭 regionId 相同就复活
// （中途的 B 可能已把共享缓存/视图改写过），必须按「请求发起时的代次」比较丢弃。
//
// 用法：页面 setup 时创建一个实例；每次上下文变化调 updateContext（含日期窗等）；
// 数据请求一律经 run 发起（自动带 AbortController），返回 null 表示该次请求已作废。
// 地区与公司切换自动失效（watch 内建）；日期窗/对象/来源由页面显式 updateContext。

/** 一次洞察请求的上下文快照：任一字段（objects 逐元素）变化即视为上下文变化 */
export type InsightRequestContext = {
  regionId?: string
  companyId?: string
  /** 业务日期窗（起止标识符由页面自定，如 '2026-09' 或 '2026-09-01~2026-09-30'） */
  businessWindow?: { start?: string; end?: string }
  /** 分析对象集合（厂站/节点/机组 id 等） */
  objects?: readonly string[]
  /** 数据来源标识 */
  source?: string
}

export function useInsightRequestGeneration() {
  // 单调递增的代次：每次上下文变化 +1。请求完成时与当前代次比较，不一致即丢弃。
  const contextVersion = ref(0)
  let tracked: InsightRequestContext = {}
  const activeControllers = new Set<AbortController>()

  function contextChanged(next: InsightRequestContext): boolean {
    if (next.regionId !== tracked.regionId) return true
    if (next.companyId !== tracked.companyId) return true
    if (next.source !== tracked.source) return true
    const windowA = tracked.businessWindow
    const windowB = next.businessWindow
    if (windowA?.start !== windowB?.start || windowA?.end !== windowB?.end) return true
    const objectsA = tracked.objects ?? []
    const objectsB = next.objects ?? []
    if (objectsA.length !== objectsB.length) return true
    if (objectsA.some((item, index) => item !== objectsB[index])) return true
    return false
  }

  /** 使在途与已完成的旧结果作废：代次 +1 并中止所有在途请求 */
  function invalidate() {
    contextVersion.value += 1
    for (const controller of activeControllers) controller.abort()
    activeControllers.clear()
  }

  /**
   * 更新上下文快照；有变化时自动失效（代次 +1、中止在途请求）。
   * 全量替换语义：未传的字段视为清空（与上次值比较）。
   */
  function updateContext(next: InsightRequestContext) {
    if (!contextChanged(next)) return
    tracked = next
    invalidate()
  }

  /**
   * 发起一次请求：自动附 AbortController；返回 null 表示该次请求已作废
   * （被取消 / 代次已过期），调用方应直接丢弃结果，不写入页面状态。
   * 请求自身的失败（网络/后端）照常抛出，不吞错误。
   */
  async function run<T>(fetcher: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    const generation = contextVersion.value
    const controller = new AbortController()
    activeControllers.add(controller)
    try {
      const value = await fetcher(controller.signal)
      // 迟到判定按代次而非地区 id：A→B→A 时第一次 A 的响应因代次落后被丢弃
      return generation === contextVersion.value ? value : null
    } catch (error) {
      // 被取消或代次过期：作废请求的失败不是页面的失败，静默返回 null
      if (controller.signal.aborted || generation !== contextVersion.value) return null
      throw error
    } finally {
      activeControllers.delete(controller)
    }
  }

  // 地区与公司切换自动失效（日期窗/对象/来源由页面显式 updateContext 声明）
  watch([selectedRegionId, selectedCompanyId], () => {
    invalidate()
  })

  return {
    /** 当前代次（只读，供页面调试/断言） */
    contextVersion,
    updateContext,
    invalidate,
    run,
    /** 当前地区 id（便捷读取，与 regionContext 一致） */
    currentRegionId: selectedRegionId
  }
}
