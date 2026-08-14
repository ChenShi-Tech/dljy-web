export type CheckSeverity = 'hard' | 'overridable' | 'warning';
export type ChecklistItem = {
    id: string;
    /** 手册 T4 中的序号 */
    no: number;
    label: string;
    severity: CheckSeverity;
    passed: boolean;
    /** 实测值与阈值的对照说明 */
    detail: string;
};
export type OverrideRecord = {
    itemId: string;
    /** 放行人（须为有权角色） */
    approvedBy: string;
    /** 第二签（双签要求） */
    cosignedBy?: string;
    reason: string;
    /** 止损触发条件——手册 S3/S11 要求超限放行必须写明 */
    stopLossCondition: string;
    at: string;
};
export type ChecklistInput = {
    /** 1 · 单日 VaR 与授权额度 */
    dailyVarYuan: number;
    varLimitYuan: number;
    /** 2 · 储能 SOC 轨迹（来自 planDispatch），无储能业务时传 null */
    socTrajectoryOk: boolean | null;
    socEndOk: boolean | null;
    /** 3 · 储能安全倍数 = 实际价差 / 要求价差 */
    safetyMultiple: number | null;
    safetyMultipleThreshold: number;
    /** 4 · 用户侧申报偏置绝对值，无售电业务时传 null */
    maxBiasAbs: number | null;
    biasManagementBand: number;
    biasLegalBand: number;
    /** 5 · 中长期履约率 */
    complianceRatio: number;
    complianceManagementBand: [number, number];
    complianceLegalBand: [number, number];
    /** 6/7 · 发电侧报价，无发电业务时传 null */
    quoteMonotonic: boolean | null;
    quoteIntegerPrice: boolean | null;
    minSegmentRatioOk: boolean | null;
    /** 8 · 合规红线自检（R-1~R-8），列出被触碰的编号 */
    redLinesTouched: string[];
    /** 9 · 数据门禁是否允许申报 */
    dataDeclarable: boolean;
    dataGateSummary: string;
    /** 10 · 双签 */
    preparedBy: string | null;
    reviewedBy: string | null;
};
/**
 * 生成十项放行清单。
 * 不适用的业务线（如纯售电租户的储能项）标记为通过并注明「本立场不适用」——
 * 不适用不等于不通过，但也不能悄悄从清单里消失，否则清单就不再是十项。
 */
export declare function buildChecklist(input: ChecklistInput): ChecklistItem[];
export type ReleaseVerdict = {
    /** 是否允许进入提交环节 */
    allowed: boolean;
    total: number;
    passedCount: number;
    /** 未通过且不可放行的项 */
    blockers: ChecklistItem[];
    /** 未通过但可由有权人放行的项 */
    pendingOverrides: ChecklistItem[];
    /** 已被有效放行的项 */
    overridden: ChecklistItem[];
    summary: string;
};
/**
 * 汇总放行结论。
 * 可放行项必须有**完整的放行记录**（双签 + 理由 + 止损条件）才算数——
 * 缺任一要素的 override 不予采信，否则「主管口头同意」会变成事实上的免检通道。
 */
export declare function evaluateRelease(items: ChecklistItem[], overrides?: OverrideRecord[]): ReleaseVerdict;
