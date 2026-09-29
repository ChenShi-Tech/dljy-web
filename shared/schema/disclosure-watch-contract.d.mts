// 云南交易日前披露盯盘共享契约的类型侧伴随定义（Epic #3478 · A1 #3479）。
// 运行时值来自 disclosure-watch-contract.mjs；DisclosureWatchRunResult 与 GET /watch-runs/:runId 的 data 一一对应。

export type DisclosureWatchCoreDataset = 'forecast_maintenance_plan' | 'actual_unplanned_unit_outage' | 'forecast_must_run_stop_unit_list'
export type DisclosureWatchDataset = DisclosureWatchCoreDataset | 'load_forecast'
export type DisclosureWatchSourceKind = 'tb-csv' | 'cgn-api-raw'
export type DisclosureWatchOrigin = 'historical-import' | 'capture'
export type DisclosureWatchCompleteness = 'complete' | 'partial' | 'empty' | 'invalid'
export type DisclosureWatchMode = 'live' | 'review'
export type DisclosureWatchRunStatus = 'running' | 'complete' | 'partial' | 'failed' | 'interrupted'
export type DisclosureWatchDisposition = 'eligible' | 'review-needed' | 'out-of-scope' | 'invalid'
export type DisclosureWatchProcessing = 'rule' | 'evaluated' | 'model-failed' | 'budget-unprocessed' | 'not-required'
export type DisclosureWatchItemLevel = 'focus' | 'general' | 'review'
export type DisclosureWatchItemKind = 'maintenance-plan' | 'must-run-stop' | 'unplanned-outage'
export type DisclosureWatchAttention = 'focus' | 'review' | 'none-qualified'
export type DisclosureWatchCoverageStatus = 'complete' | 'partial' | 'missing' | 'invalid'
export type DisclosureWatchChangeKind = 'new' | 'changed' | 'unchanged' | 'removed' | 'not-comparable'
export type DisclosureWatchWindowKind = 'interval' | 'day' | 'point' | 'unknown'
export type DisclosureWatchItemFlag = 'recovery' | 'high-load-overlap' | 'non-target-date-list' | 'conflict' | 'restricted-source'
export type DisclosureWatchReviewReason =
  | 'no-target-date-list' | 'interval-anomaly' | 'column-order-ambiguous' | 'identity-unclear' | 'conflict'
  | 'persistence-unknown' | 'partial-snapshot' | 'model-failed' | 'budget-unprocessed' | 'excerpt-truncated'
  | 'consistency-conflict'
export type DisclosureWatchCalibrationStatus = 'uncalibrated' | 'calibrated'
export type DisclosureWatchMechanism =
  | 'equipment-limit' | 'resource-constraint' | 'recovery-or-release' | 'dispatch-arrangement'
  | 'no-supply-implication' | 'insufficient-evidence'
export type DisclosureWatchConsistency = 'supports-status' | 'semantic-conflict' | 'not-addressed' | 'undeterminable'
export type DisclosureWatchFeedbackVerdict = 'useful' | 'not-useful' | 'needs-correction'
export type DisclosureWatchErrorCode =
  | 'feature-disabled' | 'region-unsupported' | 'invalid-request' | 'idempotency-key-required' | 'idempotency-conflict'
  | 'run-not-found' | 'item-not-found' | 'model-not-configured' | 'provider-auth-failed' | 'provider-rate-limited'
  | 'provider-timeout' | 'provider-error' | 'provider-invalid-response' | 'model-all-failed' | 'budget-exhausted'
  | 'no-core-input' | 'interrupted' | 'internal-error'

