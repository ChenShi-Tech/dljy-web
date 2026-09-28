// 练习空间的进入/退出编排（#3403）。
//
// 练习公司 = 挂在来源公司名下、source='PRACTICE' 的子公司（后端 #3402 幂等开通）。
// 进入 = 开通（或复用已有）→ 刷新授权公司列表 → 钉住公司上下文 → 切到练习公司；
// 钉住后 companyContext 的地区协调与授权集刷新都不再把用户切走，导引（#3404）写的
// 测试数据因此稳定落在练习公司里。
import { computed } from 'vue'
import { getCurrentUser } from '@/services/auth'
import { ApiError } from '@/services/api'
import { selectedRegionId } from '@/services/region/regionContext'
import { refreshCompanyOptions } from '@/services/company/companyApi'
import {
  companyOptions,
  companyPin,
  pinCompanySelection,
  selectedCompanyId,
  setCurrentCompanyId,
  setCompanyOptions,
  unpinCompanySelection
} from '@/services/company/companyContext'
import { isPracticeCompanyOption } from '@/services/company/practiceCompany'
import { ensurePracticeSpace } from '@/services/company/practiceSpaceApi'
import type { PracticeSpaceResult } from 'shared/company/practice-space.mjs'

export type EnterPracticeSpaceOptions = {
  module?: string
  regionId?: string
  seedStations?: boolean
}

export type EnterPracticeSpaceResult = {
  practiceCompanyId: string
  originCompanyId: string
  result: PracticeSpaceResult
}

function currentOptionSource() {
  return companyOptions.value.find((company) => company.companyId === selectedCompanyId.value)
}

// 当前公司是否练习公司（须已在授权列表中——刷新后列表未到时不误判）。
function inPracticeCompany(): boolean {
  const option = currentOptionSource()
  return !!option && isPracticeCompanyOption(option)
}

// 进入练习空间：以「来源公司」开通练习公司并钉住公司上下文、切换到练习公司。
// 来源公司 = 当前公司；当前已在练习公司里 → 用它的上级（重进不换练习公司）。
// 开通 403 且当前公司不是本人归属公司（平台管理员在云南会被自动定位到不可写的
// 中广核）→ 改用本人归属公司再试一次，仍失败则如实抛出。
export async function enterPracticeSpace(
  options: EnterPracticeSpaceOptions = {}
): Promise<EnterPracticeSpaceResult> {
  const { module = 'midlong', regionId = 'yunnan', seedStations } = options
  const payload: EnterPracticeSpaceOptions =
    seedStations === undefined ? { module, regionId } : { module, regionId, seedStations }
  const user = getCurrentUser()
  const homeCompanyId = user?.companyId ?? ''
  const current = currentOptionSource()
  let originCompanyId: string
  if (current && isPracticeCompanyOption(current)) {
    originCompanyId = current.parentCompanyId ?? companyPin.value?.originCompanyId ?? homeCompanyId
  } else {
    originCompanyId = selectedCompanyId.value
  }

  let result: PracticeSpaceResult
  try {
    result = await ensurePracticeSpace(originCompanyId, payload)
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && originCompanyId !== homeCompanyId && homeCompanyId) {
      originCompanyId = homeCompanyId
      result = await ensurePracticeSpace(originCompanyId, payload)
    } else {
      throw error
    }
  }

  const practiceCompanyId = result.practiceCompanyId
  // 先刷新授权列表（练习公司必须出现在 options 里，后续 setCurrentCompanyId 才能放行），
  // 再钉住、再切换；此顺序下刷新触发的四规则协调先发生，钉住随后接管，稳定停在练习公司。
  await refreshCompanyOptions()
  pinCompanySelection({ companyId: practiceCompanyId, regionId: selectedRegionId.value, originCompanyId })
  if (!setCurrentCompanyId(practiceCompanyId)) {
    unpinCompanySelection()
    throw new Error('进入练习空间失败：练习公司不在当前授权范围内，无法切换')
  }
  return { practiceCompanyId, originCompanyId, result }
}

// 退出练习空间：切回钉住记录里的来源公司并解除钉住；来源公司已不在授权集合
// （授权被收回等）时不再硬切，交回正常的四规则地区协调兜底。
export function exitPracticeSpace(): void {
  const originCompanyId = companyPin.value?.originCompanyId ?? null
  unpinCompanySelection()
  if (!inPracticeCompany()) return
  if (originCompanyId && setCurrentCompanyId(originCompanyId)) return
  setCompanyOptions(companyOptions.value)
}

// 当前练习公司（非练习公司或授权列表未加载时为 null）：顶栏徽标与页面标识的判据。
export const currentPracticeCompany = computed<{ companyId: string; name: string; parentCompanyId: string | null } | null>(() => {
  const option = currentOptionSource()
  if (!option || !isPracticeCompanyOption(option)) return null
  return { companyId: option.companyId, name: option.name, parentCompanyId: option.parentCompanyId ?? null }
})
