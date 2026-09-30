// 「调整与复盘账单」导引（dljy#3407）：带用户走一遍合同调整（登记 → 确认生效 → 看版本影响）→
// 外部账单分项登记 → 收款凭证 → 登记账单与台账差异 → 写处理说明关闭差异 → 业务复盘指标 → 生成月报（冻结）。
// 每步：用户亲手操作、检测满足自动推进；「帮我填 / 帮我点 / 带我去」兜底。
// 各章 recover 先认 artifacts（本导引 capture 的 id），再退回快照状态；刷新不重复建数据。
// 章序前置：调整需要一份已确认合同（复用「合同入门」/前几条导引的产物）；差异前置账单；凭证前置账单。
import type { GuideCtx, GuideDefinition, GuideStep } from '../types'
import { enterGuidePracticeSpace } from '../runner'
import { findGuideTarget } from '../targets'
import { readGuideState } from '../bridge'
import { ANCHOR, ARTIFACT, FORM, SIGNAL, STATE } from './anchors'
import { guideMonths, makeRunTag } from './examples'
import { makeExampleEvidenceFile } from './evidenceFile'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const nonEmpty = (value: unknown): boolean => String(value ?? '').trim() !== ''

// ---- 页面快照形状 ----

type AdjustmentsSnapshot = {
  canWrite?: boolean
  rows?: Array<{ id: number; status: string; direction: string | null; externalAdjustmentNo: string }>
}

type BillsSnapshot = {
  canWrite?: boolean
  bills?: Array<{ id: number; externalBillNo: string; billKind: string; voucherCount: number }>
}

type DiscrepanciesSnapshot = {
  canWrite?: boolean
  discrepancies?: Array<{ id: number; status: string }>
}

type ReportsSnapshot = {
  canWrite?: boolean
  month?: string
  reports?: Array<{ id: number; reportMonth: string }>
}

function adjustmentsSnapshotFor(_ctx: GuideCtx): AdjustmentsSnapshot | null {
  return readGuideState(STATE.adjustments) as AdjustmentsSnapshot | null
}
function billsSnapshotFor(_ctx: GuideCtx): BillsSnapshot | null {
  return readGuideState(STATE.bills) as BillsSnapshot | null
}
function discrepanciesSnapshotFor(_ctx: GuideCtx): DiscrepanciesSnapshot | null {
  return readGuideState(STATE.discrepancies) as DiscrepanciesSnapshot | null
}
function reportsSnapshot(): ReportsSnapshot | null {
  return readGuideState(STATE.reports) as ReportsSnapshot | null
}

// ---- 月份与业务键（会话固定；确认单转换出的义务落在与前置导引相同的交割月）----

function monthsFor(ctx: GuideCtx): [string, string, string] {
  const fixed = ctx.artifacts[ARTIFACT.executionMonths]
  if (Array.isArray(fixed) && fixed.length === 3 && fixed.every((m) => typeof m === 'string')) return fixed as [string, string, string]
  const months = guideMonths()
  ctx.artifacts[ARTIFACT.executionMonths] = months
  return months
}

const runTagOf = (ctx: GuideCtx): string => ctx.runTag

// ---- 各章 recover ----

const recoverPractice = (): boolean => {
  const snap = readGuideState(STATE.contracts) as { practiceActive?: boolean } | null
  return Boolean(snap?.practiceActive)
}

// 章 1 完成：本导引的调整已生效（或快照里存在 EFFECTIVE 调整）。
function adjustmentEffective(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.adjustmentId] === 'number') {
    const rows = adjustmentsSnapshotFor(ctx)?.rows ?? []
    const hit = rows.find((r) => r.id === ctx.artifacts[ARTIFACT.adjustmentId])
    if (hit) return hit.status === 'EFFECTIVE'
  }
  return (adjustmentsSnapshotFor(ctx)?.rows ?? []).some((r) => r.status === 'EFFECTIVE')
}

// 章 2 完成：本导引登记的账单存在（登记时业务键含 runTag）。
function billRegistered(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.billId] === 'number') return true
  const no = `${runTagOf(ctx)}-B1`
  return (billsSnapshotFor(ctx)?.bills ?? []).some((b) => b.externalBillNo === no)
}

