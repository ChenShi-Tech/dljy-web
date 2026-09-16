// 中长期合同十进制数的类型侧伴随定义（#2938）。运行时见 decimal.mjs。

export declare const SCALE: number
export declare const MAX_INTEGER_DIGITS: number
export type ParseDecimalResult =
  | { ok: true; value: string; scale: number }
  | { ok: false; code: 'EMPTY' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'PRECISION_EXCEEDED' | 'OUT_OF_RANGE'; scale?: number }
export declare function parseDecimal(input: unknown, options?: { maxScale?: number | null; allowNegative?: boolean }): ParseDecimalResult
export declare function toScaled(value: string | number): bigint
export declare function fromScaled(scaled: bigint): string
export declare function decimalAdd(a: string, b: string): string
export declare function decimalSub(a: string, b: string): string
export declare function decimalMul(a: string, b: string): string
export declare function decimalDiv(a: string, b: string, places?: number): string | null
export declare function decimalRound(value: string, places: number): string
export declare function decimalCompare(a: string, b: string): -1 | 0 | 1
export declare function decimalIsZero(value: string): boolean
export declare function decimalSum(values: Iterable<string>): string
