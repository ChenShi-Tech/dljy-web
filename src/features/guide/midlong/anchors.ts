// 中长期导引的锚点 / 表单 / 状态 / 信号唯一清单（dljy#3404）。
// 内容层（contractBasics 等）一律引用这里的常量，不手写字符串；锚点守卫 spec
// 以本清单为真值双向核对 .vue 模板（防改版漂移）。命名规则：ml-<区域>-<元素>。
export const ANCHOR = {
  practiceBadge: 'practice-space-badge',
  // 「操作导引」入口按钮自身（选择面板的挂载点）
  launcher: 'ml-guide-launcher',
  // 合同列表页工具条
  openSubjects: 'ml-open-subjects',
  newContract: 'ml-new-contract',
  positionsLink: 'ml-positions-link',
  // 交易主体对话框
  subjectKey: 'ml-subject-key',
  subjectName: 'ml-subject-name',
  subjectStations: 'ml-subject-stations',
  subjectSubmit: 'ml-subject-submit',
  subjectClose: 'ml-subject-close',
  // 合同录入对话框（基本信息）
  contractDocKind: 'ml-contract-doc-kind',
  contractProductKind: 'ml-contract-product-kind',
  contractNo: 'ml-contract-no',
  contractName: 'ml-contract-name',
  contractSource: 'ml-contract-source',
  contractSubject: 'ml-contract-subject',
  contractStation: 'ml-contract-station',
  contractFramework: 'ml-contract-framework',
  contractSubmit: 'ml-contract-submit',
  // 经济内容编辑器
  econDeliveryStart: 'ml-econ-delivery-start',
  econDeliveryEnd: 'ml-econ-delivery-end',
  econQuantity: 'ml-econ-quantity',
  econPrice: 'ml-econ-price',
  econTaxBasis: 'ml-econ-tax-basis',
  econAlloc: 'ml-econ-alloc',
  econAllocComplete: 'ml-econ-alloc-complete',
  econCheck: 'ml-econ-check',
  // 合同详情页
  detailStatus: 'ml-detail-status',
  detailBlocking: 'ml-detail-blocking',
  detailEvidenceBtn: 'ml-detail-evidence-btn',
  detailVerifyBtn: 'ml-detail-verify-btn',
  detailBack: 'ml-detail-back',
  evidenceType: 'ml-evidence-type',
  evidenceFile: 'ml-evidence-file',
  evidenceSubmit: 'ml-evidence-submit',
  verifyEvidence: 'ml-verify-evidence',
  verifySubmit: 'ml-verify-submit',
  // 月度持仓页
  positionsMonths: 'ml-positions-months',
  positionsDrill: 'ml-positions-drill',
  // 分时分解面板（合同详情，dljy#3405）
  curvesPanel: 'ml-curves-panel',
  curvesImportBtn: 'ml-curves-import-btn',
  curvesEstimateBtn: 'ml-curves-estimate-btn',
  // 曲线导入对话框
  curveFile: 'ml-curve-file',
  curveGranularity: 'ml-curve-granularity',
  curveUnit: 'ml-curve-unit',
  curveTimezone: 'ml-curve-timezone',
  curveCoverage: 'ml-curve-coverage',
  curveBasis: 'ml-curve-basis',
  curveSubmit: 'ml-curve-submit',
  // 分解集详情页
  curvesetChecks: 'ml-curveset-checks',
  curvesetEvidence: 'ml-curveset-evidence',
  curvesetConfirm: 'ml-curveset-confirm',
  // 分时持仓（月度持仓页入口 + 分时持仓页）
  positionsIntervalsLink: 'ml-positions-intervals-link',
  intervalFiltersDate: 'ml-interval-filters-date',
  intervalBuckets: 'ml-interval-buckets',
  intervalDrill: 'ml-interval-drill',
  // 场站分配（合同详情面板 + 分配对话框）
  stationsPanel: 'ml-stations-panel',
  allocCreate: 'ml-alloc-create',
  allocType: 'ml-alloc-type',
  allocRows: 'ml-alloc-rows',
  allocEvidence: 'ml-alloc-evidence',
  allocBalance: 'ml-alloc-balance',
  allocSave: 'ml-alloc-save',
  allocConfirm: 'ml-alloc-confirm',
  allocDraftConfirm: 'ml-alloc-draft-confirm',
  allocDraftConfirmSubmit: 'ml-alloc-draft-confirm-submit',
  // 场站维度持仓
  positionsStationsLink: 'ml-positions-stations-link',
  stationPositionsTable: 'ml-station-positions-table',
} as const

