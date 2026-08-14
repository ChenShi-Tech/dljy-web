/** 手册 0.2 节数据可信度分级。 */
export type DataCredibility = 'A' | 'B' | 'C' | 'D';
export declare const CREDIBILITY_LABEL: Record<DataCredibility, string>;
export declare const CREDIBILITY_NOTE: Record<DataCredibility, string>;
/** 三态门禁。 */
export type UsageGate = 'declarable' | 'reference' | 'display_only';
export declare const USAGE_GATE_LABEL: Record<UsageGate, string>;
/** 手册 S2 步骤 1 的八条数据源。少一条即核验单不完整。 */
export declare const REQUIRED_SOURCES: readonly [{
    readonly id: "load_forecast";
    readonly label: "统调负荷预测";
}, {
    readonly id: "renewable_forecast";
    readonly label: "新能源预测出力";
}, {
    readonly id: "boundary";
    readonly label: "运行日边界条件";
}, {
    readonly id: "contract_position";
    readonly label: "中长期持仓";
}, {
    readonly id: "storage_soc";
    readonly label: "储能 SOC 实况";
}, {
    readonly id: "customer_load";
    readonly label: "客户负荷";
}, {
    readonly id: "interprovincial";
    readonly label: "省间信息";
}, {
    readonly id: "rulebook";
    readonly label: "规则库版本";
}];
export type SourceId = (typeof REQUIRED_SOURCES)[number]['id'];
export type SourceStatus = {
    id: SourceId;
    /** 是否到位（拿到数据） */
    present: boolean;
    credibility: DataCredibility;
    /** 数据时间戳（ISO），未到位时为 null */
    timestamp: string | null;
    /** 是否为 Mock/合成数据——直接压到「仅展示」 */
    mock?: boolean;
    /** 到位但内容不完整时的实际完整比例（0-1），缺省视为 1 */
    completeness?: number;
    note?: string;
};
export type IntegrityVerdict = {
    /** 完整率：八源加权到位比例 */
    completenessRate: number;
    /** 到位源数 */
    presentCount: number;
    totalCount: number;
    /** 最弱可信度（链条最弱环节决定精度） */
    weakestCredibility: DataCredibility;
    /** 三态门禁结论 */
    gate: UsageGate;
    /** 是否触发系统降级（手册 S16 一级/二级） */
    degradeLevel: 0 | 1 | 2;
    /** 缺失或异常的源 */
    problems: {
        id: SourceId;
        label: string;
        reason: string;
    }[];
    /** 结论说明（给交易员看的一句话） */
    summary: string;
};
/**
 * 八源验签 + 完整率 + 三态门禁判定。
 *
 * 门禁规则（三者取最严）：
 *   · 完整率 ≥98% 且最弱可信度 ∈ {A,B} 且无 Mock → 可申报
 *   · 完整率 ≥95% 或最弱为 C → 可参考（申报量须向中枢收敛、暴露减半）
 *   · 完整率 <95% 或最弱为 D 或含 Mock → 仅展示（不得作为申报依据）
 *
 * 降级联动：完整率 95–98% 为一级降级（数据降级），<95% 为二级降级（模型降级）。
 */
export declare function assessIntegrity(sources: SourceStatus[]): IntegrityVerdict;
/** 门禁是否允许提交申报。 */
export declare function canDeclareUnder(gate: UsageGate): boolean;
/**
 * 门禁对申报暴露的约束系数：可申报 1.0（不打折）、可参考 0.5（暴露减半）、
 * 仅展示 0（强制中枢，不得偏置）。用于 R4 的偏置上限裁剪。
 */
export declare function exposureFactorOf(gate: UsageGate): number;
