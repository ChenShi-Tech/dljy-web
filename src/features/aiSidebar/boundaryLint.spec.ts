// 统一 AI 侧边栏接入边界的 lint 守卫自测（unify-ai-sidebar EN-06，design D13）。
//
// 守什么：业务视图直接内嵌对话内核 / 引用已移除的全局面板接口必须报错；白名单里的流程页可以内嵌
// 对话内核，但 shared/schema 等其它分层限制在白名单文件里必须照样生效。
// 坏掉的症状：flat config 后块会整体替换同名规则的选项——白名单覆盖块若忘了重新声明其它限制，
// 白名单文件就能悄悄绕过 shared/schema 分层守卫，而 lint 依旧全绿。
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

const eslint = new ESLint({ cwd: process.cwd() })

async function restrictedImports(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message)
}

const KERNEL_IMPORT = "import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'\nexport default AgentChatPanel\n"
const LEGACY_IMPORT = "import { useAiPanel } from '../composables/useAiPanel'\nexport default useAiPanel\n"
const SCHEMA_IMPORT = "import x from 'shared/schema/capture'\nexport default x\n"

describe('AI 侧边栏接入边界 lint', () => {
  it('普通业务视图直接内嵌对话内核 → 报错并指向 @/features/aiSidebar', async () => {
    const msgs = await restrictedImports('src/views/SomeNewView.ts', KERNEL_IMPORT)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('@/features/aiSidebar')
  })

  it('引用已移除的全局面板接口 → 报错', async () => {
    expect(await restrictedImports('src/components/SomePanel.ts', LEGACY_IMPORT)).toHaveLength(1)
  })

  it('白名单流程页可以内嵌对话内核', async () => {
    expect(await restrictedImports('src/views/DeclarationDeskView.vue', `<script setup lang="ts">\n${KERNEL_IMPORT.split('\n')[0]}\n</script>\n`)).toHaveLength(0)
  })

  it('白名单文件里 shared/schema 分层限制仍然生效（覆盖块没有吞掉其它限制）', async () => {
    expect(await restrictedImports('src/views/DeclarationDeskView.vue', `<script setup lang="ts">\n${SCHEMA_IMPORT.split('\n')[0]}\n</script>\n`)).toHaveLength(1)
  })

  it('侧边栏模块自身不受限（它就是对话内核的合法宿主）', async () => {
    expect(await restrictedImports('src/features/aiSidebar/AiSidebar.ts', KERNEL_IMPORT)).toHaveLength(0)
  })
}, 60_000)
