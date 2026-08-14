/** S1 偏差主因 id。存储值用 id，不存中文标签。 */
export type DeviationCauseId = 'load' | 'renewable' | 'corridor' | 'price' | 'none' | 'pending';

export type DeviationCause = {
    id: DeviationCauseId;
    label: string;
    /** 什么情况选它——给交易员看的判据 */
    hint: string;
    /** 选了它今天该盯什么。分类的价值全在这一列 */
    nextAction: string;
};

/**
 * 偏差主因分类表：前四项是业务成因（负荷/新能源/通道/价格），
 * 后两项是结论态（`none` 已判定无明显偏差 / `pending` 尚未判定）。
 */
export declare const DEVIATION_CAUSES: readonly DeviationCause[];
export declare const CAUSE_LABEL: Record<DeviationCauseId, string>;
export declare const CAUSE_IDS: readonly DeviationCauseId[];
export declare function isCauseId(value: unknown): value is DeviationCauseId;
/** 按中文标签反查 id；只给 AI 返回值用，映射不中返回 null（不做模糊匹配）。 */
export declare function causeIdOfLabel(label: unknown): DeviationCauseId | null;
/** 展示用；命中不了的值原样返回，以免抹掉改版前写下的历史主因。 */
export declare function causeLabelOf(value: unknown): string;
export declare function isPendingCause(value: unknown): boolean;
export declare const LESSONS_MIN_LENGTH: number;

export type MorningReviewDraft = { cause: unknown; lessons: unknown };
export type MorningReviewValidation = { ok: boolean; errors: string[] };
/** 复盘结论能否写回；`pending` 同样要求写今日要点。 */
export declare function validateMorningReview(draft: MorningReviewDraft): MorningReviewValidation;

/** 晨会作业窗口（公司内控规范，非市场规则——只提示不硬拦）。 */
export declare const MORNING_WINDOW: { startMinute: number; endMinute: number };
export type MorningWindowState = 'before' | 'within' | 'after';
export declare function morningWindowState(minuteOfDay: number): MorningWindowState;
export declare const MORNING_WINDOW_NOTE: Record<MorningWindowState, string>;
