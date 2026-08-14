// ============================================================================
// S10 · 决策日志（T7）：append-only + 哈希链
// ----------------------------------------------------------------------------
// 决策日志填写率是手册的一票否决 KPI，理由不在管理考核，而在 S13：收到监管质询时，
// 它是**唯一能自证报价形成过程的材料**。所以它的核心属性不是「记录」，是「不可篡改」——
// 事后能改的日志，在质询场景里等于没有。
//
// 三条来自手册的硬要求：
//   ① P10/P50/P90 必填（Z1 概率思维的载体：决策时就要写下你认为的分布，而不是事后
//      只留一个点估计，那样永远无法复盘「你当时判断错在哪」）；
//   ② 写后不可改，更正只能**追加**一条更正记录，指向被更正的条目；
//   ③ T+2 自动回填实际结果，用于事后校准。
//
// ⚠️ 原型态限制（必须如实告知使用者）：本模块的哈希链用**非加密哈希**且在浏览器端计算、
// 存浏览器本地。它能检出意外修改与顺序错乱，**防不住蓄意篡改**——真正的不可篡改需要
// 服务端追加写 + 加密哈希 + 独立留痕。上线前必须替换，页面上也必须显式标注。
// ============================================================================
export const GENESIS_HASH = 'GENESIS';
/**
 * 非加密链哈希（FNV-1a 变体）。**原型专用**：可检出意外修改与顺序错乱，
 * 不具备抗碰撞性，不能作为对抗蓄意篡改的证据。生产须换服务端 SHA-256。
 */
export function chainHash(payload, prevHash) {
    let h = 0x811c9dc5;
    const input = `${prevHash}|${payload}`;
    for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
/** 参与哈希的字段序列化——**不含** actual/lesson，因为它们允许 T+2 回填。 */
function payloadOf(e) {
    return [
        e.seq,
        e.at,
        e.targetDate,
        e.decisionPoint,
        e.judgement,
        e.rationale,
        e.p10,
        e.p50,
        e.p90,
        e.confidence,
        e.author,
        e.correctionOf ?? ''
    ].join('');
}
/**
 * 写入前校验。P10/P50/P90 不仅必填，还必须**单调不减**——
 * 顺序颠倒的三点式说明填写者没有在表达分布，而是在凑字段。
 */
export function validateDraft(draft) {
    const issues = [];
    if (!draft.decisionPoint?.trim())
        issues.push({ field: 'decisionPoint', message: '决策点必填' });
    if (!draft.judgement?.trim())
        issues.push({ field: 'judgement', message: '判断结论必填' });
    if (!draft.rationale?.trim()) {
        issues.push({ field: 'rationale', message: '理由必填，且须可追溯到成本或机会成本的具体数值' });
    }
    if (!draft.author?.trim())
        issues.push({ field: 'author', message: '决策人必填（不可代签）' });
    for (const [field, value] of [['p10', draft.p10], ['p50', draft.p50], ['p90', draft.p90]]) {
        if (!Number.isFinite(value))
            issues.push({ field, message: `${field.toUpperCase()} 必填（Z1 概率思维载体）` });
    }
    if (Number.isFinite(draft.p10) && Number.isFinite(draft.p50) && Number.isFinite(draft.p90)) {
        if (!(draft.p10 <= draft.p50 && draft.p50 <= draft.p90)) {
            issues.push({ field: 'p50', message: 'P10 ≤ P50 ≤ P90 必须成立，否则不是一个分布' });
        }
    }
    if (!Number.isFinite(draft.confidence) || draft.confidence < 0 || draft.confidence > 100) {
        issues.push({ field: 'confidence', message: '置信度须在 0–100' });
    }
    return issues;
}
/** 追加一条记录（唯一的写入方式）。校验不过则抛错，不写入半条。 */
export function appendEntry(log, draft, idSeed) {
    const issues = validateDraft(draft);
    if (issues.length) {
        throw new Error(`决策日志校验未通过：${issues.map((i) => i.message).join('；')}`);
    }
    const prev = log.at(-1);
    const seq = (prev?.seq ?? 0) + 1;
    const prevHash = prev?.hash ?? GENESIS_HASH;
    const base = {
        id: idSeed ?? `DL-${draft.targetDate}-${seq}`,
        seq,
        at: draft.at,
        targetDate: draft.targetDate,
        decisionPoint: draft.decisionPoint,
        judgement: draft.judgement,
        rationale: draft.rationale,
        p10: draft.p10,
        p50: draft.p50,
        p90: draft.p90,
        confidence: draft.confidence,
        author: draft.author,
        actual: draft.actual ?? null,
        lesson: draft.lesson ?? null,
        correctionOf: draft.correctionOf ?? null
    };
    return { ...base, prevHash, hash: chainHash(payloadOf(base), prevHash) };
}
/**
 * T+2 回填实际结果。
 * 只允许写 actual/lesson，且这两个字段不参与哈希——所以回填不会破坏链，
 * 而对任何**参与哈希的字段**的修改都会被 verifyChain 检出。这正是「可回填但不可篡改」。
 */
export function backfillActual(entry, actual, lesson) {
    return { ...entry, actual, lesson: lesson ?? entry.lesson };
}
/** 校验链完整性：逐条重算哈希并比对前后链接。 */
export function verifyChain(log) {
    let expectedPrev = GENESIS_HASH;
    for (let i = 0; i < log.length; i += 1) {
        const e = log[i];
        if (e.seq !== i + 1) {
            return { intact: false, brokenAtSeq: i + 1, reason: `序号不连续（期望 ${i + 1}，实得 ${e.seq}）` };
        }
        if (e.prevHash !== expectedPrev) {
            return { intact: false, brokenAtSeq: e.seq, reason: '前链哈希不匹配——中间有条目被删除或重排' };
        }
        const recomputed = chainHash(payloadOf(e), e.prevHash);
        if (recomputed !== e.hash) {
            return { intact: false, brokenAtSeq: e.seq, reason: '内容哈希不匹配——本条参与哈希的字段被改过' };
        }
        expectedPrev = e.hash;
    }
    return { intact: true, brokenAtSeq: null, reason: null };
}
/**
 * 更正：不修改原条目，追加一条指向它的更正记录。
 * 这样"错过什么、什么时候发现、改成什么"三件事都留在链上。
 */
export function appendCorrection(log, targetId, draft) {
    if (!log.some((e) => e.id === targetId)) {
        throw new Error(`被更正条目 ${targetId} 不存在`);
    }
    return appendEntry(log, { ...draft, correctionOf: targetId });
}
/** 填写率统计。手册要求 100%，任何缺口都是一票否决项。 */
export function coverageOf(log, targetDate, expectedPoints) {
    const today = log.filter((e) => e.targetDate === targetDate && !e.correctionOf);
    const rate = expectedPoints > 0 ? today.length / expectedPoints : 1;
    return {
        recorded: today.length,
        expected: expectedPoints,
        rate: Math.round(Math.min(rate, 1) * 10000) / 10000,
        meetsVeto: today.length >= expectedPoints,
        pendingBackfill: today.filter((e) => e.actual === null).length
    };
}
/** 事后校准：实际值是否落在决策时声明的 P10–P90 区间内。 */
export function hitRate(log) {
    const done = log.filter((e) => e.actual !== null);
    if (!done.length)
        return { evaluated: 0, hits: 0, rate: null };
    const hits = done.filter((e) => e.actual >= e.p10 && e.actual <= e.p90).length;
    return { evaluated: done.length, hits, rate: Math.round((hits / done.length) * 10000) / 10000 };
}
