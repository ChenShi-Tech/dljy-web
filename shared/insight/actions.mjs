// 动作能力发现、adapter 与版本化接收反馈（#3099，OpenSpec 任务 15.7 dljy 部分，
// 规格 insight-context-handoff CH06—CH07、design D11.1）。
//
// 三条边界：
//   1. 动作目录是白名单：未登记的 actionId 404，任意业务编排、SQL 或外部插件不接受（CH07）。
//   2. resolve 只做解析与校验，不执行业务写入；目标模块二次授权，scope 只是请求范围不是凭据。
//   3. 目标离线或消费者未就绪只让该动作 unavailable（写明原因），不阻断洞察读取，
//      也不打开默认对象/默认区域价格冒充成功（预测中心首期恒 unavailable）。

import { INSIGHT_ERRORS, InsightContractError, assertKnownKeys } from './contract.mjs'
import { getInsightSource } from './sources.mjs'
import { HANDOFF_SCHEMA, RECEIPT_SCHEMA, buildReceipt, checkActionInput, defineInsightAction, parseHandoff } from './handoff.mjs'

export { HANDOFF_SCHEMA, RECEIPT_SCHEMA }

// ── 目标模块登记（adapter 与探活）：entry 是稳定入口标识，由前端映射到既有页面/组件；──
// ── 不造新的事件总线或编排引擎。ready:false 的目标其动作登记后仍恒 unavailable。      ──
export const INSIGHT_ACTION_TARGETS = Object.freeze({
  'research-workbench': Object.freeze({ module: 'research-workbench', ready: true, entry: 'research/preview', note: '研究工作台：选区→预设→原页返回（既有页面载体）' }),
  'object-navigation': Object.freeze({ module: 'object-navigation', ready: true, entry: 'objectNavigation', note: '空间资产/披露对象查阅（复用既有 objectNavigation）' }),
  'material': Object.freeze({ module: 'material', ready: true, entry: 'material/attach', note: '专题材料既有保存通道（重试不重复创建）' }),
  'forecast-center': Object.freeze({ module: 'forecast-center', ready: false, entry: null, note: '预测中心消费者未登记：首期只声明能力，不打开默认区域价格冒充场站预测' }),
  'trade': Object.freeze({ module: 'trade', ready: true, entry: 'trade/view', note: '现货/中长期已确认事实的获权查看入口（洞察不写单、不申报）' }),
  'settlement': Object.freeze({ module: 'settlement', ready: true, entry: 'settlement/view', note: '结算单据的获权查看入口（洞察不改电费）' }),
  'data-maintenance': Object.freeze({ module: 'data-maintenance', ready: true, entry: 'upload-center', note: '数据资料维护：返回后重新查询 coverage，离开页面不视为已补齐' }),
})

/** 目标探活的默认实现：登记表说了算；route 可注入探活依赖（目标离线不挡洞察）。 */
export function defaultTargetStatus(targetModule) {
  const target = INSIGHT_ACTION_TARGETS[targetModule]
  if (!target) return { ready: false, entry: null, reason: `目标模块 ${targetModule} 未登记：动作不可用，不静默改道` }
  return target.ready
    ? { ready: true, entry: target.entry, reason: null }
    : { ready: false, entry: null, reason: target.note }
}

const entry = ({ actionId, targetModule, title, regionIds = ['yunnan'], requiredInputs, ignoredInputs = [], intent = 'read', available = true, unavailableReason = null }) => {
  const target = INSIGHT_ACTION_TARGETS[targetModule]
  if (!target) throw new Error(`动作 ${actionId} 的目标模块 ${targetModule} 未登记`)
  if (!Array.isArray(requiredInputs) || !requiredInputs.length) throw new Error(`动作 ${actionId} 必须声明必需输入`)
  return Object.freeze({
    ...defineInsightAction({ actionId, targetModule, acceptedSchemas: [HANDOFF_SCHEMA], requiredInputs, intent, available, unavailableReason }),
    title,
    regionIds: Object.freeze([...regionIds]),
    // 顶层交接字段中目标不消费的部分：出现即逐项 dropped（partial），不静默跳过。
    ignoredInputs: Object.freeze([...ignoredInputs]),
    target: Object.freeze({ ...target, ready: target.ready && available }),
  })
}

