// ============================================================================
// S3 · 决策放行清单（T4 十项）
// ----------------------------------------------------------------------------
// 这是申报动线上唯一的闸门：十项全过才允许进入提交环节。它把手册 S3「④判据与阈值」
// 那张表变成可执行的判定，而不是一份靠人对照的纸质清单。
//
// 三类结果，不要混为一谈：
//   · **硬约束不通过** —— 市场规则本身不允许（段数、单调性、精度、法定履约带），
//     任何人都放行不了，只能改方案；
//   · **可放行项不通过** —— 公司内控收紧的管理带（VaR 授权额度、盈亏平衡安全边际），
//     由有权人双签后可越过，但必须留下超限理由与止损条件；
//   · **告警项** —— 不拦提交，但要求交易员知晓。
//
// 把「规则不允许」和「公司不建议」混成一档，是内控失效最常见的起点：要么该拦的被
// 一句「主管同意了」放过去，要么不该拦的把人堵死在死线前。
// ============================================================================
function fmtPct(v) {
    return `${(v * 100).toFixed(1)}%`;
}
/**
 * 生成十项放行清单。
 * 不适用的业务线（如纯售电租户的储能项）标记为通过并注明「本立场不适用」——
 * 不适用不等于不通过，但也不能悄悄从清单里消失，否则清单就不再是十项。
 */
export function buildChecklist(input) {
    const items = [];
    items.push({
        id: 'var',
        no: 1,
        label: '单日 VaR(95%) 在授权额度内',
        severity: 'overridable',
        passed: input.dailyVarYuan <= input.varLimitYuan,
        detail: `VaR ${input.dailyVarYuan.toFixed(0)} 元 / 授权 ${input.varLimitYuan.toFixed(0)} 元`
    });
    items.push({
        id: 'soc',
        no: 2,
        label: '储能 SOC 轨迹全程在带内且终止达标',
        severity: 'hard',
        passed: input.socTrajectoryOk === null ? true : Boolean(input.socTrajectoryOk && input.socEndOk),
        detail: input.socTrajectoryOk === null
            ? '本立场不适用（无储能资产）'
            : `轨迹${input.socTrajectoryOk ? '在带内' : '越界'}，终止 SOC ${input.socEndOk ? '达标' : '未达标'}`
    });
    items.push({
        id: 'breakeven',
        no: 3,
        label: `储能盈亏平衡安全倍数 ≥ ${input.safetyMultipleThreshold}`,
        severity: 'overridable',
        passed: input.safetyMultiple === null ? true : input.safetyMultiple >= input.safetyMultipleThreshold,
        detail: input.safetyMultiple === null
            ? '本立场不适用（无储能资产）'
            : `安全倍数 ${input.safetyMultiple.toFixed(2)}（阈值 ${input.safetyMultipleThreshold}）`
    });
    const biasWithinLegal = input.maxBiasAbs === null ? true : input.maxBiasAbs <= input.biasLegalBand + 1e-9;
    const biasWithinMgmt = input.maxBiasAbs === null ? true : input.maxBiasAbs <= input.biasManagementBand + 1e-9;
    items.push({
        id: 'bias',
        no: 4,
        label: `用户侧申报偏置 ≤ ±${fmtPct(input.biasManagementBand)}（法定 ±${fmtPct(input.biasLegalBand)}）`,
        // 越法定带是硬约束；只越管理带是内控问题，可放行
        severity: biasWithinLegal ? 'overridable' : 'hard',
        passed: biasWithinMgmt,
        detail: input.maxBiasAbs === null
            ? '本立场不适用（无售电业务）'
            : `最大偏置 ${fmtPct(input.maxBiasAbs)}${biasWithinLegal ? '' : '——已越法定带，任何人不得放行'}`
    });
    const compLegal = input.complianceRatio >= input.complianceLegalBand[0] && input.complianceRatio <= input.complianceLegalBand[1];
    const compMgmt = input.complianceRatio >= input.complianceManagementBand[0] &&
        input.complianceRatio <= input.complianceManagementBand[1];
    items.push({
        id: 'compliance',
        no: 5,
        label: `中长期履约率在 [${fmtPct(input.complianceManagementBand[0])}, ${fmtPct(input.complianceManagementBand[1])}]`,
        severity: compLegal ? 'overridable' : 'hard',
        passed: compMgmt,
        detail: `履约率 ${fmtPct(input.complianceRatio)}${compLegal ? '' : '——已越法定带，会触发回收'}`
    });
    items.push({
        id: 'monotonic',
        no: 6,
        label: '报价逐段单调非递减且为整数元/MWh',
        severity: 'hard',
        passed: input.quoteMonotonic === null ? true : Boolean(input.quoteMonotonic && input.quoteIntegerPrice),
        detail: input.quoteMonotonic === null
            ? '本立场不适用（无发电侧报价）'
            : `单调性${input.quoteMonotonic ? '通过' : '不通过'}，价格精度${input.quoteIntegerPrice ? '通过' : '不通过'}`
    });
    items.push({
        id: 'segment',
        no: 7,
        label: '每段长度 ≥ 出力区间的规定比例',
        severity: 'hard',
        passed: input.minSegmentRatioOk === null ? true : input.minSegmentRatioOk,
        detail: input.minSegmentRatioOk === null ? '本立场不适用（无发电侧报价）' : input.minSegmentRatioOk ? '通过' : '存在过短分段',
    });
    items.push({
        id: 'redline',
        no: 8,
        label: '合规红线 R-1 ~ R-8 逐条自检',
        severity: 'hard',
        passed: input.redLinesTouched.length === 0,
        detail: input.redLinesTouched.length === 0 ? '无触碰' : `触碰：${input.redLinesTouched.join('、')}`
    });
    items.push({
        id: 'data',
        no: 9,
        label: '未使用 D 级数据作为加仓依据',
        severity: 'hard',
        passed: input.dataDeclarable,
        detail: input.dataGateSummary
    });
    items.push({
        id: 'dualsign',
        no: 10,
        label: '双人确认（编制人 + 复核人）',
        severity: 'hard',
        passed: Boolean(input.preparedBy && input.reviewedBy && input.preparedBy !== input.reviewedBy),
        detail: !input.preparedBy || !input.reviewedBy
            ? '双签未完成'
            : input.preparedBy === input.reviewedBy
                ? '编制人与复核人为同一人——自审自批不成立'
                : `${input.preparedBy} 编制 / ${input.reviewedBy} 复核`
    });
    return items;
}
/**
 * 汇总放行结论。
 * 可放行项必须有**完整的放行记录**（双签 + 理由 + 止损条件）才算数——
 * 缺任一要素的 override 不予采信，否则「主管口头同意」会变成事实上的免检通道。
 */