export declare const DISCLOSURE_WATCH_CONTRACT_VERSION: string
export declare const DISCLOSURE_WATCH_REGION_ID: 'yunnan'
export declare const DISCLOSURE_WATCH_RULESET_VERSION: string
export declare const DISCLOSURE_WATCH_FORMAT_VERSION: string
export declare const DISCLOSURE_WATCH_DATE_RULE_VERSION: string
export declare const DISCLOSURE_WATCH_QUESTION_SET_VERSION: string
export declare const DISCLOSURE_WATCH_FEATURE_FLAG: string
export declare const DISCLOSURE_WATCH_PATH_PREFIX: string
export declare const DISCLOSURE_WATCH_CORE_DATASETS: readonly DisclosureWatchCoreDataset[]
export declare const DISCLOSURE_WATCH_BACKGROUND_DATASETS: readonly ['load_forecast']
export declare const DISCLOSURE_WATCH_DATASETS: readonly DisclosureWatchDataset[]
export declare const DISCLOSURE_WATCH_DATASET_LABELS: Readonly<Record<DisclosureWatchDataset, string>>
export declare const DISCLOSURE_WATCH_DATE_BASIS: string
export declare const DISCLOSURE_WATCH_SOURCE_KINDS: readonly DisclosureWatchSourceKind[]
export declare const DISCLOSURE_WATCH_ORIGINS: readonly DisclosureWatchOrigin[]
export declare const DISCLOSURE_WATCH_RESTRICTED_OWNER: string
export declare const DISCLOSURE_WATCH_SOURCE_KIND_POLICY: Readonly<Record<DisclosureWatchSourceKind, Readonly<{ origin: DisclosureWatchOrigin; ownerCompanyId: string | null }>>>
export declare const DISCLOSURE_WATCH_COMPLETENESS: readonly DisclosureWatchCompleteness[]
export declare const DISCLOSURE_WATCH_ROW_QUALITY: readonly string[]
export declare const DISCLOSURE_WATCH_MAINTENANCE_COLUMN_ORDER_FROM: string
export declare const DISCLOSURE_WATCH_OUTAGE_STATUS: Readonly<Record<string, 'stopped' | 'transition' | 'running'>>
export declare const DISCLOSURE_WATCH_REQUIREMENTS: Readonly<Record<string, 'must-run' | 'must-stop'>>
export declare const DISCLOSURE_WATCH_MODES: readonly DisclosureWatchMode[]
export declare const DISCLOSURE_WATCH_RUN_STATUSES: readonly DisclosureWatchRunStatus[]
export declare const DISCLOSURE_WATCH_TERMINAL_STATUSES: readonly Exclude<DisclosureWatchRunStatus, 'running'>[]
export declare const DISCLOSURE_WATCH_DISPOSITIONS: readonly DisclosureWatchDisposition[]
export declare const DISCLOSURE_WATCH_PROCESSING: readonly DisclosureWatchProcessing[]
export declare const DISCLOSURE_WATCH_ITEM_LEVELS: readonly DisclosureWatchItemLevel[]
export declare const DISCLOSURE_WATCH_ITEM_KINDS: readonly DisclosureWatchItemKind[]
export declare const DISCLOSURE_WATCH_ATTENTION: readonly DisclosureWatchAttention[]
export declare const DISCLOSURE_WATCH_COVERAGE_STATUSES: readonly DisclosureWatchCoverageStatus[]
export declare const DISCLOSURE_WATCH_CHANGE_KINDS: readonly DisclosureWatchChangeKind[]
export declare const DISCLOSURE_WATCH_WINDOW_KINDS: readonly DisclosureWatchWindowKind[]
export declare const DISCLOSURE_WATCH_ITEM_FLAGS: readonly DisclosureWatchItemFlag[]
export declare const DISCLOSURE_WATCH_REVIEW_REASONS: readonly DisclosureWatchReviewReason[]
export declare const DISCLOSURE_WATCH_CALIBRATION_STATUSES: readonly DisclosureWatchCalibrationStatus[]
export declare const DISCLOSURE_WATCH_CALIBRATION_STATUS: 'uncalibrated'
export declare const DISCLOSURE_WATCH_MECHANISMS: readonly DisclosureWatchMechanism[]
export declare const DISCLOSURE_WATCH_MECHANISM_LABELS: Readonly<Record<DisclosureWatchMechanism, string>>
export declare const DISCLOSURE_WATCH_CONSISTENCY: readonly DisclosureWatchConsistency[]
export declare const DISCLOSURE_WATCH_CONSISTENCY_LABELS: Readonly<Record<DisclosureWatchConsistency, string>>
export declare const DISCLOSURE_WATCH_BUDGET: Readonly<{
  version: string; totalMs: number; concurrency: number; maxModelChains: number
  maxExcerptsPerChain: number; maxExcerptChars: number; lookbackDays: number
}>
export declare const DISCLOSURE_WATCH_FEEDBACK_VERDICTS: readonly DisclosureWatchFeedbackVerdict[]
export declare const DISCLOSURE_WATCH_FEEDBACK_NOTE_MAX: number
export declare const DISCLOSURE_WATCH_ERROR_CODES: readonly DisclosureWatchErrorCode[]
export declare const DISCLOSURE_WATCH_DATA_META: Readonly<{ sourceType: 'IMPORT'; mock: false; productionWrite: false }>
export declare const DISCLOSURE_WATCH_ROW_FIELDS: Readonly<Record<DisclosureWatchDataset, readonly string[]>>

export declare function isBusinessDate(value: unknown): value is string
export declare function isLocalDateTime(value: unknown): value is string
export declare function isTimePoint(value: unknown): value is string
export declare function beijingDate(nowMs?: number): string
export declare function addBusinessDays(date: string, days: number): string
export declare function liveTradeDate(nowMs?: number): string
export declare function localDateTimeToEpochMs(value: string): number | null

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }
export interface DisclosureWatchRunRequest { tradeDate: string; mode: DisclosureWatchMode }
export interface DisclosureWatchFeedbackRequest { itemId: string; verdict: DisclosureWatchFeedbackVerdict; note?: string | null }
export declare function validateRunRequest(body: unknown, options?: { nowMs?: number }): ValidationResult<DisclosureWatchRunRequest>
export declare function validateFeedbackRequest(body: unknown): ValidationResult<{ itemId: string; verdict: DisclosureWatchFeedbackVerdict; note: string | null }>
export declare function validateNormalizedRow(dataset: string, row: unknown): string[]
export declare function validateSnapshotDraft(draft: unknown): string[]
export declare function validateRunResultShape(result: unknown): string[]

