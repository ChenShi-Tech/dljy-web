// 前端源码零供应商 / 型号关键词（主仓 Epic #2661 · #2668）。
//
// #2668 起前端不再持有任何大模型供应商、真实型号、密钥：档位来自网关 /llm/services，
// 供应商只存在于网关内部。这条 spec 守的是「谁都别把品牌词写回前端」——不论内部档还是
// 交付档，不论是代码、模板还是注释、测试夹具（夹具里的品牌名一样会被 grep 出来）。
//
// 与 scripts/verify-customer-edition-build.mjs 共用同一张关键词表（那条扫交付版构建产物，
// 守的是 tree-shaking 没失效；这条扫源码，守的是源头干净）。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRAND_KEYWORDS, SOURCE_SCAN_EXEMPT } from '../../scripts/llm-brand-keywords.mjs'

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = fileURLToPath(import.meta.url)
const SCAN_EXT = new Set(['.ts', '.vue', '.js', '.mjs', '.tsx'])

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (SCAN_EXT.has(path.extname(full)) && full !== SELF) acc.push(full)
  }
  return acc
}

/** 按行做小写子串匹配；返回 `相对路径:行号 → 关键词` */
export function scanText(text: string, keywords: readonly string[], file = '<text>'): string[] {
  const hits: string[] = []
  text.split('\n').forEach((line, i) => {
    const lower = line.toLowerCase()
    for (const kw of keywords) if (lower.includes(kw)) hits.push(`${file}:${i + 1} → ${kw}`)
  })
  return hits
}

const KEYWORDS = BRAND_KEYWORDS.filter((w) => !SOURCE_SCAN_EXEMPT.includes(w))

describe('前端源码不含大模型供应商 / 型号关键词', () => {
  it('关键词表非空、全小写、豁免词确实来自表内', () => {
    expect(KEYWORDS.length).toBeGreaterThan(20)
    for (const w of BRAND_KEYWORDS) expect(w).toBe(w.toLowerCase())
    for (const w of SOURCE_SCAN_EXEMPT) expect(BRAND_KEYWORDS).toContain(w)
  })

  it('扫描器本身有区分力：塞一个关键词进去必须被抓到', () => {
    // 判空转只能靠变异——扫描器若因路径 / 扩展名 / 大小写处理出错而什么都不匹配，
    // 下一条「零命中」会因为错误的理由通过。
    const sample = `const x = 'DeepSeek-v4'\nconst y = '智谱 glm-4'\nconst z = 'ok'`
    const hits = scanText(sample, KEYWORDS, 'sample.ts')
    expect(hits).toContain('sample.ts:1 → deepseek')
    expect(hits).toContain('sample.ts:2 → 智谱')
    expect(hits).toContain('sample.ts:2 → glm-4')
    expect(hits.some((h) => h.startsWith('sample.ts:3'))).toBe(false)
  })

  it('src/** 零命中（含模板、注释、spec 夹具）', () => {
    const files = walk(SRC_ROOT)
    expect(files.length).toBeGreaterThan(100)
    const hits = files.flatMap((f) => scanText(readFileSync(f, 'utf8'), KEYWORDS, path.relative(SRC_ROOT, f)))
    expect(hits, `前端源码出现供应商 / 型号关键词：\n${hits.join('\n')}`).toEqual([])
  })

  it('本地供应商清单文件已删除，不得复活', () => {
    expect(existsSync(path.join(SRC_ROOT, 'data', 'llmProviders.ts'))).toBe(false)
  })
})