export function evaluateRelease(items, overrides = []) {
    const validOverrides = new Set(overrides
        .filter((o) => o.approvedBy && o.cosignedBy && o.approvedBy !== o.cosignedBy && o.reason.trim() && o.stopLossCondition.trim())
        .map((o) => o.itemId));
    const failed = items.filter((i) => !i.passed);
    const blockers = failed.filter((i) => i.severity === 'hard');
    const overridable = failed.filter((i) => i.severity === 'overridable');
    const overridden = overridable.filter((i) => validOverrides.has(i.id));
    const pendingOverrides = overridable.filter((i) => !validOverrides.has(i.id));
    const allowed = blockers.length === 0 && pendingOverrides.length === 0;
    const passedCount = items.filter((i) => i.passed).length;
    let summary;
    if (allowed && overridden.length === 0) {
        summary = `十项全过（${passedCount}/${items.length}），可进入提交`;
    }
    else if (allowed) {
        summary = `${passedCount}/${items.length} 项直接通过，另有 ${overridden.length} 项经双签放行，可进入提交`;
    }
    else if (blockers.length > 0) {
        summary = `${blockers.length} 项硬约束未通过，任何人不得放行——必须修改方案：${blockers.map((b) => b.label).join('；')}`;
    }
    else {
        summary = `${pendingOverrides.length} 项待双签放行（需写明超限理由与止损条件）`;
    }
    return { allowed, total: items.length, passedCount, blockers, pendingOverrides, overridden, summary };
}
