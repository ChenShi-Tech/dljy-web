// ============================================================================
// shared/ 契约面内容指纹（主仓 Epic dljy#2448 · 子任务 dljy#2454）
// ----------------------------------------------------------------------------
// dljy-web 的 shared/ 是主仓经 sync:web 单向镜像的只读副本；主仓出包
// （scripts/release/build-release.mjs --web-dist）装前端产物时，用本算法对自己的
// shared/ 算指纹，与产物 build-info.json 里的 shared.hash 比对——不等即拒绝出包，
// 从机制上堵住「交付包里前端与后端契约面不同代」。
//
// ⚠️ 本文件被主仓**逐字复制**一份使用：必须自包含、零第三方依赖（只用 node: 内置），
//    不得 import 本仓任何专有模块（eslint 也因此不在 shared/ 之外拦它——它在 scripts/，
//    仍受 lint 管，但注意它只能引 node:）。
//
// ## 算法（两仓必须完全一致；改动任何一条 = 两仓同改 + 升级 SHARED_FINGERPRINT_ALGORITHM）
//   1. relPaths 统一 POSIX 分隔符、按 UTF-16 码元顺序升序（默认 Array.prototype.sort）；
//   2. 每个文件：sha256( relPath + "\0" + 文件原始字节 ) 的 hex（小写）；
//   3. 总指纹 = sha256( 各文件 hex 以 "\n" 连接 ) 的 hex（64 位小写）。
//   文件内容不做换行归一——sync 是字节级拷贝，字节一致 ⇒ 指纹一致，做了归一反而
//   会让「字节不同、归一后相同」的两个目录被误判同代。
//
// 比对前提：两边传入的 relPaths 集合必须完全一致（fileCount 不同即直接不等）。
// =============================================================================
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** 算法版本串：主仓比对前先核对这个，将来改算法必须改这个串（两仓同改）。 */
export const SHARED_FINGERPRINT_ALGORITHM = 'sha256-path0content-v1'

/**
 * 递归列出 `<rootDir>/shared` 下全部文件的相对路径（POSIX 分隔符），排除
 * `README*` 与以 `.` 开头的文件，返回已按 UTF-16 码元顺序排序的数组。
 * `shared/` 不存在时抛错——指纹场景下静默空目录比报错更糟（空目录算出的
 * hash 会让「shared 整个没同步」被误判成合法指纹）。
 */
export function listSharedFiles(rootDir) {
  const sharedDir = path.join(rootDir, 'shared')
  let stat
  try {
    stat = statSync(sharedDir)
  } catch {
    throw new Error(`listSharedFiles: shared/ 目录不存在：${sharedDir}`)
  }
  if (!stat.isDirectory()) throw new Error(`listSharedFiles: 不是目录：${sharedDir}`)
  const out = []
  walk(sharedDir, '', out)
  return out.sort()
}

function walk(dir, relBase, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // 以 . 开头的条目（文件/目录）与 README* 文件不参与指纹：README 是人读的说明
    // 文档，两仓内容本就不同步；点文件多为编辑器/系统杂物，都不该影响版本绑定。
    if (entry.name.startsWith('.') || entry.name.startsWith('README')) continue
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name), relBase ? `${relBase}/${entry.name}` : entry.name, acc)
    } else if (entry.isFile()) {
      acc.push(relBase ? `${relBase}/${entry.name}` : entry.name)
    }
    // 其余（symlink 等）跳过：两仓 shared/ 都是普通文件树，非常规条目不进指纹。
  }
}

/**
 * 对 `relPaths`（**相对 `<rootDir>/shared`** 的 POSIX 路径，可乱序；即
 * listSharedFiles 的返回值）按上述算法计算指纹。返回 `{ hash, fileCount }`；
 * 不修改入参数组。文件缺失时 readFileSync 原样抛错。
 *
 * 注意返回的是**总指纹**：单文件列表的 hash = sha256(该文件的 per-file hex)，
 * 不等于 per-file hash 本身（测试 FIXTURE 值按这个口径手算写死）。
 */
export function sharedFingerprint(rootDir, relPaths) {
  const sorted = [...relPaths].sort()
  const lines = sorted.map((rel) => {
    const abs = path.join(rootDir, 'shared', ...rel.split('/'))
    const bytes = readFileSync(abs)
    return createHash('sha256').update(rel, 'utf8').update('\0').update(bytes).digest('hex')
  })
  const hash = createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')
  return { hash, fileCount: sorted.length }
}
