// 练习公司（练习空间）共享契约的类型侧伴随定义（#3402）。
// 运行时值来自 practice-space.mjs；PracticeSpaceResult 与 GET|POST /api/company/practice-space 的 data 一一对应。

export declare const PRACTICE_COMPANY_SOURCE: 'PRACTICE'
export declare const PRACTICE_NAME_PREFIX: '【练习】'
export declare const PRACTICE_SPACE_PATH: '/api/company/practice-space'

export interface PracticeStationSeed {
  readonly name: string
  readonly type: '风电' | '光伏'
  readonly capacity: number
}
export declare const PRACTICE_STATION_SEEDS: readonly PracticeStationSeed[]
export declare const PRACTICE_STATION_REGIONS: Readonly<Record<string, string>>

export declare function isPracticeCompany(company: { source?: string | null } | null | undefined): boolean
export declare function practiceCompanyIdFor(parentCompanyId: string): string
export declare function practiceCompanyName(parentName: string): string

export interface PracticeSpaceCompany {
  companyId: string
  name: string
  shortName: string | null
  tier: string
  parentCompanyId: string | null
  status: string
  source: string
}

export interface PracticeSpaceStation {
  id: number
  name: string
  type: string
  capacity: number | null
  regionId: string | null
  province: string | null
  status: string | null
}

export interface PracticeSpaceResult {
  /** 本次请求是否新建了练习公司（GET 恒为 false）。 */
  created: boolean
  /** 练习公司是否已存在且可用。 */
  exists: boolean
  /** 当前登录者能否在来源公司下开通练习空间（管理员或本公司 BOSS，且不在集团汇总视图）。 */
  canCreate: boolean
  parentCompanyId: string
  practiceCompanyId: string
  /** 练习公司档案；不存在或当前登录者无权访问时为 null。 */
  company: PracticeSpaceCompany | null
  /** 练习公司的场站；无权访问时为空数组。 */
  stations: PracticeSpaceStation[]
}
