// 「计划与交易执行」导引（dljy#3406）：带用户走一遍售电目标 → 交易公告 → 交易方案（测算、确认可执行建占用）→
// 导出申报材料与登记外部提交 → 成交确认单（确认成交、关联方案）→ 回计划页看完成率与占用 → 月度持仓看新义务。
// 每步：用户亲手操作、检测满足自动推进；「帮我填 / 帮我点 / 带我去」兜底。
// 各章 recover 按服务端真实状态找回（练习公司里已存在的公告/方案/确认单即视为该章已完成），刷新不重复建数据。
// 多个对话框是「登记后不关闭、显示结果、按钮换完成」模式：完成判定一律以推进信号 / 服务端状态为准，不以弹窗关闭为准。
import type { GuideCtx, GuideDefinition, GuideStep } from '../types'
import { enterGuidePracticeSpace } from '../runner'
import { findGuideTarget } from '../targets'
import { readGuideState } from '../bridge'
import { ANCHOR, ARTIFACT, FORM, SIGNAL, STATE } from './anchors'
import { guideMonths, makeRunTag, tagClock } from './examples'
import { makeExampleEvidenceFile } from './evidenceFile'
import { isPeriodKey, type PlanPeriodType } from '@/services/midlong/midlongP3Types'
import { isCompleteBeijingDateTimeInput } from '@/services/midlong/midlongP3Types'
import { monthLastDay } from '@/services/midlong/midlongTypes'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const nonEmpty = (value: unknown): boolean => String(value ?? '').trim() !== ''

// ---- 页面快照形状（对应视图经 useGuideState 提供）----

type ContractsSnapshot = { practiceActive?: boolean; canWrite?: boolean }

type PlansSnapshot = {
  canWrite?: boolean
  targets?: Array<{ id: number; subjectId: number; periodKey: string; confirmedRevisionNo: number | null; draftRevisionNo: number | null; openOccupationQuantity: string; knownSoldQuantity: string | null }>
  proposals?: Array<{ id: number; status: string }>
}

type ExecutionSnapshot = {
  canWrite?: boolean
  executionsEnabled?: boolean
  windows?: Array<{ id: number; name: string }>
  proposals?: Array<{ id: number; status: string }>
  confirmations?: Array<{ id: number; resultStatus: string }>
}

function plansSnapshotFor(_ctx: GuideCtx): PlansSnapshot | null {
  return readGuideState(STATE.plans) as PlansSnapshot | null
}
function executionSnapshotFor(_ctx: GuideCtx): ExecutionSnapshot | null {
  return readGuideState(STATE.execution) as ExecutionSnapshot | null
}

// ---- 本次导引的交割月份与示例值（会话开始固定，跨月继续不漂移）----

function monthsFor(ctx: GuideCtx): [string, string, string] {
  const fixed = ctx.artifacts[ARTIFACT.executionMonths]
  if (Array.isArray(fixed) && fixed.length === 3 && fixed.every((m) => typeof m === 'string')) return fixed as [string, string, string]
  const months = guideMonths()
  ctx.artifacts[ARTIFACT.executionMonths] = months
  return months
}

/** 申报截止示例：最后一个交割月末 10:00（北京时间，完整到时分——BeijingDateTimeInput 不接受只有日期）。 */
function deadlineExample(ctx: GuideCtx): string {
  const months = monthsFor(ctx)
  return `${monthLastDay(months[2]) ?? `${months[2]}-28`} 10:00`
}

const DECLARATION_TIME_COMPLETE = (value: unknown): boolean => isCompleteBeijingDateTimeInput(String(value ?? ''))

/** 导引示例的「教学演示」操作人（练习口径，不虚构真实姓名）。 */
const DEMO_OPERATOR = '【教学演示】交易员'

// ---- 各章 recover（按服务端真实状态找回）----

const recoverPractice = (): boolean => {
  const snap = readGuideState(STATE.contracts) as ContractsSnapshot | null
  return Boolean(snap?.practiceActive && snap.canWrite)
}

// 章 1 完成：存在已确认、交割月为本导引目标月的售电目标（不认 id——重复导引时目标可能已存在）。
function planConfirmedFor(ctx: GuideCtx): boolean {
  const months = monthsFor(ctx)
  return (plansSnapshotFor(ctx)?.targets ?? []).some((t) => t.confirmedRevisionNo !== null && t.periodKey === months[0])
}

// 章 2 完成：本导引已登记公告（capture 记下 id），或执行页快照里已有任何公告（重复导引追加，练习数据可接受）。
// recover 优先认 artifacts：恢复链的 2.5s 轮询里执行页 windows 标签可能尚未加载，快照为空不代表没登记过。
function windowRegistered(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.windowId] === 'number') return true
  return (executionSnapshotFor(ctx)?.windows ?? []).length > 0
}

