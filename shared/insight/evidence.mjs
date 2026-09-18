// 读取版本集合与结果版本（#2993 任务 3.10，DE11、D4.1）。
//
// contextVersion 只能挡住「筛选切换后的迟到响应」，挡不住「同一筛选内源资料被更新」。
// 所以每个规范结果另带：
//   readSetRef    —— 参与计算的源版本（批次/修订号或内容指纹）、对象映射版本、指标定义与方法版本的规范化摘要
//   resultVersion —— readSetRef + 分析身份 + 生效筛选 + 规范结果内容的摘要
// 下钻、翻页、导出、保存都带上期望版本；服务端重取原版本或核验当前输入指纹，不一致就返回冲突，
// 绝不把新数据悄悄当成用户看过的那一版保存。asOf/generatedAt 都不是读取版本证明。
//
// 本文件只做规范化与比对（前后端同构）；摘要值由服务端用 sha256 计算后以 rv1:/rs1: 前缀下发。

import { INSIGHT_ERRORS, InsightContractError, isReadSetRef, isResultVersion } from './contract.mjs'

const fail = message => { throw new InsightContractError(INSIGHT_ERRORS.UNPROCESSABLE, message) }

/** 稳定序列化：对象键排序、undefined 字段丢弃；数组保持顺序。同一内容恒得同一字符串。 */
export function canonicalJson(value) {
  const normalize = input => {
    if (Array.isArray(input)) return input.map(item => (item === undefined ? null : normalize(item)))
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().filter(key => input[key] !== undefined).map(key => [key, normalize(input[key])]))
    }
    if (typeof input === 'number' && !Number.isFinite(input)) throw new Error('规范序列化不接受非有限数值')
    return input
  }
  return JSON.stringify(normalize(value))
}

/**
 * 读取版本集合（摘要前的规范形态）。
 * @param {{
 *   sources: Array<{ sourceId: string, versionToken: string, window?: { start: string, end: string }, rowCount?: number }>,
 *   mappingVersion?: string|null,
 *   metricVersions?: Record<string, string>,
 *   methodVersion: string,
 * }} input
 * versionToken 必须来自源所有者能复核的东西：批次号、上游修订号，或受限读取时算出的内容指纹；
 * 不能用查询时间代替。
 */
export function buildReadSet({ sources, mappingVersion = null, metricVersions = {}, methodVersion }) {
  if (!Array.isArray(sources) || !sources.length) fail('读取版本集合至少包含一个来源')
  for (const source of sources) {
    if (typeof source?.sourceId !== 'string' || !source.sourceId) fail('读取版本集合里的来源缺少标识')
    if (typeof source.versionToken !== 'string' || !source.versionToken.trim()) fail(`来源 ${source.sourceId} 缺少可复核的版本标记`)
  }
  if (typeof methodVersion !== 'string' || !methodVersion) fail('读取版本集合缺少方法版本')
  const ids = sources.map(source => source.sourceId)
  if (new Set(ids).size !== ids.length) fail('读取版本集合里的来源重复')
  return {
    schema: 'insight-read-set/v1',
    sources: [...sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId)).map(({ sourceId, versionToken, window = null, rowCount = null }) => ({ sourceId, versionToken, window, rowCount })),
    mappingVersion,
    metricVersions: Object.fromEntries(Object.entries(metricVersions).sort(([a], [b]) => a.localeCompare(b))),
    methodVersion,
  }
}

/** 结果版本的规范输入：读取版本 + 分析身份 + 生效筛选 + 规范结果内容。 */
export function resultVersionInput({ readSetRef, analysisId, analysisVersion, scope, filters, data }) {
  if (!isReadSetRef(readSetRef)) fail('结果版本需要合法的读取版本集合引用')
  return { schema: 'insight-result/v1', readSetRef, analysisId, analysisVersion, scope, filters, data }
}

/**
 * 核验期望版本（D4.1）：
 *   match        期望与当前一致，可以继续（翻页、导出、保存）
 *   conflict     源已变化，必须提示刷新或另存新运行，不得用新值冒充旧图
 *   expired      短时引用已过期，需要重新查询
 *   unverifiable 当前无法证明一致（源不能按版本读、又没有可比的指纹），按冲突处理
 */
export function checkExpectedResult({ expected, current, now = Date.now() }) {
  if (!expected) return { status: 'match' }
  if (!isResultVersion(expected.resultVersion) || !isReadSetRef(expected.readSetRef)) fail('期望结果版本格式不正确')
  if (expected.expiresAt && Date.parse(expected.expiresAt) <= now) return { status: 'expired', reason: '结果引用已过期，请重新查询' }
  if (!current || !isReadSetRef(current.readSetRef)) return { status: 'unverifiable', reason: '当前无法证明源资料与所看结果一致，请刷新后再操作' }
  if (current.readSetRef !== expected.readSetRef) return { status: 'conflict', reason: '源资料已更新，当前看到的结果不再是最新读取版本，请刷新或另存为新运行' }
  if (current.resultVersion && current.resultVersion !== expected.resultVersion) return { status: 'conflict', reason: '同一读取版本下结果不一致，请刷新后重试' }
  return { status: 'match' }
}

/** 把核验结论转成接口错误：只有 match 能继续；其余一律 409，不静默返回新结果。 */
export function assertExpectedResult(input) {
  const verdict = checkExpectedResult(input)
  if (verdict.status !== 'match') throw new InsightContractError(INSIGHT_ERRORS.VERSION_CONFLICT, verdict.reason, { verdict: verdict.status })
  return verdict
}
