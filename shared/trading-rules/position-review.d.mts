/** 立场复盘焦点（#2005）：三类身份的目标/要点/S6 口径单一权威表。 */
export type PositionFrame = 'buyer' | 'seller' | 'storage' | 'none';
export type PositionReviewFocus = {
    frame: PositionFrame;
    goal: string;
    reviewPoints: string[];
    s6Scope: 'applicable' | 'mirrored' | 'not_primary';
    s6Note: string;
};
/** key = SubjectType；RETAILER/LOAD=买方，GENERATOR=卖方，STORAGE=储能。 */
export declare const POSITION_REVIEW_FOCUS: Record<string, PositionReviewFocus>;
/** 取立场复盘焦点；未知/空立场返回 null（调用方走通用口径，不猜立场）。 */
export declare function reviewFocusOf(position: string | null | undefined): PositionReviewFocus | null;
