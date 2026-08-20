// 守门：src 下不允许新增裸 font-size px 声明，必须走 var(--font-*) 令牌。
// global.css 的令牌定义行（--font-*: Npx）本身豁免。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src')
const RAW = /font-size:\s*[0-9.]+px/
const offenders = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(vue|css)$/.test(name)) check(p)
  }
}

function check(p) {
  const isTokenDefs = p.endsWith('global.css')
  readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (isTokenDefs && line.trim().startsWith('--font-')) return
    if (RAW.test(line)) offenders.push(`${p.replace(process.cwd() + '\\', '')}:${i + 1}  ${line.trim()}`)
  })
}

walk(ROOT)
if (offenders.length) {
  console.error(`✗ 发现 ${offenders.length} 处裸 font-size px，请改用 var(--font-*) 令牌（见 src/styles/global.css 字号档位）`)
  offenders.slice(0, 20).forEach((l) => console.error('  ' + l))
  if (offenders.length > 20) console.error(`  …另有 ${offenders.length - 20} 处`)
  process.exit(1)
}
console.log(`✓ font-size 令牌检查通过（无裸 px）`)
