// 「合同入门」导引（dljy#3404）：带用户在练习空间里亲手建完
// 交易主体 → 框架协议 → 电量合同（含经济内容与月度分解）→ 补依据 → 核验确认 → 月度持仓。
// 每步：用户亲手操作、检测满足自动推进；「帮我填 / 帮我点 / 带我去」兜底。
// 所有 signal/route 完成判定都配了 recover：刷新后按服务端真实状态找回，不重复建数据。
import type { GuideCtx, GuideDefinition, GuideStep } from '../types'
import { enterGuidePracticeSpace } from '../runner'
import { fillGuideForm, readGuideForm, readGuideState, submitGuideForm } from '../bridge'
import { ANCHOR, ARTIFACT, FORM, STATE } from './anchors'
import {
  allocationExample, deliveryExample, frameworkExample, guideMonths, matchesRunTag, obligationExample, quantityPriceExample, subjectExample, tagClock,
} from './examples'
import { makeExampleEvidenceFile } from './evidenceFile'
import { makeRunTag } from './examples'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---- 列表页状态快照的形状（MidlongContractsView 经 useGuideState 提供）----

type ContractsSnapshot = {
  practiceActive?: boolean
  canWrite?: boolean
  subjects?: Array<{ id: number; subjectKey: string }>
  contracts?: Array<{ id: number; documentKind: string; externalContractNo: string }>
  stations?: Array<{ id: number }>
}

type DetailSnapshot = {
  contractId?: number
  documentKind?: string
  confirmationStatus?: string
  verifiableEvidenceCount?: number
}

type PositionsSnapshot = {
  months?: string[]
  drillMonth?: string | null
}

function contractsSnapshot(): ContractsSnapshot | null {
  return readGuideState(STATE.contracts) as ContractsSnapshot | null
}

function detailSnapshot(): DetailSnapshot | null {
  return readGuideState(STATE.contractDetail) as DetailSnapshot | null
}

function positionsSnapshot(): PositionsSnapshot | null {
  return readGuideState(STATE.positions) as PositionsSnapshot | null
}

// ---- capture：从推进 payload（信号 / 路由 / 状态快照）里记产物 ----

function capturePracticeStations(payload: unknown, ctx: GuideCtx): void {
  const snap = payload as ContractsSnapshot | null
  const ids = (snap?.stations ?? []).map((s) => s.id).slice(0, 2)
  if (ids.length) ctx.artifacts[ARTIFACT.practiceStationIds] = ids
}

function captureSubjectId(payload: unknown, ctx: GuideCtx): void {
  const p = payload as { id?: number; subjects?: Array<{ id: number; subjectKey: string }> } | null
  if (typeof p?.id === 'number') {
    ctx.artifacts[ARTIFACT.subjectId] = p.id
    return
  }
  const hit = (p?.subjects ?? []).find((s) => matchesRunTag(s.subjectKey, ctx.runTag))
  if (hit) ctx.artifacts[ARTIFACT.subjectId] = hit.id
}

function captureContractId(artifactKey: string): (payload: unknown, ctx: GuideCtx) => void {
  return (payload, ctx) => {
    const p = payload as { contractId?: number; path?: string } | null
    let id: number | null = typeof p?.contractId === 'number' ? p.contractId : null
    if (id === null) {
      const matched = /\/zcqjy\/contracts\/(\d+)/.exec(p?.path ?? '')
      if (matched) id = Number(matched[1])
    }
    if (id !== null && Number.isFinite(id) && id > 0) ctx.artifacts[artifactKey] = id
  }
}

// ---- recover：刷新后按服务端状态找回（返回 true = 这一步已完成）----

const recoverPractice = (ctx: GuideCtx): boolean => {
  const snap = contractsSnapshot()
  if (!snap?.practiceActive || !snap.canWrite) return false
  capturePracticeStations(snap, ctx)
  return true
}

function findSubjectId(ctx: GuideCtx): number | null {
  const hit = (contractsSnapshot()?.subjects ?? []).find((s) => matchesRunTag(s.subjectKey, ctx.runTag))
  return hit ? hit.id : null
}

