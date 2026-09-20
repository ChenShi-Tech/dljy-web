// 云南市场洞察六页统一 AI 侧栏注册（dljy#3100，OpenSpec build-yunnan-regional-market-insight 任务 15.3；
// 规格 insight-context-handoff CH03、design D9 AI 边界段；后端约束层 dljy#3097）。
// ----------------------------------------------------------------------------
// 六页（总览/价格/供需/电网边界/场站/研究工作台）共用这一份接入纪律：
//
//  1. 注册走统一协议：`defineAiPage` 声明「解读本页」，挂载/激活生效、失活/卸载只清自己
//     （KeepAlive 语义由 pageRegistry 统一保证）。悬浮球与侧边栏快捷区看到的就是这份声明。
//  2. 取材纪律（CH03「AI 基于当前获权证据」）：点击时刻才采集；采集函数经 `insightAiBlockOf`
//     只收「当前签名一致」的结果——`queriedKey !== currentKey` 的过期区块绝不进上下文
//     （切页/切公司/keep-alive 后不提交旧资料的机械落点）；只传摘要与版本引用
//     （analysisId、view、业务窗、resultVersion/readSetRef、access/availability/freshness、
//     筛选摘要），**绝不传原始行数据数组**；无权区块整块退出；来源缺失与过期随 runtime
//     显式传入，不当零、不冒当前。
//  3. 组装走约束层：页面入口 `interpret()` 先把点击切片交 `POST /api/v1/insight-ai-context/assemble`
//     组装（四段输出契约 + 反例纪律 + 证据注册表），成功才随问题派发侧栏；失败诚实报错、
//     单击一次只尝试一次，无重试风暴。派发上下文同时携带原始 blocks（证据正文）与约束信封
//     （信封的注册表只含 id 与元数据，不含证据正文，缺一不可）。
//  4. 未就绪纪律（D9）：模型离线（探活 offline）只隐藏 AI 入口；数据页查询/分析/保存/导出
//     完整工作，不依赖模型。组装期间上下文签名变化或页面失活：本次解读作废，不带旧资料派发。

import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { defineAiPage, useAiSidebar, type AiPagePreset, type AiQuestion } from '@/features/aiSidebar'
import { resolveQuestion } from '@/features/aiSidebar/pageRegistry'
import { buildPageContext } from '@/features/aiSidebar/pageContext'
import { currentRegion } from '@/services/region/regionContext'
import { currentCompany } from '@/services/company/companyContext'
import { PAGE_PROMPT_KEYS, type PagePromptKey } from '@/prompts/pageKeys'
import { useAgentHealth } from '@/composables/useAgentHealth'
import {
  assembleInsightAiContext,
  type InsightAiEvidenceBlock,
  type InsightAiEvidenceItem,
} from '@/services/insight/insightAiContextClient'
import type { InsightBlockResult } from '@/services/insight/insightClient'
import type { InsightPageId } from '@/services/region/insightWorkspace'

// 页面接线用的协议类型从这里转出口（页面不必直接依赖 services 层类型路径）。
export type { InsightAiEvidenceBlock, InsightAiEvidenceItem } from '@/services/insight/insightAiContextClient'

// ── 采集：viewState 条目 → 协议区块（签名纪律的唯一实现，页面只提供身份与状态）─────────

/** 筛选摘要的合法值：标量或字符串数组；出现任何其他形状都是调用方违约，直接丢弃。 */
export type InsightAiFilterSummary = Record<string, string | number | boolean | null | string[]>

export interface InsightAiBlockSource {
  /** 区块标识（进协议 blockId；用 ASCII，如 'series'、'key-items'） */
  blockId: string
  /** 区块业务标题（进协议 title） */
  title: string
  analysisId: string
  view: string
  /** 页面当前查询签名（点击时刻重算的那份） */
  currentKey: string
  /** 结果落库时的签名；两者不一致即过期区块，绝不进上下文 */
  queriedKey: string
  result: InsightBlockResult | null
  /** 已选对象清单（进 known_objects，供「相关对象不得凭空出现」校验） */
  objects?: string[]
  /** 筛选摘要（价格对象/参考对象/来源选择/模式等；不收原始行） */
  filterSummary?: InsightAiFilterSummary
}

/** 证据 id 词表外的字符替换掉，保证匹配约束层的 id 正则。 */
function safeEvidenceId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._:/-]/g, '-')
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `ev-${cleaned}`
}

