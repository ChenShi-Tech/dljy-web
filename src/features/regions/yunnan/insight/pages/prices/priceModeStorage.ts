// 价格页展示模式的本地记忆（dljy#3007 任务 6.8）
// ----------------------------------------------------------------------------
// 「时段走势」页签顶部的分段切换（单日走势 / 多日立体 / 日期×时段热力）按
// 用户 × 地区 × 价格对象 记在 localStorage；换对象、换地区、换人互不串扰。
// 纪律（与洞察客户端一致）：localStorage 只存界面偏好，不存任何洞察结果——
// 洞察结果含公司私有资料，落盘即越权面扩大。读写全程 try/catch：隐私模式、
// 禁用 storage、配额满都不能让页面崩，读不到就回默认「单日走势」。

/** 三种展示模式：单日走势（默认）/ 多日三维立体 / 日期×时段热力。 */
export type PriceDisplayMode = 'single' | 'multi3d' | 'heatmap'

export const PRICE_DISPLAY_MODES: PriceDisplayMode[] = ['single', 'multi3d', 'heatmap']

function storageKey(username: string, regionId: string, analysisId: string): string {
  return `ynp.prices.mode|${username}|${regionId}|${analysisId}`
}

/** 读 remembered 模式；无记录、值非法、storage 抛错 → 'single'（默认单日走势）。 */
export function readPriceMode(username: string, regionId: string, analysisId: string): PriceDisplayMode {
  try {
    const raw = localStorage.getItem(storageKey(username, regionId, analysisId))
    return PRICE_DISPLAY_MODES.includes(raw as PriceDisplayMode) ? (raw as PriceDisplayMode) : 'single'
  } catch {
    return 'single'
  }
}

/** 写 remembered 模式；storage 不可用（隐私模式/配额满/被禁用）静默放弃，不影响界面。 */
export function writePriceMode(username: string, regionId: string, analysisId: string, mode: PriceDisplayMode): void {
  try {
    localStorage.setItem(storageKey(username, regionId, analysisId), mode)
  } catch {
    // 界面偏好而已，写不进去就算了，不向上抛。
  }
}