/**
 * 首期动作目录（D11.1 双向衔接清单）。requiredInputs 按「.」寻径到交接字段；
 * 空数组/空对象视为缺失。regionIds 沿用来源登记的地区白名单惯例（RS01）。
 */
export const INSIGHT_ACTIONS = Object.freeze([
  entry({
    actionId: 'research.run-preset', targetModule: 'research-workbench',
    title: '以当前选区运行研究预设（原页返回）',
    requiredInputs: ['selection', 'businessWindow.start'],
  }),
  entry({
    actionId: 'object.navigate', targetModule: 'object-navigation',
    title: '打开选区对象的既有查阅页',
    requiredInputs: ['scope.objectRefs'],
    ignoredInputs: ['metricRefs', 'marketPhase', 'viewRef'],
  }),
  entry({
    actionId: 'material.attach', targetModule: 'material',
    title: '把选区结果存为专题材料（既有保存通道）',
    requiredInputs: ['selection.resultRef'],
    ignoredInputs: ['viewRef'],
  }),
  entry({
    actionId: 'forecast.request', targetModule: 'forecast-center',
    title: '把指标目标交给预测中心',
    requiredInputs: ['scope.objectRefs', 'businessWindow.start'],
    available: false,
    unavailableReason: INSIGHT_ACTION_TARGETS['forecast-center'].note,
  }),
  entry({
    actionId: 'trade.open-module', targetModule: 'trade',
    title: '在交易模块查看分析依据（只读）',
    requiredInputs: ['businessWindow.start'],
    ignoredInputs: ['metricRefs', 'viewRef'],
  }),
  entry({
    actionId: 'settlement.open-module', targetModule: 'settlement',
    title: '在结算模块查看对应单据（只读）',
    requiredInputs: ['businessWindow.start'],
    ignoredInputs: ['metricRefs', 'viewRef'],
  }),
  entry({
    actionId: 'data.maintenance', targetModule: 'data-maintenance',
    title: '带缺口信息进入数据资料维护',
    requiredInputs: ['businessWindow.start'],
    ignoredInputs: ['selection', 'viewRef'],
  }),
])

const BY_ID = new Map(INSIGHT_ACTIONS.map(item => [item.actionId, item]))

/** 未知 actionId 返回 null，由调用方转 404（NOT_REGISTERED），不吞成 unavailable。 */
export function getInsightAction(actionId) {
  return BY_ID.get(actionId) ?? null
}

/** 能力发现：只列当前地区已登记的动作；未登记地区返回空列表，不借用其他地区的登记。 */
export function listInsightActions({ regionId } = {}) {
  if (!regionId) return [...INSIGHT_ACTIONS]
  return INSIGHT_ACTIONS.filter(item => item.regionIds.includes(regionId))
}

/** 动作目录的对外形状（GET /actions 能力发现）。 */
export function describeAction(action) {
  return {
    actionId: action.actionId,
    title: action.title,
    targetModule: action.targetModule,
    target: { ...action.target },
    acceptedSchemas: [...action.acceptedSchemas],
    requiredInputs: [...action.requiredInputs],
    ignoredInputs: [...action.ignoredInputs],
    intent: action.intent,
    available: action.available,
    unavailableReason: action.unavailableReason,
    regionIds: [...action.regionIds],
  }
}

/** 动作解析请求：{ actionId, handoff }；未知字段拒绝（影响口径的条件不能静默丢弃）。 */
export function parseActionResolveRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, '动作解析请求应为对象')
  }
  assertKnownKeys(body, ['actionId', 'handoff'], '动作解析请求')
  if (typeof body.actionId !== 'string' || !body.actionId) {
    throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, '动作解析请求缺少 actionId')
  }
  return { actionId: body.actionId, handoff: body.handoff }
}

