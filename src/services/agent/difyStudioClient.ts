import { apiGet, apiPost } from '@/services/api'

export type DifyStudioStatus = {
  code: number
  available: boolean
  studioEmbedEnabled: boolean
  ssoConfigured: boolean
  apiConfigured: boolean
  toolTokenConfigured: boolean
  baseUrl: string
  reason?: string
  msg?: string
}

export type DifyStudioSession = DifyStudioStatus & {
  sid?: string
  bootstrapUrl?: string
  target?: string
  expiresAt?: string
}

export const DEFAULT_DIFY_STUDIO_TARGET = '/dify-studio/apps'

export async function fetchDifyStudioStatus(): Promise<DifyStudioStatus> {
  return apiGet<DifyStudioStatus>('/dify-sso/status')
}

export async function createDifyStudioSession(target = DEFAULT_DIFY_STUDIO_TARGET): Promise<DifyStudioSession> {
  return apiPost<DifyStudioSession>('/dify-sso/session', { target })
}

export function difyStudioTarget(path = '/apps'): string {
  if (path.startsWith('/dify-studio')) return path
  return `/dify-studio${path.startsWith('/') ? path : `/${path}`}`
}