/** 筛选摘要 → 一行文本（数组用「、」连接；长数组截断计数，不展开原始行）。 */
function filterSummaryText(summary: InsightAiFilterSummary | undefined): string {
  if (!summary) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(summary)) {
    if (value === null || value === undefined || value === '' || value === false) continue
    if (Array.isArray(value)) {
      if (!value.length) continue
      const shown = value.slice(0, 5).join('、')
      parts.push(`${key}：${shown}${value.length > 5 ? ` 等 ${value.length} 项` : ''}`)
    } else {
      parts.push(`${key}：${value}`)
    }
  }
  return parts.join('；')
}

/** 序列目录 → 一行业务身份（来源/字段/单位/粒度），只取目录不取任何数值。 */
function seriesCatalogText(result: InsightBlockResult): string {
  const series = result.data?.series ?? []
  if (!series.length) return ''
  const shown = series
    .slice(0, 6)
    .map((meta) => `${meta.sourceId}/${meta.fieldId}（${meta.unit || '无单位'}，${meta.resolutionMinutes} 分钟）`)
    .join('；')
  return `序列目录 ${series.length} 条：${shown}${series.length > 6 ? '；其余略' : ''}`
}

/**
 * 把一个页面查询状态整理为协议区块；不满足纪律时返回 null（该区块不进上下文）：
 *   - 无结果 / 签名不一致（过期区块）→ null；
 *   - 无权（access denied）→ null：前端先整块退出，「有没有这份私有资料」本身是私有信息，
 *     约束层对 denied 也是整块退出（双保险）。
 */
export function insightAiBlockOf(source: InsightAiBlockSource): InsightAiEvidenceBlock | null {
  const { result } = source
  if (!result) return null
  if (source.queriedKey !== source.currentKey) return null // 过期区块：属于另一份读取，绝不提交
  const runtime = result.runtime
  if (runtime.access !== 'granted') return null
  const blockId = safeEvidenceId(source.blockId)

  const evidence: InsightAiEvidenceItem[] = []
  const version =
    result.resultVersion && result.readSetRef
      ? `分析 ${source.analysisId} 视图 ${source.view} 的结果版本 ${result.resultVersion}（读取版本集 ${result.readSetRef}）`
      : `分析 ${source.analysisId} 视图 ${source.view}（无结果版本引用）`
  evidence.push({
    id: `${blockId}.result`,
    text: `${version}；业务窗 ${result.businessWindow.start}~${result.businessWindow.end}；数据依据 ${result.basis}`,
  })
  const catalog = seriesCatalogText(result)
  if (catalog) evidence.push({ id: `${blockId}.series`, text: catalog })
  if (runtime.availability.state !== 'complete') {
    evidence.push({
      id: `${blockId}.availability`,
      text: `区块可用性 ${runtime.availability.state}${runtime.availability.reason ? `（原因：${runtime.availability.reason}）` : ''}；缺数或过期不得当零、不得冒当前`,
    })
  }
  const filters = filterSummaryText(source.filterSummary)
  if (filters) evidence.push({ id: `${blockId}.filters`, text: `筛选摘要：${filters}` })

  return {
    blockId,
    title: source.title,
    ...(source.objects?.length ? { objects: [...source.objects] } : {}),
    sourceRefs: (result.sourceRefs ?? []).map((ref) => ref.sourceId),
    evidence,
    runtime: {
      access: 'granted',
      availability: {
        state: runtime.availability.state,
        ...(runtime.availability.reason ? { reason: runtime.availability.reason } : {}),
      },
      freshness: { state: runtime.freshness.state },
    },
  }
}

// ── 注册组合式 ───────────────────────────────────────────────────────────────────────────

/** 四段结构的开场问题（CH03：事实→可能因素→已明确相关对象→待核实项）。 */
export function insightInterpretQuestion(label: string): string {
  return `请解读本页「${label}」：只基于本轮证据切片解读，按「事实→可能因素→已明确相关对象→待核实项」四段输出；` +
    '每条事实引用证据 id 并如实回标新鲜度，缺数说明原因、未提供字段不得当零，过期数据不冒当前，相关性不得表述为确定因果。'
}

export interface UseInsightAiPageOptions {
  /** 洞察页标识（INSIGHT_PAGE_PATHS 的六键之一） */
  pageId: InsightPageId
  /** 页面名：悬浮球提示、侧栏会话标题、开场问题共用 */
  label: string
  /**
   * 解读角色（后端页面提示词白名单 key）。洞察六页复用「市场数据分析」角色：后端白名单
   * 未新增洞察专用 key（15.4 约束层不扩提示词面），该角色的回看解读口径与洞察页一致。
   */
  promptKey?: PagePromptKey
  /** 开场问题；缺省用四段结构模板 */
  question?: AiQuestion
  /** 证据采集：页面从自身 viewStates 提取（经 insightAiBlockOf 只收当前签名结果） */
  collect: () => InsightAiEvidenceBlock[]
  /**
   * 上下文签名（如 () => String(ctx.contextVersion.value)）：/assemble 往返期间签名变化
   * 即作废本次解读，不带切换前的旧资料派发（切公司/改窗中途守卫）。
   */
  currentSignature?: () => string
  /** 快捷问题透传（侧边栏快捷区展示；可选） */
  presets?: AiPagePreset[]
}

