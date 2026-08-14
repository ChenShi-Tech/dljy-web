// 技能（Skill）管理：对接 agent-backend 的 /api/agent/skills/*（渐进式披露技能）。
// 与 llm.ts 同源（共用 agentClient 的 AGENT_API_BASE）。写操作复用 LLM 同款管理令牌：
// 服务端设了 HARNESS_ADMIN_TOKEN 时校验 x-admin-token，否则放行（单机/演示）。读操作不需令牌。
import { AGENT_API_BASE, identityHeaders } from '@/services/agent/agentClient'
import { timeoutSignal } from '@/services/api'
import { getAdminToken } from '@/services/llm'
import { invalidateBackendSkills } from '@/services/skills'

const SKILLS_BASE = `${AGENT_API_BASE}/skills`

export type SkillSource = 'builtin' | 'user'

export type SkillSummary = {
  name: string
  description: string
  source: SkillSource
  enabled: boolean
}

export type SkillDetail = SkillSummary & {
  raw: string // 完整 SKILL.md 原文（frontmatter + 正文）
  body: string // 仅正文
  files: string[] // 附属文件相对路径清单
}

// 写操作携带管理令牌（未配置 HARNESS_ADMIN_TOKEN 时返回空头，后端放行）
function adminHeaders(): Record<string, string> {
  const headers = identityHeaders()
  const t = getAdminToken()
  if (t) headers['x-admin-token'] = t
  return headers
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', ...adminHeaders() }
}

function readHeaders(): Record<string, string> {
  return identityHeaders()
}

// FastAPI HTTPException 的错误体为 {detail: string}
async function errDetail(res: Response): Promise<string> {
  try {
    return (await res.json())?.detail ?? ''
  } catch {
    return ''
  }
}

const enc = encodeURIComponent
const encPath = (path: string) => path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
const SKILLS_TIMEOUT_MS = 10_000

function skillsSignal(): AbortSignal | undefined {
  return timeoutSignal(SKILLS_TIMEOUT_MS)
}

export async function listSkills(): Promise<SkillSummary[]> {
  const res = await fetch(SKILLS_BASE, { headers: readHeaders(), signal: skillsSignal() })
  if (!res.ok) throw new Error(`技能列表获取失败: ${res.status}`)
  return (await res.json()).skills ?? []
}

export async function getSkill(name: string): Promise<SkillDetail> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}`, { headers: readHeaders(), signal: skillsSignal() })
  if (!res.ok) throw new Error((await errDetail(res)) || `技能详情获取失败: ${res.status}`)
  return (await res.json()) as SkillDetail
}

// 以 raw SKILL.md 全文创建/更新用户技能（同名覆盖内置）
export async function saveSkillRaw(name: string, raw: string): Promise<SkillSummary> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({ raw }),
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `保存失败: ${res.status}`)
  const saved = (await res.json()) as SkillSummary
  invalidateBackendSkills() // 失效斜杠菜单缓存，立即反映新建/改名/改描述
  return saved
}

export async function deleteSkill(name: string): Promise<boolean> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `卸载失败: ${res.status}`)
  invalidateBackendSkills() // 失效斜杠菜单缓存，立即移除已卸载技能
  return true
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<boolean> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}/enabled`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify({ enabled }),
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `启停失败: ${res.status}`)
  invalidateBackendSkills() // 失效斜杠菜单缓存：停用技能即时移出菜单、启用即时加入
  return true
}

export async function importSkillZip(file: File, overwrite = false): Promise<SkillSummary> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${SKILLS_BASE}/import?overwrite=${overwrite}`, {
    method: 'POST',
    headers: adminHeaders(), // 不设 content-type，由浏览器为 FormData 设 multipart 边界
    body: form,
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `导入失败: ${res.status}`)
  const imported = (await res.json()) as SkillSummary
  invalidateBackendSkills() // 失效斜杠菜单缓存，立即纳入导入的技能
  return imported
}

// 导出为下载链接（GET 直接返回 zip，组件用 <a download> 触发；读操作不需令牌）
export function exportSkillUrl(name: string): string {
  return `${SKILLS_BASE}/${enc(name)}/export`
}

// 附属文件路径可能含 /（如 notes/a.md）；逐段编码保留目录层级，同时正确处理 #、?、空格等文件名字符。
export async function readSkillFile(name: string, path: string): Promise<string> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}/files/${encPath(path)}`, {
    headers: readHeaders(),
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `附属文件读取失败: ${res.status}`)
  return (await res.json()).content ?? ''
}

export async function writeSkillFile(name: string, path: string, content: string): Promise<boolean> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}/files/${encPath(path)}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({ content }),
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `保存失败: ${res.status}`)
  return true
}

export async function deleteSkillFile(name: string, path: string): Promise<boolean> {
  const res = await fetch(`${SKILLS_BASE}/${enc(name)}/files/${encPath(path)}`, {
    method: 'DELETE',
    headers: adminHeaders(),
    signal: skillsSignal()
  })
  if (!res.ok) throw new Error((await errDetail(res)) || `删除失败: ${res.status}`)
  return true
}
