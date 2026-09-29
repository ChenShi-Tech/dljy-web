// 公开披露事件的「发布方」口径（dljy#3517 / dljy#3563）。
//
// 南网披露事件有两路来源，都是南方电网公开披露的原文，只是到手途径不同：
//   csg-authorized-export  整年导出，覆盖 2026-07-02 及之前的业务日；
//   csg-disclosure-file    日文件接续，2026-07-03 起的业务日。
// 按「是不是南网披露」判断的前端逻辑（如检修摘要收拢）一律经本模块，不再写死单一来源名；
// 来源名只作溯源显示，卡片按事件自己的 providerId 取名，不借用同地区其它来源。
// 与后端 server/domains/grid-geo/disclosure-providers.mjs 的 CSG_DISCLOSURE_PROVIDERS 同口径——
// 那份登记在 dljy 服务端、未进 shared 契约面，前端只在此处保留一份。
import type { GridDisclosureProvider } from './types'

/** 南网发布方下的全部来源 ID。 */
export const CSG_DISCLOSURE_PROVIDER_IDS: readonly string[] = Object.freeze(['csg-authorized-export', 'csg-disclosure-file'])

export function isCsgDisclosureProvider(providerId: string | null | undefined): boolean {
  return typeof providerId === 'string' && CSG_DISCLOSURE_PROVIDER_IDS.includes(providerId)
}

/**
 * 事件的来源名：按事件自己的 providerId 在 /providers 登记里查名称。
 * 查不到（登记未加载、读取失败或来源未登记）时如实写「待确认」并带上来源 ID，不拿同地区第一个来源顶替。
 */
export function disclosureEventSourceName(providers: readonly GridDisclosureProvider[], providerId: string | null | undefined): string {
  const id = typeof providerId === 'string' ? providerId.trim() : ''
  if (!id) return '来源未提供'
  const name = providers.find((provider) => provider.providerId === id)?.name?.trim()
  return name || `来源名称待确认（${id}）`
}
