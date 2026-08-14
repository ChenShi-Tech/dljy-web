// ESLint 基线（#1356）：warn 档起步——先让全仓可跑、问题可见不阻断，
// 存量清零后逐规则升 error 并接入 PR 门禁（本档 eslint 只在 error 时非零退出）。
// 覆盖面：src/ + shared/ 的 TS 与 Vue SFC。与上游原仓 eslint.config.js 同档（warn 起步），
// 上游为权威——本仓自有配置仅随上游节奏同步（root 配置不在 sync:web 覆盖集）。
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

const warnify = (rules) => Object.fromEntries(
  Object.entries(rules ?? {}).map(([key, value]) => [
    key,
    typeof value === 'string' ? 'warn' : Array.isArray(value) ? ['warn', ...value.slice(1)] : value,
  ]),
)

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'node_modules/**', 'coverage/**',
      'shared/schema/generated/**', // 生成物：上游原仓 npm run schemas:rows 再生，镜像仓禁改（mirror-guard）
    ],
  },
  ...tseslint.configs.recommended.map((entry) => ({
    ...entry,
    files: ['**/*.{ts,vue}'],
    rules: warnify(entry.rules),
  })),
  // vue flat/essential 自带 vue 插件与解析器注册；rules 整体降 warn
  {
    files: ['**/*.vue'],
    plugins: pluginVue.configs['flat/essential'].reduce((acc, e) => ({ ...acc, ...(e.plugins ?? {}) }), {}),
    languageOptions: {
      parser: pluginVue.configs['flat/essential'].map((e) => e.languageOptions?.parser).find(Boolean),
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' },
    },
    rules: warnify(pluginVue.configs['flat/essential'].reduce((acc, e) => ({ ...acc, ...(e.rules ?? {}) }), {})),
  },
)
