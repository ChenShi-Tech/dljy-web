// 逐页 AI 洞察统一接入：页面加「✨ 解读本页」按钮，调本 composable 把当前页切片摘要作
// contextPayload 交「全局统一 AI 面板」(useAiPanel) 流式解读。
//
// 复用 openAgent 契约：promptKey 经 PagePromptKey 白名单（防自由文本绕过安全基线）、
// contextPayload 走 untrusted_external_content 语义（随消息下发、不可信外部内容）。
// 约定：contextPayload 只传「当前筛选派生的切片/摘要」，勿传整页大 raw（如逐日 96 点全量、
// 多年逐日矩阵），对齐驾驶舱「只传当前 block」的做法，既省 LLM 上下文，也避免噪声淹没判断。
//
// **本页解读注册表（2026-08-26）**：右下角悬浮球要做到「在能解读的页面解读本页、在不能解读的
// 页面不出现」，就必须知道当前页有没有解读能力、以及触发它要调什么。而 contextPayload 是**页面
// 自己按当前筛选算出来的**，悬浮球拿不到——所以由页面把触发器注册进来，悬浮球只读这个注册表。
// 没注册 = 该页没有解读能力 = 悬浮球不显示。**不要给悬浮球做「无 payload 的兜底解读」**：
// 那会让模型收到「数据已在上下文」的措辞却没有数据，只能编造（#2210/#2222 已经踩过两次）。
import { onMounted, onUnmounted, shallowRef } from 'vue'
import { useAiPanel } from './useAiPanel'
import { currentRegion } from '@/services/region/regionContext'
import type { PagePromptKey } from '@/prompts'

/** 已注册的「本页解读」触发器；null = 当前页没有解读能力。 */
export interface PageInsightTarget {
  /** 页面名，用于悬浮球 tooltip */
  label: string
  /** 触发解读（等价于点该页的「✨ 解读本页」按钮） */
  run: () => void
}

const activeInsight = shallowRef<PageInsightTarget | null>(null)

/** 供悬浮球等全局组件只读当前页的解读能力。 */
export function usePageInsightTarget() {
  return activeInsight
}

export function usePageInsight(promptKey: PagePromptKey) {
  const { openAgent } = useAiPanel()

  /**
   * 触发本页 AI 解读。
   * @param label 页面/区块名（面板标题副文案 + 默认问题填充）
   * @param contextPayload 当前页切片摘要（务必精简，勿传大 raw）
   * @param question 可选自定义首问，缺省用「请解读本页…」
   */
  function askPage(
    label: string,
    contextPayload: Record<string, unknown>,
    question?: string
  ) {
    openAgent({
      promptKey,
      scenario: 'chat',
      initialQuestion:
        question ??
        `请解读本页「${label}」的关键发现与判断（数据已在上下文，仅就已给切片解读、勿臆造未取项）`,
      contextPayload,
      payload: { region_id: currentRegion.value.id, region_name: currentRegion.value.name },
      label
    })
  }

  /**
   * 把「本页解读」注册给悬浮球。必须在 setup 期同步调用（内部挂 onMounted/onUnmounted）。
   * 卸载时只清自己那份，避免路由切换期「新页已挂载、旧页才卸载」把新页的注册误清掉。
   */
  function registerPageInsight(run: () => void, label: string) {
    const entry: PageInsightTarget = { label, run }
    onMounted(() => { activeInsight.value = entry })
    onUnmounted(() => { if (activeInsight.value === entry) activeInsight.value = null })
  }

  return { askPage, registerPageInsight }
}
