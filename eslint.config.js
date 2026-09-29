// ESLint flat config：correctness 最小面 + 仓内分层守卫（error 档）。
// 对账说明（2026-08-15）：本文件由 #1（test+refactor 批 13）与 #1356 warn 档基线统一而来——
// warn 基线自身的路线图即「存量清零后逐规则升 error 并接入 PR 门禁」，本配置就是那一步：
//   - 42 处存量 error 已清零（#1 批 13b），分层守卫与 correctness 规则以 error 拦截；
//   - no-explicit-any 保持 warn（存量 ~290 处列技术债渐进清零）；
//   - shared/ 仍不在本仓 error 门禁内（上游同步区，warn 由上游权威 eslint 管）；
//   - 文件名随上游惯例用 .js（原 .ts/jiti 随统一移除）；上游为权威，root 配置不在 sync 覆盖集。
// 设计取舍详见 DEVELOPMENT.md「ESLint 与分层守卫」节。
import { globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

const SHARED_SCHEMA_PATTERN = {
  group: ['shared/schema', 'shared/schema/*', 'shared/schema/**'],
  message: '视图层禁直接 import shared/schema——请经 src/data/ 出口取用（见 DEVELOPMENT.md §6 分层约定）'
}
// 统一 AI 侧边栏的接入边界（unify-ai-sidebar EN-06）：业务页接入 AI 只经 @/features/aiSidebar，
// 不直接内嵌对话内核——否则入口会再次分散成各页各一个对话框。
const CHAT_KERNEL_PATTERN = {
  group: ['**/agent/AgentChatPanel.vue', '@/components/agent/AgentChatPanel.vue'],
  message: '业务视图不得直接内嵌对话内核——页面解读与提问请经 @/features/aiSidebar（defineAiPage / useAiSidebar）；流程步骤内嵌对话需登记到 eslint.config.js 白名单（见 DEVELOPMENT.md §3.4）'
}
const LEGACY_AI_PANEL_PATTERN = {
  group: ['**/composables/useAiPanel', '**/composables/usePageInsight', '@/composables/useAiPanel', '@/composables/usePageInsight', '**/agent/AgentSidekick.vue'],
  message: '全局 AI 面板接口已迁到 @/features/aiSidebar（useAiSidebar / defineAiPage）'
}
// 允许直接内嵌对话内核的文件：智能体工作台本身 + 作为流程步骤的内嵌对话（EN-05）。
const EMBEDDED_CHAT_ALLOWLIST = [
  'src/views/AgentWorkbenchView.vue',
  'src/views/DeclarationDeskView.vue',
  'src/views/StorageCopilotView.vue',
  'src/components/review/ReportGenerateDialog.vue',
  'src/components/review/workbench/ReviewAssistantWorkbench.vue',
  'src/components/trading/stages/StageDirection.vue',
  'src/components/trading/stages/StageMarketAnalysis.vue',
  'src/components/trading/stages/StorageDispatchBlock.vue'
]

export default tseslint.config(
  // vendor/ 与 shared/ 为上游同步覆盖区（shared 由双主仓自己的门禁管），不在本仓 lint。
  // src/attic/ 是停用区：已下架但保留的功能，不参与构建/类型检查/lint（见该目录 README）。
  // dist-customer-verify/ 是 verify:customer-edition-build 自建的交付版扫描产物（与 dist/ 同性质，已在 .gitignore）。
  globalIgnores([
    'dist/', 'dist-customer-verify/', 'coverage/', 'node_modules/', 'vendor/', 'shared/',
    'src/data/generated/', '.omc/', 'src/attic/'
  ]),

  // —— 基线：TS recommended（correctness 面）——
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_` 前缀 = 有意保留的占位参数/变量（如接口约定的位置参数），不按未使用报错。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  },

  // —— Vue：essential（correctness 面），.vue 内嵌 <script> 用 TS parser 解析 ——
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, sourceType: 'module', ecmaVersion: 'latest' },
      globals: { ...globals.browser }
    }
  },
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },

  // —— 仓内分层守卫（ DEVELOPMENT.md §3/§6 的自动执行）——
  // 1) 视图层禁直接 import shared/schema：schema 是前后端同构契约，视图消费必须经
  //    src/data/ 出口（如 captureColumnLabels 的 re-export），否则 schema 结构调整会
  //    把破坏面直接扩散到视图层。
  // 3) 视图层禁直接内嵌对话内核、禁用已移除的全局 AI 面板接口（统一 AI 侧边栏接入边界）。
  // 2) 视图层禁直接 fetch：取数必须经 src/services/（信封解析/鉴权头/地区头/重试都在
  //    那一层），散落 fetch 无法统一治理——/pi-api 代理被删后两页静默 404 即前车之鉴。
  //    features/ 不拦：gridGeo 的 geoJsonLoader 拉静态 geojson 资源属合法用法。
  //    spec 文件不拦：mock fetch 是测试手段。
  {
    files: ['src/views/**/*.{ts,vue}', 'src/components/**/*.{ts,vue}'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [SHARED_SCHEMA_PATTERN, CHAT_KERNEL_PATTERN, LEGACY_AI_PANEL_PATTERN] }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: '视图层禁直接 fetch——取数必须经 src/services/ 服务层（见 DEVELOPMENT.md §3.1 取数纪律）'
        }
      ]
    }
  },
  {
    files: EMBEDDED_CHAT_ALLOWLIST,
    rules: {
      'no-restricted-imports': ['error', { patterns: [SHARED_SCHEMA_PATTERN, LEGACY_AI_PANEL_PATTERN] }]
    }
  }
)
