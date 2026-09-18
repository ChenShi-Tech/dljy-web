// 规范图表结果、语义选区、跨模块交接与接收反馈、动作能力（#2993 任务 3.9，DE09—DE10、CH06—CH07、D11.1）。
//
// 三条原则：
//   1. 图表、表格、研究、报告读同一份规范结果；ECharts option 不是接口，dataIndex/像素不是业务身份。
//   2. 交接里的 scope 只是「请求处理的业务范围」，不是授权凭据；queryId、evidenceRef 也不是 bearer token。
//      接收方按登录身份重新鉴权，撤权、过期、未知版本各自明确返回原因。
//   3. 版本：同一主版本内新增字段必须先登记到这里再发送；收到未登记字段直接拒绝，
//      不静默丢弃——被丢掉的往往正是影响口径的条件。未知主版本一律「不支持」。

import { INSIGHT_ERRORS, InsightContractError, MARKET_PHASES, PRICE_OBJECTS, ANALYSIS_MODES, isReadSetRef, isResultVersion } from './contract.mjs'

export const HANDOFF_SCHEMA = 'insight-handoff/v1'
export const SELECTION_SCHEMA = 'insight-selection/v1'
export const RECEIPT_SCHEMA = 'insight-receipt/v1'
export const RESULT_DATA_SCHEMA = 'insight-result-data/v1'
export const RECEIPT_STATUSES = Object.freeze(['accepted', 'partial', 'rejected', 'unavailable'])
export const FIELD_DECISIONS = Object.freeze(['accepted', 'dropped', 'rejected'])
export const ACTION_INTENTS = Object.freeze(['read', 'save'])

const UNSUPPORTED = { status: 422, code: 'UNSUPPORTED_VERSION' }
const bad = message => { throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, message) }
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
/** 这些键说明调用方想用图形坐标或数组下标充当业务身份（DE10），一律拒绝。 */
const POSITIONAL_KEYS = ['dataIndex', 'seriesIndex', 'pixel', 'pixels', 'x', 'y', 'index']

/** 版本号检查：同一主版本（v1、v1.2 均可）通过；其他主版本明确不支持。 */
export function assertSchemaVersion(value, expected) {
  const [family, version] = String(value ?? '').split('/')
  const [expectedFamily, expectedVersion] = expected.split('/')
  const major = version?.split('.')[0]
  if (family !== expectedFamily || !/^v\d+(?:\.\d+)?$/.test(version ?? '') || major !== expectedVersion) {
    throw new InsightContractError(UNSUPPORTED, `不支持的契约版本：${String(value)}（当前支持 ${expected}）`)
  }
}

function assertKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (POSITIONAL_KEYS.includes(key)) bad(`${where}不能用「${key}」充当业务身份，请用规范对象、时段或记录引用`)
    if (!allowed.includes(key)) throw new InsightContractError(INSIGHT_ERRORS.UNKNOWN_FIELD, `${where}含未登记字段「${key}」，为避免口径被丢弃，交接被拒绝`, { field: key })
  }
}

function parseResultRef(value) {
  if (!isObject(value)) bad('缺少结果引用')
  assertKeys(value, ['queryId', 'resultVersion', 'readSetRef', 'expiresAt'], '结果引用')
  if (typeof value.queryId !== 'string' || !value.queryId) bad('结果引用缺少 queryId')
  if (!isResultVersion(value.resultVersion) || !isReadSetRef(value.readSetRef)) bad('结果引用缺少结果版本或读取版本集合')
  if (value.expiresAt !== undefined && value.expiresAt !== null && !Number.isFinite(Date.parse(value.expiresAt))) bad('结果引用的失效时间不正确')
  return { queryId: value.queryId, resultVersion: value.resultVersion, readSetRef: value.readSetRef, expiresAt: value.expiresAt ?? null }
}

