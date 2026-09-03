import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin, ResolvedConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { listSharedFiles, sharedFingerprint, SHARED_FINGERPRINT_ALGORITHM } from './scripts/shared-fingerprint.mjs'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

// dljy#2454：所有 mode 的构建都往产物根目录写 build-info.json（字段与用途见
// docs/customer-edition.md「构建信息文件 build-info.json」一节）。主仓出包
// （build-release.mjs --web-dist）用同一套算法对自己的 shared/ 算指纹，与这里的
// shared.hash 比对——不等即拒绝出包，堵住「交付包里前端与后端契约面不同代」。
// 文件是给出包脚本读的、不给浏览器（主仓拷镜像前会删掉），本仓不用处理 nginx。
function dljyBuildInfoPlugin(edition: 'customer' | 'internal', viteMode: string): Plugin {
  let outDir = ''
  return {
    name: 'dljy-build-info',
    apply: 'build',
    configResolved(resolved: ResolvedConfig) {
      // resolved.build.outDir 是绝对路径（--outDir 相对值已被 resolve），以它为准。
      outDir = resolved.build.outDir
    },
    closeBundle() {
      let gitSha: string | null = null
      let gitDirty = true
      try {
        gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        gitDirty = execFileSync('git', ['status', '--porcelain'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim().length > 0
      } catch {
        // git 不可用（如源码包直接构建）：sha 置 null；dirty 未知按脏处理——
        // 这个字段只用于出包侧排查展示，取不到时保守值不会误导比对。
      }
      const shared = sharedFingerprint(repoRoot, listSharedFiles(repoRoot))
      const info = {
        repo: 'dljy-web',
        edition,
        viteMode,
        gitSha,
        gitDirty,
        builtAt: new Date().toISOString(),
        shared: { hash: shared.hash, fileCount: shared.fileCount, algorithm: SHARED_FINGERPRINT_ALGORITHM }
      }
      mkdirSync(outDir, { recursive: true })
      writeFileSync(path.join(outDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n')
      console.log(`[dljy-build-info] ${path.join(path.relative(repoRoot, outDir) || '.', 'build-info.json')}  shared=${shared.hash.slice(0, 12)}… (${shared.fileCount} files)`)
    }
  }
}

// dljy-web 是 dljy 原仓前端的保密镜像下游（见 CONTRIBUTING.md）。
// 本文件为「新仓自有」：同步脚本不覆盖它，改动直接在本仓维护。
// 与原仓 vite.config.ts 的刻意差异只有四处：
//   1. 代理目标经 loadEnv 读取（原仓只读 process.env；协作者把托管 dev API 地址
//      写进 .env.local 即生效，无需导出 shell 环境变量）。
//   2. watch 不排 data/* 与 worktree（对应目录不在本仓），只排 node_modules/dist。
//   3. /pi-api 与 /data-svc 代理目标同样经 loadEnv 读取（原仓硬编码端口）。
//   4. dljy-build-info 插件（dljy#2454）：构建产物写入 build-info.json。
// 其余（分包、双入口、cesium 静态拷贝、5174 strictPort）与原仓保持一致，
// 保证「原仓构建绿 ⇒ 本仓构建绿」。

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env }

  // 客户交付档（主仓 Epic #2408 · #2410）：VITE_EDITION=customer 时，把模型配置页重定向
  // 到占位组件。**必须在模块解析层做，不能只靠 v-if 或编译期常量分支**——rollup 对动态
  // import 的 chunk 生成是保守的：即使引用它的分支被消除，chunk 照样产出，于是内部档
  // 专属的配置页仍躺在交付出去的 JS 里（#2410 实测过，两版产物一模一样；当时泄露的是
  // 前端那份供应商清单，#2668 起前端已无该清单，但内部档配置页仍不该进交付产物）。
  const isCustomerEdition = env.VITE_EDITION === 'customer'
  // 两个后端面必须是两个独立端点：/agent-api 会被 rewrite 成 /api，
  // 若与 4174 面共用同一 upstream 会路径撞车。
  const apiTarget = env.DLJY_DEV_API_TARGET || 'http://127.0.0.1:4174'
  const agentApiTarget = env.DLJY_AGENT_API_TARGET || 'http://127.0.0.1:8000'
  const dataSvcTarget = env.DLJY_DATA_SVC_TARGET || 'http://127.0.0.1:8190'
  const piPocTarget = env.DLJY_PI_POC_TARGET || 'http://127.0.0.1:8100'

  return {
    plugins: [
      dljyBuildInfoPlugin(isCustomerEdition ? 'customer' : 'internal', mode),
      ...(isCustomerEdition
        ? [{
            name: 'dljy-customer-edition',
            enforce: 'pre' as const,
            resolveId(source: string) {
              if (source.endsWith('/AiSettingsView.vue') || source.endsWith('./AiSettingsView.vue')) {
                return fileURLToPath(new URL('./src/views/edition/EditionRemovedView.vue', import.meta.url))
              }
              return null
            }
          }]
        : []),
      vue(),
      viteStaticCopy({
        targets: [
          { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesium', rename: { stripBase: 4 } },
          { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesium', rename: { stripBase: 4 } },
          { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesium', rename: { stripBase: 4 } },
          { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesium', rename: { stripBase: 4 } }
        ]
      })
    ],
    define: {
      CESIUM_BASE_URL: JSON.stringify('/cesium')
    },
    resolve: {
      alias: {
        // 前后端共享的零依赖 schema/规则（由原仓白名单同步，见 shared/ 目录）。
        shared: fileURLToPath(new URL('./shared', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      // Cesium 为按路由加载的独立 vendor（约 4 MiB minified），阈值随原仓。
      chunkSizeWarningLimit: 4200,
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          gridGeo: fileURLToPath(new URL('./grid-geo.html', import.meta.url))
        },
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/cesium/') || id.includes('/@cesium/')) return 'vendor-cesium'
            if (id.includes('xlsx')) return 'vendor-xlsx'
            if (id.includes('echarts-gl') || id.includes('claygl')) return 'vendor-echarts-gl'
            if (id.includes('echarts')) return 'vendor-echarts'
            if (id.includes('zrender')) return 'vendor-zrender'
            if (id.includes('element-plus')) return 'vendor-element-plus'
            if (id.includes('@vue') || id.includes('vue-router')) return 'vendor-vue'
            if (id.includes('lucide-vue-next')) return 'vendor-icons'
            if (id.includes('markdown-it') || id.includes('highlight.js') || id.includes('dompurify')) return 'vendor-markdown'
            // 只被异步引用的大依赖（mermaid/d3 等）交还 rollup 默认分包，
            // 手动 catch-all 会把它们拖成同步 chunk（原仓历史教训），不 catch-all。
            return undefined
          }
        }
      }
    },
    server: {
      port: 5174,
      // 被占用直接失败而非静默跳端口，与原仓约定一致。
      strictPort: true,
      // 允许经隧道/内网主机访问（协作者给维护者演示时用）。
      allowedHosts: true,
      proxy: {
        '/agent-api': {
          // 用 127.0.0.1 而非 localhost：localhost 可能解析成 IPv6 而后端只听 IPv4，
          // 每请求干等 1s 超时（原仓 PR #19 教训）。托管地址同理写 IP 或明确域名。
          target: agentApiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/agent-api/, '/api')
        },
        // pi 底座（integrations/pi-poc 编排服务，主仓库 `cd integrations/pi-poc && npm run dev`）。
        // rollout.ts::PI_NATIVE_SCENARIOS = {strategic_qa, declaration_checkup, chat} 恒定走此基址——
        // chat 于 #2158 切流完成、旧 supervisor 路径随 #2212 删除，两侧不再并存，缺此代理会让
        // 智能体工作台建会话 POST 直接 404（POST 不走 SPA fallback，症状是「后端未启用智能体」）。
        '/pi-api': {
          target: piPocTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/pi-api/, '/api')
        },
        // #2169 P2-2a：数据管理路径族经 api.ts::dataServicePath 改写为 /data-svc/api/...，
        // 此代理剥前缀转发到 data-service :8190；读服务面（/api → 4174）不变。
        // 本文件是镜像仓自有文件、不随 sync:web 覆盖，故需随原仓代理拓扑手动跟进。
        '/data-svc': {
          target: dataSvcTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/data-svc/, '')
        },
        '/api': apiTarget,
        // Dify 报告工坊与 Studio 同源嵌入：全部经 4174 面二次转发。
        '/dify-api': apiTarget,
        '/dify-sso': apiTarget,
        '/dify-studio': apiTarget,
        '/console': apiTarget,
        '/_next': apiTarget
      },
      watch: {
        // .claude/worktrees/ 是本仓 worktree 根（见 .gitignore）：不排除的话 chokidar 会把
        // 每份 worktree 的完整仓库副本各遍历一遍，开几个分支就能吃满 CPU。
        ignored: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**']
      }
    }
  }
})
