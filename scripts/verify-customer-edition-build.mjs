#!/usr/bin/env node
// ============================================================================
// verify:customer-edition-build —— 交付版产物不得泄露大模型信息
// ----------------------------------------------------------------------------
// 主仓 Epic #2408 · 子任务 #2410（后端侧见主仓 #2409）。
//
//   node scripts/verify-customer-edition-build.mjs [--dist <目录>]
//
// 不传 --dist 时会自己构建一份交付版产物再扫描。
//
// ## 判据为什么必须从 llmProviders.ts 动态提取
//
// 硬编码一份品牌名清单的话，新增供应商时门禁不会跟着覆盖——那种门禁会一直报绿，
// 直到某天客户在界面上看见了型号。这里从 `src/data/llmProviders.ts` 现场解析出
// id / name / baseURL 里的关键词，新增供应商自动纳入判据。
//
// ## 为什么必须扫产物而不是扫源码
//
// 源码里当然有这些名字（内部版要用）。真正的问题是「交付版构建出来的 JS 里还有没有」，
// 而这取决于 tree-shaking 有没有真的生效——实测踩过两次：
//   ① 只把 tab 用编译期常量摘掉 → rollup 照样为动态 import 生成 chunk，两版产物一模一样
//   ② 页面 chunk 消掉了 → `/model` 斜杠命令仍 import 供应商清单，把型号打印进聊天框
// 两次都是「源码看着改对了、产物里还在」。所以判据只能是产物。
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 供应商主机名里那些**不是厂商标识**的段。分了三类是因为它们的来源不同，将来要加
 * 的时候得知道往哪一类里放：
 *   - 服务前缀：api / console / platform 这类，任何厂商都可能有
 *   - 通用后缀：com / cn / ai 这类顶级或功能域
 *   - 地域段：ark.cn-beijing.volces.com 里的 cn-beijing
 * 不把它们剔掉的话，`console` 会在几乎每个 JS 产物里命中，门禁直接变成噪音（实测过）。
 */
const TOO_GENERIC_IDS = new Set([
  // 这两个确实是 llmProviders 里的 id，但作为判据没有意义：`custom` 是「自定义接入」
  // 模板、`spark` 是个到处都有的英文词（实测在 LoginView、ArtifactRenderer 等十几个
  // 无关产物里命中）。它们泄不出「用的是哪家模型」这个信息，而中文厂商名（见下）
  // 把这一档补上了——「星火」出现在产物里才是真泄露。
  'custom', 'spark'
])

/**
 * 中文名里那些不是厂商标识的词。它们来自「自定义（任意 OpenAI 兼容）」这类模板条目，
 * 以及厂商名后缀里的通用修饰（「海外」「聚合多模型」）——在无关产物里到处命中。
 */
const CHINESE_NOISE = new Set([
  '自定义', '任意', '海外', '聚合', '多模型', '兼容', '通用', '模型', '接入'
])

const HOSTNAME_NOISE = new Set([
  'api', 'www', 'open', 'platform', 'console', 'cloud', 'chat', 'ark', 'bigmodel',
  'com', 'cn', 'net', 'io', 'ai', 'co', 'org', 'v1',
  'cn-beijing', 'cn-hangzhou', 'us-east'
])

/**
 * 从 llmProviders.ts 解析出应当被清除的关键词。
 *
 * 判据必须跟着数据源走：硬编码一份清单的话，新增供应商时门禁不会跟着覆盖——那种门禁
 * 会一直报绿，直到某天客户在界面上看见了型号。
 *
 * 只取两处：`id` 字段（最准确的厂商标识）与 baseURL 主机名里剔除噪音后剩下的段。
 * **刻意不从型号名提取**——`step-1-8k` 会被切出 `step` 这种三四字母的通用词，
 * 在无关依赖里到处命中。厂商标识基本都能被 id 覆盖，不差型号名这一路。
 */
