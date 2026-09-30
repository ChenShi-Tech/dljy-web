// 「分解与场站」导引（dljy#3405）：带用户给「合同入门」建好的已确认电量合同补分时分解、
// 在分解集详情页校验确认，再看分时持仓，最后把电量分配到两个练习场站并在场站维度持仓里看生效。
// 每步：用户亲手操作、检测满足自动推进；「帮我填 / 帮我点 / 带我去」兜底。
// 所有 state/signal 完成判定都配了 recover：刷新后按服务端真实状态找回，不重复建数据。
// 覆盖月份一律取合同自己的正式月度分解（跨月继续也不漂移），不按日历现算——「合同入门」
// 建的合同交割月固定在它创建时会话里，本导引晚一个月开始也不能改用新的 M+1..M+3。
import type { GuideCtx, GuideDefinition, GuideStep } from '../types'
import { enterGuidePracticeSpace } from '../runner'
import { fillGuideForm, readGuideForm, readGuideState, submitGuideForm } from '../bridge'
import { ANCHOR, ARTIFACT, FORM, SIGNAL, STATE } from './anchors'
import { guideMonths, makeRunTag } from './examples'
import { makeExampleCurveFile, quantityToMicro, type CurveMonthSpec } from './curveFile'
import { monthFirstDay, monthLastDay } from '@/services/midlong/midlongTypes'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---- 各页面状态快照的形状（对应视图经 useGuideState 提供）----

type ContractsSnapshot = {
  practiceActive?: boolean
  canWrite?: boolean
  contracts?: Array<{ id: number; documentKind: string; externalContractNo: string; confirmationStatus?: string; stationId?: number | null }>
}

type DetailSnapshot = {
  contractId?: number
  documentKind?: string
  confirmationStatus?: string
}

type CurvesSnapshot = {
  contractId?: number
  months?: Array<{ month: string; timeStatus: string; monthlyFormalQuantity: string | null; formalCurveSetId: number | null }>
  sets?: Array<{ id: number; setNo: number; status: string; isCurrentRevision: boolean; blockingIssueCount: number }>
}

type CurveSetSnapshot = {
  curveSetId?: number
  contractId?: number
  status?: string
  blocking?: boolean
  coverage?: [string, string]
  monthStatuses?: Array<{ month: string; status: string }>
}

type StationsSnapshot = {
  contractId?: number
  totalQuantity?: string | null
  effectiveSetNos?: Record<string, number | null>
  drafts?: Array<{ id: number; allocationKind: string; blocking: boolean }>
}

type IntervalPositionsSnapshot = {
  fromDate?: string | null
  toDate?: string | null
  granularity?: string | null
  months?: string[]
  timeKnownMonths?: string[]
  drillDate?: string | null
}

type StationPositionsSnapshot = {
  fromMonth?: string | null
  toMonth?: string | null
  months?: string[]
  drillMonth?: string | null
}

function contractsSnapshot(): ContractsSnapshot | null {
  return readGuideState(STATE.contracts) as ContractsSnapshot | null
}
function detailSnapshot(): DetailSnapshot | null {
  return readGuideState(STATE.contractDetail) as DetailSnapshot | null
}
function curvesSnapshotFor(ctx: GuideCtx): CurvesSnapshot | null {
  const snap = readGuideState(STATE.curves) as CurvesSnapshot | null
  const known = ctx.artifacts[ARTIFACT.guideObligationId]
  // KeepAlive 下可能残留另一份合同的快照：认得起点合同之后就只认它的。
  if (snap && typeof known === 'number' && snap.contractId !== known) return null
  return snap
}
function curveSetSnapshotFor(ctx: GuideCtx): CurveSetSnapshot | null {
  const snap = readGuideState(STATE.curveSet) as CurveSetSnapshot | null
  const known = ctx.artifacts[ARTIFACT.guideObligationId]
  if (snap && typeof known === 'number' && snap.contractId !== known) return null
  return snap
}
function stationsSnapshotFor(ctx: GuideCtx): StationsSnapshot | null {
  const snap = readGuideState(STATE.contractStations) as StationsSnapshot | null
  const known = ctx.artifacts[ARTIFACT.guideObligationId]
  if (snap && typeof known === 'number' && snap.contractId !== known) return null
  return snap
}
function intervalSnapshot(): IntervalPositionsSnapshot | null {
  return readGuideState(STATE.intervalPositions) as IntervalPositionsSnapshot | null
}
function stationPositionsSnapshot(): StationPositionsSnapshot | null {
  return readGuideState(STATE.stationPositions) as StationPositionsSnapshot | null
}

// ---- 覆盖月份：取合同自己的正式月度分解月份（capture / 使用时懒记录，跨月继续不漂移）----

