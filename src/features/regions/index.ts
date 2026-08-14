// ============================================================================
// 地区扩展包聚合装配入口（Epic #1431 S3 第二段）
// ----------------------------------------------------------------------------
// 应用启动时调用一次，完成所有地区扩展包的插槽注册。**这是内核唯一允许 import 的
// regions 路径**（不含具体省名）——`verify:region-isolation` 守卫禁止内核直引
// `features/regions/<省>`，但允许本聚合入口，从而保持「内核不知道有哪些省」。
//
// 新增一省 = 本文件加一行 + 该省包自带 register.ts；内核零改动。
// ============================================================================

import { registerYunnanRegion } from './yunnan/register'

let installed = false

/** 幂等：重复调用（HMR/测试）不会触发插槽重复注册错误。 */
export function installRegionPackages(): void {
  if (installed) return
  installed = true
  registerYunnanRegion()
}
