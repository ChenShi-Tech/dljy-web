// 已迁入口登记表的客户交付版空壳（ChenShi-Tech/dljy#3464）。
//
// 客户版构建时 vite.config.ts 的 dljy-customer-edition 插件把 `registry.ts` 重定向到本文件：
// 客户交付版入口一律照旧，所以这里恒答「未迁移」，并且**不含**任何入口标签、后台路径或后台地址——
// 那些只属于内部版，不能随交付产物出去（verify:customer-edition-build 扫产物兜底）。
//
// 导出签名逐个钉在真实模块的类型上：真实模块改了签名这里 vue-tsc 就红；新增导出忘了补，
// 客户版构建会因缺导出失败。只准放函数，不准放登记表常量。
import type * as Registry from './registry'

export const isEntryHidden: typeof Registry.isEntryHidden = () => false
export const isTabHidden: typeof Registry.isTabHidden = () => false
export const hiddenEntriesOf: typeof Registry.hiddenEntriesOf = () => []
export const platformAdminBaseUrl: typeof Registry.platformAdminBaseUrl = () => null
export const migratedEntryLinks: typeof Registry.migratedEntryLinks = () => []
export const migratedRouteComponent: typeof Registry.migratedRouteComponent = (_id, loader) => loader