const validMonths = (value: unknown): value is [string, string, ...string[]] =>
  Array.isArray(value) && value.length >= 1 && value.every((m) => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m))

function coverageMonthsFor(ctx: GuideCtx): string[] {
  const fixed = ctx.artifacts[ARTIFACT.coverageMonths]
  if (validMonths(fixed)) return fixed
  const snap = curvesSnapshotFor(ctx)
  const months = (snap?.months ?? []).filter((m) => m.monthlyFormalQuantity !== null).map((m) => m.month)
  if (months.length) {
    ctx.artifacts[ARTIFACT.coverageMonths] = months
    return months
  }
  // 兜底：合同信息还没加载出来时按日历现算（正常到不了这里——导入步骤都在分解面板加载后）。
  return guideMonths()
}

function monthQuantitiesFor(ctx: GuideCtx): CurveMonthSpec[] {
  const snap = curvesSnapshotFor(ctx)
  const months = coverageMonthsFor(ctx)
  return months
    .map((month) => ({ month, quantityMicro: quantityToMicro((snap?.months ?? []).find((m) => m.month === month)?.monthlyFormalQuantity) }))
    .filter((spec): spec is CurveMonthSpec & { quantityMicro: number } => spec.quantityMicro !== null && spec.quantityMicro > 0)
}

const firstLast = (months: string[]): [string, string] => [months[0], months[months.length - 1]]

// ---- 起点合同：已确认、场站未分配的电量合同 ----

const isObligationConfirmed = (row: { documentKind?: string; confirmationStatus?: string }): boolean =>
  row.documentKind === 'OBLIGATION' && row.confirmationStatus === 'CONFIRMED'

function findStartContract(ctx: GuideCtx): { id: number; externalContractNo: string } | null {
  const rows = contractsSnapshot()?.contracts ?? []
  const known = ctx.artifacts[ARTIFACT.guideObligationId]
  const usable = rows.filter((row) => isObligationConfirmed(row) && row.stationId == null)
  const hit = usable.find((row) => row.id === known) ?? usable[0]
  return hit ? { id: hit.id, externalContractNo: hit.externalContractNo } : null
}

const detailQualifies = (snap: DetailSnapshot | null): boolean => Boolean(snap?.contractId && isObligationConfirmed(snap))

// ---- 第 1 章恢复：合同已有可用的分时分解（已确认覆盖全部月份，或有可通过校验的当前版本草稿）----

function formalCurvesComplete(ctx: GuideCtx): boolean {
  const snap = curvesSnapshotFor(ctx)
  const months = coverageMonthsFor(ctx)
  return months.every((month) => (snap?.months ?? []).some((m) => m.month === month && m.formalCurveSetId !== null))
}

function usableDraftExists(ctx: GuideCtx): boolean {
  return (curvesSnapshotFor(ctx)?.sets ?? []).some((s) => s.status === 'DRAFT' && s.isCurrentRevision && s.blockingIssueCount === 0)
}

const curvesReady = (ctx: GuideCtx): boolean => formalCurvesComplete(ctx) || usableDraftExists(ctx)
const curveSetConfirmed = (ctx: GuideCtx): boolean => curveSetSnapshotFor(ctx)?.status === 'CONFIRMED'

// ---- 第 4 章恢复：正式交易分配已确认（或有可通过校验的草稿）----

function formalAllocationConfirmed(ctx: GuideCtx): boolean {
  const setNos = stationsSnapshotFor(ctx)?.effectiveSetNos ?? {}
  return setNos.FORMAL_TRADING != null
}

function formalDraftExists(ctx: GuideCtx): boolean {
  return (stationsSnapshotFor(ctx)?.drafts ?? []).some((d) => d.allocationKind === 'FORMAL_TRADING' && !d.blocking)
}

const allocationReady = (ctx: GuideCtx): boolean => formalAllocationConfirmed(ctx) || formalDraftExists(ctx)

// ---- 信号 match / 路由 match ----

const isNonBlockingDraft = (payload: unknown): boolean => (payload as { blocking?: boolean } | null)?.blocking === false
const isCurveDetailRoute = (route: { path: string }): boolean => /^\/zcqjy\/curves\/\d+/.test(route.path)
const isContractDetailRoute = (route: { path: string }): boolean => /^\/zcqjy\/contracts\/\d+/.test(route.path)

// ---- capture ----

function captureStartContract(payload: unknown, ctx: GuideCtx): void {
  const fromPath = /\/zcqjy\/contracts\/(\d+)/.exec((payload as { path?: string } | null)?.path ?? '')
  if (fromPath) {
    ctx.artifacts[ARTIFACT.guideObligationId] = Number(fromPath[1])
    return
  }
  const snap = payload as DetailSnapshot | null
  if (typeof snap?.contractId === 'number') ctx.artifacts[ARTIFACT.guideObligationId] = snap.contractId
}

