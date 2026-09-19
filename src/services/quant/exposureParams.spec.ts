// fetchExposure 参数契约守卫：mode（合同分解形态）与 expected_source（对比口径）取值域不相交，
// 历史上 SimulatorView 把口径值当分解模式传（mode: 'renewable'），后端 midlong_tools 直接
// ValueError → HTTP 400「未知分解模式 renewable」，页面自上线起点「运行模拟」必报错。
//
// 组件测试不在本仓范围（vitest environment=node，无 jsdom），故用源码级扫描守卫：
// 遍历所有 fetchExposure 调用点，解析 mode / expected_source 实参（字面量或同文件 ref 初值），
// 断言各自落在后端合法域内且不是同一个实参。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 取值域权威：packages/agent-runtime/src/agent_runtime/tools/midlong/midlong_tools.py::_CURVE_MODES
const CURVE_MODES = ['uniform', 'peak_valley', 'solar_shaped']
// 取值域权威：packages/agent-runtime/src/agent_runtime/api/quant.py::ExposureRequest.expected_source
const EXPECTED_SOURCES = ['renewable', 'load']

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if ((p.endsWith('.vue') || p.endsWith('.ts')) && !p.endsWith('.spec.ts')) out.push(p)
  }
  return out
}

type CallSite = { file: string; mode?: string; expectedSource?: string }

/** 把实参解析成字面量：'peak_valley' → peak_valley；curveMode.value → 同文件 ref 初值。 */
function resolveLiteral(arg: string, source: string): string | null {
  const raw = arg.trim()
  const direct = raw.match(/^['"]([^'"]+)['"]$/)
  if (direct) return direct[1]
  const varName = raw.match(/^(\w+)\.value$/)?.[1]
  if (!varName) return null
  // const x = ref('lit') / ref<'a'|'b'>('lit')
  const decl = new RegExp(`\\b${varName}\\s*=\\s*ref(?:<[^>]*>)?\\(\\s*['"]([^'"]+)['"]`).exec(source)
  return decl ? decl[1] : null
}

function collectCallSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const file of walk(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('fetchExposure(')) continue
    for (const m of source.matchAll(/fetchExposure\(\s*\{([^{}]*)\}\s*\)/g)) {
      const body = m[1]
      const modeArg = body.match(/(?:^|[,\s])mode\s*:\s*([^,\n}]+)/)?.[1]
      const srcArg = body.match(/(?:^|[,\s])expected_source\s*:\s*([^,\n}]+)/)?.[1]
      sites.push({
        file: file.slice(SRC_ROOT.length + 1),
        mode: modeArg && resolveLiteral(modeArg, source) ? resolveLiteral(modeArg, source)! : modeArg?.trim(),
        expectedSource:
          srcArg && resolveLiteral(srcArg, source) ? resolveLiteral(srcArg, source)! : srcArg?.trim(),
      })
    }
  }
  return sites
}

describe('fetchExposure 参数契约', () => {
  const sites = collectCallSites()

  it('前端调用点已全部迁移（9.6/HA-05：fetchOverview 取代 fetchExposure）', () => {
    // 组 8/9 完成后前端不应再有调用点；端点本体（quant.py exposure）保留一个发布周期，
    // 确认零调用后经移除 issue 删除 quantClient.ts 里的 fetchExposure 定义。
    expect(sites.length).toBe(0)
  })

  it('mode 实参不得取 expected_source 的值域', () => {
    const violations = sites.filter((s) => s.mode && EXPECTED_SOURCES.includes(s.mode))
    expect(violations, `把对比口径当分解模式传，后端必 400: ${JSON.stringify(violations)}`).toEqual([])
  })

  it('mode 与 expected_source 不得共用同一实参', () => {
    const violations = sites.filter((s) => s.mode && s.expectedSource && s.mode === s.expectedSource)
    expect(violations, `两参数取值域不相交，不可同源: ${JSON.stringify(violations)}`).toEqual([])
  })

  it('可静态解析的 mode 字面量落在后端合法域', () => {
    const resolved = sites.filter((s) => s.mode && !s.mode.includes('.') && !s.mode.includes('('))
    const violations = resolved.filter((s) => !CURVE_MODES.includes(s.mode!))
    expect(violations, `合法分解模式: ${CURVE_MODES.join('/')}`).toEqual([])
  })

  it('可静态解析的 expected_source 字面量落在后端合法域', () => {
    const resolved = sites.filter(
      (s) => s.expectedSource && !s.expectedSource.includes('.') && !s.expectedSource.includes('('),
    )
    const violations = resolved.filter((s) => !EXPECTED_SOURCES.includes(s.expectedSource!))
    expect(violations, `合法对比口径: ${EXPECTED_SOURCES.join('/')}`).toEqual([])
  })
})
