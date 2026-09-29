// ============================================================================
// 申报单风控检查：手册 T4 十项在申报状态机上的落地
// ----------------------------------------------------------------------------
// 服务端 `runRiskCheck`（DRAFT → RISK_CHECKED）的判定实现。放 shared/ 是因为前端
// 申报台也要用同一份——交易员在点「风控检查」之前就该看到会被什么拦住，而不是提交
// 后才被服务端弹回来。前后端两份实现必然漂移，这里只有一份。
//
// 三个必须说清的设计点：
//
// ① **严重性分三档，不是两档**。硬约束（市场规则本身不允许）任何人放行不了；
//    可放行项（公司内控收紧的管理带）双签后可越过；告警只提示。把「规则不允许」
//    和「公司不建议」混成一档，要么该拦的被一句「主管同意了」放过去，要么不该拦的
//    把人堵死在死线前。
//
// ② **不适用 ≠ 通过**。当前申报单是 96 点时序曲线结构，没有「发电侧分段报价」的段
//    概念，所以段单调性/段长度这两项**无法在此结构上校验**——它们标 UNAVAILABLE
//    并升档，而不是伪装成 PASS。同理，偏置校验需要负荷预测量、储能校验需要 SOC 与
//    价格参数，这些输入没接进来之前一律 UNAVAILABLE。
//    随着数据接入，UNAVAILABLE 会逐条变成真检查——这是骨架，不是占位。
//
// ③ **数据基线是硬门禁**。`synthetic`（合成演示）绝不允许申报；`illustrative`
//    （特征示意）当前是系统默认值，全拦会打死流程，故列为可放行——但要有人双签
//    担责。`real`/`captured` 才是实盘决策级口径（与 `isDecisionGrade` 同口径）。
//    `provisional`（暂定口径，#2556）介于两者之间：有工程依据（持仓分解 + 储能净
//    放电叠加）但未经结算验证——不阻断，只给 warning 提醒核对持仓基线。
// ============================================================================

/**
 * @typedef {'PASS'|'FAIL'|'UNAVAILABLE'} CheckStatus
 * @typedef {'hard'|'overridable'|'warning'} CheckSeverity
 */

/**
 * @typedef {Object} DeclarationCheck
 * @property {string} checkId
 * @property {string} name
 * @property {CheckStatus} status
 * @property {CheckSeverity} severity
 * @property {string} detail
 */

/** 可作为实盘决策依据的数据基线（与 src/services/dataBasis.ts::isDecisionGrade 同口径）。 */
export const DECISION_GRADE_BASIS = ['real', 'captured']

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

/**
 * 十项申报检查。
 *
 * @param {Object} declaration 申报单
 * @param {Object} [inputs] 外部注入的判定依据
 * @param {{floor?:number,cap?:number,source?:string}|null} [inputs.priceCap] 地区限价
 * @param {Object|null} [inputs.exposure] 中长期敞口：套保服务目标日「仅中长期」逐时段敞口摘要（server/declaration-hedge-exposure.mjs）
 * @param {string} [inputs.subjectType] 主体立场
 * @param {number[]|null} [inputs.forecastCurveMwh96] 负荷预测量（偏置校验用）
 * @param {number} [inputs.biasManagementBand] 偏置管理带，默认 0.2
 * @param {number} [inputs.biasLegalBand] 偏置法定带，默认 0.3
 * @param {string[]} [inputs.redLinesTouched] 合规红线自检结果
 * @param {{trajectoryOk:boolean,endOk:boolean}|null} [inputs.soc] 储能 SOC 校验结论
 * @param {number|null} [inputs.safetyMultiple] 储能盈亏平衡安全倍数
 * @param {number} [inputs.safetyMultipleThreshold] 安全倍数阈值，默认 1.15
 * @returns {{checks: DeclarationCheck[], passed: boolean, blocked: boolean, blockers: DeclarationCheck[], gateLevel: 'L2'|'L3', totalMwh: number, maxMw: number, evaluatedAt: string}}
 */
