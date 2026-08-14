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
 * @param {Object|null} [inputs.exposure] 中长期敞口（quant/exposure）
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

  // ④ 中长期敞口/履约
  const exposure = inputs.exposure
  if (!exposure || exposure.available === false) {
    checks.push({
      checkId: 'exposure',
      name: '中长期敞口',
      status: 'UNAVAILABLE',
      severity: 'overridable',
      detail: `敞口服务不可用${exposure?.error ? `：${exposure.error}` : ''}（quant/exposure 未连通，按升档审批处理）`
    })
  } else {
    const sellSide = ['GENERATOR', 'STORAGE'].includes(subjectType)
    const exposureMwh = Number(sellSide ? exposure.sellExposureMwh : exposure.buyExposureMwh) || 0
    const within = totalMwh <= exposureMwh * 1.1
    checks.push({
      checkId: 'exposure',
      name: '中长期敞口',
      status: within ? 'PASS' : 'FAIL',
      severity: 'overridable',
      detail: `申报总量 ${round2(totalMwh)} MWh / ${sellSide ? '售出' : '购入'}敞口 ${round2(exposureMwh)} MWh（容忍 +10%，套保率 ${exposure.hedgeRatio ?? '-'}）`
    })
  }

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

/** 阻断原因的一句话摘要，用于状态机拒绝时回给调用方。 */
export function blockReason(result) {
  if (!result.blocked) return null
  return `硬约束未通过，任何人不得放行：${result.blockers.map((b) => `${b.name}（${b.detail}）`).join('；')}`
}
