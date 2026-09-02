#!/usr/bin/env node
// ============================================================================
// verify:customer-edition-build —— 交付版产物不得泄露大模型信息
// ----------------------------------------------------------------------------
// 主仓 Epic #2408 · 子任务 #2410；判据来源改造见 Epic #2661 · #2668。
//
//   node scripts/verify-customer-edition-build.mjs [--dist <目录>]
//
// 不传 --dist 时会自己构建一份交付版产物再扫描。
//
// ## 判据：scripts/llm-brand-keywords.mjs 的内联关键词表
//
// #2410 时判据从前端那份供应商清单（llmProviders.ts）现场解析。#2668 起前端**不再持有任何
// 供应商 / 型号信息**（清单已删，档位来自网关 /llm/services），判据来源没了，关键词表就是
// 判据本身——它是回归绊线：列出本仓历史上出现过的品牌 / 型号词，谁把它们写回前端就红。
// 同一张表也被 src/services/edition.brand-keywords.spec.ts 拿去扫源码，两处判据只维护一处。
//
// ## 为什么必须扫产物而不是扫源码
//
// 源码扫描（那条 spec）守的是「前端不写品牌」；本门禁守的是另一件事——「交付版构建出来的
// JS 里还有没有内部档专属的东西」，而这取决于 tree-shaking 有没有真的生效——实测踩过两次：
//   ① 只把 tab 用编译期常量摘掉 → rollup 照样为动态 import 生成 chunk，两版产物一模一样
//   ② 页面 chunk 消掉了 → `/model` 斜杠命令仍 import 供应商清单，把型号打印进聊天框
// 两次都是「源码看着改对了、产物里还在」。所以判据只能是产物。
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRAND_KEYWORDS } from './llm-brand-keywords.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 关键词表被清空 / 结构被改坏时拒绝报绿——判据失效时报绿的门禁比没有门禁更糟。 */
function brandKeywords() {
  const words = [...BRAND_KEYWORDS].filter((w) => typeof w === 'string' && w.length >= 4)
  if (words.length === 0) {
    console.error('✗ 关键词表为空——scripts/llm-brand-keywords.mjs 判据失效，拒绝报绿')
    process.exit(1)
  }
  return words
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

const keywords = brandKeywords()
const files = walkJs(assetsDir)
if (files.length === 0) {
  console.error('✗ 产物里一个 .js 都没有，构建异常')
  process.exit(1)
}

console.log(`verify:customer-edition-build`)
console.log(`  判据关键词 ${keywords.length} 个（scripts/llm-brand-keywords.mjs 内联表）`)
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