export interface UseInsightAiPageReturn {
  /** AI 服务可用性：探活 offline 时为 false（页面据此隐藏 AI 入口；数据页不受影响） */
  aiAvailable: ComputedRef<boolean>
  /** 是否有当前签名一致的已就绪区块（决定入口是否可发起解读） */
  hasEvidence: ComputedRef<boolean>
  /** 页面「AI 解读本页」入口：先 /assemble 约束组装，成功才派发；失败诚实报错，不重试 */
  interpret: () => Promise<boolean>
}

export function useInsightAiPage(options: UseInsightAiPageOptions): UseInsightAiPageReturn {
  const route = useRoute()
  const ai = useAiSidebar()
  const promptKey = options.promptKey ?? PAGE_PROMPT_KEYS.marketDataAnalysis

  // 页面存活标记：与 defineAiPage 同一套 KeepAlive 生命周期。组装往返期间页面被切走/失活，
  // 采样的切片就不再代表用户眼前的页面，派发一律作废。
  const pageActive = ref(true)
  onMounted(() => { pageActive.value = true })
  onActivated(() => { pageActive.value = true })
  onDeactivated(() => { pageActive.value = false })
  onUnmounted(() => { pageActive.value = false })

  // 模型服务探活：离线只关 AI 入口（unknown 视为可用——探活未回来不先入为主地藏入口）。
  const { offline, check: checkAgentHealth } = useAgentHealth()
  const aiAvailable = computed(() => !offline.value)
  onMounted(() => { void checkAgentHealth() })
  onActivated(() => { if (offline.value) void checkAgentHealth() })

  /** 点击时刻的协议切片：经页面 collect（内部走 insightAiBlockOf 的签名纪律）。 */
  function sliceOf(): InsightAiEvidenceBlock[] {
    return options.collect()
  }

  const hasEvidence = computed(() => sliceOf().length > 0)

  function pageContext() {
    return buildPageContext({
      routePath: route.path,
      pageLabel: options.label,
      region: currentRegion.value,
      company: currentCompany.value,
    })
  }

  // 统一协议注册：悬浮球 / 侧边栏快捷问题共用。interpret.context 返回当前签名切片
  // （无已就绪结果时为 null：悬浮球按「打开 AI 助手」分岔，不发无据解读）。
  defineAiPage({
    label: options.label,
    promptKey,
    interpret: {
      context: () => {
        const blocks = sliceOf()
        return blocks.length ? { blocks } : null
      },
      question: options.question ?? insightInterpretQuestion(options.label),
    },
    presets: options.presets,
  })

  /**
   * 页面入口的解读动作：采集 → /assemble 约束组装 → 派发。
   * 任何一步不成立都诚实反馈并返回 false；/assemble 单次尝试，绝不自动重试。
   */
  async function interpret(): Promise<boolean> {
    if (offline.value) {
      ElMessage.warning('AI 服务未就绪，暂时无法解读本页；页面查询、分析与导出不受影响')
      return false
    }
    const blocks = sliceOf()
    if (!blocks.length) {
      ElMessage.info('当前没有已就绪的区块结果可解读；请先等待查询完成或选择有数据的窗口')
      return false
    }
    const signatureBefore = options.currentSignature?.() ?? null
    try {
      const envelope = await assembleInsightAiContext({ page_context: pageContext(), slice: { blocks } })
      // 组装往返期间口径或页面变了：这份信封属于点击前的旧读取，作废不派发。
      if (!pageActive.value || (signatureBefore !== null && options.currentSignature?.() !== signatureBefore)) {
        ElMessage.info('页面上下文已变化，本次解读未发起；请重新点击「AI 解读本页」')
        return false
      }
      ai.ask(resolveQuestion(options.question ?? insightInterpretQuestion(options.label)), {
        // 证据正文（blocks）与约束信封（四段契约/纪律/证据注册表）一起随轮下发：
        // 信封的注册表只有 id 与元数据，证据正文只在 blocks 里，缺一不可。
        context: { blocks, insight_ai_context: envelope },
        label: options.label,
        promptKey,
      })
      return true
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : '服务暂不可用'
      ElMessage.error(`AI 上下文组装失败：${reason}。本次解读未发起，可稍后重试；页面功能不受影响`)
      return false
    }
  }

  return { aiAvailable: aiAvailable as ComputedRef<boolean>, hasEvidence, interpret }
}
