#!/usr/bin/env node
// ============================================================================
// verify:customer-edition-build —— 交付版产物不得泄露大模型信息 + shared 指纹同代
// ----------------------------------------------------------------------------
// 主仓 Epic #2408 · 子任务 #2410；判据来源改造见 Epic #2661 · #2668；
// shared 指纹门禁见 dljy#2448 · #2454（本脚本后半段）；
// 已迁入口门禁见 ChenShi-Tech/dljy#3464（本脚本中段：提示文字 / 后台路径 / 后台地址不得进交付产物）。
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
import { loadEnv } from 'vite'
import { BRAND_KEYWORDS } from './llm-brand-keywords.mjs'
import { listSharedFiles, sharedFingerprint, SHARED_FINGERPRINT_ALGORITHM } from './shared-fingerprint.mjs'

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

// 自建产物时注入的「后台地址」金丝雀（#3464）：内部版会把 VITE_PLATFORM_ADMIN_URL 拼进提示链接，
// 客户版不得读取它。自建时把它设成一个不可能在别处出现的值，产物里一旦出现就说明有代码漏读了它。
const ADMIN_URL_CANARY = 'http://platform-admin-canary.invalid:5176'

if (!distDir) {
  distDir = path.join(repoRoot, 'dist-customer-verify')
  console.log('构建交付版产物用于扫描…')
  // --mode customer 让 vite 加载 .env.customer（内含 VITE_EDITION=customer）。
  // 不用 `env: { VITE_EDITION }` 传——那样门禁与 npm run build:customer 走的是两条
  // 不同的配置路径，门禁验的就不是实际交付构建。
  // 额外注入的只有上面的后台地址金丝雀——它不参与交付档判定，交付档仍只由 .env.customer 决定。
  execFileSync('npx', ['vite', 'build', '--mode', 'customer', '--outDir', path.basename(distDir)], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, VITE_PLATFORM_ADMIN_URL: ADMIN_URL_CANARY }
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

// ============================================================================
// 已迁入口门禁（ChenShi-Tech/dljy#3464）：内部版把已迁至平台后台的旧入口换成「已迁至平台后台」提示
// 与后台链接；客户交付版入口一律照旧——提示文字、后台页面路径、后台地址都不得出现在交付产物里。
// 客户版构建靠 vite.config.ts 把登记表与提示组件重定向到空壳做到这一点，这里扫产物验证它真的生效。
//
// 判据全部从源码现取、并先自检：提示短语必须真在提示组件源码里、后台路径从登记表逐条解析——
// 源码改了措辞或登记表被改坏而判据没跟上时拒绝报绿（判据失效时报绿的门禁比没有门禁更糟）。
// ============================================================================
const MIGRATION_NOTICE_SRC = path.join(repoRoot, 'src/features/platformAdminMigration/MigratedToAdminNotice.vue')
const MIGRATION_REGISTRY_SRC = path.join(repoRoot, 'src/features/platformAdminMigration/registry.ts')
const MIGRATION_PHRASES = ['已迁至平台后台', '已迁到平台后台', '由平台人员处理', '前往平台后台']

function migrationCriteria() {
  const noticeSrc = readFileSync(MIGRATION_NOTICE_SRC, 'utf8')
  const missing = MIGRATION_PHRASES.filter((p) => !noticeSrc.includes(p))
  if (missing.length) {
    console.error(`✗ 已迁入口判据与源码脱节：提示组件里找不到 ${missing.join('、')}——改了提示措辞请同步本脚本 MIGRATION_PHRASES，拒绝报绿`)
    process.exit(1)
  }
  const registrySrc = readFileSync(MIGRATION_REGISTRY_SRC, 'utf8')
  const adminPaths = [...new Set([...registrySrc.matchAll(/adminPath:\s*'([^']+)'/g)].map((m) => m[1]))]
  if (adminPaths.length === 0 || adminPaths.some((p) => !p.startsWith('/#/'))) {
    console.error('✗ 已迁入口判据失效：登记表里解析不到 adminPath（或格式不是 /#/…）——拒绝报绿')
    process.exit(1)
  }
  // 后台地址：自建产物时是金丝雀；另外本机若真配了 VITE_PLATFORM_ADMIN_URL（进程环境或 .env*），也一并查。
  const adminUrls = new Set()
  if (!args.dist) adminUrls.add(ADMIN_URL_CANARY)
  const configured = (loadEnv('customer', repoRoot, 'VITE_PLATFORM_ADMIN_URL').VITE_PLATFORM_ADMIN_URL ?? '').trim()
  if (configured) adminUrls.add(configured.replace(/\/+$/, ''))
  return { phrases: MIGRATION_PHRASES, adminPaths, adminUrls: [...adminUrls] }
}

const migration = migrationCriteria()
const migrationHits = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const needle of [...migration.phrases, ...migration.adminPaths, ...migration.adminUrls]) {
    if (text.includes(needle)) migrationHits.push({ file: path.relative(distDir, f), needle })
  }
}
if (migrationHits.length) {
  console.error('✗ 交付版产物里出现「已迁至平台后台」相关内容（提示文字 / 后台路径 / 后台地址）：')
  const byNeedle = new Map()
  for (const h of migrationHits) {
    if (!byNeedle.has(h.needle)) byNeedle.set(h.needle, [])
    byNeedle.get(h.needle).push(h.file)
  }
  for (const [needle, fs] of byNeedle) console.error(`    ${needle} → ${[...new Set(fs)].slice(0, 3).join(', ')}`)
  console.error('')
  console.error('  客户版入口应照旧：检查 vite.config.ts 的 CUSTOMER_EDITION_STUBS 是否覆盖了新引用方式（须用 @/ 别名 import）。')
  process.exit(1)
}
console.log(
  `  已迁入口：提示短语 ${migration.phrases.length} 个 · 后台路径 ${migration.adminPaths.length} 条 · 后台地址 ${migration.adminUrls.length} 个${
    args.dist ? '' : '（含自建金丝雀）'
  } 零命中`
)

// ============================================================================
// build-info.json 门禁（dljy#2454）：交付档产物必须携带 shared/ 指纹，且与当下
// 仓库里的 shared/ 同代。品牌词门禁守「产物不泄密」，这条守「产物与契约面对齐」：
// build:customer 与本门禁之间若有人动了 shared/（sync 回流、手工改动），旧产物的
// shared.hash 就对不上现算值——红，重新构建即可。主仓出包时还会用同一算法再比一次。
// ============================================================================
const buildInfoPath = path.join(distDir, 'build-info.json')
if (!existsSync(buildInfoPath)) {
  console.error(`✗ ${path.relative(repoRoot, buildInfoPath)} 不存在——vite.config.ts 的 dljy-build-info 插件没生效？拒绝报绿`)
  process.exit(1)
}
const info = JSON.parse(readFileSync(buildInfoPath, 'utf8'))
const sharedFiles = listSharedFiles(repoRoot)
const expectedShared = sharedFingerprint(repoRoot, sharedFiles)
const buildInfoProblems = []
if (info.edition !== 'customer') {
  buildInfoProblems.push(`edition 应为 "customer"，实际 ${JSON.stringify(info.edition ?? null)}`)
}
if (info.shared?.algorithm !== SHARED_FINGERPRINT_ALGORITHM) {
  buildInfoProblems.push(`shared.algorithm 应为 "${SHARED_FINGERPRINT_ALGORITHM}"，实际 ${JSON.stringify(info.shared?.algorithm ?? null)}——算法升级了两仓没同改？`)
}
if (info.shared?.fileCount !== sharedFiles.length) {
  buildInfoProblems.push(`shared.fileCount 应为 ${sharedFiles.length}（当前仓库 shared/ 实数），实际 ${JSON.stringify(info.shared?.fileCount ?? null)}`)
}
if (info.shared?.hash !== expectedShared.hash) {
  buildInfoProblems.push(`shared.hash 与当前仓库 shared/ 现算不一致（产物 ${info.shared?.hash ?? null} ≠ 现算 ${expectedShared.hash}）——产物是 shared/ 变动前构建的，重新 build:customer`)
}
if (buildInfoProblems.length) {
  console.error(`✗ ${path.relative(repoRoot, buildInfoPath)} 门禁不过：`)
  for (const p of buildInfoProblems) console.error(`    - ${p}`)
  process.exit(1)
}
console.log(`  build-info.json：edition=customer · git=${(info.gitSha ?? 'null').slice(0, 12)} · shared ${info.shared.fileCount} 文件 ${info.shared.hash.slice(0, 12)}… 与仓库 shared/ 同代`)

console.log(`✓ verify:customer-edition-build 通过（${keywords.length} 个关键词零命中 + 已迁入口零泄露 + build-info 指纹一致）`)