export function evaluateDeclarationChecks(declaration, inputs = {}) {
  /** @type {DeclarationCheck[]} */
  const checks = []
  const energy = Array.isArray(declaration.energyCurveMwh96) ? declaration.energyCurveMwh96 : []
  const totalMwh = energy.reduce((sum, v) => sum + (Number(v) || 0), 0)
  const maxMw = energy.reduce((max, v) => Math.max(max, (Number(v) || 0) * 4), 0)
  const subjectType = String(inputs.subjectType ?? declaration.subjectType ?? '')
  const prices = Array.isArray(declaration.priceCurve96) ? declaration.priceCurve96 : null

  // ① 功率约束 —— 申报最大功率不得超过可用容量
  const capacityMw = Number(declaration.capacityMw) || 0
  checks.push({
    checkId: 'capacity',
    name: '功率约束',
    status: capacityMw > 0 && maxMw <= capacityMw ? 'PASS' : 'FAIL',
    severity: 'hard',
    detail: `申报最大功率 ${round2(maxMw)} MW / 可用容量 ${round2(capacityMw)} MW`
  })

  // ② 限价合规
  if (!prices || !prices.length) {
    checks.push({
      checkId: 'priceCap',
      name: '限价合规',
      status: 'PASS',
      severity: 'hard',
      detail: '报量不报价，无价格曲线需校验'
    })
  } else if (!inputs.priceCap || !Number.isFinite(Number(inputs.priceCap.cap))) {
    checks.push({
      checkId: 'priceCap',
      name: '限价合规',
      status: 'UNAVAILABLE',
      severity: 'hard',
      detail: '未提供地区限价区间（RegionSpotProfile.mechanism.priceCap）'
    })
  } else {
    const floor = Number(inputs.priceCap.floor ?? -Infinity)
    const cap = Number(inputs.priceCap.cap)
    const offenders = prices.filter((p) => Number(p) < floor || Number(p) > cap).length
    checks.push({
      checkId: 'priceCap',
      name: '限价合规',
      status: offenders === 0 ? 'PASS' : 'FAIL',
      severity: 'hard',
      detail: offenders === 0
        ? `96 点申报价均在 [${floor}, ${cap}] 元/MWh 区间（来源 ${inputs.priceCap.source ?? 'region-profile'}）`
        : `${offenders} 个时点申报价越出 [${floor}, ${cap}] 元/MWh`
    })
  }

  // ③ 报价精度与分段单调性
  if (!prices || !prices.length) {
    checks.push({
      checkId: 'quotePrecision',
      name: '报价精度与段单调性',
      status: 'PASS',
      severity: 'hard',
      detail: '报量不报价，无需校验'
    })
  } else {
    const nonInteger = prices.filter((p) => !Number.isInteger(Number(p))).length
    checks.push({
      checkId: 'quotePrecision',
      name: '报价精度与段单调性',
      // 96 点是时序曲线，本就不该单调；段单调性属发电侧分段报价单（T1）的结构，
      // 当前单据类型上无从校验 —— 如实标 UNAVAILABLE 而非伪装成 PASS。
      status: nonInteger > 0 ? 'FAIL' : 'UNAVAILABLE',
      severity: 'hard',
      detail: nonInteger > 0
        ? `${nonInteger} 个时点报价非整数元/MWh`
        : '报价精度通过；段单调性需分段报价单（T1）结构，当前 96 点曲线单据无从校验'
    })
  }

  // ④ 中长期敞口（HA-02：约束只取套保服务在目标日给出的「仅中长期」逐时段敞口）
  checks.push(exposureCheck({ exposure: inputs.exposure, energy, totalMwh, subjectType }))

  // ⑤ 用户侧申报偏置
  const forecast = Array.isArray(inputs.forecastCurveMwh96) ? inputs.forecastCurveMwh96 : null
  const mgmtBand = Number.isFinite(inputs.biasManagementBand) ? inputs.biasManagementBand : 0.2
  const legalBand = Number.isFinite(inputs.biasLegalBand) ? inputs.biasLegalBand : 0.3
  if (!['RETAILER', 'LOAD'].includes(subjectType)) {
    checks.push({
      checkId: 'bias',
      name: '用户侧申报偏置',
      status: 'PASS',
      severity: 'hard',
      detail: `本立场（${subjectType || '未声明'}）无用户侧需求申报，不适用`
    })
  } else if (!forecast || forecast.length !== energy.length) {
    checks.push({
      checkId: 'bias',
      name: '用户侧申报偏置',
      status: 'UNAVAILABLE',
      severity: 'hard',
      detail: '未提供同长度负荷预测曲线，无法计算偏置（按升档审批处理）'
    })
  } else {
    let maxAbs = 0
    for (let i = 0; i < energy.length; i += 1) {
      const base = Number(forecast[i]) || 0
      if (base <= 0) continue
      maxAbs = Math.max(maxAbs, Math.abs((Number(energy[i]) || 0) - base) / base)
    }
    const overLegal = maxAbs > legalBand + 1e-9
    checks.push({
      checkId: 'bias',
      name: '用户侧申报偏置',
      status: maxAbs <= mgmtBand + 1e-9 ? 'PASS' : 'FAIL',
      // 越法定带任何人放行不了；只越管理带是内控问题，可双签放行
      severity: overLegal ? 'hard' : 'overridable',
      detail: `最大偏置 ${(maxAbs * 100).toFixed(1)}%（管理带 ±${(mgmtBand * 100).toFixed(0)}%，法定带 ±${(legalBand * 100).toFixed(0)}%）${overLegal ? ' —— 已越法定带' : ''}`
    })
  }

  // ⑥ 数据基线门禁
  const basis = String(declaration.basis ?? '')
  if (DECISION_GRADE_BASIS.includes(basis)) {
    checks.push({
      checkId: 'dataBasis',
      name: '数据可信度门禁',
      status: 'PASS',
      severity: 'hard',
      detail: `数据基线 ${basis}，属实盘决策级口径`
    })
  } else if (basis === 'provisional') {
    // 暂定口径（#2556 申报链）：持仓分解基线 + 储能净放电叠加，有工程依据但未经
    // 结算验证——不阻断流程，但必须提醒核对持仓基线（#2560 D2-a 口径）。
    checks.push({
      checkId: 'dataBasis',
      name: '数据可信度门禁',
      status: 'PASS',
      severity: 'warning',
      detail: '数据基线为暂定口径（provisional），建议核对持仓基线——未经结算验证，正式提交前须业务复核'
    })
  } else if (basis === 'synthetic') {
    checks.push({
      checkId: 'dataBasis',
      name: '数据可信度门禁',
      status: 'FAIL',
      severity: 'hard',
      detail: '数据基线为合成演示数据（synthetic），绝不允许进入申报'
    })
  } else {
    checks.push({
      checkId: 'dataBasis',
      name: '数据可信度门禁',
      status: 'FAIL',
      // illustrative 是当前系统默认值，全拦会打死流程；列为可放行但须双签担责
      severity: 'overridable',
      detail: `数据基线 ${basis || '未声明'}（非实盘决策级），以此申报须双签担责`
    })
  }

  // ⑦ 报价依据摘要（S13 监管质询时的自证材料）
  const rationale = String(declaration.quoteRationale ?? '').trim()
  if (rationale) {
    checks.push({
      checkId: 'quoteRationale',
      name: '报价依据摘要',
      status: 'PASS',
      severity: 'hard',
      detail: `已填写（${rationale.length} 字），可追溯报价形成过程`
    })
  } else if (declaration.quoteRationale === undefined) {
    checks.push({
      checkId: 'quoteRationale',
      name: '报价依据摘要',
      // 存量单在该字段入契约之前创建，无从要求——升档而非拦死
      status: 'UNAVAILABLE',
      severity: 'hard',
      detail: '存量申报单无此字段（该字段在契约中新增），按升档审批处理'
    })
  } else {
    checks.push({
      checkId: 'quoteRationale',
      name: '报价依据摘要',
      status: 'FAIL',
      severity: 'hard',
      detail: '报价依据摘要为空——监管质询时无法自证报价形成过程'
    })
  }

  // ⑧ 合规红线自检
  const redLines = Array.isArray(inputs.redLinesTouched) ? inputs.redLinesTouched.filter(Boolean) : []
  checks.push({
    checkId: 'redLine',
    name: '合规红线自检',
    status: redLines.length === 0 ? 'PASS' : 'FAIL',
    severity: 'hard',
    detail: redLines.length === 0 ? '未申报触碰任何红线' : `触碰：${redLines.join('、')}`
  })

  // ⑨/⑩ 储能专属：SOC 轨迹与盈亏平衡
  const isStorage = subjectType === 'STORAGE'
  if (!isStorage) {
    checks.push({
      checkId: 'socTrajectory',
      name: '储能 SOC 轨迹',
      status: 'PASS',
      severity: 'hard',
      detail: `本立场（${subjectType || '未声明'}）无储能资产，不适用`
    })
    checks.push({
      checkId: 'breakeven',
      name: '储能盈亏平衡安全倍数',
      status: 'PASS',
      severity: 'overridable',
      detail: '本立场无储能资产，不适用'
    })
  } else {
    const soc = inputs.soc
    checks.push({
      checkId: 'socTrajectory',
      name: '储能 SOC 轨迹',
      status: !soc ? 'UNAVAILABLE' : soc.trajectoryOk && soc.endOk ? 'PASS' : 'FAIL',
      severity: 'hard',
      detail: !soc
        ? '未提供 SOC 轨迹校验结论（储能计划未接入，按升档审批处理）'
        : `轨迹${soc.trajectoryOk ? '在带内' : '越界'}，终止 SOC ${soc.endOk ? '达标' : '未达标'}`
    })
    const sm = inputs.safetyMultiple
    const smThreshold = Number.isFinite(inputs.safetyMultipleThreshold) ? inputs.safetyMultipleThreshold : 1.15
    checks.push({
      checkId: 'breakeven',
      name: '储能盈亏平衡安全倍数',
      status: !Number.isFinite(sm) ? 'UNAVAILABLE' : sm >= smThreshold ? 'PASS' : 'FAIL',
      severity: 'overridable',
      detail: !Number.isFinite(sm)
        ? '未提供安全倍数（储能计划未接入，按升档审批处理）'
        : `安全倍数 ${Number(sm).toFixed(2)}（阈值 ${smThreshold}）`
    })
  }

  const blockers = checks.filter((c) => c.severity === 'hard' && c.status === 'FAIL')
  const failed = checks.some((c) => c.status === 'FAIL')
  const degraded = checks.some((c) => c.status === 'UNAVAILABLE')

  return {
    checks,
    passed: !failed && !degraded,
    // 硬约束不通过 → 拦住状态转移，任何人放行不了
    blocked: blockers.length > 0,
    blockers,
    // 风控未全过 → DecisionGate 升档（L2 → L3），对齐分权设计的申报队列档位
    gateLevel: !failed && !degraded ? 'L2' : 'L3',
    totalMwh: round2(totalMwh),
    maxMw: round2(maxMw),
    evaluatedAt: new Date().toISOString()
  }
}

