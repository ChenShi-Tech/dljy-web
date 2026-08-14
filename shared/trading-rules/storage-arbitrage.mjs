// ============================================================================
// 储能套利决策规则（手册第七章 R1 / R2 / R3 / R11）
// ----------------------------------------------------------------------------
// 与既有 `src/services/storageEconomics.ts::storageBreakeven` 的关系：**两者口径不同，
// 刻意不合并**。既有函数只算「效率损耗 + 循环成本」，缺两项在现货实盘里决定盈亏方向的量：
//
//   ① 充电侧刚性加价 a = 上网环节线损电价 + 系统运行费。储能充电时视同用户，这笔钱
//      必须付。漏计会让盈亏平衡价差被低估约 a/η_RT（默认参数下约 82 元/MWh）。
//   ② 容量电价折价 c_cap。它是收益侧的减项，且与年循环次数**反向**——容量电价按功率
//      给的是固定收入，多循环只是摊薄它。通用优化器最容易犯的错，就是把「多拿容量
//      补贴」当成增加循环的理由。
//
// 既有函数有现存消费者（实验室/测算页），改它的口径会连带改那些页面的数字，因此本
// 模块另立，供申报动线（S3 线A / S8）使用；两者的差异在文档中显式登记。
//
// **R1 是这一切的前提**：套利决策单元是「结算周期」而非「出清周期」。当结算价 = 小时内
// 若干出清点的算术平均时，小时内部做充放切换价差收益恒为 0，只增加循环损耗——任何以
// 出清粒度为目标函数的优化，在这类市场里都是错误建模。决策单元由 rulepack 的
// `settlementIntervalMin` + `settlementAggregator` 推导，不在本模块写死。
// ============================================================================
function round(value, digits = 2) {
    const f = 10 ** digits;
    return Math.round(value * f) / f;
}
/**
 * R1：由市场时序推导套利决策单元。
 * 这是 S8 优化目标函数的维度来源——**不要用 96 点价格做目标函数**，除非该省结算
 * 粒度确实等于出清粒度。
 */
export function decisionUnitOf(timing) {
    const points = Math.max(1, Math.round(timing.settlementIntervalMin / timing.daClearingIntervalMin));
    const merged = timing.settlementAggregator !== 'none' && points > 1;
    return {
        intervalMin: timing.settlementIntervalMin,
        unitsPerDay: Math.round((24 * 60) / timing.settlementIntervalMin),
        clearingPointsPerUnit: points,
        intraUnitSwitchingProfitable: !merged,
        reason: merged
            ? `结算价 = ${points} 个 ${timing.daClearingIntervalMin} 分钟出清点${timing.settlementAggregator === 'arithmetic_mean' ? '算术' : '加权'}平均，单元内价差被拉平，切换只增损耗`
            : `结算粒度 = 出清粒度 ${timing.settlementIntervalMin} 分钟，无合成，单元内价差真实存在`
    };
}
/**
 * R11：容量电价折算到度电。
 *
 * **反直觉但关键**：`c_cap` 与年循环次数成反比。容量电价是按功率给的固定收入，
 * 多循环只是把它摊薄——所以不能把「多拿容量补贴」当作增加循环的理由，增加循环
 * 的唯一理由是价差本身足够（R3）。
 *
 * 「是否纳入清单管理」是**资产级配置**而非全局参数：未纳入的项目 c_cap 记 0，
 * 盈亏平衡价差整体上移，商业模型完全不同。
 */
export function capacityPayment(input) {
    if (!input.inCapacityList) {
        return {
            ratio: 0,
            annualRevenueYuan: 0,
            annualDischargeMwh: 0,
            cCapYuanPerMwh: 0,
            note: '未纳入容量电价清单管理，容量折价按 0 计——盈亏平衡价差整体上移'
        };
    }
    const ratio = Math.min(1, Math.max(0, input.dischargeDurationH / Math.max(input.denominatorH, 1e-9)));
    const annualRevenue = input.ratedPowerKw * input.standardYuanPerKwYear * ratio;
    const annualDischarge = Math.max(input.cyclesPerYear * input.usableCapacityMwh * input.operatingDod, 1e-9);
    return {
        ratio: round(ratio, 4),
        annualRevenueYuan: round(annualRevenue),
        annualDischargeMwh: round(annualDischarge, 3),
        cCapYuanPerMwh: round(annualRevenue / annualDischarge),
        note: `年循环 ${input.cyclesPerYear} 次；循环次数上升则度电容量折价下降（固定收入被摊薄）`
    };
}
/**
 * R3：盈亏平衡价差。放出 1 MWh 需从电网购入 1/η_RT MWh。
 *
 * ```
 * P_dis + c_cap + c_as = (P_chg + a) / η_RT + C_cyc
 * ΔP_required = P_chg × (1/η_RT − 1) + a/η_RT + C_cyc − c_cap − c_as
 * ```
 */