function captureCurveSetId(payload: unknown, ctx: GuideCtx): void {
  const p = payload as { curveSetId?: number } | null
  if (typeof p?.curveSetId === 'number' && p.curveSetId > 0) ctx.artifacts[ARTIFACT.curveSetId] = p.curveSetId
}

// ---- 「带我去」导航：先跳转，等页面表单挂载后用 fill+submit 纠正 KeepAlive 可能保留的旧筛选 ----

const nonEmpty = (value: unknown): boolean => String(value ?? '').trim() !== ''

async function goIntervalPositions(ctx: GuideCtx): Promise<void> {
  const months = coverageMonthsFor(ctx)
  const fromDate = monthFirstDay(months[0]) ?? `${months[0]}-01`
  const toDate = monthLastDay(months[months.length - 1]) ?? `${months[months.length - 1]}-28`
  ctx.go({ path: '/zcqjy/positions/intervals', query: { fromDate, toDate, granularity: 'DAY' } })
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !readGuideForm(FORM.intervalFilters)) await sleep(200)
  fillGuideForm(FORM.intervalFilters, { dateRange: [fromDate, toDate], granularity: 'DAY', asOf: '', subjectId: '' })
  await submitGuideForm(FORM.intervalFilters)
}

async function goStationPositions(ctx: GuideCtx): Promise<void> {
  const [first, last] = firstLast(coverageMonthsFor(ctx))
  ctx.go({ path: '/zcqjy/positions/stations', query: { fromMonth: first, toMonth: last } })
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !readGuideForm(FORM.stationPositionsFilters)) await sleep(200)
  fillGuideForm(FORM.stationPositionsFilters, { monthRange: [first, last], allocationKind: 'FORMAL_TRADING', asOf: '', subjectId: '' })
  await submitGuideForm(FORM.stationPositionsFilters)
}

// ---- 分配行示例：按交割月分配，每个月两个练习场站对半（整数微单位算，避免浮点尾数）----

function allocationRowsExample(ctx: GuideCtx): Array<{ stationId: number | null; segmentMonth: string; quantity: string }> {
  const seeded = ctx.artifacts[ARTIFACT.practiceStationIds]
  const stationIds = Array.isArray(seeded) ? (seeded as number[]).slice(0, 2) : []
  const months = coverageMonthsFor(ctx)
  const totalMicro = quantityToMicro(stationsSnapshotFor(ctx)?.totalQuantity) ?? 0
  // 月总额：前面的月吃整除部分，最后一个月拿尾差，合计与合同电量严格相等。
  const monthBase = Math.floor(totalMicro / months.length)
  const rows: Array<{ stationId: number | null; segmentMonth: string; quantity: string }> = []
  months.forEach((month, index) => {
    const monthMicro = index === months.length - 1 ? totalMicro - monthBase * (months.length - 1) : monthBase
    const half = Math.floor(monthMicro / 2)
    rows.push({ stationId: stationIds[0] ?? null, segmentMonth: month, quantity: microText(half) })
    rows.push({ stationId: stationIds[1] ?? null, segmentMonth: month, quantity: microText(monthMicro - half) })
  })
  return rows
}

/** 整数微单位 → 去尾零的小数文本（导引文案与示例值统一用它）。 */
function microText(micro: number): string {
  const text = `${Math.floor(Math.abs(micro) / 1_000_000)}.${String(Math.abs(micro) % 1_000_000).padStart(6, '0')}`
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0'
}

// ---- 步骤 ----

