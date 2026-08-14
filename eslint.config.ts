// ESLint flat config：correctness 最小面 + 仓内分层守卫。
// 设计取舍（详见 DEVELOPMENT.md「ESLint 与分层守卫」节）：
//   - 只取 correctness 规则，不引 stylistic/格式类——格式统一交给编辑器与后续决策，
//     避免首次引入即产生海量格式 diff 淹没真实问题；
//   - 分层守卫是本配置的核心目的：此前「views 禁 import shared/schema」「取数只经
//     services 层」两条仓规只写在文档里，无自动执行（已知各有一处存量违例，已清理）；
//   - no-explicit-any 降为 warn：存量 ~238 处（多为脏数据边界的手写守卫），列技术债
//     渐进清零，不在引入门禁的同一批里制造巨型 diff。
import { globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  // vendor/ 与 shared/ 为上游同步覆盖区（shared 由双主仓自己的门禁管），不在本仓 lint。
  globalIgnores([
    'dist/', 'coverage/', 'node_modules/', 'vendor/', 'shared/',
    'src/data/generated/', '.omc/'
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
        {
          patterns: [
            {
              group: ['shared/schema', 'shared/schema/*', 'shared/schema/**'],
              message: '视图层禁直接 import shared/schema——请经 src/data/ 出口取用（见 DEVELOPMENT.md §6 分层约定）'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: '视图层禁直接 fetch——取数必须经 src/services/ 服务层（见 DEVELOPMENT.md §3.1 取数纪律）'
        }
      ]
    }
  }
)
