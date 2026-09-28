// 导引定义注册表（dljy#3404）：按 group 动态 import，避免引擎启动即加载全部内容层。
import type { GuideDefinition } from './types'

const cache = new Map<string, GuideDefinition>()

export async function listGuides(group: 'midlong'): Promise<GuideDefinition[]> {
  if (group === 'midlong') {
    const [{ contractBasicsGuide }, { plannedGuides }] = await Promise.all([
      import('./midlong/contractBasics'),
      import('./midlong/plannedGuides'),
    ])
    return [contractBasicsGuide, ...plannedGuides]
  }
  return []
}

export async function loadGuideDefinition(id: string): Promise<GuideDefinition | null> {
  const cached = cache.get(id)
  if (cached) return cached
  const all = await listGuides('midlong')
  const found = all.find((guide) => guide.id === id) ?? null
  if (found) cache.set(id, found)
  return found
}