const steps: GuideStep[] = [
  // 章 0：进入练习空间
  {
    id: '0-0', chapter: 0, route: '/zcqjy/contracts',
    title: '给已确认的电量合同补分解、分场站',
    body: (ctx) => `这条导引接着「合同入门」往下走：给那份已核验确认的电量合同导入分时曲线 → 确认分解集 → 看分时持仓 → 把电量分配到两个练习场站 → 在场站维度持仓里看生效。\n点下面的按钮进入练习空间【练习】公司（本次运行标签 ${ctx.runTag}）。`,
    advance: { kind: 'state', state: STATE.contracts, done: (snap) => {
      const s = snap as ContractsSnapshot | null
      return !!s?.practiceActive && !!s.canWrite
    } },
    assist: { kind: 'action', label: '进入练习空间并开始', run: () => enterGuidePracticeSpace() },
    recover: (): boolean => {
      const snap = contractsSnapshot()
      return !!snap?.practiceActive && !!snap.canWrite
    },
  },
  {
    id: '0-1', chapter: 0, route: '/zcqjy/contracts',
    target: ANCHOR.practiceBadge, within: 'page', placement: 'bottom',
    title: '已进入练习空间',
    body: '顶栏的【练习】徽标表示当前在练习公司里操作。导引期间请保持在这个公司；离开会自动暂停，回来可以继续。',
    advance: { kind: 'manual' },
  },

  // 章 1：分时分解（导入曲线）
  {
    id: '1-0', chapter: 1, route: '/zcqjy/contracts',
    title: '找到那份电量合同',
    body: (ctx) => {
      const hit = findStartContract(ctx)
      return hit
        ? `打开已核验确认、场站未分配的电量合同（「合同入门」建的那份，编号 ${hit.externalContractNo}）。点「带我去」直接打开。`
        : `练习公司里还没有「已确认、场站未分配」的电量合同。请先运行「合同入门」建一份，再回到这条导引；或点「带我去」去合同列表找。`
    },
    advance: {
      kind: 'any',
      of: [
        { kind: 'route', match: isContractDetailRoute },
        // KeepAlive 可能残留详情快照：认得起点合同后只认它；没认过时任何「已确认电量合同」详情都算（F5 恢复场景）。
        { kind: 'state', state: STATE.contractDetail, done: (snap, ctx) => detailQualifies(snap as DetailSnapshot | null) && (ctx.artifacts[ARTIFACT.guideObligationId] == null || (snap as DetailSnapshot).contractId === ctx.artifacts[ARTIFACT.guideObligationId]) },
      ],
    },
    assist: { kind: 'navigate', to: (ctx) => {
      const hit = findStartContract(ctx)
      if (hit) ctx.artifacts[ARTIFACT.guideObligationId] = hit.id
      return { path: `/zcqjy/contracts/${hit?.id ?? ''}` }
    } },
    capture: captureStartContract,
    recover: (ctx): boolean => {
      const detail = detailSnapshot()
      if (detailQualifies(detail) && (ctx.artifacts[ARTIFACT.guideObligationId] == null || detail!.contractId === ctx.artifacts[ARTIFACT.guideObligationId])) {
        ctx.artifacts[ARTIFACT.guideObligationId] = detail!.contractId
        return true
      }
      const hit = findStartContract(ctx)
      if (hit) {
        ctx.artifacts[ARTIFACT.guideObligationId] = hit.id
        return true
      }
      return false
    },
  },
  {
    id: '1-1', chapter: 1, target: ANCHOR.curvesImportBtn, within: 'page', placement: 'bottom',
    title: '打开「导入曲线」',
    body: '分时分解在合同详情页的「分时分解」区登记。合同必须先核验确认（未确认版本的电量还会变）。点「导入曲线」；旁边的「生成估算」只产出内部估算、不计入正式持仓，这条导引走正式路径。',
    advance: { kind: 'visible', target: ANCHOR.curveFile, within: 'dialog' },
    assist: { kind: 'click' },
    recover: curvesReady,
  },
  {
    id: '1-2', chapter: 1, target: ANCHOR.curveFile, within: 'dialog', resumeTo: '1-1',
    title: '选择曲线文件',
    body: '真实使用时点「下载 CSV 模板」，按模板逐时段填好再上传。练习直接点「帮我填」：会生成一份教学示例 CSV（北京时间 24 点/日、单位 MWh，每月合计与正式月度分解严格相等——不守恒的曲线不能确认）。',
    advance: { kind: 'form', form: FORM.curveImport, settleMs: 0, done: (v) => v.file instanceof File, missing: (v) => (v.file instanceof File ? [] : ['选择曲线文件']) },
    assist: { kind: 'fill', form: FORM.curveImport, values: (ctx) => {
      const specs = monthQuantitiesFor(ctx)
      return { format: 'csv', file: specs.length ? makeExampleCurveFile(specs, ctx) : null }
    } },
    recover: curvesReady,
  },
  {
    id: '1-3', chapter: 1, target: ANCHOR.curveGranularity, within: 'dialog', resumeTo: '1-1',
    title: '原始粒度',
    body: '声明文件里曲线的时间粒度，不默认。示例文件是 1 小时粒度（每天 24 个时段）。',
    advance: { kind: 'form', form: FORM.curveImport, settleMs: 0, done: (v) => v.granularityMinutes === 60 },
    assist: { kind: 'fill', form: FORM.curveImport, values: () => ({ granularityMinutes: 60 }) },
    recover: curvesReady,
  },
  {
    id: '1-4', chapter: 1, target: ANCHOR.curveUnit, within: 'dialog', resumeTo: '1-1',
    title: '单位',
    body: '声明数值的单位：功率（MW、kW）按时长换算，电量（MWh、kWh）按固定系数换算。示例文件用的是 MWh。',
    advance: { kind: 'form', form: FORM.curveImport, settleMs: 0, done: (v) => v.unit === 'MWh' },
    assist: { kind: 'fill', form: FORM.curveImport, values: () => ({ unit: 'MWh' }) },
    recover: curvesReady,
  },
  {
    id: '1-5', chapter: 1, target: ANCHOR.curveTimezone, within: 'dialog', resumeTo: '1-1',
    title: '原始时区',
    body: '时区必须显式声明、不默认——同一份时刻表在不同时区指向不同时段。示例文件按北京时间填写，选 Asia/Shanghai。',
    advance: { kind: 'form', form: FORM.curveImport, settleMs: 0, done: (v) => v.sourceTimezone === 'Asia/Shanghai' },
    assist: { kind: 'fill', form: FORM.curveImport, values: () => ({ sourceTimezone: 'Asia/Shanghai' }) },
    recover: curvesReady,
  },
  {
    id: '1-6', chapter: 1, target: ANCHOR.curveCoverage, within: 'dialog', resumeTo: '1-1', placement: 'right',
    title: '覆盖月份',
    body: (ctx) => {
      const months = coverageMonthsFor(ctx)
      return `声明这份曲线覆盖哪些交割月，必须落在合同交割期内：${months[0]} 至 ${months[months.length - 1]}（即这份合同的正式月度分解月份 ${months.join('、')}）。示例文件恰好覆盖这些月份的每一个时段。`
    },
    advance: { kind: 'form', form: FORM.curveImport, settleMs: 0, done: (v, ctx) => {
      const months = coverageMonthsFor(ctx)
      return Array.isArray(v.coverage) && v.coverage.length === 2 && v.coverage[0] === months[0] && v.coverage[1] === months[months.length - 1]
    } },
    assist: { kind: 'fill', form: FORM.curveImport, values: (ctx) => ({ coverage: firstLast(coverageMonthsFor(ctx)) }) },
    recover: curvesReady,
  },
  {
    id: '1-7', chapter: 1, target: ANCHOR.curveBasis, within: 'dialog', resumeTo: '1-1', placement: 'right',
    title: '文件性质',
    body: '正式曲线声明为「电子交易确认单」或「交易中心导出」时，确认这份分解集会把曲线文件自动登记为合同资料并作为依据，不用再手选。练习选「电子交易确认单」；「依据资料」可留空，说明框帮你标注了教学示例。',
    advance: { kind: 'form', form: FORM.curveImport, settleMs: 0, done: (v) => v.sourceDocumentType === 'ELECTRONIC_CONFIRMATION' },
    assist: { kind: 'fill', form: FORM.curveImport, values: (ctx) => ({ sourceDocumentType: 'ELECTRONIC_CONFIRMATION', note: `教学示例曲线（操作导引 ${ctx.runTag} 生成）` }) },
    recover: curvesReady,
  },
  {
    id: '1-8', chapter: 1, target: ANCHOR.curveSubmit, within: 'dialog', resumeTo: '1-1', placement: 'bottom',
    title: '保存草稿并校验',
    body: '提交后系统逐月核对：曲线合计与正式月度分解严格相等（容差 0，不缩放、不补零），缺段、越界都是阻断问题。校验通过也只是草稿——确认在分解集详情页完成。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.curveDraftCreated, match: isNonBlockingDraft },
        { kind: 'state', state: STATE.curves, done: (snap, ctx) => usableDraftExists(ctx) || formalCurvesComplete(ctx) },
      ],
    },
    assist: { kind: 'click' },
    capture: captureCurveSetId,
    recover: curvesReady,
  },
  {
    id: '1-9', chapter: 1,
    title: '去分解集详情页',
    body: '草稿已保存。点结果里的「查看分解集并确认」，或点「带我去」。',
    advance: { kind: 'route', match: isCurveDetailRoute },
    assist: { kind: 'navigate', to: (ctx) => ({ path: `/zcqjy/curves/${ctx.artifacts[ARTIFACT.curveSetId] ?? ''}` }) },
    recover: (ctx): boolean => {
      const snap = curveSetSnapshotFor(ctx)
      return Boolean(snap?.curveSetId)
    },
  },

  // 章 2：分解集详情页校验与确认
  {
    id: '2-0', chapter: 2, target: ANCHOR.curvesetChecks, within: 'page', placement: 'top',
    title: '核对守恒',
    body: (ctx) => {
      const months = coverageMonthsFor(ctx)
      return `「守恒核对」逐月对比曲线合计与正式月度分解，每月都必须是「守恒」（${months.join('、')}），时段一个不缺。有不守恒或缺段只能回到原始资料重新导入，系统不会自动补零或缩放。`
    },
    advance: { kind: 'state', state: STATE.curveSet, done: (snap, ctx) => {
      const s = snap as CurveSetSnapshot | null
      if (!s || s.blocking) return false
      const months = coverageMonthsFor(ctx)
      const statuses = new Map((s.monthStatuses ?? []).map((m) => [m.month, m.status]))
      return months.every((month) => statuses.get(month) === 'CONSERVED')
    } },
    recover: curveSetConfirmed,
  },
  {
    id: '2-1', chapter: 2, target: ANCHOR.curvesetConfirm, within: 'page', placement: 'bottom',
    title: '确认这份分解集',
    body: '校验通过后「确认」可点。点它打开确认对话框。',
    advance: { kind: 'visible', target: ANCHOR.curvesetEvidence, within: 'dialog' },
    assist: { kind: 'click' },
    recover: curveSetConfirmed,
  },
  {
    id: '2-2', chapter: 2, target: ANCHOR.curvesetEvidence, within: 'dialog', resumeTo: '2-1', placement: 'right',
    title: '依据资料',
    body: '正式分解必须挂依据。导入时文件性质声明为「电子交易确认单」，确认时这份曲线文件会自动登记为合同资料并作为依据，所以这里不用再选；说明可留空。看完点「下一步」。',
    advance: { kind: 'manual' },
    recover: curveSetConfirmed,
  },
  {
    id: '2-3', chapter: 2, target: ANCHOR.curvesetConfirm, within: 'dialog', resumeTo: '2-1', placement: 'bottom',
    title: '确认',
    body: '确认后按月计入正式分时持仓；同月已有的旧分解集保留在历史视图。',
    advance: { kind: 'state', state: STATE.curveSet, done: (snap) => (snap as CurveSetSnapshot | null)?.status === 'CONFIRMED' },
    assist: { kind: 'click' },
    recover: curveSetConfirmed,
  },

  // 章 3：分时持仓
  {
    id: '3-0', chapter: 3,
    title: '去看分时持仓',
    body: (ctx) => {
      const months = coverageMonthsFor(ctx)
      return `分时分解已确认，到「分时持仓」看它生效：日期范围 ${months[0]}-01 ~ ${months[months.length - 1]} 月末、粒度「日」（三个月按小时查超出单次上限），点「带我去」会带上查询条件。`
    },
    advance: { kind: 'state', state: STATE.intervalPositions, done: (snap, ctx) => {
      const s = snap as IntervalPositionsSnapshot | null
      const months = coverageMonthsFor(ctx)
      return Boolean(s && s.granularity === 'DAY' && s.fromDate === (monthFirstDay(months[0]) ?? `${months[0]}-01`) && s.toDate === (monthLastDay(months[months.length - 1]) ?? ''))
    } },
    assist: { kind: 'action', label: '带我去', run: (ctx) => goIntervalPositions(ctx) },
    recover: (ctx): boolean => {
      const s = intervalSnapshot()
      const months = coverageMonthsFor(ctx)
      return Boolean(s && s.granularity === 'DAY' && s.fromDate === (monthFirstDay(months[0]) ?? `${months[0]}-01`) && s.toDate === (monthLastDay(months[months.length - 1]) ?? ''))
    },
  },
  {
    id: '3-1', chapter: 3, target: ANCHOR.intervalFiltersDate, within: 'page', placement: 'bottom',
    title: '日期范围与粒度',
    body: '分时持仓只按已确认的正式分时分解汇总。只有月量、没有分时的合同在图上显示灰色「分时未知」底带——不补零、不均摊。',
    advance: { kind: 'manual' },
    recover: (): boolean => intervalSnapshot()?.granularity === 'DAY',
  },
  {
    id: '3-2', chapter: 3, target: ANCHOR.intervalBuckets, within: 'page', placement: 'top',
    title: '这份合同已有正式分时',
    body: (ctx) => {
      const months = coverageMonthsFor(ctx)
      return `「合同分时状态」里这份合同的 ${months.join('、')} 应显示「已有正式分时」，时段明细里的电量就是刚才那条曲线按月计入的。`
    },
    advance: { kind: 'state', state: STATE.intervalPositions, done: (snap, ctx) => {
      const s = snap as IntervalPositionsSnapshot | null
      return coverageMonthsFor(ctx).every((month) => (s?.timeKnownMonths ?? []).includes(month))
    } },
    recover: (ctx): boolean => {
      const s = intervalSnapshot()
      return coverageMonthsFor(ctx).every((month) => (s?.timeKnownMonths ?? []).includes(month))
    },
  },
  {
    id: '3-3', chapter: 3, target: ANCHOR.intervalDrill, within: 'page', placement: 'top',
    title: '点开一个时段',
    body: '在「时段明细」里点任意一行，钻取区列出该时段每份合同的贡献与所用分解集（可一路点进原始曲线行）。',
    advance: { kind: 'state', state: STATE.intervalPositions, done: (snap) => nonEmpty((snap as IntervalPositionsSnapshot | null)?.drillDate) },
    recover: (): boolean => nonEmpty(intervalSnapshot()?.drillDate),
  },

  // 章 4：场站分配
  {
    id: '4-0', chapter: 4, target: ANCHOR.stationsPanel, within: 'page', placement: 'top',
    title: '回到合同详情，打开场站分配',
    body: '电量现在挂在交易主体名下（主体统签），还没落到场站。回合同详情的「场站分配」区，点「登记正式交易分解」。',
    advance: { kind: 'visible', target: ANCHOR.allocType, within: 'dialog' },
    assist: { kind: 'click' },
    recover: allocationReady,
  },
  {
    id: '4-1', chapter: 4, target: ANCHOR.allocType, within: 'dialog', resumeTo: '4-0', placement: 'right',
    title: '分配类型与片段',
    body: '「正式交易分解」是给交易与结算看的正式口径；「内部经营分配」是内部口径、单独展示。「分配片段」选「按交割月」——每个月单独分；「按合同总量」整笔分但拆不到月份，场站持仓里会记成「月份未分到场站」。这里保持默认的正式交易分解，把片段切成按交割月，看完点「下一步」。',
    advance: { kind: 'manual' },
    recover: allocationReady,
  },
  {
    id: '4-2', chapter: 4, target: ANCHOR.allocRows, within: 'dialog', resumeTo: '4-0', placement: 'right',
    title: '分给两个练习场站',
    body: (ctx) => {
      const months = coverageMonthsFor(ctx)
      const seeded = ctx.artifacts[ARTIFACT.practiceStationIds]
      const enough = Array.isArray(seeded) && (seeded as number[]).length >= 2
      return `每个月加两行：两个练习场站各分该月的一半（示例按合同电量均分到 ${months.join('、')} 再对半）。同一片段的分配合计不得超过该月电量，余额始终显示在下方。${enough ? '' : '\n（练习场站清单还没取到，请手选场站。）'}`
    },
    advance: { kind: 'form', form: FORM.stationAllocation, settleMs: 800, done: (v) =>
      Array.isArray(v.rows) && v.rows.length >= 2
      && v.rows.every((row: { stationId: unknown; segmentMonth: unknown; quantity: unknown }) => row.stationId != null && nonEmpty(row.segmentMonth) && quantityToMicro(row.quantity) !== null && quantityToMicro(row.quantity)! > 0)
      && v.blocking === false,
      missing: (v) => {
        const rows = Array.isArray(v.rows) ? (v.rows as Array<{ stationId: unknown; segmentMonth: unknown; quantity: unknown }>) : []
        return [
          rows.length >= 2 ? '' : '第二行场站（点「+ 添加场站」）',
          rows.every((r) => r.stationId != null) ? '' : '每行选场站',
          rows.every((r) => nonEmpty(r.segmentMonth)) ? '' : '按交割月分配时每行选月份',
          rows.every((r) => quantityToMicro(r.quantity) !== null && quantityToMicro(r.quantity)! > 0) ? '' : '每行填电量',
          v.blocking === false ? '' : '分配合计超出片段电量，先调小',
        ].filter(Boolean)
      },
    },
    assist: { kind: 'fill', form: FORM.stationAllocation, values: (ctx) => ({ segmentMode: 'MONTHLY', rows: allocationRowsExample(ctx) }) },
    recover: allocationReady,
  },
  {
    id: '4-3', chapter: 4, target: ANCHOR.allocEvidence, within: 'dialog', resumeTo: '4-0', placement: 'left',
    title: '依据资料',
    body: '正式交易分解必须挂合同已有资料（合同入门补的电子交易确认单就在这里选）。没有可选依据时先回详情「补充资料」再来。',
    advance: { kind: 'form', form: FORM.stationAllocation, settleMs: 0, done: (v) => Array.isArray(v.evidenceIds) && v.evidenceIds.length > 0 },
    assist: { kind: 'fill', form: FORM.stationAllocation, values: (_ctx, current) => {
      const options = (current?.evidenceOptions as number[] | undefined) ?? []
      return { evidenceIds: options.length ? [options[0]] : [] }
    } },
    recover: allocationReady,
  },
  {
    id: '4-4', chapter: 4, target: ANCHOR.allocBalance, within: 'dialog', resumeTo: '4-0', placement: 'top',
    title: '片段余额预览',
    body: '「合同总量」片段的电量 = 已分配 + 未分配。超额会标红且不能确认；保存草稿不改变场站维度持仓。看完点「下一步」。',
    advance: { kind: 'manual' },
    recover: allocationReady,
  },
  {
    id: '4-5', chapter: 4, target: ANCHOR.allocSave, within: 'dialog', resumeTo: '4-0', placement: 'bottom',
    title: '保存草稿并校验',
    body: '保存后按钮换成「确认分配」——同一套「先草稿、再确认」的节奏：草稿随时可废弃重来，确认才生效。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.allocationDraftSaved, match: isNonBlockingDraft },
        { kind: 'form', form: FORM.stationAllocation, settleMs: 0, done: (v) => typeof v.draftSetNo === 'number' },
      ],
    },
    assist: { kind: 'click' },
    recover: allocationReady,
  },
  {
    id: '4-6', chapter: 4, target: ANCHOR.allocConfirm, within: 'dialog', resumeTo: '4-0', placement: 'bottom',
    title: '确认分配',
    body: '确认后这份正式交易分解生效，替换同类旧分配（整套快照）。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.allocationConfirmed },
        { kind: 'state', state: STATE.contractStations, done: (_snap, ctx) => formalAllocationConfirmed(ctx) },
      ],
    },
    assist: { kind: 'click' },
    recover: formalAllocationConfirmed,
  },
  {
    id: '4-7', chapter: 4, target: ANCHOR.stationsPanel, within: 'page', placement: 'top',
    title: '分配已生效',
    body: '回到详情页：正式交易分解显示生效分配集与逐片段余额，未分配余额变成 0。',
    advance: { kind: 'manual' },
    recover: formalAllocationConfirmed,
  },

  // 章 5：场站维度持仓
  {
    id: '5-0', chapter: 5,
    title: '去看场站维度持仓',
    body: (ctx) => {
      const [first, last] = firstLast(coverageMonthsFor(ctx))
      return `到「场站维度持仓」看拆分结果：月份 ${first} ~ ${last}、正式交易分解口径。主体合计 = 场站份额 + 未分配 + 月份未分到场站，页面只展示这条拆分、不相加。`
    },
    advance: { kind: 'state', state: STATE.stationPositions, done: (snap, ctx) => {
      const s = snap as StationPositionsSnapshot | null
      const [first, last] = firstLast(coverageMonthsFor(ctx))
      return Boolean(s && s.fromMonth === first && s.toMonth === last)
    } },
    assist: { kind: 'action', label: '带我去', run: (ctx) => goStationPositions(ctx) },
    recover: (ctx): boolean => {
      const s = stationPositionsSnapshot()
      const [first, last] = firstLast(coverageMonthsFor(ctx))
      return Boolean(s && s.fromMonth === first && s.toMonth === last)
    },
  },
  {
    id: '5-1', chapter: 5, target: ANCHOR.stationPositionsTable, within: 'page', placement: 'top',
    title: '点开 M+1 月',
    body: (ctx) => {
      const months = coverageMonthsFor(ctx)
      return `「逐月拆分」里点 ${months[0]} 那一行：该月电量按两个练习场站的份额拆开，钻取区能看每份合同的分配来源。`
    },
    advance: { kind: 'state', state: STATE.stationPositions, done: (snap, ctx) => (snap as StationPositionsSnapshot | null)?.drillMonth === coverageMonthsFor(ctx)[0] },
    recover: (ctx): boolean => stationPositionsSnapshot()?.drillMonth === coverageMonthsFor(ctx)[0],
  },
  {
    id: '5-2', chapter: 5, finishing: true,
    title: '完成',
    body: '全流程走完了：分时曲线导入 → 守恒校验与确认 → 分时持仓 → 场站分配（草稿 → 确认）→ 场站维度持仓。\n数据留在练习公司，不影响集团汇总；想再练一遍，先回「合同入门」新建一份合同（本条导引会认「已确认、场站未分配」的那份），或直接重开本导引换一份合同。',
    advance: { kind: 'manual' },
  },
]

export const allocationStationsGuide: GuideDefinition = {
  id: 'midlong.allocation-stations',
  group: 'midlong',
  title: '分解与场站',
  summary: '给已确认的电量合同导入分时曲线、确认分解集，再把电量分配到场站，看分时与场站两个维度的持仓。',
  status: 'ready',
  makeRunTag,
  initArtifacts: () => ({ [ARTIFACT.guideMonths]: guideMonths() }),
  requires: [ANCHOR.curvesPanel, ANCHOR.stationsPanel, ANCHOR.positionsIntervalsLink, ANCHOR.positionsStationsLink],
  needsWrite: true,
  steps,
}