const dotValue = (source, path) => String(path).split('.').reduce((node, key) => (node == null ? node : node[key]), source)
const isPresent = value => value !== null && value !== undefined && !(Array.isArray(value) && !value.length)

/**
 * 动作解析（CH06/CH07）：
 *   未知 actionId / 地区未登记 → 抛 404 语义（NOT_REGISTERED）；
 *   目标未就绪或动作不可用 → unavailable + 原因（先于版本与输入检查）；
 *   交接版本不被接受 / 必需输入缺失 → rejected（逐字段说明）；
 *   来源未登记 → rejected（不静默忽略影响口径的条件）；
 *   目标不消费的顶层字段 → 逐项 dropped（partial）；全部接收 → accepted。
 * 返回的 target 只是合法登记项，不构成授权；接收方执行时仍按登录身份重新鉴权。
 */
export function resolveInsightAction({ actionId, handoff, regionId = null, isTargetReady = defaultTargetStatus }) {
  const action = getInsightAction(actionId)
  if (!action) throw new InsightContractError(INSIGHT_ERRORS.NOT_REGISTERED, `未登记的洞察动作：${actionId}`)
  if (regionId && !action.regionIds.includes(regionId)) {
    throw new InsightContractError(INSIGHT_ERRORS.NOT_REGISTERED, `地区 ${regionId} 未登记动作 ${actionId}`)
  }
  const parsed = parseHandoff(handoff)
  if (parsed.actionId !== actionId) {
    throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, `交接的 actionId（${parsed.actionId}）与请求解析的动作（${actionId}）不一致`)
  }
  if (regionId && parsed.scope.regionId !== regionId) {
    throw new InsightContractError(INSIGHT_ERRORS.BAD_REQUEST, '交接业务范围的地区与当前选择的地区不一致，请刷新后重试')
  }
  const targetStatus = isTargetReady(action.targetModule)
  const targetOf = ready => ({ module: action.targetModule, entry: ready ? (targetStatus.entry ?? action.target.entry) : null, ready, note: action.target.note })
  if (!action.available || !targetStatus.ready) {
    return {
      actionId,
      action,
      receipt: buildReceipt({
        status: 'unavailable',
        reason: action.available ? targetStatus.reason : action.unavailableReason,
        target: targetOf(false),
        returnContext: parsed.returnContext,
      }),
    }
  }
  const failed = checkActionInput(action, parsed)
  if (failed) {
    return { actionId, action, receipt: { ...failed, target: targetOf(true), returnContext: parsed.returnContext } }
  }
  // 交接声称的来源必须已登记：未知来源无法核验口径，直接拒绝（CH06 不静默跳默认）。
  const claimedSources = [...new Set([...parsed.sourceIds, ...(parsed.selection?.sourceIds ?? [])])]
  const unknownSources = claimedSources.filter(id => !getInsightSource(id))
  if (unknownSources.length) {
    return {
      actionId,
      action,
      receipt: buildReceipt({
        status: 'rejected',
        reason: `来源未登记，目标无法核验口径：${unknownSources.join('、')}`,
        fieldDecisions: unknownSources.map(id => ({ field: `sourceIds:${id}`, decision: 'rejected', reason: '来源未登记' })),
        target: targetOf(true),
        returnContext: parsed.returnContext,
      }),
    }
  }
  const dropped = action.ignoredInputs
    .filter(field => isPresent(dotValue(parsed, field)))
    .map(field => ({ field, decision: 'dropped', reason: `目标 ${action.targetModule} 不消费 ${field}：需要保留该条件请改用支持它的动作` }))
  return {
    actionId,
    action,
    receipt: buildReceipt({
      status: dropped.length ? 'partial' : 'accepted',
      fieldDecisions: [
        ...action.requiredInputs.map(field => ({ field, decision: 'accepted' })),
        ...dropped,
      ],
      target: targetOf(true),
      returnContext: parsed.returnContext,
    }),
  }
}
