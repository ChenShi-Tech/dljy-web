// 山西扩展包装配入口（dljy#2995 阶段 A）
// 与 yunnan/register.ts 同构：本省登记项统一在此汇总，内核不认识本文件。

import { registerShanxiInsightWorkspace } from './insight/workspace'

export function registerShanxiRegion(): void {
  registerShanxiInsightWorkspace()
}