/** 敞口容忍度：申报量不超过敞口 × (1 + 10%)。 */
const EXPOSURE_TOLERANCE = 0.1

/** 取不到可施加约束的原因 → 文案（原因码与套保判级的未评估原因同名，见 shared/hedge/contract.mjs ASSESSMENT_REASONS）。 */
const EXPOSURE_UNAVAILABLE_LABELS = {
  REGION_UNSUPPORTED: '该地区未开放套保模块',
  NO_REGION: '申报单未归属地区',
  NO_CREDENTIAL: '无访问凭据',
  FORBIDDEN: '无权限查看中长期持仓',
  LEG_FAILED: '套保服务数据加载失败',
  ALL_UNKNOWN: '目标日全部时段敞口未知',
  SUBJECT_UNSUPPORTED: '该申报主体没有对应的套保敞口数据'
}

function unknownBreakdownText(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return ''
  const parts = []
  if (breakdown.LOCKED_CURVE_MISSING) parts.push(`锁价分时未知 ${breakdown.LOCKED_CURVE_MISSING}`)
  if (breakdown.GENERATION_UNKNOWN) parts.push(`发电未知 ${breakdown.GENERATION_UNKNOWN}`)
  if (breakdown.NO_DATA) parts.push(`无锁价与发电数据 ${breakdown.NO_DATA}`)
  return parts.join('、')
}

