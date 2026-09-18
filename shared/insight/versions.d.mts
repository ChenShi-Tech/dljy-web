// 业务键版本选择类型（#2993）。
export type SettlementStatus = 'formal' | 'provisional'
export declare const SETTLEMENT_STATUSES: readonly SettlementStatus[]
export declare function selectVersions<T>(
  rows: T[],
  options: { keyOf: (row: T) => string; contentOf?: (row: T) => unknown; statusOf?: ((row: T) => string | null) | null; status?: SettlementStatus | null },
): { selected: T[]; duplicates: number; conflicts: Array<{ key: string; variants: number }>; excludedByStatus: number }
export declare function compareSources<T>(
  leftRows: T[],
  rightRows: T[],
  options: { keyOf: (row: T) => string; contentOf: (row: T) => unknown },
): { onlyLeft: string[]; onlyRight: string[]; same: string[]; different: Array<{ key: string; left: unknown; right: unknown }> }