function extractBrandKeywords() {
  const file = path.join(repoRoot, 'src', 'data', 'llmProviders.ts')
  if (!existsSync(file)) {
    console.error(`✗ 找不到 ${path.relative(repoRoot, file)}——判据来源缺失，拒绝报绿`)
    process.exit(1)
  }
  const text = readFileSync(file, 'utf8')
  const words = new Set()
  for (const m of text.matchAll(/\bid:\s*["']([a-z0-9-]+)["']/gi)) {
    const id = m[1].toLowerCase()
    if (!TOO_GENERIC_IDS.has(id)) words.add(id)
  }
  // 中文厂商名：不会像英文短词那样误报，正好补上被 TOO_GENERIC_IDS 放掉的那一档。
  // 「星火」「豆包」出现在交付产物里就是真泄露，不存在巧合。
  for (const m of text.matchAll(/\bname:\s*["']([^"']+)["']/gi)) {
    for (const cn of m[1].matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
      if (!CHINESE_NOISE.has(cn[0])) words.add(cn[0])
    }
  }
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
    for (const seg of m[1].toLowerCase().split('.')) {
      if (seg.length >= 4 && !HOSTNAME_NOISE.has(seg)) words.add(seg)
    }
  }
  if (words.size === 0) {
    console.error('✗ 一个关键词都没解析出来——llmProviders.ts 结构变了，判据失效，拒绝报绿')
    process.exit(1)
  }
  return [...words].sort()
}

function walkJs(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walkJs(full, acc)
    else if (full.endsWith('.js')) acc.push(full)
  }
  return acc
}

function parseArgs(argv) {
  const args = { dist: null }
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--dist') args.dist = path.resolve(argv[++i])
  return args
}

const args = parseArgs(process.argv.slice(2))
let distDir = args.dist

if (!distDir) {
  distDir = path.join(repoRoot, 'dist-customer-verify')
  console.log('构建交付版产物用于扫描…')
  // --mode customer 让 vite 加载 .env.customer（内含 VITE_EDITION=customer）。
  // 不用 `env: { VITE_EDITION }` 传——那样门禁与 npm run build:customer 走的是两条
  // 不同的配置路径，门禁验的就不是实际交付构建。
  execFileSync('npx', ['vite', 'build', '--mode', 'customer', '--outDir', path.basename(distDir)], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit']
  })
}

const assetsDir = path.join(distDir, 'assets')
if (!existsSync(assetsDir)) {
  console.error(`✗ 产物目录不存在：${assetsDir}——没有扫描对象，拒绝报绿`)
  process.exit(1)
}

const keywords = extractBrandKeywords()
const files = walkJs(assetsDir)
if (files.length === 0) {
  console.error('✗ 产物里一个 .js 都没有，构建异常')
  process.exit(1)
}

console.log(`verify:customer-edition-build`)
console.log(`  判据关键词 ${keywords.length} 个（自 llmProviders.ts 解析）`)
console.log(`  扫描 ${files.length} 个 JS 产物`)
console.log('')

const hits = []
for (const f of files) {
  const text = readFileSync(f, 'utf8').toLowerCase()
  for (const kw of keywords) {
    if (text.includes(kw)) hits.push({ file: path.relative(distDir, f), kw })
  }
}

if (hits.length) {
  console.error('✗ 交付版产物里出现大模型供应商信息：')
  const byKw = new Map()
  for (const h of hits) {
    if (!byKw.has(h.kw)) byKw.set(h.kw, [])
    byKw.get(h.kw).push(h.file)
  }
  for (const [kw, fs] of byKw) console.error(`    ${kw} → ${[...new Set(fs)].slice(0, 3).join(', ')}`)
  console.error('')
  console.error('  改源码的 v-if 不够——要让 rollup 真的把那条依赖链消掉。见 docs/customer-edition.md。')
  process.exit(1)
}

console.log(`✓ verify:customer-edition-build 通过（${keywords.length} 个关键词零命中）`)