// 章 3 的两级完成态：草稿已保存（可继续确认）与已确认可执行（章完成）。
function proposalDraftExists(ctx: GuideCtx): boolean {
  const known = ctx.artifacts[ARTIFACT.proposalId]
  return (plansSnapshotFor(ctx)?.proposals ?? []).some((p) => p.id === known && p.status === 'DRAFT')
}

function proposalExecutable(ctx: GuideCtx): boolean {
  const known = ctx.artifacts[ARTIFACT.proposalId]
  const statuses = ['EXECUTABLE', 'SUBMITTED', 'AWAITING_RESULT', 'CLEARED']
  return (executionSnapshotFor(ctx)?.proposals ?? []).some((p) => p.id === known && statuses.includes(p.status))
    || (plansSnapshotFor(ctx)?.proposals ?? []).some((p) => p.id === known && statuses.includes(p.status))
}

// 章 4 完成：方案已登记外部提交（或已推进到待结果）。
function proposalSubmitted(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.submissionId] === 'number') return true
  const known = ctx.artifacts[ARTIFACT.proposalId]
  const statuses = ['SUBMITTED', 'AWAITING_RESULT', 'CLEARED']
  return (executionSnapshotFor(ctx)?.proposals ?? []).some((p) => p.id === known && statuses.includes(p.status))
}

// 章 5 完成：本导引已登记成交确认单（capture 记下 id），或执行页已有任何确认单。
function confirmationRegistered(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.confirmationId] === 'number') return true
  // 预成交（PRE_CLEARED）不创建义务、不推进完成率，不能视为本章已走过；只认确认成交。
  return (executionSnapshotFor(ctx)?.confirmations ?? []).some((c) => c.resultStatus === 'CLEARED')
}

// ---- 导航兜底动作 ----

/** 「带我去」到某页某个标签：SPA 导航 + 轮询页面按钮出现；视图切换被挂起时整页直达（会话持久化可恢复）。 */
async function gotoPageTab(ctx: GuideCtx, path: string, tab: string, button: string): Promise<void> {
  ctx.go({ path, query: { tab } })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const el = findGuideTarget(button, 'page')
    if (el) {
      el.click()
      return
    }
    await sleep(300)
  }
  window.location.assign(`${path}?tab=${tab}`)
}

/** 方案确认后抽屉留在计划页（plans 模式没有导出/提交按钮）：第 4 章去执行页打开同一方案的执行抽屉。 */
async function gotoExecutionProposal(ctx: GuideCtx): Promise<void> {
  ctx.go({ path: '/zcqjy/execution', query: { tab: 'proposals' } })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const table = findGuideTarget(ANCHOR.executionProposalRows, 'page')
    const cell = table?.querySelector('.el-table__body-wrapper tbody tr td')
    if (cell) {
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return
    }
    await sleep(300)
  }
  window.location.assign('/zcqjy/execution?tab=proposals')
}

// ---- 步骤 ----

