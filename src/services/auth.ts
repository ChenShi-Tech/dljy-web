import { apiDelete, apiGet, apiPatch, apiPost } from '@/services/api'
import {
  getDefaultGovernanceUser,
  replaceAccessOverrides,
  resolveGovernanceUser,
  type DataScope,
  type GovernanceUser,
  type RoleAccessOverride,
  type RoleCode,
  type SubjectType
} from '@/services/governance'
import { regionIdForAreaCode } from '@/data/regions'
import { setCurrentRegionId } from '@/services/region/regionContext'
import { clearStanceContext, syncStancesFromSession } from '@/services/stance/stanceContext'

const TOKEN_KEY = 'dljy_restore_token'
const USER_KEY = 'dljy_governance_user'

export type AuthUser = GovernanceUser & {
  userId?: string
  // 账号绑定的「默认预测厂站」id(管理员可配置;留空时前端按 公司+地区 自动取首个匹配厂站)。
  forecastStationId?: string | null
  status?: 'ACTIVE' | 'DISABLED'
  mustChangePassword?: boolean
  failedLoginCount?: number
  lockedUntil?: string | null
  lastLoginAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type LoginPayload = {
  username: string
  password: string
  rememberMe: boolean
  captchaVerification?: string
}

export type LoginResponse = {
  token: string
  user: AuthUser
  roles?: string[]
  permissions?: string[]
  resetPwdFlag?: boolean
  session?: AuthSession
  access?: AuthAccessPayload
}

export type InfoResponse = {
  user: AuthUser
  roles: string[]
  permissions: string[]
  resetPwdFlag: boolean
  session?: AuthSession
  access?: AuthAccessPayload
}

export type AuthSession = {
  sessionId: string
  username: string
  issuedAt: string
  expiresAt: string
  ip?: string
  userAgent?: string
  revokedAt?: string | null
  rememberMe: boolean
  reason: string
}

export type AuthAccessPayload = {
  rule?: {
    defaultRoute: string
    groups?: string[]
    routes?: string[]
    actions: string[]
  }
  overrides?: Partial<Record<RoleCode, RoleAccessOverride>>
}

export type AuthDirectory = {
  schemaVersion: number
  generatedAt: string
  database: {
    driver: string
    file: string
    persisted: boolean
  }
  passwordPolicy: Record<string, unknown>
  sessionPolicy: Record<string, unknown>
  roles: Array<{
    roleCode: RoleCode
    label: string
    adminLevel: boolean
    access: AuthAccessPayload['rule']
  }>
  users: AuthUser[]
  accessRules: Partial<Record<RoleCode, AuthAccessPayload['rule']>>
  accessOverrides: Partial<Record<RoleCode, RoleAccessOverride>>
  auditRows: Array<Record<string, unknown>>
}

export type AuthUserInput = Partial<Pick<AuthUser,
  'displayName' | 'roleCode' | 'status' | 'companyId' | 'forecastStationId' | 'areaCode' | 'area' | 'subjectId' | 'subjectName' | 'subjectType' | 'allowedAreas' | 'allowedSubjectTypes' | 'dataScopes' | 'mustChangePassword'
>> & {
  username?: string
  password?: string
}

export type ResetPasswordInput = {
  password: string
  mustChangePassword?: boolean
  revokeSessions?: boolean
}

export type AuthAuditRow = {
  auditId: number
  type: string
  username?: string
  actor?: string
  result?: string
  reason?: string
  sessionId?: string
  createdAt: string
  meta?: Record<string, unknown>
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export async function logout() {
  const token = getToken()
  if (token) {
    try {
      await apiPost('/auth/logout', {})
    } catch {
      // 本地退出必须可靠；远端会话失效时也清理浏览器态。
    }
  }
  clearAuthState()
}

function clearAuthState() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  // 立场随会话清空（#2193）：防下一个登录账号继承上一个账号的作业立场。
  clearStanceContext()
}

// Sub-4(#520)：登录成功后默认地区随账号归属（YN→yunnan、SX→shanxi）。只在显式登录
// 动作时联动一次，getInfo（刷新恢复会话）不联动，保留用户会话中手动切换的地区偏好；
// GROUP（集团）与未登记属地不联动。公共披露数据全员可用，故不做硬锁，登录后仍可自由切换。
function applyAccountRegionPreference(user: AuthUser) {
  const regionId = regionIdForAreaCode(user.areaCode)
  if (regionId) setCurrentRegionId(regionId)
}

export async function login(payload: LoginPayload) {
  const response = await apiPost<LoginResponse>('/auth/login', payload)
  if (!response.token) {
    throw new Error('登录接口未返回有效会话')
  }
  localStorage.setItem(TOKEN_KEY, response.token)
  const user = persistAuthUser(response, payload.username)
  applyAccountRegionPreference(user)
  return {
    token: response.token,
    user,
    roles: response.roles ?? [],
    permissions: response.permissions ?? user.permissions,
    resetPwdFlag: response.resetPwdFlag ?? user.mustChangePassword ?? false,
    session: response.session,
    access: response.access
  }
}

export async function getInfo() {
  if (!getToken()) {
    throw new Error('请先登录')
  }
  try {
    const response = await apiGet<InfoResponse>('/auth/info')
    const user = persistAuthUser(response)
    return {
      user,
      roles: [...new Set([user.roleCode, ...(response.roles ?? [])])],
      permissions: response.permissions ?? user.permissions,
      resetPwdFlag: response.resetPwdFlag ?? false,
      session: response.session,
      access: response.access
    }
  } catch (error) {
    clearAuthState()
    throw error
  }
}

function persistAuthUser(response: LoginResponse | InfoResponse, fallbackUsername?: string): AuthUser {
  if (response.access?.overrides) {
    replaceAccessOverrides(response.access.overrides)
  }
  const user = resolveGovernanceUser(response.user?.username ?? fallbackUsername, {
    ...(response.user ?? {}),
    permissions: response.permissions ?? response.user?.permissions
  })
  if (!user) {
    throw new Error('用户信息接口缺少 user 字段')
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  // 立场允许集合随会话同源更新（#2193）：登录与 getInfo 刷新走同一处，两侧天然一致。
  syncStancesFromSession(user)
  return user
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return resolveGovernanceUser(parsed.username, parsed) as AuthUser
  } catch {
    return null
  }
}

export function getCurrentUser(): AuthUser {
  return getStoredUser() ?? (getDefaultGovernanceUser() as AuthUser)
}

export async function getAuthDirectory() {
  const response = await apiGet<AuthDirectory>('/auth/directory')
  if (!response.data) throw new Error('认证目录响应缺少 data')
  if (response.data.accessOverrides) {
    replaceAccessOverrides(response.data.accessOverrides)
  }
  return response.data
}

export async function getAuthUsers() {
  const response = await apiGet<AuthUser[]>('/auth/users')
  return response.rows ?? []
}

export async function createAuthUser(input: AuthUserInput) {
  const response = await apiPost<AuthUser>('/auth/users', normalizeUserInput(input, true))
  if (!response.data) throw new Error('创建用户响应缺少 data')
  return response.data
}

export async function updateAuthUser(username: string, input: AuthUserInput) {
  const response = await apiPatch<AuthUser>(`/auth/users/${encodeURIComponent(username)}`, normalizeUserInput(input, false))
  if (!response.data) throw new Error('更新用户响应缺少 data')
  return response.data
}

export async function resetAuthUserPassword(username: string, input: ResetPasswordInput) {
  return apiPost(`/auth/users/${encodeURIComponent(username)}/reset-password`, input)
}

export async function setAuthUserStatus(username: string, status: AuthUser['status']) {
  const response = await apiPost<AuthUser>(`/auth/users/${encodeURIComponent(username)}/status`, { status })
  if (!response.data) throw new Error('用户状态响应缺少 data')
  return response.data
}

export async function revokeAuthUserSessions(username: string) {
  const response = await apiPost<{ revokedCount: number }>(`/auth/users/${encodeURIComponent(username)}/revoke-sessions`, {})
  return response.data
}

export async function getAuthSessions(scope: 'mine' | 'all' = 'mine') {
  const response = await apiGet<AuthSession[]>('/auth/sessions', { scope })
  return response.rows ?? []
}

export async function deleteAuthSession(sessionId: string) {
  return apiDelete(`/auth/sessions/${encodeURIComponent(sessionId)}`)
}

export async function getAuthAudit(limit = 80) {
  const response = await apiGet<AuthAuditRow[]>('/auth/audit', { limit })
  return response.rows ?? []
}

export async function changePassword(payload: { oldPassword: string; newPassword: string; confirmPassword: string }) {
  await apiPost('/auth/change-password', payload)
  const info = await getInfo()
  // 首登强制改密后进入系统，等价一次显式登录动作 → 同样联动账号属地默认地区。
  applyAccountRegionPreference(info.user)
  window.dispatchEvent(new CustomEvent('governance-user-changed', { detail: info.user }))
  return info
}

export async function saveServerRoleAccessOverride(roleCode: RoleCode, override: RoleAccessOverride) {
  const response = await apiPost<{ accessOverrides: Partial<Record<RoleCode, RoleAccessOverride>> }>('/auth/role-access', {
    roleCode,
    override
  })
  if (response.data?.accessOverrides) {
    replaceAccessOverrides(response.data.accessOverrides)
  }
  return response.data
}

export async function resetServerRoleAccessOverride(roleCode?: RoleCode) {
  const response = await apiPost<{ accessOverrides: Partial<Record<RoleCode, RoleAccessOverride>> }>('/auth/role-access/reset', {
    roleCode
  })
  if (response.data?.accessOverrides) {
    replaceAccessOverrides(response.data.accessOverrides)
  }
  return response.data
}

function normalizeUserInput(input: AuthUserInput, create: boolean) {
  return {
    ...input,
    username: create ? String(input.username ?? '').trim().toLowerCase() : undefined,
    displayName: String(input.displayName ?? '').trim(),
    roleCode: input.roleCode,
    areaCode: String(input.areaCode ?? 'YN').trim().toUpperCase(),
    area: input.area,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    subjectType: input.subjectType as SubjectType | undefined,
    allowedAreas: normalizeStringArray(input.allowedAreas),
    allowedSubjectTypes: normalizeStringArray(input.allowedSubjectTypes) as SubjectType[] | undefined,
    dataScopes: normalizeDataScopes(input.dataScopes),
    password: create ? String(input.password ?? '').trim() : undefined
  }
}

function normalizeStringArray(value?: string[]) {
  return value?.map((item) => String(item).trim()).filter(Boolean)
}

function normalizeDataScopes(value?: DataScope[]) {
  return value?.filter((scope) => scope && scope.tenantId && scope.areaCode && scope.subjectId)
}
