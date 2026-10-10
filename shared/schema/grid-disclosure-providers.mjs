// 公开披露事件的来源（provider）与「发布方」口径：前后端单一事实源（#3571，承接 #3517）。
//
// 南网披露事件有两路来源，都是南方电网公开披露的原文，只是到手途径不同：
//   csg-authorized-export  南网整年导出，覆盖 2026-07-02 及之前的业务日；
//   csg-disclosure-file    南网披露日文件接续，覆盖 2026-07-03 起的业务日。
// 两路是同一发布方（南网）的同一批披露：时间口径、对象/电厂分组、身份归并、检修摘要收拢等
// 一律按「发布方」判定，不写死单一来源名；来源名只作溯源字段（事件的 providerId、来源列表、按来源筛选）。
//
// 消费方：服务端来源登记与 SQL 判定片段（grid-geo 披露读取侧）、日文件事件编译（ETL）、dljy-web（经 sync:web）。
// 整年导出的 Python 编译器保留自身常量，取值以本模块为准。南网再加一路来源只改这里。
// 纯数据 + 纯函数、零 import。

/** 南网发布方标识（/providers 登记的 publisher 字段）。 */
export const CSG_DISCLOSURE_PUBLISHER = 'csg'

export const CSG_AUTHORIZED_EXPORT_PROVIDER = 'csg-authorized-export'
export const CSG_DISCLOSURE_FILE_PROVIDER = 'csg-disclosure-file'

/** 南网发布方下的全部来源 ID（顺序即来源列表顺序）。 */
export const CSG_DISCLOSURE_PROVIDER_IDS = Object.freeze([CSG_AUTHORIZED_EXPORT_PROVIDER, CSG_DISCLOSURE_FILE_PROVIDER])

/**
 * 发布方键：进分组键、对象标注键、身份键的哈希输入。
 * 南网取历史来源名 `csg-authorized-export` 作键值——既有分组键与已保存的对象标注不因新增来源而改变，
 * 新来源的同一对象自动归到同一键下。
 */
export const CSG_PUBLISHER_KEY = CSG_AUTHORIZED_EXPORT_PROVIDER

/** 来源显示名（/providers 登记的 name 字段；页头与事件卡片的来源名都取它）。 */
export const CSG_DISCLOSURE_PROVIDER_NAMES = Object.freeze({
  [CSG_AUTHORIZED_EXPORT_PROVIDER]: '南方电网公开披露',
  [CSG_DISCLOSURE_FILE_PROVIDER]: '南方电网公开披露（日文件接续）',
})

const CSG_SET = new Set(CSG_DISCLOSURE_PROVIDER_IDS)

/** 某来源是否属于南网发布方（严格按来源 ID 全等，不做大小写或空白归一）。 */
export function isCsgDisclosureProvider(providerId) {
  return CSG_SET.has(String(providerId ?? ''))
}

/** 来源 → 发布方键（非南网来源各自成一方）。 */
export function disclosurePublisherKey(providerId) {
  return isCsgDisclosureProvider(providerId) ? CSG_PUBLISHER_KEY : String(providerId ?? '')
}

/** 与某来源同一发布方的全部来源（按对象筛事件时用，跨 2026-07-02/07-03 边界连续）；每次返回新数组。 */
export function publisherProviderIds(providerId) {
  return isCsgDisclosureProvider(providerId) ? [...CSG_DISCLOSURE_PROVIDER_IDS] : [String(providerId ?? '')]
}

/**
 * 事件的来源名：按事件自己的 providerId 在来源登记（/providers 返回的列表）里查名称。
 * 没有来源 ID 时写「来源未提供」；查不到（登记未加载、读取失败或来源未登记）时如实写「待确认」并带上来源 ID，
 * 不拿同地区其它来源顶替。
 */
export function disclosureEventSourceName(providers, providerId) {
  const id = typeof providerId === 'string' ? providerId.trim() : ''
  if (!id) return '来源未提供'
  const name = Array.isArray(providers) ? providers.find((provider) => provider?.providerId === id)?.name : undefined
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed || `来源名称待确认（${id}）`
}