function findContractId(ctx: GuideCtx, kind: 'FRAMEWORK' | 'OBLIGATION'): number | null {
  const hit = (contractsSnapshot()?.contracts ?? []).find(
    (c) => c.documentKind === kind && matchesRunTag(c.externalContractNo, ctx.runTag),
  )
  return hit ? hit.id : null
}

const recoverSubjectChapter = (ctx: GuideCtx): boolean => {
  const id = findSubjectId(ctx)
  if (id === null) return false
  ctx.artifacts[ARTIFACT.subjectId] = id
  return true
}

const recoverFrameworkChapter = (ctx: GuideCtx): boolean => {
  const id = findContractId(ctx, 'FRAMEWORK')
  if (id === null) return false
  ctx.artifacts[ARTIFACT.frameworkId] = id
  return true
}

const recoverObligationChapter = (ctx: GuideCtx): boolean => {
  const id = findContractId(ctx, 'OBLIGATION')
  if (id === null) return false
  ctx.artifacts[ARTIFACT.obligationId] = id
  return true
}

const evidenceAdded = (): boolean => (detailSnapshot()?.verifiableEvidenceCount ?? 0) > 0
const verifyConfirmed = (): boolean => detailSnapshot()?.confirmationStatus === 'CONFIRMED'

const recoverEvidenceAdded = (): boolean => evidenceAdded() || verifyConfirmed()
const recoverVerified = (): boolean => verifyConfirmed()

const spreadMonths = (): [string, string, string] => guideMonths()

const recoverPositionsLoaded = (): boolean => {
  const months = positionsSnapshot()?.months ?? []
  const [m1, , m3] = spreadMonths()
  return months.includes(m1) && months.includes(m3)
}

const recoverDrilled = (): boolean => positionsSnapshot()?.drillMonth === spreadMonths()[0]

// ---- 信号 match ----

const isFrameworkSaved = (payload: unknown): boolean => (payload as { documentKind?: string } | null)?.documentKind === 'FRAMEWORK'
const isObligationSaved = (payload: unknown): boolean => (payload as { documentKind?: string } | null)?.documentKind === 'OBLIGATION'

const isContractDetailRoute = (route: { path: string }): boolean => /^\/zcqjy\/contracts\/\d+/.test(route.path)
const isContractsListRoute = (route: { path: string }): boolean => route.path === '/zcqjy/contracts'

/** 4-7「带我去月度持仓」：跳转后若 KeepAlive 保留了旧筛选，用 positions.filters 的 fill+submit 纠正。 */
async function goPositions(ctx: GuideCtx): Promise<void> {
  const [m1, , m3] = spreadMonths()
  ctx.go({ path: '/zcqjy/positions', query: { fromMonth: m1, toMonth: m3 } })
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !readGuideForm(FORM.positionsFilters)) await sleep(200)
  fillGuideForm(FORM.positionsFilters, { monthRange: [m1, m3] })
  await submitGuideForm(FORM.positionsFilters)
}

const nonEmpty = (value: unknown): boolean => String(value ?? '').trim() !== ''

// ---- 步骤 ----

