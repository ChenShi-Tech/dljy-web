// 逐页 AI 洞察侧栏统一接入：市场洞察分析页加「✨ 解读本页」按钮，调本 composable 把当前页
// 切片摘要作 contextPayload 交「全局统一 AI 中心」(useAiPanel) 的 agent 模式流式解读。
//
// 复用 openAgent 契约：promptKey 经 PagePromptKey 白名单（防自由文本绕过安全基线）、
// contextPayload 走 untrusted_external_content 语义（随消息下发、不可信外部内容）。
// 约定：contextPayload 只传「当前筛选派生的切片/摘要」，勿传整页大 raw（如逐日 96 点全量、
// 多年逐日矩阵），对齐驾驶舱「只传当前 block」的做法，既省 LLM 上下文，也避免噪声淹没判断。
import { useAiPanel } from './useAiPanel'
import { currentRegion } from '@/services/region/regionContext'
import type { PagePromptKey } from '@/prompts'

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

  return { askPage }
}