export const FORM = {
  subject: 'midlong.subject',
  contractCreate: 'midlong.contract.create',
  evidence: 'midlong.evidence',
  verify: 'midlong.verify',
  positionsFilters: 'midlong.positions.filters',
  curveImport: 'midlong.curve.import',
  curvesetConfirm: 'midlong.curveset.confirm',
  intervalFilters: 'midlong.positions.intervals.filters',
  stationAllocation: 'midlong.stations.allocation',
  stationPositionsFilters: 'midlong.positions.stations.filters',
} as const

export const STATE = {
  contracts: 'midlong.contracts',
  contractDetail: 'midlong.contractDetail',
  positions: 'midlong.positions',
  curves: 'midlong.curves',
  curveSet: 'midlong.curveSet',
  contractStations: 'midlong.contractStations',
  intervalPositions: 'midlong.positions.intervals',
  stationPositions: 'midlong.positions.stations',
} as const

export const SIGNAL = {
  subjectCreated: 'midlong.subject.created',
  contractSaved: 'midlong.contract.saved',
  evidenceAdded: 'midlong.evidence.added',
  contractVerified: 'midlong.contract.verified',
  curveDraftCreated: 'midlong.curve.draftCreated',
  curveSetConfirmed: 'midlong.curveset.confirmed',
  allocationDraftSaved: 'midlong.stations.allocation.saved',
  allocationConfirmed: 'midlong.stations.allocation.confirmed',
} as const

/** 会话 artifacts 里的产物键（capture / recover 写，后续步骤的示例值读）。 */
export const ARTIFACT = {
  subjectId: 'subjectId',
  frameworkId: 'frameworkId',
  obligationId: 'obligationId',
  /** 与 runner 的 PRACTICE_STATIONS_ARTIFACT 同值：进入练习空间时由开通接口返回写入。 */
  practiceStationIds: 'practiceStationIds',
  /** 409 编码冲突时的重试次数（框架协议 / 电量合同各一份）。 */
  frameworkConflictAttempt: 'frameworkConflictAttempt',
  obligationConflictAttempt: 'obligationConflictAttempt',
  /** 本次导引固定使用的交割月份 [M+1, M+2, M+3]（会话开始时写入，跨月继续也不漂移）。 */
  guideMonths: 'guideMonths',
  /** 用户实际登记的主体编码（可能不含运行标签），刷新恢复时据此找回。 */
  subjectKey: 'subjectKey',
  /** 「分解与场站」：本次操作的电量合同 id（1-0 选定起点时记下）。 */
  guideObligationId: 'guideObligationId',
  /** 「分解与场站」：从合同正式月度分解读出的覆盖月份（按合同实际交割月，不按日历现算）。 */
  coverageMonths: 'coverageMonths',
  /** 「分解与场站」：导入草稿 / 确认的分解集 id（推进信号 payload 记下，「带我去」跳转用）。 */
  curveSetId: 'curveSetId',
} as const

export const GUIDE_ANCHORS: string[] = Object.values(ANCHOR)
export const GUIDE_FORM_KEYS: string[] = Object.values(FORM)
export const GUIDE_STATE_KEYS: string[] = Object.values(STATE)
export const GUIDE_SIGNAL_NAMES: string[] = Object.values(SIGNAL)