function parseObjectRefs(list, where) {
  if (list === undefined) return []
  if (!Array.isArray(list) || list.length > 200) bad(`${where}对象引用应为最多 200 项的列表`)
  return list.map(ref => {
    if (!isObject(ref)) bad(`${where}对象引用格式不正确`)
    assertKeys(ref, ['type', 'id', 'effectiveAt'], `${where}对象引用`)
    if (typeof ref.type !== 'string' || typeof ref.id !== 'string' || !ref.type || !ref.id) bad(`${where}对象引用缺少类型或标识`)
    return { type: ref.type, id: ref.id, ...(ref.effectiveAt ? { effectiveAt: ref.effectiveAt } : {}) }
  })
}

function parseIntervals(list) {
  if (list === undefined) return []
  if (!Array.isArray(list) || list.length > 2000) bad('时段选区应为最多 2000 段的列表')
  return list.map(item => {
    if (!isObject(item)) bad('时段选区格式不正确')
    assertKeys(item, ['start', 'end'], '时段选区')
    const start = Date.parse(item.start), end = Date.parse(item.end)
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(String(item.start)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(String(item.end))) bad('时段必须带时区')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) bad('时段起止不正确')
    return { start: item.start, end: item.end }
  })
}

function parseMetricRefs(list) {
  if (list === undefined) return []
  if (!Array.isArray(list)) bad('指标引用应为列表')
  return list.map(ref => {
    if (!isObject(ref)) bad('指标引用格式不正确')
    assertKeys(ref, ['id', 'definitionVersion'], '指标引用')
    if (typeof ref.id !== 'string' || typeof ref.definitionVersion !== 'string') bad('指标引用必须带定义版本')
    return { id: ref.id, definitionVersion: ref.definitionVersion }
  })
}

/**
 * 语义选区（DE10）：规范对象、时段、指标、记录引用 + 所属结果版本。
 */
export function parseSelection(input) {
  if (!isObject(input)) bad('选区应为对象')
  assertKeys(input, ['schemaVersion', 'resultRef', 'regionId', 'companyId', 'objectRefs', 'timeIntervals', 'metricRefs', 'recordRefs', 'priceObject', 'marketPhase', 'sourceIds', 'contextVersion'], '选区')
  assertSchemaVersion(input.schemaVersion, SELECTION_SCHEMA)
  if (typeof input.regionId !== 'string' || !input.regionId) bad('选区缺少地区')
  if (!Number.isSafeInteger(input.contextVersion) || input.contextVersion < 0) bad('选区缺少上下文代次')
  if (input.priceObject !== undefined && input.priceObject !== null && !PRICE_OBJECTS.includes(input.priceObject)) bad('选区价格对象不正确')
  if (input.marketPhase !== undefined && input.marketPhase !== null && !MARKET_PHASES.includes(input.marketPhase)) bad('选区市场阶段不正确')
  const recordRefs = input.recordRefs ?? []
  if (!Array.isArray(recordRefs) || recordRefs.some(ref => typeof ref !== 'string' || !ref)) bad('记录引用应为字符串列表')
  const sourceIds = input.sourceIds ?? []
  if (!Array.isArray(sourceIds) || sourceIds.some(id => typeof id !== 'string' || !id)) bad('来源引用应为字符串列表')
  const selection = {
    schemaVersion: input.schemaVersion,
    resultRef: parseResultRef(input.resultRef),
    regionId: input.regionId,
    companyId: input.companyId ?? null,
    objectRefs: parseObjectRefs(input.objectRefs, '选区'),
    timeIntervals: parseIntervals(input.timeIntervals),
    metricRefs: parseMetricRefs(input.metricRefs),
    recordRefs: [...recordRefs],
    priceObject: input.priceObject ?? null,
    marketPhase: input.marketPhase ?? null,
    sourceIds: [...sourceIds],
    contextVersion: input.contextVersion,
  }
  if (!selection.objectRefs.length && !selection.timeIntervals.length && !selection.recordRefs.length) bad('选区至少包含对象、时段或记录中的一项')
  return selection
}

/**
 * 图表/表格事件是否仍属于当前上下文：地区、公司或代次任一不同即作废（迟到事件、A→B→A）。
 */
export function isSelectionCurrent(selection, current) {
  return selection.regionId === current.regionId
    && (selection.companyId ?? null) === (current.companyId ?? null)
    && selection.contextVersion === current.contextVersion
    && selection.resultRef.resultVersion === current.resultVersion
}