export function breakevenSpread(input) {
    const eta = Math.min(Math.max(input.roundTripEfficiency, 0.01), 1);
    const efficiencyLoss = input.chargePriceYuanPerMwh * (1 / eta - 1);
    const adderLoaded = input.chargeAdderYuanPerMwh / eta;
    const credit = input.cCapYuanPerMwh + input.cAsYuanPerMwh;
    const required = efficiencyLoss + adderLoaded + input.cycleCostYuanPerMwh - credit;
    return {
        requiredSpreadYuanPerMwh: round(required),
        requiredDischargePriceYuanPerMwh: round(input.chargePriceYuanPerMwh + required),
        efficiencyLossYuanPerMwh: round(efficiencyLoss),
        chargeAdderLoadedYuanPerMwh: round(adderLoaded),
        cycleCostYuanPerMwh: round(input.cycleCostYuanPerMwh),
        creditYuanPerMwh: round(credit)
    };
}
export const ARBITRAGE_VERDICT_LABEL = {
    execute: '执行循环',
    needs_approval: '主管批准后可执行',
    skip: '不循环，仅维持 SOC'
};
/** 安全边际判定：实际价差 ≥ 要求价差 × 1.15 才无条件执行。 */
export function arbitrageVerdict(actualSpread, requiredSpread, safetyMargin = 1.15) {
    const req = requiredSpread;
    const multiple = req > 0 ? actualSpread / req : actualSpread >= 0 ? Number.POSITIVE_INFINITY : 0;
    if (actualSpread >= req * safetyMargin)
        return { verdict: 'execute', safetyMultiple: round(multiple, 3) };
    if (actualSpread >= req)
        return { verdict: 'needs_approval', safetyMultiple: round(multiple, 3) };
    return { verdict: 'skip', safetyMultiple: round(multiple, 3) };
}
/**
 * R2：充放小时选择 + SOC 轨迹递推。
 *
 * 步骤严格按手册：①算 n_chg/n_dis 上限 ②价格排序 ③剔除辅助服务锁定单元
 * ④时序可行性（放电单元必须晚于其配对的充电单元，不能先放后充）⑤逐对加入并用
 * R3 校验 ⑥到上限停止 ⑦双循环判定 ⑧SOC 轨迹递推，越界回退最后一对。
 *
 * 毛利 ≤ 0 时返回「无套利窗口日」——此时只应下发维持 SOC 的最小动作计划，
 * 而不是硬凑一个循环。
 */
