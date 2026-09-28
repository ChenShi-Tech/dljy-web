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
} as const

export const FORM = {
  subject: 'midlong.subject',
  contractCreate: 'midlong.contract.create',
  evidence: 'midlong.evidence',
  verify: 'midlong.verify',
  positionsFilters: 'midlong.positions.filters',
} as const

export const STATE = {
  contracts: 'midlong.contracts',
  contractDetail: 'midlong.contractDetail',
  positions: 'midlong.positions',
} as const

export const SIGNAL = {
  subjectCreated: 'midlong.subject.created',
  contractSaved: 'midlong.contract.saved',
  evidenceAdded: 'midlong.evidence.added',
  contractVerified: 'midlong.contract.verified',
} as const

/** 会话 artifacts 里的产物键（capture / recover 写，后续步骤的示例值读）。 */
export const ARTIFACT = {
  subjectId: 'subjectId',
  frameworkId: 'frameworkId',
  obligationId: 'obligationId',
  practiceStationIds: 'practiceStationIds',
  /** 409 编码冲突时的重试次数（框架协议 / 电量合同各一份）。 */
  frameworkConflictAttempt: 'frameworkConflictAttempt',
  obligationConflictAttempt: 'obligationConflictAttempt',
} as const

export const GUIDE_ANCHORS: string[] = Object.values(ANCHOR)
export const GUIDE_FORM_KEYS: string[] = Object.values(FORM)
export const GUIDE_STATE_KEYS: string[] = Object.values(STATE)
export const GUIDE_SIGNAL_NAMES: string[] = Object.values(SIGNAL)
