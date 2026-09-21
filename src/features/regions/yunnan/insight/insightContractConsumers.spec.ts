// @vitest-environment happy-dom
// ↑ 勿删：本文件不是 *.component.spec.ts，vitest node project 默认不给 DOM；被 mock 的
//   @/services/api 经 importOriginal 加载真身时，其顶层 regionContext 要读 window。
// insightContractConsumers.spec.ts — 契约「不是只有类型声明、有真实前端消费者」核对
// （dljy#3106，OpenSpec build-yunnan-regional-market-insight 任务 16.8 / A20）
// ----------------------------------------------------------------------------
// 16.8 验收里「契约不是只有类型声明无实际消费者」的自动化落点，三层断链：
//   ① 登记：INSIGHT_ENDPOINTS 里的端点真实存在（research/preview、insights/query）；
//   ② 客户端：researchClient / insightClient 对端点真实发 POST（运行时调用 + mock fetch 层）；
//   ③ 页面：六页源码真实 import 并调用客户端（fs 读源码断言，页面不消费即失败）。
// 附带核对六页注册与页面文件一一对应（注册无孤儿、文件无未注册）。
// 注意渲染口径：研究页走 research/preview 专用契约，不调 queryInsight；
// 其余五页各自调用 queryInsight——两类契约都有至少一个真实消费者。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { INSIGHT_ENDPOINTS } from 'shared/insight/analyses.mjs'
import { INSIGHT_PAGE_IDS, INSIGHT_PAGE_PATHS } from '@/services/region/insightWorkspace'
import { runResearchPreview, type ResearchPreviewRequest } from '@/services/insight/researchClient'

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }))
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  apiPost,
}))

// ── 夹具 ─────────────────────────────────────────────────────────────────────────────────

// vitest 从仓库根运行（happy-dom 环境下 import.meta.url 不是 file 协议，不能用 URL 推路径）
const PAGES_DIR = join(process.cwd(), 'src', 'features', 'regions', 'yunnan', 'insight', 'pages')
/** 磁盘上真实存在的洞察页面文件（每例运行时列举，不硬编码文件名）。 */
const PAGE_FILES = readdirSync(PAGES_DIR).filter((file) => file.endsWith('Page.vue'))

/** pageId → PascalCase（grid-boundaries → GridBoundaries），对应 Yunnan{Pascal}Page.vue。 */
function pascalCaseOf(pageId: string): string {
  return pageId
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function pageSource(pageId: string): string {
  const expected = `Yunnan${pascalCaseOf(pageId)}Page.vue`
  const hit = PAGE_FILES.find((file) => file === expected)
  if (!hit) {
    throw new Error(`注册页 ${pageId} 找不到页面文件：期望 ${expected}，目录里只有 ${PAGE_FILES.join(', ')}`)
  }
  return readFileSync(join(PAGES_DIR, hit), 'utf8')
}

/** assertResearchPreviewResult 的最小合法结果（页面/客户端实际消费的必备字段齐全）。 */
function researchPreviewPayload(presetId: string) {
  return {
    schemaVersion: 'insight-research/v1',
    queryId: 'q-test',
    presetId,
    presetVersion: 'v1',
    methodVersion: 'm1',
    regionId: 'yunnan',
    businessWindow: { start: '2026-05-01', end: '2026-05-31', timeZone: 'Asia/Shanghai', days: 31 },
    mode: 'ex-post',
    asOf: null,
    mock: false,
    productionWrite: false,
    generatedAt: '2026-05-01T00:00:00+08:00',
    sourceRefs: [],
    readSetRef: 'rs-test',
    resultVersion: 'rv-test',
    inputs: [],
    sample: { conditions: { minSamples: 1 }, primarySamples: 24, eligibilityMet: true, observed: 24 },
    method: { kind: 'correlation', kernel: 'pearson', notes: ['测试样本'] },
    data: {
      schemaVersion: 'insight-research/v1',
      view: 'table',
      dimensions: [],
      measures: [],
      rows: [],
      series: [],
    },
    definitionDraft: { presetId, note: '测试' },
  }
}

// ── 用例 ─────────────────────────────────────────────────────────────────────────────────

describe('契约消费者存在性（16.8 / A20）', () => {
  it('research/preview：端点登记 → researchClient 真实 POST → 研究页真实消费，三层俱全', async () => {
    // ① 登记
    expect(INSIGHT_ENDPOINTS.researchPreview.path).toBe('/api/v1/market-insight/research/preview')
    // ② 客户端运行时消费
    apiPost.mockResolvedValue({ data: researchPreviewPayload('research.price-load-correlation') })
    const request = {
      presetId: 'research.price-load-correlation',
      context: {},
    } as unknown as ResearchPreviewRequest
    const result = await runResearchPreview(request)
    expect(apiPost).toHaveBeenCalledTimes(1)
    const [path, body] = apiPost.mock.calls[0] as unknown as [string, ResearchPreviewRequest]
    expect(path).toBe(INSIGHT_ENDPOINTS.researchPreview.path)
    expect(body.presetId).toBe('research.price-load-correlation')
    expect(result.schemaVersion).toBe('insight-research/v1')
    // ③ 页面侧消费：研究页 import 客户端并调用（不是只挂类型）
    const source = pageSource('research')
    expect(source).toContain("from '@/services/insight/researchClient'")
    expect(source).toContain('runResearchPreview(')
  })

  it('insights/query：除研究页（走研究预览契约）外五页真实调用 queryInsight，六页全部消费 insightClient', () => {
    expect(INSIGHT_ENDPOINTS.query.path).toBe('/api/v1/market-insight/query')
    for (const pageId of INSIGHT_PAGE_IDS) {
      const source = pageSource(pageId)
      // 契约家族消费：六页都 import insightClient（能力目录/查询/覆盖同一客户端）
      expect(source, `${pageId} 应消费 insightClient`).toContain("from '@/services/insight/insightClient'")
      if (pageId === 'research') {
        // 研究页的图表数据来自研究预览契约，不发 insights/query（不双重取数）
        expect(source).not.toContain('queryInsight(')
      } else {
        expect(source, `${pageId} 应真实调用 queryInsight`).toContain('queryInsight(')
      }
    }
  })

  it('六页注册与页面文件一一对应：注册无孤儿、页面文件无未注册', () => {
    expect(Object.keys(INSIGHT_PAGE_PATHS)).toEqual(INSIGHT_PAGE_IDS)
    for (const pageId of INSIGHT_PAGE_IDS) {
      // 每个注册 id 都能找到对应页面文件（pageSource 找不到即抛错），且文件里有洞察实现（不是空壳）
      const source = pageSource(pageId)
      expect(source.length).toBeGreaterThan(1000)
      expect(INSIGHT_PAGE_PATHS[pageId]).toMatch(/^\/insight\//)
    }
    // 页面文件无未注册：目录里的洞察页数量与注册数一致（不多不少）
    expect(PAGE_FILES).toHaveLength(INSIGHT_PAGE_IDS.length)
  })
})
