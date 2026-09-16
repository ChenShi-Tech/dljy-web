// 业务页接入 AI 侧边栏的声明注册表（统一 AI 侧边栏 PI-01）。
//
// 页面在 setup 期调 `defineAiPage` 声明「我是谁、用哪个解读角色、点解读时发什么、有哪些快捷问题」；
// 悬浮球、页面上的解读按钮、侧边栏快捷问题都只读这里的「当前生效声明」。
//
// **生命周期必须跟随 KeepAlive**：路由视图包在 `<KeepAlive>` 里，离开页面只失活不卸载。
// 旧实现只挂 onMounted/onUnmounted，声明会停留在最先挂载的页面——2026-09-16 实机复现：
// 分时行情 → 驾驶舱 → 价格分析，三处悬浮球都显示「解读本页：分时行情」。
// 所以挂载/激活时生效，失活/卸载时**只清自己**：新页先激活、旧页后失活的时序下不误清新页。
import { onActivated, onDeactivated, onMounted, onUnmounted, shallowRef, type Ref } from 'vue'
import type { PagePromptKey } from '@/prompts/pageKeys'
import { defaultInterpretQuestion } from './interpretPrompts'

/** 点击时刻生成的数据切片；务必只传当前筛选派生的摘要，勿传整页 raw。 */
export type AiContextFactory = () => Record<string, unknown> | null

export type AiQuestion = string | (() => string)

export interface AiPageInterpret {
  context: AiContextFactory
  /** 开场问题；缺省用通用解读模板。随页面状态变化（如当前 tab）时传函数。 */
  question?: AiQuestion
}

export interface AiPagePreset {
  label: string
  question: AiQuestion
  context?: AiContextFactory
  /** 页面没有 interpret 时，标记为 interpret 的快捷问题充当悬浮球的「解读本页」 */
  interpret?: boolean
}

export interface AiPageDefinition {
  /** 页面名：悬浮球提示、页面背景条与开场问题都用它 */
  label: string
  /** 解读角色：只能是页面提示词白名单 key（前端不得以自由文本设置系统提示词） */
  promptKey: PagePromptKey
  interpret?: AiPageInterpret
  presets?: AiPagePreset[]
}

export interface ResolvedInterpret {
  question: string
  context: AiContextFactory | null
}

const active = shallowRef<AiPageDefinition | null>(null)

/** 当前生效的页面声明（只读使用）。 */
export function activeAiPage(): Readonly<Ref<AiPageDefinition | null>> {
  return active
}

export function activatePage(def: AiPageDefinition): void {
  active.value = def
}

/** 只清自己：避免「新页已激活、旧页才失活」时把新页的声明清掉。 */
export function deactivatePage(def: AiPageDefinition): void {
  if (active.value === def) active.value = null
}

export function resolveQuestion(q: AiQuestion): string {
  return typeof q === 'function' ? q() : q
}

/** 解析页面的「解读本页」动作：优先 interpret，其次标记为 interpret 的快捷问题；都没有返回 null。 */
export function resolveInterpret(def: AiPageDefinition): ResolvedInterpret | null {
  if (def.interpret) {
    return {
      question: def.interpret.question ? resolveQuestion(def.interpret.question) : defaultInterpretQuestion(def.label),
      context: def.interpret.context
    }
  }
  const preset = def.presets?.find((p) => p.interpret)
  if (preset) return { question: resolveQuestion(preset.question), context: preset.context ?? null }
  return null
}

export function canInterpret(def: AiPageDefinition | null): boolean {
  return !!def && resolveInterpret(def) !== null
}

/** 业务页 setup 期同步调用。每次调用登记一份独立声明（以对象身份区分「是不是自己」）。 */
export function defineAiPage(def: AiPageDefinition): void {
  const entry: AiPageDefinition = { ...def }
  onMounted(() => activatePage(entry))
  onActivated(() => activatePage(entry))
  onDeactivated(() => deactivatePage(entry))
  onUnmounted(() => deactivatePage(entry))
}