// ── 接口响应形状 ─────────────────────────────────────────────────────────

export interface DisclosureWatchSnapshotSummary {
  snapshotId: string
  dataset: DisclosureWatchDataset
  coverageDate: string
  receivedAt: string
  completeness: DisclosureWatchCompleteness
  origin: DisclosureWatchOrigin
  contentSha256: string
}

export interface DisclosureWatchCapabilities {
  contractVersion: string
  enabled: boolean
  regionId: string
  supportedRegion: boolean
  modelReady: boolean
  calibrationStatus: DisclosureWatchCalibrationStatus
  liveTradeDate: string
  tradeDate: string | null
  datasets: Array<{ dataset: DisclosureWatchDataset; label: string; latest: DisclosureWatchSnapshotSummary | null; forTradeDate: DisclosureWatchSnapshotSummary | null }>
  errors: DisclosureWatchError[]
}

export interface DisclosureWatchError { code: DisclosureWatchErrorCode; message: string }

export interface DisclosureWatchSourceRef { snapshotId: string; rowIndex: number }

export interface DisclosureWatchEvidence {
  ref: string // 摘录编号 E1…，无摘录的证据为 S1…
  sourceRef: DisclosureWatchSourceRef
  dataset: DisclosureWatchDataset
  coverageDate: string
  receivedAt: string
  fields: Record<string, string | null>
}

export interface DisclosureWatchModelJudgement<T extends string> {
  origin: 'model'
  trial: true
  choice: T
  probabilities: Record<string, number>
  confidence: number | null
  modelVersion: string
  questionSetVersion: string
}

export interface DisclosureWatchItem {
  itemId: string
  level: DisclosureWatchItemLevel
  kind: DisclosureWatchItemKind
  object: { objectKey: string; plantName: string | null; unitName: string | null; deviceName: string | null }
  change: { kind: DisclosureWatchChangeKind; comparedCoverageDate: string | null; detail: string | null }
  window: { kind: DisclosureWatchWindowKind; start: string | null; end: string | null; label: string }
  headline: string
  facts: Array<{ label: string; value: string }>
  reviewReasons: DisclosureWatchReviewReason[]
  flags: DisclosureWatchItemFlag[]
  processing: DisclosureWatchProcessing
  mechanism: DisclosureWatchModelJudgement<DisclosureWatchMechanism> | null
  consistency: DisclosureWatchModelJudgement<DisclosureWatchConsistency> | null
  evidence: DisclosureWatchEvidence[]
  nextAction: string
  eventId: string | null
}

export interface DisclosureWatchCoverageEntry {
  status: DisclosureWatchCoverageStatus
  snapshotId: string | null
  coverageDate: string | null
  receivedAt: string | null
  note: string | null
}

export interface DisclosureWatchRunResult {
  contractVersion: string
  runId: string
  status: DisclosureWatchRunStatus
  mode: DisclosureWatchMode
  tradeDate: string
  regionId: string
  asOf: string
  createdAt: string
  finishedAt: string | null
  deadlineAt: string
  scopeLabel: string
  calibrationStatus: DisclosureWatchCalibrationStatus
  versions: {
    contract: string; ruleset: string; questionSet: string; format: string; dateRule: string; budget: string
    requestModel: string | null; modelVersions: string[]
  }
  inputVersion: { hash: string; snapshots: DisclosureWatchSnapshotSummary[] }
  inputCoverage: Record<DisclosureWatchCoreDataset, DisclosureWatchCoverageEntry>
  backgroundCoverage: { load_forecast: DisclosureWatchCoverageEntry }
  processingCoverage: { chains: number; modelRequired: number; evaluated: number; modelFailed: number; unprocessed: number }
  counts: {
    rawRows: number; duplicateRows: number; chains: number
    byDisposition: Record<DisclosureWatchDisposition, number>
    byLevel: Record<DisclosureWatchItemLevel, number>
  }
  attention: DisclosureWatchAttention
  summary: string
  items: DisclosureWatchItem[]
  background: {
    loadForecast: null | {
      coverageDate: string
      unit: 'MW'
      points: Array<{ timePoint: string; valueMw: number | null }>
      highLoadHours: string[] | null
      method: string
    }
  }
  usage: { calls: number; inputTokens: number | null; outputTokens: number | null; elapsedMs: number | null }
  errors: DisclosureWatchError[]
  dataMeta: { sourceType: 'IMPORT'; mock: false; productionWrite: false; persisted: true }
}