const steps: GuideStep[] = [
  // 章 0：进入练习空间
  {
    id: '0-0', chapter: 0, route: '/zcqjy/contracts',
    title: '在练习空间里建一套测试业务流',
    body: (ctx) => `这条导引带你亲手走一遍中长期售电的全流程：登记交易主体 → 录框架协议 → 录电量合同（含月度分解）→ 补充依据 → 核验确认 → 在月度持仓里看它生效。\n点下面的按钮会切换到练习空间【练习】公司（本次运行标签 ${ctx.runTag}）。练习数据不计入集团汇总，也不能删除；再练一遍会追加新的一批。`,
    advance: { kind: 'state', state: STATE.contracts, done: (snap) => {
      const s = snap as ContractsSnapshot | null
      return !!s?.practiceActive && !!s.canWrite
    } },
    assist: { kind: 'action', label: '进入练习空间并开始', run: () => enterGuidePracticeSpace() },
    capture: capturePracticeStations,
    recover: recoverPractice,
  },
  {
    id: '0-1', chapter: 0, route: '/zcqjy/contracts',
    target: ANCHOR.practiceBadge, within: 'page', placement: 'bottom',
    title: '已进入练习空间',
    body: '顶栏的【练习】徽标表示当前在练习公司里操作。导引期间请保持在这个公司；离开会自动暂停，回来可以继续。',
    advance: { kind: 'manual' },
  },

  // 章 1：交易主体
  {
    id: '1-0', chapter: 1, route: '/zcqjy/contracts',
    target: ANCHOR.openSubjects, within: 'page', placement: 'bottom',
    title: '第一步：登记交易主体',
    body: '合同核验前必须有交易主体（购售电对手方在本公司的登记）。点「交易主体」打开登记对话框。',
    advance: { kind: 'visible', target: ANCHOR.subjectKey, within: 'dialog' },
    assist: { kind: 'click' },
    recover: recoverSubjectChapter,
  },
  {
    id: '1-1', chapter: 1, target: ANCHOR.subjectKey, within: 'dialog',
    title: '主体编码',
    body: '主体编码在公司内唯一，是合同的关联键；展示名不作唯一键。填一个自己能认出来的编码即可。',
    advance: { kind: 'form', form: FORM.subject, settleMs: 800, done: (v) => nonEmpty(v.subjectKey), missing: (v) => (nonEmpty(v.subjectKey) ? [] : ['主体编码']) },
    assist: { kind: 'fill', form: FORM.subject, values: (ctx, current) => ({ subjectKey: subjectExample(ctx, current).subjectKey }) },
    recover: recoverSubjectChapter,
  },
  {
    id: '1-2', chapter: 1, target: ANCHOR.subjectName, within: 'dialog',
    title: '主体名称',
    body: (ctx) => `展示名称，给人看的。例如「【教学演示】交易单元 ${tagClock(ctx.runTag)}」。`,
    advance: { kind: 'form', form: FORM.subject, settleMs: 800, done: (v) => nonEmpty(v.displayName), missing: (v) => (nonEmpty(v.displayName) ? [] : ['主体名称']) },
    assist: { kind: 'fill', form: FORM.subject, values: (ctx) => ({ displayName: subjectExample(ctx).displayName }) },
    recover: recoverSubjectChapter,
  },
  {
    id: '1-3', chapter: 1, target: ANCHOR.subjectStations, within: 'dialog', placement: 'right', optional: true,
    title: '关联场站（可选）',
    body: '把主体关联到练习公司开通的两个练习场站。场站须属本公司且登记为云南；不关联也不影响本导引。',
    advance: { kind: 'form', form: FORM.subject, settleMs: 0, done: (v) => Array.isArray(v.stationIds) && v.stationIds.length > 0 },
    assist: { kind: 'fill', form: FORM.subject, values: (ctx) => ({ stationIds: subjectExample(ctx).stationIds }) },
    recover: recoverSubjectChapter,
  },
  {
    id: '1-4', chapter: 1, target: ANCHOR.subjectSubmit, within: 'dialog', placement: 'bottom',
    title: '登记主体',
    body: '交易单元代码可以留空（不虚构官方编码），系统只提示不阻断。点「登记主体」保存；编码冲突（409）时换个编码重试即可。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: 'midlong.subject.created', match: (payload, ctx) => matchesRunTag((payload as { subjectKey?: string } | null)?.subjectKey ?? '', ctx.runTag) },
        { kind: 'state', state: STATE.contracts, done: (snap, ctx) => (snap as ContractsSnapshot | null)?.subjects?.some((s) => matchesRunTag(s.subjectKey, ctx.runTag)) ?? false },
      ],
    },
    assist: { kind: 'click' },
    capture: captureSubjectId,
    recover: recoverSubjectChapter,
  },
  {
    id: '1-5', chapter: 1, target: ANCHOR.subjectClose, within: 'dialog', placement: 'bottom',
    title: '关闭对话框',
    body: '主体已建好。关闭对话框回到合同列表。',
    advance: { kind: 'hidden', target: ANCHOR.subjectClose, within: 'dialog' },
    assist: { kind: 'click' },
    recover: recoverSubjectChapter,
  },

  // 章 2：框架协议
  {
    id: '2-0', chapter: 2, route: '/zcqjy/contracts',
    target: ANCHOR.newContract, within: 'page', placement: 'bottom',
    title: '第二步：录一份框架协议',
    body: '框架协议约定年度合作的总体条款，本身不计入持仓；电量挂在它下面。点「录入合同草稿」打开表单。',
    advance: { kind: 'visible', target: ANCHOR.contractDocKind, within: 'dialog' },
    assist: { kind: 'click' },
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-1', chapter: 2, target: ANCHOR.contractDocKind, within: 'dialog', placement: 'right',
    title: '文件类型：框架协议',
    body: '把文件类型切成「框架协议」。框架协议不计入月度持仓，也不要求经济内容。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v) => v.documentKind === 'FRAMEWORK' },
    assist: { kind: 'fill', form: FORM.contractCreate, values: () => ({ documentKind: 'FRAMEWORK' }) },
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-2', chapter: 2, target: ANCHOR.contractNo, within: 'dialog',
    title: '合同编号与名称',
    body: '编号在同一个来源命名空间内唯一。框架协议与后面的电量合同是两份合同，编号要错开。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 800, done: (v) => nonEmpty(v.externalContractNo) && nonEmpty(v.contractName), missing: (v) => [nonEmpty(v.externalContractNo) ? '' : '合同编号', nonEmpty(v.contractName) ? '' : '合同名称'].filter(Boolean) },
    assist: { kind: 'fill', form: FORM.contractCreate, values: (ctx, current) => {
      const example = frameworkExample(ctx, current)
      return { externalContractNo: example.externalContractNo, contractName: example.contractName }
    } },
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-3', chapter: 2, target: ANCHOR.contractSource, within: 'dialog',
    title: '来源命名空间',
    body: '来源决定编号的唯一性范围。用 TEST-GUIDE 时列表会显示「教学演示」标记；用其它非 TEST 开头的来源也没问题，只是不会有标记。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 800, done: (v) => nonEmpty(v.sourceNamespace), missing: (v) => (nonEmpty(v.sourceNamespace) ? [] : ['来源命名空间']) },
    assist: { kind: 'fill', form: FORM.contractCreate, values: (ctx, current) => ({ sourceNamespace: frameworkExample(ctx, current).sourceNamespace }) },
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-4', chapter: 2, target: ANCHOR.contractSubject, within: 'dialog', placement: 'right',
    title: '选择交易主体',
    body: '选刚登记的那个主体。下拉按名称展示，编码在旁边。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v) => v.subjectId !== null && v.subjectId !== undefined && v.subjectId !== '' },
    assist: { kind: 'fill', form: FORM.contractCreate, values: (ctx, current) => ({ subjectId: frameworkExample(ctx, current).subjectId }) },
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-5', chapter: 2, target: ANCHOR.contractSubmit, within: 'dialog', placement: 'bottom',
    title: '保存框架协议',
    body: '保存后是草稿状态。框架协议不需要经济内容，直接保存即可；编号冲突（409）时点「帮我填」会换一个编号后缀。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: 'midlong.contract.saved', match: isFrameworkSaved },
        { kind: 'route', match: isContractDetailRoute },
      ],
    },
    assist: { kind: 'click' },
    capture: captureContractId(ARTIFACT.frameworkId),
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-6', chapter: 2, target: ANCHOR.detailStatus, within: 'page', placement: 'bottom',
    title: '合同详情：草稿',
    body: '保存后跳到合同详情。框架协议也能补充依据并核验，本导引先跳过，去录电量合同。',
    advance: { kind: 'manual' },
    recover: recoverFrameworkChapter,
  },
  {
    id: '2-7', chapter: 2, target: ANCHOR.detailBack, within: 'page', placement: 'bottom',
    title: '回到合同列表',
    body: '点「返回列表」回 /zcqjy/contracts。',
    advance: { kind: 'route', match: isContractsListRoute },
    assist: { kind: 'navigate', to: () => ({ path: '/zcqjy/contracts' }) },
    recover: recoverFrameworkChapter,
  },

  // 章 3：电量合同
  {
    id: '3-0', chapter: 3, route: '/zcqjy/contracts',
    target: ANCHOR.newContract, within: 'page', placement: 'bottom',
    title: '第三步：录电量合同',
    body: '现在录真正计量的电量合同，挂到刚建的框架协议下。再点一次「录入合同草稿」。',
    advance: { kind: 'visible', target: ANCHOR.contractDocKind, within: 'dialog' },
    assist: { kind: 'click' },
    recover: recoverObligationChapter,
  },
  {
    id: '3-1', chapter: 3, target: ANCHOR.contractProductKind, within: 'dialog', placement: 'right',
    title: '品种周期与分类',
    body: '品种周期、交易方式、电能属性是三个独立分类：年度双边常规电能是默认组合，直接认可即可。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v) => v.documentKind === 'OBLIGATION' && nonEmpty(v.productKind) && nonEmpty(v.tradeMethod) && nonEmpty(v.energyAttribute) },
    assist: { kind: 'fill', form: FORM.contractCreate, values: (ctx, current) => {
      const example = obligationExample(ctx, current)
      return { documentKind: example.documentKind, productKind: example.productKind, tradeMethod: example.tradeMethod, marketScope: example.marketScope, energyAttribute: example.energyAttribute }
    } },
    recover: recoverObligationChapter,
  },
  {
    id: '3-2', chapter: 3, target: ANCHOR.contractNo, within: 'dialog',
    title: '编号 / 名称 / 来源',
    body: '同一份来源命名空间里编号唯一；电量合同用 -01 结尾与框架协议错开。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 800, done: (v) => nonEmpty(v.externalContractNo) && nonEmpty(v.contractName) && nonEmpty(v.sourceNamespace), missing: (v) => [nonEmpty(v.externalContractNo) ? '' : '合同编号', nonEmpty(v.contractName) ? '' : '合同名称', nonEmpty(v.sourceNamespace) ? '' : '来源命名空间'].filter(Boolean) },
    assist: { kind: 'fill', form: FORM.contractCreate, values: (ctx, current) => {
      const example = obligationExample(ctx, current)
      return { externalContractNo: example.externalContractNo, contractName: example.contractName, sourceNamespace: example.sourceNamespace }
    } },
    recover: recoverObligationChapter,
  },
  {
    id: '3-3', chapter: 3, target: ANCHOR.contractSubject, within: 'dialog', placement: 'right',
    title: '交易主体与场站',
    body: '主体选同一个。场站可以留空：主体统签的合同先不落到具体场站，列表只提示「场站未分配」，不阻断。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v) => v.subjectId !== null && v.subjectId !== undefined && v.subjectId !== '' },
    assist: { kind: 'fill', form: FORM.contractCreate, values: (ctx, current) => ({ subjectId: obligationExample(ctx, current).subjectId }) },
    recover: recoverObligationChapter,
  },
  {
    id: '3-4', chapter: 3, target: ANCHOR.contractFramework, within: 'dialog', placement: 'right', optional: true,
    title: '挂到框架协议（可选）',
    body: '所属框架协议选刚保存的那份，形成「框架 + 电量」的层级。也可以不挂（跳过），不影响后续步骤。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v, ctx) => v.frameworkContractId === ((ctx.artifacts[ARTIFACT.frameworkId] as number | undefined) ?? null) && v.frameworkContractId !== null },
    assist: { kind: 'fill', form: FORM.contractCreate, ready: (v) => v.frameworkReady === true, values: (ctx, current) => ({ frameworkContractId: obligationExample(ctx, current).frameworkContractId }) },
    recover: recoverObligationChapter,
  },
  {
    id: '3-5', chapter: 3, target: ANCHOR.econDeliveryStart, within: 'dialog', placement: 'right',
    title: '交割期',
    body: (ctx) => {
      const [m1, , m3] = spreadMonthsFor(ctx)
      return `交割期按自然月取整段：${m1} 月 1 日到 ${m3} 月月末。结束日当天也算交割。`
    },
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v) => nonEmpty(v.deliveryStart) && nonEmpty(v.deliveryEnd), missing: (v) => [nonEmpty(v.deliveryStart) ? '' : '交割开始日期', nonEmpty(v.deliveryEnd) ? '' : '交割结束日期'].filter(Boolean) },
    assist: { kind: 'fill', form: FORM.contractCreate, values: () => ({ ...deliveryExample() }) },
    recover: recoverObligationChapter,
  },
  {
    id: '3-6', chapter: 3, target: ANCHOR.econQuantity, within: 'dialog',
    title: '电量与价格',
    body: '合同电量 1000 MWh、售电价 280 元/MWh、固定价、含税、电能量价。没填价格表示「待核对」，不是 0。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 800, done: (v) => nonEmpty(v.totalQuantity) && Array.isArray(v.econErrors) && v.econErrors.length === 0, missing: (v) => [nonEmpty(v.totalQuantity) ? '' : '合同电量', ...(Array.isArray(v.econErrors) && v.econErrors.length ? ['经济内容有校验错误'] : [])].filter(Boolean) },
    assist: { kind: 'fill', form: FORM.contractCreate, values: () => ({ ...quantityPriceExample() }) },
    recover: recoverObligationChapter,
  },
  {
    id: '3-7', chapter: 3, target: ANCHOR.econAlloc, within: 'dialog', placement: 'bottom',
    title: '月度分解',
    body: '不做均摊：分解必须与合同电量严格相等。三行 400 / 300 / 300（M+1/M+2/M+3）都用「正式依据」，并勾选「分解已完整」。',
    advance: { kind: 'form', form: FORM.contractCreate, settleMs: 0, done: (v) => v.allocationCompleteness === 'COMPLETE' },
    assist: { kind: 'fill', form: FORM.contractCreate, values: () => ({ ...allocationExample() }) },
    recover: recoverObligationChapter,
  },
  {
    id: '3-8', chapter: 3, target: ANCHOR.contractSubmit, within: 'dialog', placement: 'bottom',
    title: '保存电量合同',
    body: '下方校验框无红色错误时保存。保存后进入详情页，能看到阻断项只剩「缺核验依据」。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: 'midlong.contract.saved', match: isObligationSaved },
        { kind: 'route', match: isContractDetailRoute },
      ],
    },
    assist: { kind: 'click' },
    capture: captureContractId(ARTIFACT.obligationId),
    recover: recoverObligationChapter,
  },

  // 章 4：依据、核验与持仓
  {
    id: '4-0', chapter: 4, target: ANCHOR.detailBlocking, within: 'page', placement: 'bottom',
    title: '核验前需补齐',
    body: '阻断项只剩「缺核验依据」，其余（场站未分配等）都只是提示。补一份依据就能核验。',
    advance: { kind: 'manual' },
    recover: recoverVerified,
  },
  {
    id: '4-1', chapter: 4, target: ANCHOR.detailEvidenceBtn, within: 'page', placement: 'bottom',
    title: '补充资料',
    body: '点「补充资料」打开上传对话框。',
    advance: { kind: 'visible', target: ANCHOR.evidenceType, within: 'dialog' },
    assist: { kind: 'click' },
    recover: recoverEvidenceAdded,
  },
  {
    id: '4-2', chapter: 4, target: ANCHOR.evidenceType, within: 'dialog', placement: 'right',
    title: '资料类型',
    body: '电子交易确认单、纸质合同、交易中心导出三类可以作核验依据；其它类型只作留档。',
    advance: { kind: 'form', form: FORM.evidence, settleMs: 0, done: (v) => ['ELECTRONIC_CONFIRMATION', 'PAPER_CONTRACT', 'TRADING_CENTER_EXPORT'].includes(String(v.documentType)), missing: (v) => (['ELECTRONIC_CONFIRMATION', 'PAPER_CONTRACT', 'TRADING_CENTER_EXPORT'].includes(String(v.documentType)) ? [] : ['选择可作依据的资料类型']) },
    assist: { kind: 'fill', form: FORM.evidence, values: () => ({ documentType: 'ELECTRONIC_CONFIRMATION' }) },
    recover: recoverEvidenceAdded,
  },
  {
    id: '4-3', chapter: 4, target: ANCHOR.evidenceFile, within: 'dialog',
    title: '上传文件',
    body: '选一个文件。点「帮我填」会生成一份教学示例文件，正文里明确写着「非真实依据」。',
    advance: { kind: 'form', form: FORM.evidence, settleMs: 0, done: (v) => v.file !== null && v.file !== undefined, missing: (v) => (v.file ? [] : ['选择依据文件']) },
    assist: { kind: 'fill', form: FORM.evidence, values: (ctx) => ({ file: makeExampleEvidenceFile(`${ctx.runTag}-01`, ctx) }) },
    recover: recoverEvidenceAdded,
  },
  {
    id: '4-4', chapter: 4, target: ANCHOR.evidenceSubmit, within: 'dialog', placement: 'bottom',
    title: '提交资料',
    body: '补充资料不会改变合同电量，只是给核验提供凭证。',
    advance: {
      kind: 'any',
      of: [
        { kind: 'signal', name: 'midlong.evidence.added' },
        { kind: 'state', state: STATE.contractDetail, done: (snap) => ((snap as DetailSnapshot | null)?.verifiableEvidenceCount ?? 0) > 0 },
      ],
    },
    assist: { kind: 'click' },
    recover: recoverEvidenceAdded,
  },
  {
    id: '4-5', chapter: 4, target: ANCHOR.detailVerifyBtn, within: 'page', placement: 'bottom',
    title: '核验确认',
    body: '点「核验确认」打开确认对话框。',
    advance: { kind: 'visible', target: ANCHOR.verifySubmit, within: 'dialog' },
    assist: { kind: 'click' },
    recover: recoverVerified,
  },
  {
    id: '4-6', chapter: 4, target: ANCHOR.verifySubmit, within: 'dialog', placement: 'bottom',
    title: '确认核验',
    body: '可作依据的资料默认全选。确认后合同进入「已确认」版本，之后只能录更正版本、不能覆盖。',
    advance: { kind: 'state', state: STATE.contractDetail, done: (snap) => (snap as DetailSnapshot | null)?.confirmationStatus === 'CONFIRMED' },
    assist: { kind: 'click' },
    recover: recoverVerified,
  },
  {
    id: '4-7', chapter: 4,
    title: '去月度持仓看结果',
    body: (ctx) => {
      const [m1, , m3] = spreadMonthsFor(ctx)
      return `合同已确认，现在到「月度持仓」看它生效：区间 ${m1} ~ ${m3}，正式分解电量 1000 MWh。\n若页面保留了旧筛选，点「带我去」会一并纠正。`
    },
    advance: { kind: 'state', state: STATE.positions, done: (snap) => {
      const months = (snap as PositionsSnapshot | null)?.months ?? []
      const [m1, , m3] = spreadMonths()
      return months.includes(m1) && months.includes(m3)
    } },
    assist: { kind: 'action', label: '带我去', run: (ctx) => goPositions(ctx) },
    recover: recoverPositionsLoaded,
  },
  {
    id: '4-8', chapter: 4, route: '/zcqjy/positions',
    target: ANCHOR.positionsMonths, within: 'page', placement: 'bottom',
    title: '点开 M+1 月',
    body: (ctx) => `在月度明细里点 ${spreadMonthsFor(ctx)[0]} 那一行，展开该月的合同贡献。`,
    advance: { kind: 'state', state: STATE.positions, done: (snap, ctx) => (snap as PositionsSnapshot | null)?.drillMonth === spreadMonthsFor(ctx)[0] },
    recover: recoverDrilled,
  },
  {
    id: '4-9', chapter: 4, route: '/zcqjy/positions',
    target: ANCHOR.positionsDrill, within: 'page', placement: 'top',
    title: '这就是刚才那笔合同',
    body: '钻取区列出该月每份已确认合同的贡献：刚录的电量合同在这里按月度分解计入。',
    advance: { kind: 'manual' },
    recover: recoverDrilled,
  },
  {
    id: '4-A', chapter: 4, finishing: true,
    title: '完成',
    body: '全流程走完了：主体 → 框架协议 → 电量合同（含月度分解）→ 依据 → 核验确认 → 持仓。\n数据留在练习公司，不影响集团汇总；想再练一遍随时可以从「操作导引」重新开始（会追加新的一批）。',
    advance: { kind: 'manual' },
  },
]

/** body 文案里的交割月展示（与示例值同源，避免两处日期算不一致）。 */
function spreadMonthsFor(_ctx: GuideCtx): [string, string, string] {
  return spreadMonths()
}

export const contractBasicsGuide: GuideDefinition = {
  id: 'midlong.contract-basics',
  group: 'midlong',
  title: '合同入门',
  summary: '在练习空间里建主体、录框架与电量合同、补依据核验，最后在月度持仓里看它生效。',
  status: 'ready',
  makeRunTag,
  requires: [ANCHOR.openSubjects, ANCHOR.newContract, ANCHOR.positionsLink],
  needsWrite: true,
  steps,
}
