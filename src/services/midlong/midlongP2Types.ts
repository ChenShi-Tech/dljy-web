// 中长期售电 P2（分时分解与场站分配，dljy#2971）的类型与枚举出口：页面经 services 取用共享契约，
// 不直接依赖 shared/ 路径（契约由 dljy 主仓 shared/midlong/curves 单向同步而来，本仓只读）。
export type {
  BucketCoverage, ContractCurvesOverview, ContractStationAllocationsOverview, CorrectionImpactStatus, CurveConfirmResult,
  CurveCorrectionImpact, CurveDraftInput, CurveDraftResult, CurveEstimateInput, CurveEstimateMethod, CurveFileRole, CurveGranularity,
  CurveInterval, CurveMonthCheck, CurveSet, CurveSetDetail, CurveSetStatus, CurveSourceDocumentType, CurveTemplateDeclaration,
  CurveTemplateFiles, CurveTimeStatus, EffectiveStationAllocation, IntervalBucket, IntervalPositionGranularity, IntervalPositionQuery,
  IntervalPositionReport, IssueReport, IssueSummaryEntry, P2DiscardResult, StationAllocationConfirmResult, StationAllocationDraftInput,
  StationAllocationDraftResult, StationAllocationKind, StationAllocationRow, StationAllocationSet, StationAllocationSetDetail,
  StationContribution, StationDerivation, StationPositionQuery, StationPositionReport, StationSegment, StationSegmentMode, ValidationIssue,
} from 'shared/midlong/curves.mjs'
export {
  BUCKET_COVERAGE_LABELS, CORRECTION_IMPACT_LABELS, CURVE_CONVERSION_METHOD_LABELS, CURVE_ESTIMATE_GRANULARITIES, CURVE_ESTIMATE_METHOD_LABELS,
  CURVE_EVIDENCE_BASIS_LABELS, CURVE_FILE_COLUMNS, CURVE_FILE_SHEETS, CURVE_FORMAL_SOURCE_DOCUMENT_TYPES, CURVE_GRANULARITIES,
  CURVE_GRANULARITY_LABELS, CURVE_INPUT_KIND_LABELS, CURVE_MEASURE_LABELS, CURVE_SET_STATUS_LABELS, CURVE_SOURCE_DOCUMENT_TYPES,
  CURVE_STANDARD_TEMPLATE, CURVE_TEMPLATES, CURVE_TIME_STATUS_LABELS, CURVE_UNITS, INTERVAL_POSITION_MAX_DAYS, P2_BASIS_EVIDENCE_TYPES,
  STATION_ALLOCATION_KINDS, STATION_ALLOCATION_KIND_LABELS, STATION_DERIVATION_LABELS, STATION_SEGMENT_MODES, STATION_SEGMENT_MODE_LABELS,
  resolveIntervalRange, validateStationAllocations,
} from 'shared/midlong/curves.mjs'