/** 约束来源说明：只在确实读到了套保结果（有生成时刻）时给出；未开放地区、无凭据、无权限等根本没读，不写来源。 */
function constraintSourceText(exposure, { basisNote = true } = {}) {
  const src = exposure?.constraintSource
  if (!src || !src.generatedAt) return ''
  const range = src.targetDate ? `目标日 ${src.targetDate}` : `${src.fromDate ?? '?'}~${src.toDate ?? '?'}`
  return `；约束来源：${src.label ?? '套保服务'}（仅中长期口径，${range}，生成于 ${src.generatedAt}）${basisNote ? '，机制电量不计入' : ''}`
}

/**
 * ④ 中长期敞口（HA-02）。
 *
 * 约束 = 套保服务在目标日给出的「仅中长期」逐时段敞口（机制电量不计入）；按申报方向取售出或购入
 * 敞口，申报量不超过敞口 × 1.1 为 PASS。敞口对象形状见 server/declaration-hedge-exposure.mjs：
 * - 带 `knownIntervalIndexes`（套保服务的逐时段结果）：只对已知时段施加约束——申报量只累计
 *   落在已知时段的 15 分钟点，未知时段的申报量不参与比较并在 detail 说明；
 * - 不带（人工填报或旧形状）：按全日申报总量比较，与原判据一致。
 *
 * 套保敞口是发电侧口径（场站发电 − 中长期锁价），只对发电主体给出；其余主体由取数层判为
 * SUBJECT_UNSUPPORTED，不拿发电侧的负敞口冒充购入敞口。
 *
 * 状态取舍：取不到可施加的约束时（全部时段未知 / 地区未开放 / 主体无对应数据腿 / 无访问凭据 /
 * 无权限查看中长期持仓 / 服务失败）一律 UNAVAILABLE，而不是 PASS。现有三档枚举里 PASS 只用于「本立场不适用」
 * （如售电立场没有储能资产），这里约束本身适用、只是数据给不出——属于文件头设计点 ②「输入没接进来
 * 之前一律 UNAVAILABLE」：不拦死（可放行项），但按升档审批处理，不把「没评估」当成「安全」
 * （与 HA-01 风控面板「未评估不计为安全」同一立场）。
 */
