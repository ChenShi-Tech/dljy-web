export type DecisionLogEntry = {
    id: string;
    /** 记录序号，从 1 开始连续 */
    seq: number;
    /** 决策时点（ISO） */
    at: string;
    /** 标的交易日 */
    targetDate: string;
    /** 决策点名称，如「储能充放时段选择」「用户侧偏置方向」 */
    decisionPoint: string;
    /** 判断结论 */
    judgement: string;
    /** 理由（须可追溯到成本或机会成本的具体数值） */
    rationale: string;
    /** 概率预测三点式 元/MWh */
    p10: number;
    p50: number;
    p90: number;
    /** 主观置信度 0-100 */
    confidence: number;
    /** 决策人（不可代签） */
    author: string;
    /** T+2 回填的实际结果 元/MWh；未回填为 null */
    actual: number | null;
    /** 事后心得 */
    lesson: string | null;
    /** 若本条是更正记录，指向被更正条目的 id */
    correctionOf: string | null;
    /** 前一条的链哈希（首条为 GENESIS） */
    prevHash: string;
    /** 本条的链哈希 */
    hash: string;
};
export type DecisionLogDraft = Omit<DecisionLogEntry, 'id' | 'seq' | 'prevHash' | 'hash' | 'actual' | 'lesson'> & {
    actual?: number | null;
    lesson?: string | null;
};
export declare const GENESIS_HASH = "GENESIS";
/**
 * 非加密链哈希（FNV-1a 变体）。**原型专用**：可检出意外修改与顺序错乱，
 * 不具备抗碰撞性，不能作为对抗蓄意篡改的证据。生产须换服务端 SHA-256。
 */
export declare function chainHash(payload: string, prevHash: string): string;
/**
 * 参与哈希的字段序列化——不含 actual/lesson（允许 T+2 回填）。
 * 服务端 SHA-256 链（decision-log-server.mjs）与 FNV 原型链共用这一份序列化。
 */
export declare function payloadOf(e: DecisionLogEntry): string;
export type ValidationIssue = {
    field: string;
    message: string;
};
/**
 * 写入前校验。P10/P50/P90 不仅必填，还必须**单调不减**——
 * 顺序颠倒的三点式说明填写者没有在表达分布，而是在凑字段。
 */
export declare function validateDraft(draft: DecisionLogDraft): ValidationIssue[];
/** 追加一条记录（唯一的写入方式）。校验不过则抛错，不写入半条。 */
export declare function appendEntry(log: DecisionLogEntry[], draft: DecisionLogDraft, idSeed?: string): DecisionLogEntry;
/**
 * T+2 回填实际结果。
 * 只允许写 actual/lesson，且这两个字段不参与哈希——所以回填不会破坏链，
 * 而对任何**参与哈希的字段**的修改都会被 verifyChain 检出。这正是「可回填但不可篡改」。
 */
export declare function backfillActual(entry: DecisionLogEntry, actual: number, lesson?: string): DecisionLogEntry;
export type ChainVerdict = {
    intact: boolean;
    /** 首个出问题的序号（1 起），完好时为 null */
    brokenAtSeq: number | null;
    reason: string | null;
};
/**
 * 校验链完整性：逐条重算哈希并比对前后链接。
 * hashFn 缺省用 FNV 原型哈希；服务端传 decision-log-server.mjs 的 SHA-256 实现。
 */
export declare function verifyChain(log: DecisionLogEntry[], hashFn?: (payload: string, prevHash: string) => string): ChainVerdict;
/**
 * 更正：不修改原条目，追加一条指向它的更正记录。
 * 这样"错过什么、什么时候发现、改成什么"三件事都留在链上。
 */
export declare function appendCorrection(log: DecisionLogEntry[], targetId: string, draft: Omit<DecisionLogDraft, 'correctionOf'>): DecisionLogEntry;
export type LogCoverage = {
    /** 已记录的决策点数 */
    recorded: number;
    /** 当日应记录的决策点数 */
    expected: number;
    /** 填写率 */
    rate: number;
    /** 是否达成一票否决要求（100%） */
    meetsVeto: boolean;
    /** 待 T+2 回填的条数 */
    pendingBackfill: number;
};
/** 填写率统计。手册要求 100%，任何缺口都是一票否决项。 */
export declare function coverageOf(log: DecisionLogEntry[], targetDate: string, expectedPoints: number): LogCoverage;
/** 事后校准：实际值是否落在决策时声明的 P10–P90 区间内。 */
export declare function hitRate(log: DecisionLogEntry[]): {
    evaluated: number;
    hits: number;
    rate: number | null;
};
