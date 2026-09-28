// 练习空间开通/查询接口（#3403，后端实现见 ChenShi-Tech/dljy#3402）。
// GET 幂等查询；POST 幂等开通（只有来源公司可写者 ADMIN/本公司 BOSS 能开通，否则 403）。
// 路径与 data 结构来自共享契约 shared/company/practice-space.mjs（PRACTICE_SPACE_PATH
// 自带 /api 前缀，api.ts 的 isExplicitApiPath 会让它原样直达，不再叠加基址）。
import { apiGet, apiPost } from '@/services/api'
import { PRACTICE_SPACE_PATH, type PracticeSpaceResult } from 'shared/company/practice-space.mjs'

type DataResponse<T> = { data?: T }

export async function fetchPracticeSpace(companyId: string): Promise<PracticeSpaceResult> {
  const response = await apiGet<DataResponse<PracticeSpaceResult>>(PRACTICE_SPACE_PATH, { company: companyId })
  if (!response.data) throw new Error('练习空间响应缺少 data')
  return response.data
}

export type EnsurePracticeSpaceOptions = {
  module?: string
  regionId?: string
  seedStations?: boolean
}

export async function ensurePracticeSpace(
  companyId: string,
  options: EnsurePracticeSpaceOptions = {}
): Promise<PracticeSpaceResult> {
  const query = `?company=${encodeURIComponent(companyId)}`
  const response = await apiPost<DataResponse<PracticeSpaceResult>>(
    `${PRACTICE_SPACE_PATH}${query}`,
    {
      module: options.module,
      regionId: options.regionId,
      seedStations: options.seedStations
    }
  )
  if (!response.data) throw new Error('练习空间开通响应缺少 data')
  return response.data
}
