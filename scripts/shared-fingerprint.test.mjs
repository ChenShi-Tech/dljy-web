// ============================================================================
// shared-fingerprint.mjs 单测（node:test，不进 vitest）
// ----------------------------------------------------------------------------
// 守什么不变量：dljy#2454 两仓版本绑定的指纹算法——两仓各有一份逐字拷贝，本测
// 锁住的是「算法契约」：排序口径、路径参与哈希、字节级敏感、列表归一。
// 坏掉的症状：本文件改算法而主仓那份没同步改 → 两仓指纹系统性错开，主仓出包
// 全部被拒（或更糟：错位地全部放行）——所以期望 hash 用「按规格独立手算」的
// 写死值对拍，不是拿实现自身输出回读自身（伪对拍锁不住算法被改）。
// ============================================================================

// 夹具 3 文件（alpha.txt / beta/gamma.txt / delta.txt）按规格手算（独立脚本、不经实现）：
//   per-file = sha256(relPath + "\0" + utf8 字节).hex（留档：
//     alpha.txt      fc6dc9a1fe8bb18c55114e27d74fa2d39586a79c1f0f209e11b17df27c7c6b24
//     beta/gamma.txt 57e74b0c00c7baf56ed4da8466259d47de7ec960711d0b74aebcc60b1a93ed58
//     delta.txt      231157513e6c2641d5146ae3e4b392788852844ec1dbb9643b6ff431e60ff64f）
//   total = sha256(per-file hex 以 "\n" 连接).hex
const FIXTURE_TOTAL_HASH = 'adaff4165924bbbf7ac91c9e5e31cba6cc620c6ed122cc53c763129141024c61'
// 单文件列表的返回值是**总指纹** = sha256(该文件 per-file hex)，不是 per-file hash 本身
// （第一个版本在这里把断言对象配错，排查绕了一大圈——两仓实现方改算法时按此口径对拍）。
const FIXTURE_SINGLE_TOTAL = {
  'alpha.txt': 'a65fe6d461e0798a4a8090e7107378cba5bf57dfe1edaf8b2a297ffb71b6670d',
  'beta/gamma.txt': '657e9da5c5fa44c8b43dbfb7c2ad429349a47c38fc6c5f2ec078b2aed8761165',
  'delta.txt': 'fd1253b7c2690d64ef9ac39575a3edce2e0625ab0f01c49cdbca93a73e7ddf8e'
}

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { listSharedFiles, sharedFingerprint, SHARED_FINGERPRINT_ALGORITHM } from './shared-fingerprint.mjs'

/** 建标准夹具：<tmp>/shared/{alpha.txt, beta/gamma.txt, delta.txt, README.md, .hidden.txt} */
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'dljy-shared-fp-'))
  const shared = path.join(root, 'shared')
  mkdirSync(path.join(shared, 'beta'), { recursive: true })
  writeFileSync(path.join(shared, 'alpha.txt'), 'alpha-bytes-v1')
  writeFileSync(path.join(shared, 'beta', 'gamma.txt'), 'gamma-bytes-v1')
  writeFileSync(path.join(shared, 'delta.txt'), 'delta-bytes-v1')
  writeFileSync(path.join(shared, 'README.md'), '# 说明文档，两仓各写各的，不参与指纹')
  writeFileSync(path.join(shared, '.hidden.txt'), '编辑器/系统杂物，不参与指纹')
  return root
}

test('指纹与规格手算值一致（含子目录相对路径），单文件退化口径逐项可对拍', () => {
  const root = makeFixture()
  try {
    const files = listSharedFiles(root)
    assert.deepEqual(files, ['alpha.txt', 'beta/gamma.txt', 'delta.txt'])
    // 单文件列表 → 总指纹 = sha256(per-file hex)，逐项等于手算表——锁「路径进哈希」这一条。
    for (const [rel, expect] of Object.entries(FIXTURE_SINGLE_TOTAL)) {
      assert.equal(sharedFingerprint(root, [rel]).hash, expect, `single-total ${rel}`)
    }
    const fp = sharedFingerprint(root, files)
    assert.equal(fp.hash, FIXTURE_TOTAL_HASH)
    assert.equal(fp.fileCount, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('relPaths 乱序输入 → 同一指纹（不修改入参数组）', () => {
  const root = makeFixture()
  try {
    const shuffled = ['delta.txt', 'beta/gamma.txt', 'alpha.txt']
    const input = [...shuffled]
    assert.equal(
      sharedFingerprint(root, shuffled).hash,
      sharedFingerprint(root, listSharedFiles(root)).hash
    )
    assert.deepEqual(input, shuffled, '不得修改调用方的数组')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('任一文件变一个字节 → 指纹变（字节级敏感，不做换行归一）', () => {
  const root = makeFixture()
  try {
    const before = sharedFingerprint(root, listSharedFiles(root)).hash
    writeFileSync(path.join(root, 'shared', 'alpha.txt'), 'alpha-bytes-v2')
    const after = sharedFingerprint(root, listSharedFiles(root))
    assert.notEqual(after.hash, before)
    assert.equal(after.fileCount, 3, '只改内容不改文件数')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('增删文件 → fileCount 与 hash 都变；listSharedFiles 排除 README* 与点文件且已排序', () => {
  const root = makeFixture()
  try {
    const files = listSharedFiles(root)
    assert.ok(files.every((rel) => !rel.split('/').some((seg) => seg.startsWith('.') || seg.startsWith('README'))))
    assert.deepEqual([...files], [...files].sort(), '返回值已排序（UTF-16 码元序）')

    writeFileSync(path.join(root, 'shared', 'beta', 'extra.txt'), 'extra')
    const grown = listSharedFiles(root)
    assert.equal(grown.length, 4)
    assert.deepEqual(grown, ['alpha.txt', 'beta/extra.txt', 'beta/gamma.txt', 'delta.txt'])
    assert.equal(sharedFingerprint(root, grown).fileCount, 4)
    assert.notEqual(sharedFingerprint(root, grown).hash, FIXTURE_TOTAL_HASH)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('对真实仓库 shared/ 冒烟：88 个文件，指纹可复算且 algorithm 版本串就位', () => {
  // 本测试用真实仓库当夹具（只读）：让「verify 门禁与 build-info 写入消费同一实现」
  // 这条链在单测里也被走到一次；不硬编码 71 之外的业务值（dljy#2938 同步 shared/midlong 8 个文件后由 37 增至 45，dljy#2969 预登记 P2/P3 共享契约 4 个文件后增至 49，dljy#2993 同步 shared/insight 20 个文件后增至 69，dljy#3006 追加总览清单 2 个后增至 71，dljy#3038 追加 shared/hedge 9 个后增至 80，dljy#3080 追加 shared/insight/research.mjs 后增至 81，dljy#3092 追加 shared/schema/grid-geo-contract.mjs 后增至 82，与主仓 SHARED_WHITELIST 同步）。
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const files = listSharedFiles(repoRoot)
  assert.equal(files.length, 88)
  const fp = sharedFingerprint(repoRoot, files)
  assert.match(fp.hash, /^[0-9a-f]{64}$/)
  assert.equal(fp.fileCount, files.length)
  // 复算一次必须逐字节一致（确定性）。
  assert.equal(sharedFingerprint(repoRoot, [...files].reverse()).hash, fp.hash)
  assert.equal(SHARED_FINGERPRINT_ALGORITHM, 'sha256-path0content-v1')
  // 夹具与真实仓库互不污染（readFileSync 仅作连通性哨兵）。
  assert.ok(readFileSync(path.join(repoRoot, 'shared', files[0])).length > 0)
})