export function planDispatch(input) {
    const n = input.unitPrices.length;
    const hoursPerUnit = 24 / Math.max(n, 1);
    const energyWindow = input.capacityMwh * (input.socMax - input.socMin);
    const perUnitEnergy = input.availablePowerMw * hoursPerUnit;
    const maxDischargeUnits = perUnitEnergy > 0
        ? Math.max(0, Math.ceil((energyWindow * input.dischargeEfficiency) / perUnitEnergy))
        : 0;
    const maxChargeUnits = perUnitEnergy > 0
        ? Math.max(0, Math.ceil(energyWindow / input.chargeEfficiency / perUnitEnergy))
        : 0;
    const locked = new Set(input.lockedUnits);
    const usable = input.unitPrices
        .map((price, index) => ({ price, index }))
        .filter((u) => !locked.has(u.index));
    const chargeCandidates = [...usable].sort((a, b) => a.price - b.price);
    const dischargeCandidates = [...usable].sort((a, b) => b.price - a.price);
    const pairs = [];
    const usedUnits = new Set();
    // 一对充放 = 一个循环，故对数上限直接受日循环次数限值约束；同时不得超过
    // 能量窗口允许的充/放单元数。
    const pairLimit = Math.min(maxChargeUnits, maxDischargeUnits, input.maxCyclesPerDay);
    for (const dis of dischargeCandidates) {
        if (pairs.length >= pairLimit)
            break;
        if (usedUnits.has(dis.index))
            continue;
        // 时序可行性：充电必须早于放电
        const chg = chargeCandidates.find((c) => !usedUnits.has(c.index) && c.index < dis.index);
        if (!chg)
            continue;
        const be = breakevenSpread({ ...input.breakeven, chargePriceYuanPerMwh: chg.price });
        const spread = dis.price - chg.price;
        const { verdict, safetyMultiple } = arbitrageVerdict(spread, be.requiredSpreadYuanPerMwh);
        if (verdict === 'skip')
            break; // 候选已按价差降序，后续只会更差
        const dischargeMwh = Math.min(perUnitEnergy, energyWindow * input.dischargeEfficiency);
        pairs.push({
            chargeUnit: chg.index,
            dischargeUnit: dis.index,
            chargePrice: chg.price,
            dischargePrice: dis.price,
            spread: round(spread),
            requiredSpread: be.requiredSpreadYuanPerMwh,
            safetyMultiple,
            dischargeMwh: round(dischargeMwh, 3),
            grossMarginYuan: round((spread - be.requiredSpreadYuanPerMwh) * dischargeMwh)
        });
        usedUnits.add(chg.index);
        usedUnits.add(dis.index);
    }
    // ⑦ 双循环判定：第二对及以后须满足增量毛利/增量循环成本比门槛
    if (pairs.length > 1) {
        const first = pairs[0];
        const rest = pairs.slice(1);
        const incrementalMargin = rest.reduce((sum, p) => sum + p.grossMarginYuan, 0);
        const incrementalCost = rest.reduce((sum, p) => sum + input.breakeven.cycleCostYuanPerMwh * p.dischargeMwh, 0);
        if (incrementalCost > 0 && incrementalMargin / incrementalCost < input.secondCycleRatioThreshold) {
            pairs.length = 0;
            pairs.push(first);
            usedUnits.clear();
            usedUnits.add(first.chargeUnit);
            usedUnits.add(first.dischargeUnit);
        }
    }
    // ⑧ SOC 轨迹递推校验，**越界则回退最后一对**（手册 R2 步骤 8）。
    //
    // 回退是必须的，不能只报错：充放效率不对称（充进 1 MWh 只能放出 η_RT MWh），
    // 每多做一对循环，终止 SOC 就更低一截。一个尖峰再诱人，只要它让终止 SOC 落不回
    // 目标带，这一对就必须放弃——次日的起始 SOC 是下一天全部套利空间的前提。
    let unitPowerMw = new Array(n).fill(0);
    let socTrajectory = [];
    let rejectReason = null;
    let rolledBack = 0;
    while (true) {
        const traj = simulateSoc(pairs, input, n, hoursPerUnit);
        unitPowerMw = traj.unitPowerMw;
        socTrajectory = traj.socTrajectory;
        rejectReason = traj.rejectReason;
        if (!rejectReason || pairs.length === 0)
            break;
        pairs.pop();
        rolledBack += 1;
    }
    const totalGrossMargin = pairs.reduce((sum, p) => sum + p.grossMarginYuan, 0);
    return {
        pairs,
        unitPowerMw,
        socTrajectory,
        maxChargeUnits,
        maxDischargeUnits,
        totalGrossMarginYuan: round(totalGrossMargin),
        cycles: pairs.length,
        noArbitrageWindow: pairs.length === 0 || totalGrossMargin <= 0,
        rejectReason,
        rolledBackPairs: rolledBack
    };
}
/** 按给定充放对递推 SOC 轨迹；返回越界或终止不达标的原因（可行时为 null）。 */
function simulateSoc(pairs, input, n, hoursPerUnit) {
    const unitPowerMw = new Array(n).fill(0);
    for (const p of pairs) {
        unitPowerMw[p.chargeUnit] = -input.availablePowerMw;
        unitPowerMw[p.dischargeUnit] = input.availablePowerMw;
    }
    const socTrajectory = [];
    let soc = input.socStart;
    for (let i = 0; i < n; i += 1) {
        const power = unitPowerMw[i];
        const deltaMwh = power < 0
            ? -power * hoursPerUnit * input.chargeEfficiency
            : -(power * hoursPerUnit) / input.dischargeEfficiency;
        soc += deltaMwh / Math.max(input.capacityMwh, 1e-9);
        if (soc < input.socMin - 1e-9 || soc > input.socMax + 1e-9) {
            return {
                unitPowerMw,
                socTrajectory,
                rejectReason: `第 ${i + 1} 个决策单元 SOC 越界（${(soc * 100).toFixed(1)}% 不在 [${(input.socMin * 100).toFixed(0)}%, ${(input.socMax * 100).toFixed(0)}%]）`
            };
        }
        socTrajectory.push(round(soc, 4));
    }
    const socEnd = socTrajectory[n - 1];
    if (socEnd !== undefined && Math.abs(socEnd - input.socTarget) > input.socTargetTolerance + 1e-9) {
        return {
            unitPowerMw,
            socTrajectory,
            rejectReason: `终止 SOC ${(socEnd * 100).toFixed(1)}% 未落在目标 ${(input.socTarget * 100).toFixed(0)}% ±${(input.socTargetTolerance * 100).toFixed(0)}% 内`
        };
    }
    return { unitPowerMw, socTrajectory, rejectReason: null };
}
// ── 决策单元 → 执行粒度展开 ─────────────────────────────────────────────────
/**
 * 把决策单元级功率展开为执行粒度曲线（如 24 小时 → 96 点）。
 * 采用「满功率优先」原则：单元内功率恒定即可，因为单元内价格已被结算算子拉平，
 * 分配方式不影响收益，只影响设备磨损（R1 推论 2）。
 */