/** 跨模块交接信封（D11.1）。 */
export function parseHandoff(input) {
  if (!isObject(input)) bad('交接应为对象')
  assertKeys(input, ['schemaVersion', 'handoffId', 'originModule', 'actionId', 'contextVersion', 'resultRef', 'scope', 'businessWindow', 'metricRefs', 'priceObject', 'marketPhase', 'sourceIds', 'selection', 'analysisMode', 'asOf', 'evidenceRefs', 'viewRef', 'returnContext'], '交接')
  assertSchemaVersion(input.schemaVersion, HANDOFF_SCHEMA)
  for (const key of ['handoffId', 'originModule', 'actionId']) if (typeof input[key] !== 'string' || !input[key]) bad(`交接缺少 ${key}`)
  if (!Number.isSafeInteger(input.contextVersion) || input.contextVersion < 0) bad('交接缺少上下文代次')
  if (!isObject(input.scope)) bad('交接缺少业务范围')
  assertKeys(input.scope, ['regionId', 'companyId', 'objectRefs'], '交接业务范围')
  if (typeof input.scope.regionId !== 'string' || !input.scope.regionId) bad('交接业务范围缺少地区')
  if (!isObject(input.businessWindow)) bad('交接缺少业务窗')
  assertKeys(input.businessWindow, ['start', 'end', 'timeZone', 'nativeResolutionMinutes'], '交接业务窗')
  if (input.analysisMode !== undefined && !ANALYSIS_MODES.includes(input.analysisMode)) bad('交接分析模式不正确')
  if (input.analysisMode === 'ex-ante' && !input.asOf) bad('事前交接必须带截止时点')
  const evidenceRefs = input.evidenceRefs ?? []
  if (!Array.isArray(evidenceRefs) || evidenceRefs.some(ref => typeof ref !== 'string')) bad('证据引用应为字符串列表')
  if (!isObject(input.returnContext)) bad('交接缺少返回位置')
  assertKeys(input.returnContext, ['pageId', 'filters', 'viewState'], '返回位置')
  if (typeof input.returnContext.pageId !== 'string' || !input.returnContext.pageId) bad('返回位置缺少页面')
  return {
    schemaVersion: input.schemaVersion,
    handoffId: input.handoffId,
    originModule: input.originModule,
    actionId: input.actionId,
    contextVersion: input.contextVersion,
    resultRef: input.resultRef === undefined || input.resultRef === null ? null : parseResultRef(input.resultRef),
    scope: { regionId: input.scope.regionId, companyId: input.scope.companyId ?? null, objectRefs: parseObjectRefs(input.scope.objectRefs, '交接') },
    businessWindow: { ...input.businessWindow },
    metricRefs: parseMetricRefs(input.metricRefs),
    priceObject: input.priceObject ?? null,
    marketPhase: input.marketPhase ?? null,
    sourceIds: [...(input.sourceIds ?? [])],
    selection: input.selection === undefined || input.selection === null ? null : parseSelection(input.selection),
    analysisMode: input.analysisMode ?? 'ex-post',
    asOf: input.asOf ?? null,
    evidenceRefs: [...evidenceRefs],
    viewRef: input.viewRef ?? null,
    returnContext: { pageId: input.returnContext.pageId, filters: input.returnContext.filters ?? {}, viewState: input.returnContext.viewState ?? {} },
  }
}

/**
 * 接收反馈（CH06）：逐字段说明接收、丢弃（须征得用户确认后的显式删减）还是拒绝。
 * accepted 不得有丢弃或拒绝字段；partial 至少有一个 dropped；rejected/unavailable 必须给原因。
 */
