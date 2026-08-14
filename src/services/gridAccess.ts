// 电网接入点统一客户端（Epic #1893 / Issue #1925）。对接 server/grid-access-api.mjs：
// 接入点清单、凭据状态查询/录入/清除/连通测试，全部仅 ADMIN/BOSS（非管理员 403，视图层兜底提示）。
//
// 取代原 sichuanCredentials.ts（#1620）——凭据从「四川一套全局」升级为「按接入点分键 +
// 按录入账号分记录」：
//   - 接口只回**本人记录**的掩码；别人的记录连掩码都拿不到（账号级隔离，覆盖公司间隔离）。
//   - 每个接入点实际生效的只有一套（无人值守采集用它），生效者身份随状态返回，
//     页面必须明示「当前生效的是谁录入的」。
//   - 连通测试测的是**当前生效那套**（采集真正读的文件），不是本人草稿。
import { apiDelete, apiGet, apiPost, apiPut } from './api'

// 六项国密/OAuth2 密钥。字段名与 Java CredentialStore 读的键一一对应，不可自由改名。
export type GridCredentialSecretField =
  | 'appId'
  | 'appSecret'
  | 'sm4Key'
  | 'sm4Iv'
  | 'sm2PrivateKey'
  | 'sm2PublicKey'

// 通道类型与就绪度，值域与 shared/grid-access/access-points.mjs 一致。
export type GridAccessChannelKind = 'official-platform' | 'enterprise-adapter'
export type GridAccessReadiness = 'live' | 'ready' | 'maintenance' | 'unreachable' | 'planned'

export type GridAccessPoint = {
  id: string
  name: string
  kind: GridAccessChannelKind
  gridOperator: 'sgcc' | 'csg' | 'mengxi' | 'other'
  regionId: string | null
  platformHost: string | null
  credentialProfile: string | null
  credentialEntry: boolean
  readiness: GridAccessReadiness
  readinessNote: string
  probedAt: string | null
  serviceBinding: { statusApi: string; triggerApi: string; healthApi: string } | null
  configApi: string | null
  sourceRegistryRefs: string[]
}

// 清单里的凭据摘要：只含生效者身份与本人是否录过，不含任何掩码（最小暴露面）。
export type GridAccessPointListItem = GridAccessPoint & {
  credentials: {
    effectiveOwner: string | null
    effectiveUpdatedAt: string | null
    ownRecorded: boolean
  } | null
}

// 测试结论。每个取值对应一个明确的处置动作，视图层据此给提示：
//   unconfigured → 去补录凭据          ok                  → 无需动作
//   credentialMalformed → 核对密钥      endpointRejected    → 改端点地址
//   credentialRejected → 核对/重申请    platformError       → 平台侧异常，稍后重试
//   unreachable → 查网络，别动凭据      serviceDown         → 先启动采集服务
//   error → 看服务日志
export type GridCredentialTestResult =
  | 'ok'
  | 'unconfigured'
  // 密钥内容无法被国密算法解析（粘错位/少一位/混入非法字符）。这是六项手工粘贴
  // 最高频的失败形态，且此时凭据一个字节都没发出去。
  | 'credentialMalformed'
  | 'endpointRejected'
  | 'credentialRejected'
  // 令牌端点 5xx 或响应异常。SDK 把所有 RestClientException 都包成同一个异常
  // （错误码常见 invalid_token_response），若一律判「凭据被拒」会让人去换一套
  // 本来正确的密钥——故只有明确的鉴权拒绝码才算凭据错，其余归这一类。
  | 'platformError'
  | 'unreachable'
  | 'serviceDown'
  | 'error'

export type GridCredentialTest = {
  result: GridCredentialTestResult
  msg?: string | null
  checkedAt?: string | null
}

// 本人记录（掩码 + 进度）。configured 口径与 Java SichuanCredentials.isComplete() 一致。
export type GridCredentialOwnRecord = {
  configured: boolean
  missing: string[]
  filledCount: number
  totalCount: number
  masked: Record<GridCredentialSecretField, string | null>
  // 端点不是秘密，明文回显——运维要一眼确认没打到总部去。
  baseAddress: string | null
  accessTokenUri: string | null
  updatedAt: string | null
}

// 生效集元信息：**不含掩码**（生效者可能不是查看者本人）。
export type GridCredentialEffective = {
  owner: string
  ownerCompanyId: string | null
  ownedByViewer: boolean
  updatedAt: string | null
  configured: boolean
  baseAddress: string | null
  accessTokenUri: string | null
  lastTest: GridCredentialTest | null
}

export type GridCredentialStatus = {
  pointId: string
  credentialEntry: boolean
  own: GridCredentialOwnRecord | null
  effective: GridCredentialEffective | null
  defaultBaseAddress?: string
  // PUT 响应附带：本次保存是否接管了生效集（完整才接管；不完整只存草稿）。
  becameEffective?: boolean
  // DELETE 响应附带：生效集如何处置（kept/switched/cleared/none）。
  effectiveFallback?: 'kept' | 'switched' | 'cleared' | 'none'
}

export type GridCredentialTestReport = GridCredentialTest & {
  tokenType?: string | null
  expiresIn?: number | null
  expiresAt?: string | null
  errorCode?: string | null
  accessTokenUri?: string | null
  upstream?: string | null
  // 结论是否已写回生效记录。为 false 时 notRecordedReason 说明原因——最典型的是
  // 测试期间生效凭据被更换，本次结论属于旧凭据，不能当作新凭据已验证。
  recorded?: boolean
  notRecordedReason?: string | null
}

// 录入输入。**增量语义**：只提交填了的字段，留空的保留本人记录原值；
// 要整体换一套凭据先调 clearGridCredentials。
export type GridCredentialInput = Partial<Record<GridCredentialSecretField, string>> & {
  baseAddress?: string
  accessTokenUri?: string
}

export async function fetchGridAccessPoints(): Promise<GridAccessPointListItem[]> {
  const envelope = await apiGet<{ points: GridAccessPointListItem[] }>('/api/v1/grid-access/points')
  return envelope.data?.points ?? []
}

export async function fetchGridCredentialStatus(pointId: string): Promise<GridCredentialStatus | null> {
  const envelope = await apiGet<GridCredentialStatus>(`/api/v1/grid-access/points/${pointId}/credentials`)
  return envelope.data ?? null
}

export async function saveGridCredentials(
  pointId: string,
  input: GridCredentialInput
): Promise<GridCredentialStatus | null> {
  const envelope = await apiPut<GridCredentialStatus>(`/api/v1/grid-access/points/${pointId}/credentials`, input)
  return envelope.data ?? null
}

export async function clearGridCredentials(pointId: string): Promise<GridCredentialStatus | null> {
  const envelope = await apiDelete<GridCredentialStatus>(`/api/v1/grid-access/points/${pointId}/credentials`)
  return envelope.data ?? null
}

// 连通测试：转发 Java 采集服务真实换一次 access token（不拉业务数据、不写任何表）。
// Java 服务没起来时回 serviceDown——凭据本身未被验证，不能当成凭据错。
export async function testGridCredentials(pointId: string): Promise<GridCredentialTestReport | null> {
  const envelope = await apiPost<GridCredentialTestReport>(`/api/v1/grid-access/points/${pointId}/credentials/test`, {})
  return envelope.data ?? null
}
