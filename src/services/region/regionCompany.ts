// 权威「地区 → 默认公司」注册表（Issue #569 / #656 决策）。
//
// 语义：`REGION_HOME_COMPANY[region]` 仅是「切到该地区时默认定位的公司」，非唯一公司
// 同一地区架构上可有多家授权主体（#668）。切地区时是否真正落到默认公司，由
// companyContext 的四规则联动判定（可能因授权集合/记忆/空态而选择其它公司或不自动选择）。
// 与 server/auth-store.mjs 公司/用户种子、server/company-seed.mjs 厂站 province、
// docs/data/region-company-structure.md 权威结构文档保持一致，改任一处须同步本表。
//
// 云南订正后仅中广核云南一家主体（原冗余 comp-yunnan 已合并，见 #569）。

export const REGION_HOME_COMPANY: Record<string, string> = {
  shanxi: 'comp-shanxi', // 山西发电
  yunnan: 'comp-cgn-yunnan', // 中广核云南新能源（云南唯一主体）
  sichuan: 'comp-sichuan-a' // 四川能源A（示例租户，名实订正后为四川）
}

// 返回某地区的默认公司 id；无登记（如无专属公司的地区）返回 null。
export function regionHomeCompanyId(regionId: string): string | null {
  return REGION_HOME_COMPANY[regionId] ?? null
}

// 公司 → 所属地区 的完整映射（Issue #668）。
//
// 用途：切地区联动公司时，判断「当前公司是否属于目标地区」（#668 规则 1），不能只靠
// regionHomeCompanyId（它只覆盖各地区的默认公司）。本表覆盖所有种子/可切换公司，
// 含非默认主体（如山西的 comp-sande-puhua，#575）。
// GROUP 母公司（dljy-demo 演示集团）无单一地区归属，故意不登记 → companyRegionId 返回 null，
// 规则 1 据此判定「非地区专属公司」，切地区时不予保留。
// 与 REGION_HOME_COMPANY 同源，与 server/auth-store.mjs seedCompanies、
// docs/data/region-company-structure.md 保持一致，改任一处须同步两表。
export const COMPANY_REGION: Record<string, string> = {
  'comp-shanxi': 'shanxi',
  'comp-sande-puhua': 'shanxi', // 三德普华（山西）私有数据宿主（#575），非山西默认公司但属山西地区
  'comp-cgn-yunnan': 'yunnan',
  'comp-sichuan-a': 'sichuan'
}

// 返回某公司所属地区 id；未登记（GROUP 母公司 / 未知公司）返回 null。
export function companyRegionId(companyId: string | null | undefined): string | null {
  if (!companyId) return null
  return COMPANY_REGION[companyId] ?? null
}