export function expandToExecutionCurve(unitPowerMw, pointsPerUnit) {
    const out = [];
    for (const power of unitPowerMw) {
        for (let i = 0; i < pointsPerUnit; i += 1)
            out.push(power);
    }
    return out;
}
/** 手册 S8 的八项约束全量校验，任一阻断项不通过即不得下发。 */
export function checkDispatchConstraints(input) {
    const { plan } = input;
    const maxAbsPower = plan.unitPowerMw.reduce((m, p) => Math.max(m, Math.abs(p)), 0);
    const bothDirections = plan.unitPowerMw.some((p) => p > 0) && plan.unitPowerMw.some((p) => p < 0);
    const simultaneous = false; // 单序列表达下不可能同时充放，保留检查位以对齐手册条目
    let maxRamp = 0;
    for (let i = 1; i < plan.unitPowerMw.length; i += 1) {
        maxRamp = Math.max(maxRamp, Math.abs(plan.unitPowerMw[i] - plan.unitPowerMw[i - 1]));
    }
    const socOk = plan.socTrajectory.length > 0 && plan.socTrajectory.every((s) => s >= input.socMin - 1e-9 && s <= input.socMax + 1e-9);
    const socEnd = plan.socTrajectory.at(-1);
    const socEndOk = socEnd !== undefined && Math.abs(socEnd - input.socTarget) <= input.socTargetTolerance + 1e-9;
    return [
        {
            id: 'power',
            label: '功率约束',
            passed: maxAbsPower <= input.availablePowerMw + 1e-9 && !simultaneous,
            detail: `峰值功率 ${maxAbsPower.toFixed(1)} MW ≤ 可用 ${input.availablePowerMw.toFixed(1)} MW${bothDirections ? '；充放分处不同单元' : ''}`,
            blocking: true
        },
        {
            id: 'soc_band',
            label: 'SOC 上下限',
            passed: socOk,
            detail: socOk
                ? `全程落在 [${(input.socMin * 100).toFixed(0)}%, ${(input.socMax * 100).toFixed(0)}%]`
                : plan.rejectReason ?? 'SOC 轨迹越界',
            blocking: true
        },
        {
            id: 'soc_end',
            label: '终止 SOC',
            passed: socEndOk,
            detail: socEnd === undefined
                ? '轨迹未完整生成'
                : `终止 ${(socEnd * 100).toFixed(1)}%，目标 ${(input.socTarget * 100).toFixed(0)}% ±${(input.socTargetTolerance * 100).toFixed(0)}%`,
            blocking: true
        },
        {
            id: 'ramp',
            label: '爬坡约束',
            passed: maxRamp <= input.rampLimitMw + 1e-9,
            detail: `相邻单元最大功率变化 ${maxRamp.toFixed(1)} MW ≤ 爬坡能力 ${input.rampLimitMw.toFixed(1)} MW`,
            blocking: true
        },
        {
            id: 'cycles',
            label: '日循环次数',
            passed: plan.cycles <= input.maxCyclesPerDay,
            detail: `本计划 ${plan.cycles} 次 ≤ 公司限值 ${input.maxCyclesPerDay} 次`,
            blocking: true
        },
        {
            id: 'monthly_quota',
            label: '中长期充电限额',
            passed: input.monthlyChargeMwh <= input.monthlyChargeQuotaMwh + 1e-9,
            detail: `月度累计充电 ${input.monthlyChargeMwh.toFixed(1)} / 限额 ${input.monthlyChargeQuotaMwh.toFixed(1)} MWh`,
            blocking: true
        },
        {
            id: 'compliance',
            label: '中长期履约',
            passed: input.contractComplianceRatio >= input.complianceBand[0] &&
                input.contractComplianceRatio <= input.complianceBand[1],
            detail: `履约率 ${(input.contractComplianceRatio * 100).toFixed(1)}%，管理带 [${(input.complianceBand[0] * 100).toFixed(0)}%, ${(input.complianceBand[1] * 100).toFixed(0)}%]`,
            blocking: false
        },
        {
            id: 'identity',
            label: '合规·身份不混用',
            passed: !input.identityMixed,
            detail: input.identityMixed
                ? '检测到储能充电与售电采购在同一标的——违反「同一主体不得以两种身份在同一标的交易」'
                : '储能充电与售电采购分账户分标的',
            blocking: true
        }
    ];
}
/** 是否允许下发：所有阻断项通过。 */
export function canDispatch(checks) {
    return checks.filter((c) => c.blocking).every((c) => c.passed);
}