const steps: GuideStep[] = [
  // 章 0：进入练习空间
  {
    id: '0-0', chapter: 0, route: '/zcqjy/plans',
    title: '走一遍计划与交易执行',
    body: (ctx) => `这条导引带你走完中长期售电的后半程：录售电目标并确认 → 登记交易公告（申报截止）→ 建交易方案（测算、确认可执行建立占用）→ 导出申报材料并登记外部提交 → 登记成交确认单（确认成交、关联方案）→ 回计划页看完成率 → 月度持仓看新义务。\n点下面的按钮进入练习空间【练习】公司（本次运行标签 ${ctx.runTag}）。`,
    advance: { kind: 'state', state: STATE.contracts, done: (snap) => Boolean((snap as ContractsSnapshot | null)?.practiceActive) },
    assist: { kind: 'action', label: '进入练习空间并开始', run: () => enterGuidePracticeSpace() },
    recover: recoverPractice,
  },
  {
    id: '0-1', chapter: 0, route: '/zcqjy/plans',
    target: ANCHOR.practiceBadge, within: 'page', placement: 'bottom',
    title: '已进入练习空间',
    body: '顶栏的【练习】徽标表示当前在练习公司里操作。导引期间请保持在这个公司；离开会自动暂停，回来可以继续。',
    advance: { kind: 'manual' },
  },

  // 章 1：售电目标
  {
    id: '1-0', chapter: 1, target: ANCHOR.plansNewTarget, within: 'page', placement: 'bottom', optional: true,
    title: '新建售电目标',
    body: '售电目标是人工确认的经营安排（不是物理可发电量）。确认后的目标决定「剩余计划待售量」与完成率的分母。点「新建目标」。',
    advance: { kind: 'visible', target: ANCHOR.planSubject, within: 'dialog' },
    assist: { kind: 'click' },
    recover: planConfirmedFor,
  },
  {
    id: '1-1', chapter: 1, target: ANCHOR.planSubject, within: 'dialog', resumeTo: '1-0', optional: true,
    title: '交易主体',
    body: '选「合同入门」里登记的那个练习主体。「帮我填」会选练习公司的第一个主体。',
    advance: { kind: 'form', form: FORM.planCreate, settleMs: 0, done: (v) => v.subjectId !== null && v.subjectId !== undefined && v.subjectId !== '' },
    assist: { kind: 'fill', form: FORM.planCreate, ready: (v) => v.subjectsReady === true, values: (_ctx, current) => ({ subjectId: (current?.subjectOptions as number[] | undefined)?.[0] ?? null }) },
    recover: planConfirmedFor,
  },
  {
    id: '1-2', chapter: 1, target: ANCHOR.planPeriod, within: 'dialog', resumeTo: '1-0', placement: 'right', optional: true,
    title: '交割期',
    body: (ctx) => `粒度「月」、交割月 ${monthsFor(ctx)[0]}——后面方案的交割片段、成交确认单都要落在这个月里。`,
    advance: { kind: 'form', form: FORM.planCreate, settleMs: 0, done: (v, ctx) => v.periodType === ('MONTH' as PlanPeriodType) && isPeriodKey('MONTH', v.periodKey) && v.periodKey === monthsFor(ctx)[0] },
    assist: { kind: 'fill', form: FORM.planCreate, values: (ctx) => ({ periodType: 'MONTH', periodKey: monthsFor(ctx)[0] }) },
    recover: planConfirmedFor,
  },
  {
    id: '1-3', chapter: 1, target: ANCHOR.planQuantity, within: 'dialog', resumeTo: '1-0', optional: true,
    title: '目标电量与依据',
    body: '目标电量示例 600 MWh；依据与负责人确认前必填——「帮我填」一并写上教学演示值。价格为空表示未定，不是 0。若后续方案确认时提示「可安排计划量不足」，把方案电量调小即可（练习公司可能已有历史确认合同占了额度）。',
    advance: { kind: 'form', form: FORM.planCreate, settleMs: 800, done: (v) => nonEmpty(v.targetQuantity) && nonEmpty(v.basisNote) && nonEmpty(v.ownerName) },
    assist: { kind: 'fill', form: FORM.planCreate, values: (ctx) => ({ targetQuantity: '600', basisNote: `教学示例目标（操作导引 ${ctx.runTag}）`, ownerName: DEMO_OPERATOR }) },
    recover: planConfirmedFor,
  },
  {
    id: '1-4', chapter: 1, target: ANCHOR.planSubmit, within: 'dialog', resumeTo: '1-0', placement: 'bottom',
    title: '保存目标（待确认）',
    body: '保存后是待确认草稿，计入完成情况前还要「确认」——下一步就在列表里点。重复导引时该主体该交割期可能已有目标（保存会提示不能重复新建）：目标已确认的话本章会自动跳过。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.planSaved, match: (payload, ctx) => (payload as { periodKey?: string } | null)?.periodKey === monthsFor(ctx)[0] },
        // 重复导引：该主体该交割期的目标已存在（保存会 409），已确认即视为本章完成。
        { kind: 'state', state: STATE.plans, done: (_snap, ctx) => planConfirmedFor(ctx) },
      ],
    },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { planId?: number } | null)?.planId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.planId] = id
    },
    recover: planConfirmedFor,
  },
  {
    id: '1-5', chapter: 1, target: ANCHOR.planRowConfirm, within: 'page', placement: 'top',
    title: '确认目标',
    body: '目标表的「操作」列点「确认」——确认后的版本才参与完成率与可安排计划量的计算。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.planConfirmed, match: (payload, ctx) => (payload as { periodKey?: string } | null)?.periodKey === monthsFor(ctx)[0] },
        { kind: 'state', state: STATE.plans, done: (_snap, ctx) => planConfirmedFor(ctx) },
      ],
    },
    assist: { kind: 'click' },
    recover: planConfirmedFor,
  },
  {
    id: '1-6', chapter: 1, target: ANCHOR.plansTargetTable, within: 'page', placement: 'top',
    title: '看一眼完成情况',
    body: '这张表是每月的经营盘子：确认目标、确认已售、剩余计划待售量、完成率、未完成占用、可安排计划量。现在已售还是 0——成交确认单登记后这里会变。看完点「下一步」。',
    advance: { kind: 'manual' },
    recover: planConfirmedFor,
  },

  // 章 2：交易公告
  {
    id: '2-0', chapter: 2, target: ANCHOR.executionRegisterWindow, within: 'page', placement: 'bottom',
    title: '去交易执行，登记公告',
    body: '交易公告记录申报的起止时间，是方案关联与日历提醒的依据。「带我去」到交易执行页的公告登记，并帮你点「登记公告」。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'visible', target: ANCHOR.windowName, within: 'dialog' },
        { kind: 'state', state: STATE.execution, done: (_snap, ctx) => windowRegistered(ctx) },
      ],
    },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoPageTab(ctx, '/zcqjy/execution', 'windows', ANCHOR.executionRegisterWindow) },
    recover: windowRegistered,
  },
  {
    id: '2-1', chapter: 2, target: ANCHOR.windowName, within: 'dialog', resumeTo: '2-0',
    title: '公告名称',
    body: '按公告原文登记名称即可，来源、文号等没给的参数留空显示「待核对」，不编造。',
    advance: { kind: 'form', form: FORM.windowRegister, settleMs: 800, done: (v) => nonEmpty(v.announcementName) },
    assist: { kind: 'fill', form: FORM.windowRegister, values: (ctx) => ({ announcementName: `【教学演示】月度申报公告 ${tagClock(ctx.runTag)}` }) },
    recover: windowRegistered,
  },
  {
    id: '2-2', chapter: 2, target: ANCHOR.windowDeclCloses, within: 'dialog', resumeTo: '2-0', placement: 'right',
    title: '申报截止',
    body: (ctx) => `公告明确给出的时间才填（日期 + 时:分，只选日期不接受）；没给出的整项留空，日历归入「待补」不生成提醒。示例填到 ${monthsFor(ctx)[2]} 月末 10:00。`,
    advance: { kind: 'form', form: FORM.windowRegister, settleMs: 0, done: (v) => DECLARATION_TIME_COMPLETE(v.declarationClosesAt) },
    assist: { kind: 'fill', form: FORM.windowRegister, values: (ctx) => ({ declarationClosesAt: deadlineExample(ctx) }) },
    recover: windowRegistered,
  },
  {
    id: '2-3', chapter: 2, target: ANCHOR.windowSubmit, within: 'dialog', resumeTo: '2-0', placement: 'bottom',
    title: '登记公告',
    body: '登记后公告进入交易日历；若已有方案引用旧版本公告，这里会列出来提示重新核对。',
    advance: { kind: 'signal', name: SIGNAL.windowSaved },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { windowId?: number } | null)?.windowId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.windowId] = id
    },
    recover: windowRegistered,
  },
  {
    id: '2-4', chapter: 2,
    title: '完成公告登记',
    body: '对话框里点「完成」关闭；有的公告登记会列出「引用旧版本需重新核对的方案」。下一步去建交易方案。',
    advance: { kind: 'manual' },
    recover: windowRegistered,
  },

  // 章 3：交易方案
  {
    id: '3-0', chapter: 3, target: ANCHOR.plansNewProposal, within: 'page', placement: 'bottom', optional: true,
    title: '新建方案草稿',
    body: '回到计划页的「交易方案」标签。方案是内部安排：保存草稿不建立占用、不进持仓；「确认可执行」才建立占用。「带我去」会切到该标签并帮你点「新建方案草稿」。',
    advance: { kind: 'visible', target: ANCHOR.proposalSubject, within: 'dialog' },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoPageTab(ctx, '/zcqjy/plans', 'proposals', ANCHOR.plansNewProposal) },
    recover: proposalExecutable,
  },
  {
    id: '3-1', chapter: 3, target: ANCHOR.proposalSubject, within: 'dialog', resumeTo: '3-0', optional: true,
    title: '交易主体',
    body: '与售电目标同一个主体——方案的占用要落在该主体的目标上。',
    advance: { kind: 'form', form: FORM.proposalCreate, settleMs: 0, done: (v) => v.subjectId !== null && v.subjectId !== undefined && v.subjectId !== '' },
    assist: { kind: 'fill', form: FORM.proposalCreate, ready: (v) => v.subjectsReady === true, values: (_ctx, current) => ({ subjectId: (current?.subjectOptions as number[] | undefined)?.[0] ?? null }) },
    recover: proposalDraftExists,
  },
  {
    id: '3-2', chapter: 3, target: ANCHOR.proposalWindow, within: 'dialog', resumeTo: '3-0', placement: 'right', optional: true,
    title: '关联交易公告',
    body: '选刚登记的公告——确认可执行前必须关联；公告更正后方案会提示按新版本重新核对。',
    advance: { kind: 'form', form: FORM.proposalCreate, settleMs: 0, done: (v) => v.windowId !== null && v.windowId !== undefined && v.windowId !== '' },
    assist: { kind: 'fill', form: FORM.proposalCreate, ready: (v) => v.windowsReady === true, values: (_ctx, current) => ({ windowId: (current?.windowOptions as number[] | undefined)?.[0] ?? null }) },
    recover: proposalDraftExists,
  },
  {
    id: '3-3', chapter: 3, target: ANCHOR.proposalSegments, within: 'dialog', resumeTo: '3-0', placement: 'left', optional: true,
    title: '交割片段',
    body: (ctx) => {
      const month = monthsFor(ctx)[0]
      return `交割片段落在本导引的目标月 ${month}：一行、拟售电量与目标一致（示例 600 MWh）。交易方式、负责人与理由是「确认可执行」的必填项，帮填会一并写上教学演示值。`
    },
    advance: { kind: 'form', form: FORM.proposalCreate, settleMs: 800, done: (v, ctx) => {
      const segments = (v as { segments?: Array<{ deliveryMonth: string; quantity: string }> }).segments ?? []
      return segments.length === 1 && segments[0]?.deliveryMonth === monthsFor(ctx)[0] && nonEmpty(segments[0]?.quantity)
        && nonEmpty(v.tradeMethod) && nonEmpty(v.ownerName) && nonEmpty(v.rationale)
    } },
    assist: { kind: 'fill', form: FORM.proposalCreate, values: (ctx) => ({
      segments: [{ deliveryMonth: monthsFor(ctx)[0], quantity: '600' }],
      tradeMethod: 'BILATERAL',
      ownerName: DEMO_OPERATOR,
      rationale: `教学示例方案（操作导引 ${ctx.runTag}）`,
    }) },
    recover: proposalDraftExists,
  },
  {
    id: '3-4', chapter: 3, target: ANCHOR.proposalSubmit, within: 'dialog', resumeTo: '3-0', placement: 'bottom', optional: true,
    title: '保存方案草稿',
    body: '保存后对话框关闭、方案抽屉自动打开——测算与「确认可执行」就在抽屉里。',
    advance: { kind: 'signal', name: SIGNAL.proposalSaved },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { proposalId?: number } | null)?.proposalId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.proposalId] = id
    },
    recover: proposalExecutable,
  },
  {
    id: '3-5', chapter: 3, target: ANCHOR.plansProposalTable, within: 'page', placement: 'top',
    title: '方案测算与确认可执行',
    body: '保存后方案抽屉自动打开：先看「方案测算」（交易前/后的电量与名义金额对比，模拟值），再点「确认可执行（建立占用）」——占用会体现在计划页的「未完成占用」。抽屉若被关闭：在计划页「交易方案」标签的列表里点行重开（不在计划页就先回去）；「帮我点」会代点（等测算加载完成、按钮可点后才点）。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.proposalConfirmed, match: (payload, ctx) => (payload as { proposalId?: number } | null)?.proposalId === ctx.artifacts[ARTIFACT.proposalId] },
        // 挂 plans 快照：存在任何非草稿方案（含已成交完结的 CLEARED）即视为本章已走过——
        // 重跑导引的新会话没有 proposalId 产物，也能在计划页直接跳过本章（练习公司的方案只来自导引/演练）。
        { kind: 'state', state: STATE.plans, done: (snap) => ((snap as PlansSnapshot | null)?.proposals ?? []).some((p) => p.status !== 'DRAFT') },
      ],
    },
    assist: { kind: 'action', label: '帮我点', run: async () => {
      // 抽屉可能已关：先点方案列表行重开，再等「确认可执行」可点（测算加载完成前按钮禁用）后点下。
      const deadline = Date.now() + 12_000
      let opened = false
      while (Date.now() < deadline) {
        const confirmBtn = findGuideTarget(ANCHOR.pdetailConfirm, 'drawer')
        if (confirmBtn && !confirmBtn.classList.contains('is-disabled')) {
          confirmBtn.click()
          return
        }
        if (!opened) {
          const row = findGuideTarget(ANCHOR.plansProposalTable, 'page')?.querySelector('.el-table__body-wrapper tbody tr')
          if (row) {
            row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            opened = true
          }
        }
        await sleep(300)
      }
    } },
    recover: proposalExecutable,
  },
  {
    id: '3-6', chapter: 3, target: ANCHOR.plansProposalTable, within: 'page', placement: 'top',
    title: '占用已建立',
    body: '抽屉的「交割片段与占用」区逐月显示未完成占用；撤销或关闭方案会释放占用。方案状态变为「可执行」。看完点「下一步」。',
    advance: { kind: 'manual' },
    recover: proposalExecutable,
  },

  // 章 4：导出申报材料与登记外部提交
  {
    id: '4-0', chapter: 4, target: ANCHOR.executionProposalRows, within: 'page', placement: 'top',
    title: '去执行页，导出申报材料',
    body: '导出/提交按钮在交易执行页的方案抽屉里（计划页的抽屉只管测算与确认）。「带我去」打开执行页的同一方案抽屉，然后点「导出申报材料」——只读下载，不等于提交。点「下一步」继续。',
    advance: { kind: 'manual' },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoExecutionProposal(ctx) },
    recover: proposalSubmitted,
  },
  {
    id: '4-1', chapter: 4, target: ANCHOR.pdetailSubmit, within: 'drawer', resumeTo: '4-0', placement: 'left',
    title: '登记外部提交',
    body: '本系统不登录外部平台：「登记外部提交」只记录谁、什么时候在外部提交了这一事实，不宣称平台已受理。点它打开登记对话框。',
    advance: { kind: 'visible', target: ANCHOR.submissionAt, within: 'dialog' },
    assist: { kind: 'click' },
    recover: proposalSubmitted,
  },
  {
    id: '4-2', chapter: 4, resumeTo: '4-0', target: ANCHOR.submissionAt, within: 'dialog',
    title: '外部提交时间',
    body: '按外部平台的实际提交时间填（日期 + 时:分完整填写）。示例用当前时间的整点。',
    advance: { kind: 'form', form: FORM.proposalSubmission, settleMs: 0, done: (v) => DECLARATION_TIME_COMPLETE(v.submittedAt) },
    assist: { kind: 'fill', form: FORM.proposalSubmission, values: () => {
      const now = new Date(Date.now() + 8 * 3600_000)
      const p = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate(), h: now.getUTCHours() }
      const pad = (n: number) => String(n).padStart(2, '0')
      return { submittedAt: `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:00` }
    } },
    recover: proposalSubmitted,
  },
  {
    id: '4-3', chapter: 4, resumeTo: '4-0', target: ANCHOR.submissionBy, within: 'dialog',
    title: '外部操作人',
    body: '登记在外部平台实际操作的人。练习填教学演示值即可；回执依据（编号/回执时间/文件）可以暂缺，缺失项会显示「待补」。',
    advance: { kind: 'form', form: FORM.proposalSubmission, settleMs: 800, done: (v) => nonEmpty(v.submittedByName) },
    assist: { kind: 'fill', form: FORM.proposalSubmission, values: () => ({ submittedByName: DEMO_OPERATOR, channel: '交易平台人工申报' }) },
    recover: proposalSubmitted,
  },
  {
    id: '4-4', chapter: 4, resumeTo: '4-0', target: ANCHOR.submissionSubmit, within: 'dialog', placement: 'bottom',
    title: '登记提交',
    body: '登记后方案状态变为「已提交」，对话框显示回执完整度（缺依据会列出待补项）。',
    advance: { kind: 'signal', name: SIGNAL.proposalSubmitted, match: (payload, ctx) => (payload as { proposalId?: number } | null)?.proposalId === ctx.artifacts[ARTIFACT.proposalId] },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { submissionId?: number } | null)?.submissionId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.submissionId] = id
    },
    recover: proposalSubmitted,
  },
  {
    id: '4-5', chapter: 4, resumeTo: '4-0', target: ANCHOR.submissionResult, within: 'dialog', placement: 'top',
    title: '提交登记完成',
    body: '「不代表平台已受理」——受理与否以外部平台为准；需要时可以再「补充回执」。看完点「完成」关闭对话框，点「下一步」。',
    advance: { kind: 'manual' },
    recover: proposalSubmitted,
  },

  // 章 5：成交确认单
  {
    id: '5-0', chapter: 5, target: ANCHOR.executionRegisterConfirmation, within: 'page', placement: 'bottom',
    title: '登记成交确认单',
    body: '外部成交后拿到的确认单在这里登记：「确认成交」会把方案占用原子转换为合同义务。「带我去」到执行确认标签并帮你点「登记确认单」。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'visible', target: ANCHOR.confirmSubject, within: 'dialog' },
        { kind: 'state', state: STATE.plans, done: (_snap, ctx) => confirmationRegistered(ctx) },
      ],
    },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoPageTab(ctx, '/zcqjy/execution', 'confirmations', ANCHOR.executionRegisterConfirmation) },
    recover: confirmationRegistered,
  },
  {
    id: '5-1', chapter: 5, target: ANCHOR.confirmSubject, within: 'dialog', resumeTo: '5-0',
    title: '主体、来源与确认编号',
    body: '主体选同一个；来源填 TEST-GUIDE（练习命名空间，列表据此标「教学演示」）；编号是外部确认单上的编号，同一来源内唯一。',
    advance: { kind: 'form', form: FORM.confirmationRegister, settleMs: 800, done: (v) => v.subjectId !== '' && nonEmpty(v.sourceNamespace) && nonEmpty(v.confirmationNo) },
    assist: { kind: 'fill', form: FORM.confirmationRegister, ready: (v) => v.candidatesReady === true && Array.isArray(v.subjectOptions) && v.subjectOptions.length > 0, values: (ctx, current) => ({
      subjectId: String((current?.subjectOptions as number[] | undefined)?.[0] ?? ''),
      sourceNamespace: 'TEST-GUIDE',
      confirmationNo: `${ctx.runTag}-C1`,
    }) },
    recover: confirmationRegistered,
  },
  {
    id: '5-2', chapter: 5, target: ANCHOR.confirmStatus, within: 'dialog', resumeTo: '5-0', placement: 'right',
    title: '确认成交',
    body: '「预成交」只保留记录、不建合同义务；「确认成交」会把关联方案的占用原子转换为合同义务（转换逐月展示在登记结果里）。这步切成「确认成交」——品种周期（月度）与交易方式（双边协商）是创建合同义务的必需项，一并帮你填上。',
    advance: { kind: 'form', form: FORM.confirmationRegister, settleMs: 0, done: (v) => v.resultStatus === 'CLEARED' },
    assist: { kind: 'fill', form: FORM.confirmationRegister, values: () => ({ resultStatus: 'CLEARED', productKind: 'MONTH', tradeMethod: 'BILATERAL' }) },
    recover: confirmationRegistered,
  },
  {
    id: '5-3', chapter: 5, target: ANCHOR.confirmSegments, within: 'dialog', resumeTo: '5-0', placement: 'left',
    title: '交割段',
    body: (ctx) => {
      const month = monthsFor(ctx)[0]
      return `交割段与方案一致：${month} 成交 300 MWh、价 280 元/MWh（价格未知就留空，不编价）。`
    },
    advance: { kind: 'form', form: FORM.confirmationRegister, settleMs: 800, done: (v, ctx) => {
      const segments = (v as { segments?: Array<{ deliveryMonth: string; quantity: string }> }).segments ?? []
      return segments.length === 1 && segments[0]?.deliveryMonth === monthsFor(ctx)[0] && Number(segments[0]?.quantity) > 0
    } },
    assist: { kind: 'fill', form: FORM.confirmationRegister, values: (ctx) => ({ segments: [{ deliveryMonth: monthsFor(ctx)[0], quantity: '300', price: '280' }] }) },
    recover: confirmationRegistered,
  },
  {
    id: '5-4', chapter: 5, target: ANCHOR.confirmFile, within: 'dialog', resumeTo: '5-0', placement: 'right',
    title: '确认单文件',
    body: '确认成交必须附依据文件。点「帮我填」生成一份教学示例文件（正文标明非真实依据）；真实使用时上传外部确认单原件。',
    advance: { kind: 'form', form: FORM.confirmationRegister, settleMs: 0, done: (v) => v.hasFile === true },
    assist: { kind: 'fill', form: FORM.confirmationRegister, values: (ctx) => ({ file: makeExampleEvidenceFile(`${ctx.runTag}-C1`, ctx) }) },
    recover: confirmationRegistered,
  },
  {
    id: '5-5', chapter: 5, target: ANCHOR.confirmProposal, within: 'dialog', resumeTo: '5-0', placement: 'left', optional: true,
    title: '关联方案',
    body: '关联刚才的方案 #——确认成交会把它的占用逐月转换为合同义务；不关联则直接创建新义务。练习选上它（也可跳过）。',
    advance: { kind: 'form', form: FORM.confirmationRegister, settleMs: 0, done: (v) => v.proposalId !== '' },
    assist: { kind: 'fill', form: FORM.confirmationRegister, ready: (v) => v.candidatesReady === true, values: (_ctx, current) => ({ proposalId: String((current?.proposalOptions as number[] | undefined)?.[0] ?? '') }) },
    recover: confirmationRegistered,
  },
  {
    id: '5-6', chapter: 5, target: ANCHOR.confirmSubmit, within: 'dialog', resumeTo: '5-0', placement: 'bottom',
    title: '登记确认单',
    body: '登记后展示「登记事实」：链接类型（创建义务/关联既有）、占用转换逐月明细与计划偏差。同一外部确认单重复登记会被幂等识别，不会重复计一次。',
    advance: { kind: 'signal', name: SIGNAL.confirmationSaved },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const p = payload as { confirmationId?: number; contractId?: number | null } | null
      if (typeof p?.confirmationId === 'number') ctx.artifacts[ARTIFACT.confirmationId] = p.confirmationId
    },
    recover: confirmationRegistered,
  },
  {
    id: '5-7', chapter: 5, target: ANCHOR.confirmResult, within: 'dialog', resumeTo: '5-0', placement: 'top',
    title: '看占用转换与计划偏差',
    body: '结果区逐月列出占用转换（例如 +200 MWh 转为合同义务）和重算后的计划偏差。确认单生成/关联的合同现在已按确认版本计入月度持仓。看完点「完成」，点「下一步」。',
    advance: { kind: 'manual' },
    recover: confirmationRegistered,
  },

  // 章 6：计划页看完成率
  {
    id: '6-0', chapter: 6, target: ANCHOR.plansTargetTable, within: 'page', placement: 'top',
    title: '回计划页看完成率',
    body: '「带我去」回计划页：成交的 600 MWh 进入「确认已售」，完成率与剩余计划待售量随之变化；方案的占用已随确认转换释放。',
    advance: { kind: 'state', state: STATE.plans, done: (snap) => (snap as PlansSnapshot | null)?.targets?.some((t) => Number(t.knownSoldQuantity) > 0) === true },
    assist: { kind: 'action', label: '带我去', run: (ctx) => { ctx.go({ path: '/zcqjy/plans' }) } },
    recover: (ctx) => (plansSnapshotFor(ctx)?.targets ?? []).some((t) => Number(t.knownSoldQuantity) > 0),
  },
  {
    id: '6-1', chapter: 6, target: ANCHOR.plansTargetTable, within: 'page', placement: 'top',
    title: '完成率与占用转换',
    body: '确认已售 = 成交确认单转换出的合同电量；未完成占用随转换释放归零。待核验、超计划都会如实显示，不当 0。看完点「下一步」。',
    advance: { kind: 'manual' },
    recover: (ctx) => (plansSnapshotFor(ctx)?.targets ?? []).some((t) => t.confirmedRevisionNo !== null),
  },

  // 章 7：月度持仓
  {
    id: '7-0', chapter: 7, target: ANCHOR.positionsMonths, within: 'page', placement: 'top',
    title: '去月度持仓看新义务',
    body: (ctx) => {
      const [m1, , m3] = monthsFor(ctx)
      return `确认成交转换出的合同义务已按确认版本计入月度持仓：区间 ${m1} ~ ${m3} 每月 200 MWh。`
    },
    advance: { kind: 'state', state: STATE.positions, done: (snap, ctx) => {
      const months = (snap as { months?: string[] } | null)?.months ?? []
      const [m1, , m3] = monthsFor(ctx)
      return months.includes(m1) && months.includes(m3)
    } },
    assist: { kind: 'action', label: '带我去', run: (ctx) => {
      const [m1, , m3] = monthsFor(ctx)
      ctx.go({ path: '/zcqjy/positions', query: { fromMonth: m1, toMonth: m3 } })
    } },
    recover: (ctx) => {
      const snap = readGuideState(STATE.positions) as { months?: string[] } | null
      const [m1, , m3] = monthsFor(ctx)
      return Boolean(snap?.months?.includes(m1) && snap?.months?.includes(m3))
    },
  },
  {
    id: '7-1', chapter: 7, finishing: true,
    title: '完成',
    body: '后半程走完了：售电目标（确认）→ 交易公告 → 方案（测算 → 确认可执行建占用）→ 申报材料与外部提交 → 成交确认单（占用转合同义务）→ 完成率与持仓。\n数据留在练习公司，不影响集团汇总；结合「合同入门」和「分解与场站」，中长期售电的全流程就完整了。',
    advance: { kind: 'manual' },
  },
]

export const planExecutionGuide: GuideDefinition = {
  id: 'midlong.plan-execution',
  group: 'midlong',
  title: '计划与交易执行',
  summary: '用已确认合同生成申报计划：目标、公告、方案（测算与占用）、外部提交与成交确认单，最后看完成率与持仓。',
  status: 'ready',
  makeRunTag,
  initArtifacts: () => ({ [ARTIFACT.executionMonths]: guideMonths() }),
  requires: [ANCHOR.plansNewTarget, ANCHOR.plansNewProposal, ANCHOR.executionRegisterWindow, ANCHOR.executionRegisterConfirmation],
  needsWrite: true,
  steps,
}