export function buildReceipt({ status, fieldDecisions = [], reason = null, target = null, returnContext = null }) {
  if (!RECEIPT_STATUSES.includes(status)) throw new Error(`未登记的接收状态：${status}`)
  for (const item of fieldDecisions) {
    if (!FIELD_DECISIONS.includes(item.decision) || typeof item.field !== 'string') throw new Error('字段决定格式不正确')
    if (item.decision !== 'accepted' && !item.reason) throw new Error(`字段 ${item.field} 被${item.decision === 'dropped' ? '丢弃' : '拒绝'}时必须说明原因`)
  }
  const dropped = fieldDecisions.filter(item => item.decision === 'dropped')
  const rejected = fieldDecisions.filter(item => item.decision === 'rejected')
  if (status === 'accepted' && (dropped.length || rejected.length)) throw new Error('完全接收时不能丢弃或拒绝任何字段')
  if (status === 'partial' && !dropped.length) throw new Error('部分接收必须列出被丢弃的字段')
  if ((status === 'rejected' || status === 'unavailable') && !reason) throw new Error('拒绝或不可用必须给出原因')
  return { schemaVersion: RECEIPT_SCHEMA, status, fieldDecisions: fieldDecisions.map(item => ({ ...item })), reason, target, returnContext }
}

/**
 * 动作能力登记（CH07）：目标模块、接受的交接版本、必需输入、意图与当前可用性。
 * 可选目标未就绪只让这个动作不可用，不阻断洞察读取。
 */
export function defineInsightAction({ actionId, targetModule, acceptedSchemas = [HANDOFF_SCHEMA], requiredInputs = [], intent = 'read', available = false, unavailableReason = null }) {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(actionId ?? '')) throw new Error(`动作标识不正确：${actionId}`)
  if (!ACTION_INTENTS.includes(intent)) throw new Error(`未登记的动作意图：${intent}`)
  if (!available && !unavailableReason) throw new Error(`动作 ${actionId} 不可用时必须写明原因`)
  return Object.freeze({ actionId, targetModule, acceptedSchemas: Object.freeze([...acceptedSchemas]), requiredInputs: Object.freeze([...requiredInputs]), intent, available, unavailableReason })
}

/** 按动作能力检查一份交接：版本不接受、缺必需输入都给出拒绝反馈而不是假成功。 */
export function checkActionInput(action, handoff) {
  if (!action.available) return buildReceipt({ status: 'unavailable', reason: action.unavailableReason })
  const family = handoff.schemaVersion.split('.')[0]
  if (!action.acceptedSchemas.some(schema => schema.split('.')[0] === family)) return buildReceipt({ status: 'rejected', reason: `目标不接受 ${handoff.schemaVersion}` })
  const missing = action.requiredInputs.filter(field => {
    const value = field.split('.').reduce((node, key) => (node == null ? node : node[key]), handoff)
    return value === null || value === undefined || (Array.isArray(value) && !value.length)
  })
  if (missing.length) return buildReceipt({ status: 'rejected', reason: `缺少必需输入：${missing.join('、')}`, fieldDecisions: missing.map(field => ({ field, decision: 'rejected', reason: '必需输入缺失' })) })
  return null
}

/**
 * 规范结果数据（DE09）：维度、度量（带单位与指标引用）与行。图表只是这份数据的一种呈现。
 * 展示抽样必须声明方法与总体规模，不能用点数代替有效观测。
 */
export function assertResultData(data) {
  if (!isObject(data)) throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '规范结果数据应为对象')
  assertSchemaVersion(data.schemaVersion, RESULT_DATA_SCHEMA)
  if (!Array.isArray(data.dimensions) || !data.dimensions.length) throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '规范结果至少有一个维度')
  if (!Array.isArray(data.measures)) throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '规范结果缺少度量声明')
  for (const measure of data.measures) {
    if (typeof measure.id !== 'string' || typeof measure.unit !== 'string') throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '每个度量必须声明标识与单位')
  }
  if (!Array.isArray(data.rows)) throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '规范结果缺少数据行')
  const keys = new Set([...data.dimensions.map(item => item.id), ...data.measures.map(item => item.id), 'recordRef'])
  for (const row of data.rows) {
    for (const key of Object.keys(row)) if (!keys.has(key)) throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, `数据行含未声明的列 ${key}`)
  }
  if (data.sampling) {
    if (typeof data.sampling.method !== 'string' || !Number.isSafeInteger(data.sampling.population)) throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, '抽样展示必须声明方法与总体规模')
  }
  return data
}