// 章 3 完成：账单已有收款凭证。
function voucherRegistered(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.voucherId] === 'number') return true
  const billId = ctx.artifacts[ARTIFACT.billId]
  if (typeof billId !== 'number') return false
  return (billsSnapshotFor(ctx)?.bills ?? []).some((b) => b.id === billId && b.voucherCount > 0)
}

// 章 4 完成：只认本导引实际登记的差异（capture 的 discrepancyId）；账单存在不代表差异已登记——
// 若按前置账单判定，恢复链会跳过 4-0..4-3 而第 5 章没有差异可关（codex R1-01）。
function discrepancyRegistered(ctx: GuideCtx): boolean {
  return typeof ctx.artifacts[ARTIFACT.discrepancyId] === 'number'
}

// 章 5 完成：差异已关闭（RESOLVED；登记快照与处理说明冻结）。
function discrepancyResolved(ctx: GuideCtx): boolean {
  const known = ctx.artifacts[ARTIFACT.discrepancyId]
  const rows = discrepanciesSnapshotFor(ctx)?.discrepancies ?? []
  if (typeof known === 'number') return rows.some((d) => d.id === known && d.status === 'RESOLVED')
  return rows.some((d) => d.status === 'RESOLVED')
}

// 章 7 完成：目标月已有生成的月报。
function reportGenerated(ctx: GuideCtx): boolean {
  if (typeof ctx.artifacts[ARTIFACT.reportId] === 'number') return true
  const month = monthsFor(ctx)[0]
  return (reportsSnapshot()?.reports ?? []).some((r) => r.reportMonth === month)
}

// ---- 导航兜底 ----

/** 「带我去」到合同调整页（SPA + 整页兜底）。 */
async function gotoAdjustments(ctx: GuideCtx): Promise<void> {
  ctx.go({ path: '/zcqjy/adjustments' })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (findGuideTarget(ANCHOR.adjustmentRegister, 'page')) return
    await sleep(300)
  }
  window.location.assign('/zcqjy/adjustments')
}

/** 「带我去」到账单台账页。 */
async function gotoBills(ctx: GuideCtx, tab: 'bills' | 'discrepancies'): Promise<void> {
  ctx.go({ path: '/zcqjy/bills', query: { tab } })
  const deadline = Date.now() + 8000
  const anchor = tab === 'bills' ? ANCHOR.billRegister : ANCHOR.discrepancyRegister
  while (Date.now() < deadline) {
    if (findGuideTarget(anchor, 'page')) return
    await sleep(300)
  }
  window.location.assign(`/zcqjy/bills?tab=${tab}`)
}

/** 「带我去」到复盘页，并把交割月筛选切到本导引的目标月（codex R1-02）。 */
async function gotoReview(ctx: GuideCtx): Promise<void> {
  const targetMonth = monthsFor(ctx)[0]
  const [year, mon] = targetMonth.split('-')
  ctx.go({ path: '/zcqjy/review' })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const picker = findGuideTarget(ANCHOR.reviewMonth, 'page')
    if (picker) {
      picker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(600)
      // 月面板：必要时切年，再点目标月
      for (let i = 0; i < 24; i += 1) {
        const panel = [...document.querySelectorAll('.el-month-panel, .el-picker-panel')].find((p) => p.getClientRects().length > 0)
        const header = panel?.querySelector('.el-date-picker__header-label')?.textContent ?? ''
        if (header.includes(year)) break
        const nextYear = [...(panel?.querySelectorAll('.el-date-picker__header .el-picker-panel__icon-btn') ?? [])].pop()
        nextYear?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(200)
      }
      const cells = [...document.querySelectorAll('.el-month-table td')].filter((td) => td.getClientRects().length > 0)
      const cell = cells.find((td) => (td.textContent ?? '').replace(/[^0-9]/g, '') === String(Number(mon))) as HTMLElement | null
      cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(400)
      // 面板关闭后点「查询」触发 loadMetrics
      const searchBtn = [...document.querySelectorAll<HTMLElement>('main button')].find((b) => b.textContent?.trim() === '查询')
      searchBtn?.click()
      return
    }
    await sleep(300)
  }
  window.location.assign('/zcqjy/review')
}

