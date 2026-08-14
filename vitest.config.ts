import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 与原仓 vitest.config.ts 同构（本仓为镜像下游）：node project 跑纯函数 *.spec.ts，
// dom project 跑组件 *.component.spec.ts；差异仅一处——删除了原仓已失效的
// @dljy/platform-sdk alias（该包已不存在）。
export default defineConfig({
  // 组件测试需 @vitejs/plugin-vue 解析 .vue SFC；extends:true 让 projects 继承根 plugins。
  plugins: [vue()],
  resolve: {
    alias: {
      shared: fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    projects: [
      // extends: true 继承根 resolve.alias——vitest 4 projects 默认不继承根 config。
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/**/*.spec.ts'], exclude: ['src/**/*.component.spec.ts'] } },
      { extends: true, test: { name: 'dom', environment: 'happy-dom', include: ['src/**/*.component.spec.ts'], setupFiles: ['./vitest.setup.dom.ts'] } }
    ],
    coverage: {
      provider: 'v8',
      // 仅统计 .ts/.js 逻辑层覆盖：.vue 计入会让未覆盖组件把全局覆盖率稀释到失效（原仓口径）。
      include: ['src/**/*.{ts,tsx,js,jsx,mjs}'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.component.spec.ts',
        'src/test/**',
        'src/types/**',
        '**/*.d.ts',
        'src/data/generated/**'
      ],
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      // 阈值随原仓（实测基线 −2pp buffer）；原仓调阈值时同步这里。
      thresholds: { lines: 24, functions: 20, statements: 23, branches: 19 }
    }
  }
})
