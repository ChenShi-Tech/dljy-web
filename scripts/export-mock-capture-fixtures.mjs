// 演示采集 fixtures 导出（PRD 附录 C.19/C.20）：市场洞察 + 现货交易域的真实采集回放件。
//
// 做什么：把后端仓 data/private/capture-raw/shanxi/ 下白名单采集族，按裁剪窗口拷贝到
// src/services/mock/fixtures/<family>/<原文件名>.json，并生成 fixtures-index.json
// （族 → {file, bytes, date?, capturedAt?} 清单，bytes 降序，镜像后端 listCaptured 排序）。
// mock 路由运行时按「文件名子串匹配 + 最大文件胜出」（与 server/capture-replay.mjs 同一
// 解析规则）消费，未命中回落前端合成器。
//
// 边界纪律：
//   * 白名单族限定市场洞察 + 现货交易域，其余域维持合成器；
//   * AppleDouble 垃圾（._*）与 .meta.json 侧车不拷贝（运行时不需要，capturedAt/date 入索引）；
//   * hash 命名且「文件名无日期」的族（如 sdpt_zrqsb）按侧车记录的请求日期解析内容日期
//     （与后端 CAPTURE_CONTENT_DATE_INDEX / contentDateIndexFor 同源同字段）；
//   * fixtures 目录与索引均被 .gitignore 忽略——本地演示 worktree 携带，永不提交（分支纪律）。
//
// 用法：node scripts/export-mock-capture-fixtures.mjs [captureRoot] [destDir]
//   默认 captureRoot=D:/work/dljy/data/private/capture-raw/shanxi，dest=src/services/mock/fixtures
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getContentDateIndex } from '../shared/schema/entities/capture-families.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

const captureRoot = resolve(process.argv[2] ?? 'D:/work/dljy/data/private/capture-raw/shanxi')
const destDir = resolve(process.argv[3] ?? join(repoRoot, 'src/services/mock/fixtures'))

// —— 裁剪窗口参数（逐日文件按文件名日期截取最近 N 天；聚合/hash 文件全保留）——
const ZCQXHDL_DAYS = 120 // 价格分析/出清/散点的逐日 list24/fhlist24（覆盖页内默认日期与 30 天滚动窗口）
const FSHQ_DAYS = 122 // 分时行情 rqlx0/rqlx1 日文档（覆盖视图硬编码默认日 2026-06-01/2026-06-30）
const FSHQ_DATADET_KEEP = 8 // 买卖盘逐笔样例（其余 id 落合成器兜底；全量 15 万文件不可携带）

const FAMILIES = [
  'sdpt_console',
  'sdpt_zcqxhdl',
  'sdpt_actualLoad',
  'sdpt_zsjfx_idx',
  'sdpt_fshq',
  'knn-api_api',
  // 现货交易域（C.20）：日前上报（hash 命名走侧车内容日期）+ 日前电量预估
  'sdpt_zrqsb',
  'sdpt_zptqx',
  // 中长期域（C.21 验收修复）：交易月历（calendar__full 行形状 {jyrq,sj1,sj2}，
  // 此前落通用行集兜底缺 jyrq → 视图 rows[].jyrq.slice 抛 TypeError、整页空）
  'sdpt_zjyap'
]

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

function dateInName(name) {
  const m = name.match(/\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : null
}

function sidecarCapturedAt(dir, file) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, file.replace(/\.json$/i, '.meta.json')), 'utf8'))
    return typeof meta?.capturedAt === 'string' ? meta.capturedAt : null
  } catch {
    return null
  }
}