// ---- 步骤 ----

const steps: GuideStep[] = [
  // 章 0：进入练习空间
  {
    id: '0-0', chapter: 0, route: '/zcqjy/adjustments',
    title: '走一遍调整与复盘账单',
    body: (ctx) => `这条导引带你走完中长期的收尾环节：对已确认合同登记一笔外部调整并确认生效（看版本影响）→ 登记外部账单（分项）→ 登记收款凭证 → 登记账单与台账差异 → 写处理说明关闭差异 → 业务复盘看指标 → 生成月报（冻结）。\n点下面的按钮进入练习空间【练习】公司（本次运行标签 ${ctx.runTag}）。`,
    advance: { kind: 'state', state: STATE.contracts, done: (snap) => Boolean((snap as { practiceActive?: boolean } | null)?.practiceActive) },
    assist: { kind: 'action', label: '进入练习空间并开始', run: () => enterGuidePracticeSpace() },
    recover: recoverPractice,
  },
  {
    id: '0-1', chapter: 0, route: '/zcqjy/adjustments',
    target: ANCHOR.practiceBadge, within: 'page', placement: 'bottom',
    title: '已进入练习空间',
    body: '顶栏的【练习】徽标表示当前在练习公司里操作。导引期间请保持在这个公司；离开会自动暂停，回来可以继续。',
    advance: { kind: 'manual' },
  },

  // 章 1：合同调整
  {
    id: '1-0', chapter: 1, target: ANCHOR.adjustmentRegister, within: 'page', optional: true,
    title: '登记一笔外部调整',
    body: '外部调整记录「合同之外发生的变化」（转让、部分终止、电量增减），生效后原子改写合同义务。「带我去」到合同调整页并帮你点「登记调整」。若练习公司已有生效的调整记录（重复导引），点「跳过」滑过本章。',
    advance: { kind: 'visible', target: ANCHOR.adjustmentType, within: 'dialog' },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoAdjustments(ctx) },
    recover: adjustmentEffective,
  },
  {
    id: '1-1', chapter: 1, target: ANCHOR.adjustmentContractNext, within: 'dialog', resumeTo: '1-0', optional: true,
    title: '选择要调整的合同',
    body: '只能调整已核验确认的合同。「帮我点」会选第一份候选并进入登记表单。',
    advance: { kind: 'visible', target: ANCHOR.adjustmentType, within: 'dialog' },
    assist: { kind: 'action', label: '帮我点', run: async () => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const dlg = [...document.querySelectorAll('.el-dialog')].find((d) => d.getClientRects().length > 0 && (d.textContent ?? '').includes('选择要调整的合同'))
        const select = dlg?.querySelector('.el-select__wrapper')
        if (select) {
          select.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          await sleep(700)
          const opt = [...document.querySelectorAll('.el-select-dropdown')].filter((p) => p.getClientRects().length > 0).flatMap((p) => [...p.querySelectorAll('.el-select-dropdown__item')])[0]
          opt?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          await sleep(500)
          const next = [...(dlg?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === '下一步')
          next?.click()
          return
        }
        await sleep(300)
      }
    } },
    recover: adjustmentEffective,
  },
  {
    id: '1-2', chapter: 1, target: ANCHOR.adjustmentType, within: 'dialog', resumeTo: '1-0', optional: true,
    title: '调整类型与登记要素',
    body: '类型保持「外部调整」；来源与外部调整编号是业务键（帮填用 TEST-GUIDE 命名空间）；我方义务方向选「增加我方售电义务」——方向是生效的前提，留空会停在「待核对」；交割段填目标月、变化量 100 MWh（绝对值，方向统一由方向字段给出）；调整原因必填。「帮我填」一次写全。',
    advance: { kind: 'form', form: FORM.adjustmentRegister, settleMs: 800, done: (v, ctx) =>
      nonEmpty(v.sourceNamespace) && nonEmpty(v.externalAdjustmentNo) && nonEmpty(v.reason)
      && v.direction === 'OBLIGATION_INCREASE'
      && Array.isArray(v.segments) && v.segments.length === 1 && v.segments[0]?.deliveryMonth === monthsFor(ctx)[0] && nonEmpty(v.segments[0]?.quantity) },
    assist: { kind: 'fill', form: FORM.adjustmentRegister, values: (ctx) => ({
      sourceNamespace: 'TEST-GUIDE',
      externalAdjustmentNo: `${ctx.runTag}-ADJ1`,
      externalRevisionNo: '1',
      direction: 'OBLIGATION_INCREASE',
      reason: `教学示例调整：目标月增配 100 MWh（操作导引 ${ctx.runTag}）`,
      segments: [{ deliveryMonth: monthsFor(ctx)[0], quantity: '100' }],
      file: makeExampleEvidenceFile(`${ctx.runTag}-ADJ1`, ctx, { label: '调整生效依据', guide: '调整与复盘账单' }),
    }) },
    recover: adjustmentEffective,
  },
  {
    id: '1-3', chapter: 1, target: ANCHOR.adjustmentSubmit, within: 'dialog', resumeTo: '1-0', placement: 'bottom',
    title: '登记调整（未生效）',
    body: '登记只是记录事实：调整停在「待确认生效」，不改合同义务。登记成功后详情抽屉自动打开。',
    advance: { kind: 'signal', name: SIGNAL.adjustmentSaved },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { adjustmentId?: number } | null)?.adjustmentId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.adjustmentId] = id
    },
    recover: adjustmentEffective,
  },
  {
    id: '1-4', chapter: 1, target: ANCHOR.adjustmentConfirm, within: 'drawer', resumeTo: '1-0', placement: 'left',
    title: '确认生效',
    body: '抽屉里点「确认生效」——生效是原子操作：同时生成合同新版本、按方向更新各片段义务。生效必须有核验依据，「帮我填」会先生成教学示例文件并在弹窗里代点提交。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: SIGNAL.adjustmentConfirmed },
        { kind: 'state', state: STATE.adjustments, done: (_snap, ctx) => adjustmentEffective(ctx) },
      ],
    },
    assist: { kind: 'action', label: '帮我点', run: async (ctx) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const btn = findGuideTarget(ANCHOR.adjustmentConfirm, 'drawer')
        if (btn) {
          btn.click()
          break
        }
        await sleep(300)
      }
      // 无既有依据时补教学示例文件（codex R1-03）：与 FORM.adjustmentConfirm 的 fill 同构，
      // 直接写 File 使「确认生效」按钮脱离禁用，再等按钮可点后提交。
      const fileInput = (findGuideTarget(ANCHOR.adjustmentConfirmFile, 'dialog') as HTMLElement | null)?.querySelector('input[type="file"]') as HTMLInputElement | null
      const submitDeadline = Date.now() + 8000
      while (Date.now() < submitDeadline) {
        const submit = findGuideTarget(ANCHOR.adjustmentConfirmSubmit, 'dialog') as HTMLButtonElement | null
        if (submit && !submit.disabled) {
          submit.click()
          return
        }
        if (fileInput && fileInput.files?.length === 0) {
          const file = makeExampleEvidenceFile(`${ctx.runTag}-ADJ1`, ctx, { label: '调整生效依据', guide: '调整与复盘账单' })
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set
          if (setter) {
            const dt = new DataTransfer()
            dt.items.add(file)
            setter.call(fileInput, dt.files)
            fileInput.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }
        await sleep(300)
      }
    } },
    recover: adjustmentEffective,
  },
  {
    id: '1-5', chapter: 1, target: ANCHOR.adjustmentConfirmResult, within: 'drawer', resumeTo: '1-0', placement: 'top',
    title: '已生效：看版本影响',
    body: '生效结果列出合同新版本号与逐月义务变化。「变更影响」区对比生效台账冻结快照与拟变更；合同详情页的版本历史里调整与更正同一条时间线、都有「影响对比」。',
    advance: { kind: 'manual' },
    recover: adjustmentEffective,
  },

  // 章 2：外部账单
  {
    id: '2-0', chapter: 2, target: ANCHOR.billRegister, within: 'page', optional: true,
    title: '登记外部账单',
    body: '外部账单按「主体 + 来源 + 外部账单编号」登记，分项只记外部账单上明确给出的行、不做推算。「带我去」到账单台账页并帮你点「登记账单」。若练习公司已有本导引登记的账单（重复导引），点「跳过」滑过本章。',
    advance: { kind: 'visible', target: ANCHOR.billSubject, within: 'dialog' },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoBills(ctx, 'bills') },
    recover: billRegistered,
  },
  {
    id: '2-1', chapter: 2, target: ANCHOR.billSubject, within: 'dialog', resumeTo: '2-0', optional: true,
    title: '账单要素',
    body: (ctx) => `主体选练习主体；来源 TEST-GUIDE；编号帮填为 ${ctx.runTag}-B1；形态保持「分项账单」；期间与分项落在 ${monthsFor(ctx)[0]}（金额示例 84000 元——与台账是否一致由后面差异章检验）。`,
    advance: { kind: 'form', form: FORM.billRegister, settleMs: 800, done: (v) =>
      v.subjectId !== null && nonEmpty(v.sourceNamespace) && nonEmpty(v.externalBillNo)
      && nonEmpty(v.periodStartMonth) && nonEmpty(v.periodEndMonth) && nonEmpty(v.amount)
      && Array.isArray(v.lineItems) && v.lineItems.length >= 1 && (nonEmpty(v.lineItems[0]?.quantity) || nonEmpty(v.lineItems[0]?.amount)) },
    assist: { kind: 'fill', form: FORM.billRegister, ready: (merged) => merged.subjectsReady === true, values: (ctx, current) => {
      const month = monthsFor(ctx)[0]
      return {
        subjectId: (current?.subjectOptions as number[] | undefined)?.[0] ?? null,
        sourceNamespace: 'TEST-GUIDE',
        externalBillNo: `${ctx.runTag}-B1`,
        periodStartMonth: month,
        periodEndMonth: month,
        amount: '84000',
        lineItems: [{ deliveryMonth: month, quantity: '300', price: '280', amount: '84000', note: '教学示例分项' }],
      }
    } },
    recover: billRegistered,
  },
  {
    id: '2-2', chapter: 2, target: ANCHOR.billSubmit, within: 'dialog', resumeTo: '2-0', placement: 'bottom',
    title: '登记账单',
    body: '同一外部账单重复处理会被幂等识别（链接既有记录、金额不重复累计）。登记后账单进台账列表。',
    advance: { kind: 'signal', name: SIGNAL.billSaved },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { billId?: number } | null)?.billId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.billId] = id
    },
    recover: billRegistered,
  },

  // 章 3：收款凭证
  {
    id: '3-0', chapter: 3, target: ANCHOR.billRow, within: 'page', optional: true,
    title: '给账单登记收款凭证',
    body: '到账以凭证为准——没有凭证的账单不显示到账。「带我去」后点账单行打开详情抽屉，再点「登记收款凭证」。「帮我点」会代点这两下。',
    advance: { kind: 'visible', target: ANCHOR.voucherNo, within: 'dialog' },
    assist: { kind: 'action', label: '带我去', run: async (ctx) => {
      await gotoBills(ctx, 'bills')
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const table = findGuideTarget(ANCHOR.billRow, 'page')
        const cell = table?.querySelector('.el-table__body-wrapper tbody tr td')
        if (cell) {
          cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          break
        }
        await sleep(300)
      }
      const openDeadline = Date.now() + 6000
      while (Date.now() < openDeadline) {
        const btn = findGuideTarget(ANCHOR.voucherOpen, 'drawer')
        if (btn) {
          btn.click()
          return
        }
        await sleep(300)
      }
    } },
    recover: voucherRegistered,
  },
  {
    id: '3-1', chapter: 3, target: ANCHOR.voucherNo, within: 'dialog', resumeTo: '3-0',
    title: '收款凭证要素',
    body: '凭证编号帮填为运行标签（练习口径）；收款金额示例 84000 元、日期今天。凭证只追加、不可改。',
    advance: { kind: 'form', form: FORM.voucherRegister, settleMs: 800, done: (v) => nonEmpty(v.voucherNo) && nonEmpty(v.amount) && nonEmpty(v.receivedAt) },
    assist: { kind: 'fill', form: FORM.voucherRegister, values: (ctx) => {
      const now = new Date(Date.now() + 8 * 3600_000)
      const p = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() }
      const pad = (n: number) => String(n).padStart(2, '0')
      return { voucherNo: `${ctx.runTag}-V1`, amount: '84000', receivedAt: `${p.y}-${pad(p.m)}-${pad(p.d)}` }
    } },
    recover: voucherRegistered,
  },
  {
    id: '3-2', chapter: 3, target: ANCHOR.voucherSubmit, within: 'dialog', resumeTo: '3-0', placement: 'bottom',
    title: '登记凭证',
    body: '登记后账单显示到账。「不代表平台已受理」的口径同样适用于凭证。',
    advance: { kind: 'signal', name: SIGNAL.voucherSaved },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { voucherId?: number } | null)?.voucherId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.voucherId] = id
    },
    recover: voucherRegistered,
  },
  {
    id: '3-3', chapter: 3, target: ANCHOR.voucherResult, within: 'dialog', resumeTo: '3-0', placement: 'top',
    title: '凭证登记完成',
    body: '到账金额以凭证为准。看完点「完成」关闭对话框，点「下一步」去登记差异。',
    advance: { kind: 'manual' },
    recover: voucherRegistered,
  },

  // 章 4：账单与台账差异
  {
    id: '4-0', chapter: 4, target: ANCHOR.discrepancyRegister, within: 'page', optional: true,
    title: '登记账单与台账差异',
    body: '差异=外部账单该月分项 与 台账（P1 持仓正式分解）该月分项 的差值，服务端自动计算、两侧不一致才允许登记。「带我去」到差异台账页并帮你点「登记差异」。若练习公司已有本导引登记的差异（重复导引），点「跳过」滑过本章。',
    advance: { kind: 'visible', target: ANCHOR.discrepancySubject, within: 'dialog' },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoBills(ctx, 'discrepancies') },
    recover: discrepancyRegistered,
  },
  {
    id: '4-1', chapter: 4, target: ANCHOR.discrepancySubject, within: 'dialog', resumeTo: '4-0', optional: true,
    title: '差异比对目标',
    body: (ctx) => `主体选练习主体（账单候选会随之加载）、交割月 ${monthsFor(ctx)[0]}、外部账单选刚登记的那份（${ctx.runTag}-B1）。差异原因与负责人可后补。`,
    advance: { kind: 'form', form: FORM.discrepancyRegister, settleMs: 800, done: (v) => v.subjectId !== null && nonEmpty(v.deliveryMonth) && v.billId !== null && v.billId !== undefined && v.billId !== '' },
    assist: { kind: 'fill', form: FORM.discrepancyRegister, ready: (v) => v.subjectsReady === true, values: (ctx, current) => ({
      subjectId: (current?.subjectOptions as number[] | undefined)?.[0] ?? null,
      deliveryMonth: monthsFor(ctx)[0],
    }) },
    recover: discrepancyRegistered,
  },
  {
    id: '4-2', chapter: 4, target: ANCHOR.discrepancyBill, within: 'dialog', resumeTo: '4-0', placement: 'left', optional: true,
    title: '选账单并登记',
    body: '帮填已选主体与交割月；在「比对的外部账单」下拉里选刚登记的账单，然后点「登记（不自动改台账）」——两侧一致时服务端会拒绝空差异，那就调整账单金额后再试。点「帮我点」会代点登记。',
    advance: { kind: 'signal', name: SIGNAL.discrepancySaved },
    assist: { kind: 'action', label: '帮我点', run: async () => {
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        const submit = findGuideTarget(ANCHOR.discrepancySubmit, 'dialog')
        if (submit) {
          submit.click()
          return
        }
        await sleep(300)
      }
    } },
    capture: (payload, ctx) => {
      const id = (payload as { discrepancyId?: number } | null)?.discrepancyId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.discrepancyId] = id
    },
    recover: discrepancyRegistered,
  },
  {
    id: '4-3', chapter: 4, target: ANCHOR.discrepancySubmit, within: 'dialog', resumeTo: '4-0', placement: 'top',
    title: '看差值口径',
    body: '结果区给出两侧快照的量差/价差与可比性说明。差异登记只留痕，不改台账。看完点「完成」关闭对话框。',
    advance: { kind: 'manual' },
    recover: discrepancyRegistered,
  },

  // 章 5：关闭差异
  {
    id: '5-0', chapter: 5, target: ANCHOR.discrepancyRow, within: 'page', optional: true,
    title: '写处理说明关闭差异',
    body: '到差异台账页点差异行打开抽屉，点「关闭（必须填处理说明）」——处理说明是关闭的必填留痕，关闭后登记快照与说明冻结、不改台账数据。「帮我点」会代点「关闭」打开说明框。',
    advance: { kind: 'visible', target: ANCHOR.discrepancyNote, within: 'dialog' },
    assist: { kind: 'action', label: '带我去', run: async (ctx) => {
      await gotoBills(ctx, 'discrepancies')
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const table = findGuideTarget(ANCHOR.discrepancyRow, 'page')
        const cell = table?.querySelector('.el-table__body-wrapper tbody tr td')
        if (cell) {
          cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          break
        }
        await sleep(300)
      }
      const openDeadline = Date.now() + 6000
      while (Date.now() < openDeadline) {
        const btn = findGuideTarget(ANCHOR.discrepancyResolve, 'drawer')
        if (btn) {
          btn.click()
          return
        }
        await sleep(300)
      }
    } },
    recover: discrepancyResolved,
  },
  {
    id: '5-1', chapter: 5, target: ANCHOR.discrepancyNote, within: 'dialog', resumeTo: '5-0',
    title: '处理说明',
    body: '写明原因、依据与处理结果（关闭后冻结）。帮填一段教学示例说明。',
    advance: { kind: 'form', form: FORM.discrepancyResolve, settleMs: 800, done: (v) => nonEmpty(v.resolutionNote) },
    assist: { kind: 'fill', form: FORM.discrepancyResolve, values: (ctx) => ({ resolutionNote: `教学示例处理：经与交易中心核对为计量周期差异，双方台账已按同一口径调整（操作导引 ${ctx.runTag}）` }) },
    recover: discrepancyResolved,
  },
  {
    id: '5-2', chapter: 5, target: ANCHOR.discrepancyResolveSubmit, within: 'dialog', resumeTo: '5-0', placement: 'bottom',
    title: '关闭（留痕）',
    body: '关闭后差异状态变为「已解决」，操作区随之收起。',
    advance: { kind: 'signal', name: SIGNAL.discrepancyResolved },
    assist: { kind: 'click' },
    recover: discrepancyResolved,
  },
  {
    id: '5-3', chapter: 5, target: ANCHOR.discrepancyResolved, within: 'drawer', resumeTo: '5-0', placement: 'top',
    title: '差异已关闭',
    body: '登记快照与处理说明冻结、可追溯；台账数据保持原样——差异管理是「对齐认知」，不是「改数据」。看完点「下一步」去业务复盘。',
    advance: { kind: 'manual' },
    recover: discrepancyResolved,
  },

  // 章 6：业务复盘
  {
    id: '6-0', chapter: 6, target: ANCHOR.reviewMonth, within: 'page',
    title: '业务复盘指标',
    body: (ctx) => `「带我去」到业务复盘页。把交割月切到 ${monthsFor(ctx)[0]}（本导引的交易日）：完成率、同口径均价、对手方/方式分布、结算金额与数据缺口都在这一页，只读不改。`,
    advance: { kind: 'visible', target: ANCHOR.reviewMetrics, within: 'page' },
    assist: { kind: 'action', label: '带我去', run: (ctx) => gotoReview(ctx) },
    recover: (): boolean => Boolean(reportsSnapshot() || readGuideState(STATE.reports)),
  },
  {
    id: '6-1', chapter: 6, target: ANCHOR.reviewMetrics, within: 'page', placement: 'top',
    title: '读指标的正确姿势',
    body: '完成率与均价是「同口径」的（不跨口径比较）；结算金额是账单侧事实；数据缺口如实列出——复盘页全部只读，任何数字都不推算、不补齐。看完点「下一步」生成月报。',
    advance: { kind: 'manual' },
    recover: reportGenerated,
  },

  // 章 7：生成月报
  {
    id: '7-0', chapter: 7, target: ANCHOR.reviewGenerate, within: 'page',
    title: '生成月报（冻结）',
    body: (ctx) => `点「生成月报（冻结）」——生成会把当月输入（合同/计划/成交确认/账单版本与口径）冻结成报告版本；之后数据变化不回写旧报告。目标月 ${monthsFor(ctx)[0]}、范围全公司。`,
    advance: { kind: 'visible', target: ANCHOR.reviewGenerateNote, within: 'dialog' },
    assist: { kind: 'click' },
    recover: reportGenerated,
  },
  {
    id: '7-1', chapter: 7, target: ANCHOR.reviewGenerateNote, within: 'dialog', resumeTo: '7-0',
    title: '生成说明',
    body: '生成说明可空。同一输入重复生成会被识别（提示输入未变化）——重复导引时遇到该提示点「完成」即可。',
    advance: { kind: 'form', form: FORM.reportGenerate, settleMs: 500, done: () => true },
    assist: { kind: 'fill', form: FORM.reportGenerate, values: (ctx) => ({ note: `教学示例月报（操作导引 ${ctx.runTag}）` }) },
    recover: reportGenerated,
  },
  {
    id: '7-2', chapter: 7, target: ANCHOR.reviewGenerateSubmit, within: 'dialog', resumeTo: '7-0', placement: 'bottom',
    title: '生成（冻结当前输入）',
    body: '点「生成（冻结当前输入）」——成功后对话框展示冻结输入计数与变化说明。',
    advance: { kind: 'signal', name: SIGNAL.reportGenerated },
    assist: { kind: 'click' },
    capture: (payload, ctx) => {
      const id = (payload as { reportId?: number } | null)?.reportId
      if (typeof id === 'number') ctx.artifacts[ARTIFACT.reportId] = id
    },
    recover: reportGenerated,
  },
  {
    id: '7-3', chapter: 7, target: ANCHOR.reviewGenerateResult, within: 'dialog', resumeTo: '7-0', placement: 'top',
    title: '月报已生成',
    body: '点「完成」关闭对话框，在报告版本列表里点行打开报告全文（可按版本导出 CSV）。点「下一步」收尾。',
    advance: { kind: 'manual' },
    recover: reportGenerated,
  },
  {
    id: '7-4', chapter: 7, target: ANCHOR.reportExport, within: 'drawer', resumeTo: '7-0', optional: true,
    title: '打开报告与导出',
    body: '在报告列表点行打开报告抽屉：版本列表、按版本冻结快照全文、逐版本 CSV 导出。看完这篇导引就完成了。',
    advance: { kind: 'manual' },
    recover: reportGenerated,
  },
  {
    id: '7-5', chapter: 7, finishing: true,
    title: '完成',
    body: '收尾环节走完了：合同调整（生效并看影响）→ 外部账单 → 收款凭证 → 差异登记与关闭 → 业务复盘 → 月报冻结。\n结合前三条导引（合同入门 / 分解与场站 / 计划与交易执行），中长期售电从建合同到复盘结算的完整闭环就都练过了。数据留在练习公司，不影响集团汇总。',
    advance: { kind: 'manual' },
  },
]

export const adjustReviewGuide: GuideDefinition = {
  id: 'midlong.adjust-review',
  group: 'midlong',
  title: '调整与复盘账单',
  summary: '对已确认合同登记外部调整并生效，登记账单/凭证/差异并关闭，最后复盘指标、生成冻结月报。',
  status: 'ready',
  makeRunTag,
  initArtifacts: () => ({ [ARTIFACT.executionMonths]: guideMonths() }),
  requires: [ANCHOR.adjustmentRegister, ANCHOR.billRegister, ANCHOR.discrepancyRegister, ANCHOR.reviewGenerate],
  needsWrite: true,
  steps,
}
