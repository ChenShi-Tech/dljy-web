// 预测入口的「默认算法」选取（dljy#3647）：前端不再写死任何算法名当默认值。
// 优先级：目录对当前标的标记的默认算法 → 目录标记 recommended 的算法 → 第一个可用的非占位模型；
// 一个都没有就返回空串，由页面显示「暂无可用模型」空态，而不是回落到某个可能已下线的算法。
import type { ModelRegistryEntry } from './modelContractTypes'

/** 目录里没有任何可选模型时的统一空态文案。 */
export const NO_AVAILABLE_MODEL_TEXT = '暂无可用模型'

type DefaultCandidate = {
  modelId: string
  available?: boolean
  mock?: boolean
  provenance?: Pick<ModelRegistryEntry['provenance'], 'mock'>
  recommended?: boolean
}

function isPickable(model: DefaultCandidate): boolean {
  return model.available !== false && model.mock !== true && model.provenance?.mock !== true
}

/**
 * 从「页面当前可选的模型」里挑默认项，返回 modelId；没有可选项返回 ''。
 * 传入的必须是页面下拉真实在用的列表（已按目标/准入过滤）——默认值只能落在用户看得到、选得了的项上，
 * 目录默认 id 不在其中（如被准入规则隐藏）时忽略它，绝不硬凑。
 */
export function pickDefaultModelId(
  models: readonly DefaultCandidate[],
  catalogDefaultId?: string | null,
): string {
  const pickable = models.filter(isPickable)
  if (catalogDefaultId && pickable.some((m) => m.modelId === catalogDefaultId)) return catalogDefaultId
  return pickable.find((m) => m.recommended === true)?.modelId ?? pickable[0]?.modelId ?? ''
}