function exposureCheck({ exposure, energy, totalMwh, subjectType }) {
  const base = { checkId: 'exposure', name: '中长期敞口', severity: 'overridable' }
  const sellSide = ['GENERATOR', 'STORAGE'].includes(subjectType)
  const sideLabel = sellSide ? '售出' : '购入'
  const knownIndexes = exposure && Array.isArray(exposure.knownIntervalIndexes) ? exposure.knownIntervalIndexes : null
  const allUnknown = Boolean(exposure) && exposure.available !== false && knownIndexes !== null && knownIndexes.length === 0

  if (!exposure || exposure.available === false || allUnknown) {
    const reason = allUnknown ? 'ALL_UNKNOWN' : exposure?.reason
    const label = EXPOSURE_UNAVAILABLE_LABELS[reason] ?? exposure?.reasonLabel ?? '敞口数据不可用'
    // 全部未知时 note 是整段摘要（含来源），这里只取未知原因分布；其余原因的 note 就是具体原因。
    const why = reason === 'ALL_UNKNOWN'
      ? unknownBreakdownText(exposure?.unknownBreakdown)
      : (exposure?.note ?? exposure?.error ?? '')
    return {
      ...base,
      status: 'UNAVAILABLE',
      detail: `${label}${why ? `（${why}）` : ''}，未施加中长期敞口约束${reason === 'ALL_UNKNOWN' ? '，不以模板合同曲线补齐' : ''}（按升档审批处理）${constraintSourceText(exposure, { basisNote: false })}`
    }
  }

  const exposureMwh = Number(sellSide ? exposure.sellExposureMwh : exposure.buyExposureMwh) || 0
  const manualPrefix = exposure.manual ? '【人工】' : ''
  const manualSuffix = exposure.manual
    ? `；敞口值为人工填报，不回写套保结果${exposure.hedgeFallback?.note ? `（套保服务未给出约束：${exposure.hedgeFallback.note}）` : ''}`
    : ''
  if (knownIndexes !== null) {
    const known = new Set(knownIndexes.map(Number))
    const minutesPerInterval = Number(exposure.intervalMinutes) > 0 ? Number(exposure.intervalMinutes) : 60
    const pointMinutes = energy.length > 0 ? 1440 / energy.length : 15
    let declaredMwh = 0
    for (let i = 0; i < energy.length; i += 1) {
      if (known.has(Math.floor((i * pointMinutes) / minutesPerInterval))) declaredMwh += Number(energy[i]) || 0
    }
    const total = Number(exposure.totalIntervals) || known.size
    const unknown = Math.max(0, total - known.size)
    const coverage = unknown > 0 ? `已知 ${known.size}/${total} 个时段：` : ''
    const unconstrainedMwh = round2(totalMwh - declaredMwh)
    const tail = unknown > 0
      ? `；其余 ${unknown} 个时段敞口未知（${unknownBreakdownText(exposure.unknownBreakdown) || '原因未知'}），这些时段的申报量 ${unconstrainedMwh} MWh 未施加约束`
      : ''
    const within = declaredMwh <= exposureMwh * (1 + EXPOSURE_TOLERANCE)
    return {
      ...base,
      status: within ? 'PASS' : 'FAIL',
      detail: `${manualPrefix}${coverage}申报量 ${round2(declaredMwh)} MWh / 仅中长期${sideLabel}敞口 ${round2(exposureMwh)} MWh（容忍 +10%）${tail}${constraintSourceText(exposure)}${manualSuffix}`
    }
  }

  // 人工填报或旧形状：没有逐时段覆盖信息，按全日申报总量比较（原判据）
  const within = totalMwh <= exposureMwh * (1 + EXPOSURE_TOLERANCE)
  return {
    ...base,
    status: within ? 'PASS' : 'FAIL',
    detail: `${manualPrefix}申报总量 ${round2(totalMwh)} MWh / ${sideLabel}敞口 ${round2(exposureMwh)} MWh（容忍 +10%${exposure.hedgeRatio != null ? `，套保率 ${exposure.hedgeRatio}` : ''}）${constraintSourceText(exposure)}${manualSuffix}`
  }
}

/** 阻断原因的一句话摘要，用于状态机拒绝时回给调用方。 */
export function blockReason(result) {
  if (!result.blocked) return null
  return `硬约束未通过，任何人不得放行：${result.blockers.map((b) => `${b.name}（${b.detail}）`).join('；')}`
}