// 内容日期解析（镜像后端 contentDateFromSidecar）：CAPTURE_CONTENT_DATE_INDEX 登记的族，
// 从侧车 postData（JSON 串/对象）或 query（查询串）取登记字段归一为 YYYY-MM-DD。
function normalizeDate(value) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(value ?? ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function sidecarContentDate(dir, file, field) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, file.replace(/\.json$/i, '.meta.json')), 'utf8'))
    const post = meta?.postData
    if (typeof post === 'string' && post.trim().startsWith('{')) {
      const d = normalizeDate(JSON.parse(post)?.[field])
      if (d) return d
    } else if (post && typeof post === 'object') {
      const d = normalizeDate(post[field])
      if (d) return d
    }
    const query = meta?.query
    if (typeof query === 'string' && query) {
      const d = normalizeDate(new URLSearchParams(query.startsWith('?') ? query.slice(1) : query).get(field))
      if (d) return d
    }
  } catch { /* 侧车缺失/损坏：该文件无内容日期（与后端「宁可漏不可错配」同口径） */ }
  return null
}

if (!existsSync(captureRoot)) {
  console.error(`capture-raw 根不存在: ${captureRoot}`)
  process.exit(1)
}

rmSync(destDir, { recursive: true, force: true })
mkdirSync(destDir, { recursive: true })

const index = { generatedAt: new Date().toISOString(), source: captureRoot, families: {} }
let totalBytes = 0
let totalFiles = 0

for (const family of FAMILIES) {
  const dir = join(captureRoot, family)
  if (!existsSync(dir)) {
    console.warn(`⚠ 跳过（目录不存在）: ${family}`)
    continue
  }
  const all = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json') && !f.startsWith('._'))
  const dates = all.map(dateInName).filter(Boolean).sort()
  const maxDate = dates[dates.length - 1] ?? null
  const zcqxhdlCutoff = maxDate ? addDays(maxDate, -(ZCQXHDL_DAYS - 1)) : null
  const fshqCutoff = maxDate ? addDays(maxDate, -(FSHQ_DAYS - 1)) : null

  const kept = all.filter((file) => {
    const d = dateInName(file)
    if (family === 'sdpt_zcqxhdl') {
      // 聚合/hash 文件（listrs_full、list__、listrs__）全保留；逐日 list24/fhlist24 按窗口截取
      if (!d) return true
      return d >= zcqxhdlCutoff
    }
    if (family === 'sdpt_fshq') {
      if (file.includes('dataDet__id')) return true // 候选，稍后按侧车时刻取最新 N 份
      if (!d) return true
      return d >= fshqCutoff
    }
    return true
  })

  // dataDet 采样：无日期命名，按侧车 capturedAt 取最新 N 份
  const datadet = kept.filter((f) => f.includes('dataDet__id'))
  if (datadet.length > FSHQ_DATADET_KEEP) {
    const byTime = datadet
      .map((f) => ({ f, at: sidecarCapturedAt(dir, f) ?? '' }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const doomed = new Set(byTime.slice(FSHQ_DATADET_KEEP).map((x) => x.f))
    for (const f of doomed) kept.splice(kept.indexOf(f), 1)
  }

  const familyDir = join(destDir, family)
  mkdirSync(familyDir, { recursive: true })
  const dateField = getContentDateIndex(family)?.field ?? null
  const entries = []
  for (const file of kept) {
    const st = statSync(join(dir, file))
    copyFileSync(join(dir, file), join(familyDir, file))
    const entry = { file, bytes: st.size }
    const d = dateInName(file) ?? (dateField ? sidecarContentDate(dir, file, dateField) : null)
    if (d) entry.date = d
    const capturedAt = sidecarCapturedAt(dir, file)
    if (capturedAt) entry.capturedAt = capturedAt
    entries.push(entry)
    totalBytes += st.size
    totalFiles += 1
  }
  // 镜像后端 listCaptured：bytes 降序（子串匹配时最大文件胜出的解析依赖该序）
  entries.sort((a, b) => b.bytes - a.bytes || (a.file < b.file ? -1 : 1))
  index.families[family] = entries
  console.log(`${family}: 保留 ${entries.length}/${all.length} 文件`)
}

const indexPath = join(destDir, '../fixtures-index.json')
writeFileSync(indexPath, JSON.stringify(index, null, 1))
console.log(`\n共 ${totalFiles} 文件 / ${(totalBytes / 1024 / 1024).toFixed(1)}MB → ${destDir}`)
console.log(`索引 → ${indexPath}`)
