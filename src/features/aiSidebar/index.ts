// 统一 AI 侧边栏：业务页接入 AI 的唯一出口。
//
// 业务页只从这里 import——声明页面（defineAiPage）、发起解读/提问（useAiSidebar）。
// 侧边栏与智能体工作台平级、共用 components/agent 对话内核；业务视图不得直接内嵌对话内核
// （ESLint no-restricted-imports 守卫，流程内嵌的步骤页除外）。
export { defineAiPage } from './pageRegistry'
export type { AiPageDefinition, AiPageInterpret, AiPagePreset, AiContextFactory, AiQuestion } from './pageRegistry'
export { useAiSidebar } from './useAiSidebar'
export { default as AiSidebar } from './AiSidebar.vue'
export { default as AiOrbLauncher } from './AiOrbLauncher.vue'
