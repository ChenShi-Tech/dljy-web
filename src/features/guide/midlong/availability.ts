// 「操作导引」入口的可用性判定（dljy#3404）。原因按固定顺序取第一条命中的，
// 与任务规格一致：地区 → 角色（能否进练习空间）→ 已选公司 → 模块总开关 →
// 合同/持仓子模块 → 写权限。不可用时按钮禁用但保持可见，tooltip 说明原因。
import { canSwitchCompany, selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { getCurrentUser } from '@/services/auth'
import type { MidlongCapabilities } from '@/services/midlong/midlongTypes'

export type GuideAvailability = { available: boolean; reason: string }

export function midlongGuideAvailability(capabilities: MidlongCapabilities | null): GuideAvailability {
  if (currentRegion.value?.id !== 'yunnan') {
    return { available: false, reason: '导引目前只支持云南地区，请先切换到云南' }
  }
  if (!canSwitchCompany(getCurrentUser())) {
    return { available: false, reason: '练习空间只对管理员/老板开放，当前角色不能切换公司' }
  }
  if (!selectedCompanyId.value) {
    return { available: false, reason: '当前地区尚未选择有效公司' }
  }
  if (!capabilities) {
    return { available: false, reason: '中长期能力尚未加载完成，请稍候' }
  }
  if (!capabilities.enabled) {
    return { available: false, reason: '中长期售电模块已暂停使用' }
  }
  if (!capabilities.modules.contracts || !capabilities.modules.positions) {
    return { available: false, reason: '合同或月度持仓模块未开通' }
  }
  if (!capabilities.canWrite) {
    return { available: false, reason: '当前账号对所选公司没有中长期写权限' }
  }
  return { available: true, reason: '' }
}
