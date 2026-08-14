export type ForecastTarget = 'load' | 'price' | 'strategy'

export type ForecastModelProvider = 'static-mock' | 'internal-model-service' | 'external-model-api'

export type ForecastModelMode = 'static' | 'shadow' | 'production'

export type ForecastRequest = {
  target: ForecastTarget
  area: string
  date: string
  scenario: string
  provider?: ForecastModelProvider
  horizonHours?: number
  features?: ForecastFeatureOverrides
}

export type ForecastModelDescriptor = {
  provider: ForecastModelProvider
  mode: ForecastModelMode
  modelKey: string
  version: string
  endpoint: string | null
  featureSchemaVersion: string
  trainingWindow: {
    from: string
    to: string
  }
}

export type ForecastFeatureSet = {
  calendar: {
    dayType: 'workday' | 'weekend' | 'holiday'
    dayOfWeek: number
    isHoliday: boolean
    isPeakSeason: boolean
  }
  weather: {
    temperatureC: number
    humidityPct: number
    windSpeedMps: number
    precipitationMm: number
    solarIrradianceWm2: number
  }
  system: {
    baselineLoadMWh: number
    renewableOutputMWh: number
    thermalAvailabilityPct: number
    plannedOutageMWh: number
    reserveMarginPct: number
  }
  market: {
    previousDayAvgPriceYuanMWh: number
    tradedVolumeMWh: number
    renewableSharePct: number
    gridConstraintLevel: 'low' | 'medium' | 'high'
    priceCapYuanMWh: number
  }
}

export type ForecastFeatureOverrides = {
  calendar?: Partial<ForecastFeatureSet['calendar']>
  weather?: Partial<ForecastFeatureSet['weather']>
  system?: Partial<ForecastFeatureSet['system']>
  market?: Partial<ForecastFeatureSet['market']>
}

export type ForecastRiskMetric = {
  code: string
  name: string
  level: 'low' | 'medium' | 'high'
  value: number
  unit: string
  threshold: number
  trend: 'up' | 'down' | 'flat'
  driver: string
  mitigation: string
}

export type StrategyAdvice = {
  posture: 'defensive' | 'neutral' | 'opportunistic'
  summary: string
  actions: StrategyAction[]
  watchItems: string[]
}

export type StrategyAction = {
  id: string
  priority: 'low' | 'medium' | 'high'
  target: 'volume' | 'price' | 'deviation' | 'settlement'
  timeWindow: string
  recommendation: string
  expectedImpact: string
  riskControl: string
}

export type ForecastScenario = {
  id: string
  name: string
  description: string
  loadPeak: number
  avgPrice: number
  confidence: number
  advice: string
  features: ForecastFeatureSet
  riskMetrics: ForecastRiskMetric[]
  strategyAdvice: StrategyAdvice
}

export type ForecastSeriesPoint = {
  hour: string
  actual: number
  forecast: number
  lowerBound: number
  upperBound: number
  confidence: number
}

export type ForecastQualityMetrics = {
  mapePct: number
  peakErrorPct: number
  volatilityIndex: number
  riskScore: number
}

export type ForecastExplanation = {
  summary: string
  target: ForecastTarget
  featureSchemaVersion: string
  confidenceBand: 'low' | 'medium' | 'high'
  baseline: {
    averageForecast: number
    peakHour: string
    peakForecast: number
    valleyHour: string
    valleyForecast: number
    spread: number
  }
  featureDrivers: ForecastFeatureDriver[]
  riskContributions: ForecastRiskContribution[]
  decisionTrace: ForecastDecisionTrace
}

export type ForecastFeatureDriver = {
  code: string
  name: string
  direction: 'up' | 'down' | 'flat'
  weight: number
  value: number | string
  unit: string
  rationale: string
}

export type ForecastFeaturePackageRow = {
  featureKey: string
  group: keyof ForecastFeatureSet
  field: string
  label: string
  value: string | number | boolean
  valueType: string
  sourceFamily: string | null
  localApi: string | null
  privateCacheNamespace: string | null
  transform: string
  updateCadence: string
  modelUse: string
}

export type ForecastFeatureSource = {
  family: string
  localApis: string[]
  featureKeys: string[]
  updateCadences: string[]
}

export type ForecastPrivateCacheTarget = {
  namespace: string
  privatePath: string
  featureKeys: string[]
}

export type ForecastFeaturePackage = {
  documentType: 'forecast-feature-package'
  packageId: string
  area: string
  date: string
  target: ForecastTarget
  scenarioId: string
  scenarioName: string
  generatedAt: string
  model: ForecastModelDescriptor
  featureSchemaVersion: string
  packageSchemaVersion: string
  runtimeStatus: string
  featureCount: number
  overrideContract: {
    acceptedRequestKey: string
    mergeRule: string
    supportedGroups: string[]
  }
  featureRows: ForecastFeaturePackageRow[]
  featureDrivers: ForecastFeatureDriver[]
  sourceFamilies: ForecastFeatureSource[]
  privateCacheTargets: ForecastPrivateCacheTarget[]
  validationCommands: string[]
  gitPolicy: string
}

export type ForecastRiskContribution = {
  code: string
  name: string
  level: 'low' | 'medium' | 'high'
  contributionPct: number
  driver: string
  mitigation: string
}

export type ForecastDecisionTrace = {
  posture: StrategyAdvice['posture']
  summary: string
  recommendedActions: StrategyAction[]
  watchItems: string[]
}

export type ForecastResponse = ForecastScenario & {
  requestId: string
  area: string
  date: string
  target: ForecastTarget
  scenarioId: string
  generatedAt: string
  horizonHours: number
  granularity: 'hourly'
  model: ForecastModelDescriptor
  appliedFeatures: ForecastFeatureSet
  metrics: ForecastQualityMetrics
  explanation?: ForecastExplanation
  series: ForecastSeriesPoint[]
}

export type DayRollingPricePointMode = 'all96' | 'hourly24' | 'selected'

export type DayRollingPricePredictionRequest = {
  area: string
  date: string
  scenario?: string
  pointMode: DayRollingPricePointMode
  timeRange?: {
    start: string
    end: string
  }
  selectedTimes?: string[]
  features?: ForecastFeatureOverrides
  historyRange1?: Array<[string, string] | { start: string; end: string }>
  historyRange2?: Array<[string, string] | { start: string; end: string }>
  k1?: number
  k2?: number
  lowerPct?: number
  upperPct?: number
  selectedFeatures?: string[]
  includeOthers?: boolean
  dataSourceConfig?: {
    load?: string
    wind?: string
    solar?: string
  }
  singleTimePoint?: string
  singleTimeGrain?: '96' | '24'
  customImportSessionId?: string
}

export type DayRollingPricePredictionPoint = {
  index: number
  time: string
  predictedPrice: number
  lowerBound: number
  upperBound: number
  thermalPrice: number
  confidence: number
  loadPressure: number
  renewablePressure: number
  constraintLevel: ForecastFeatureSet['market']['gridConstraintLevel']
}

export type DayRollingProductionFeature = {
  key: string
  label: string
}

export type DayRollingProductionDataSourceOption = {
  value: string
  label: string
}

export type DayRollingProductionKnnEndpoint = {
  key: string
  action: string
  path: string
  method: string
  contentType?: string
  bodyKeys?: string[]
  formFields?: string[]
  paramsJsonKeys?: string[]
  queryKeys?: string[]
  exportModes?: string[]
  runtimeMetadataStatus?: string
  status?: number
  responseContentType?: string
  responseDisposition?: string
  fileExtension?: string
  missingMetadataFields?: string[]
  condition?: string
}

export type DayRollingProductionKnnContract = {
  contractVersion: string
  sourceRoute: string
  localApi: string
  adapterFamily: string
  runtimeStatus: string
  modeMapping: Array<{
    localPointMode: DayRollingPricePointMode
    productionOutputMode: 'all96' | 'all24' | 'single'
    label: string
  }>
  activeEndpoint: DayRollingProductionKnnEndpoint
  transformedParams: {
    train_ranges1: Array<{ start: string; end: string }>
    train_ranges2: Array<{ start: string; end: string }>
    predict_date: string
    k1: number
    k2: number
    lower_pct: number
    upper_pct: number
    features: string[]
    include_others: boolean
    wind_source: string
    solar_source: string
    load_source: string
    output_mode: 'all96' | 'all24' | 'single'
    single_time_point: string
    single_time_grain: '96' | '24'
  }
  responseContract: {
    topLevelKeys: string[]
    resultsRowKeys: string[]
    detailsRowKeys: string[]
    summaryKeys: string[]
    parseRule: string
  }
  endpoints: DayRollingProductionKnnEndpoint[]
  currentSelection: {
    pointMode: DayRollingPricePointMode
    productionOutputMode: 'all96' | 'all24' | 'single'
    hasCustomImport: boolean
  }
  gitPolicy: string
}

export type DayRollingActionManifestEntry = {
  actionKey: string
  label: string
  localApi: string | null
  localMethod: string | null
  productionApi?: string
  productionMethod?: string
  artifactKind: string
  runtimeMetadataStatus: string
  missingRuntimeMetadataFields: string[]
  isActualFileTransfer: boolean
  uiStateLabel: string
}

export type DayRollingValidationCheck = {
  key: string
  label: string
  result: 'pass' | 'warn' | 'block'
  detail: string
}

export type DayRollingCustomImportContract = {
  enabled: boolean
  runtimeMetadataStatus: string
  selectedSources: Array<{
    feature: string
    sourceKey: string
    label: string
  }>
  uploadEndpoint: string
  uploadMethod: string
  uploadContentType: string
  paramsFieldName: string
  uploadFieldName: string
  paramsJsonKeys: string[]
  paramsPreviewKeys: string[]
  templateEndpoint: string
  templateMethod: string
  templateQueryKeys: string[]
  fileType: string
  acceptedFileTypes: string[]
  missingRuntimeMetadataFields: string[]
  privateCacheTarget: string
  gitPolicy: string
}

export type DayRollingSimilarDayRow = {
  rank: number
  date: string
  time: string
  price: number
  wind: number
  solar: number
  load: number
  export: number
  nonmkt: number
  hydro: number
  others: number
  isHigh: boolean
  isLow: boolean
  branch: number
  thermal: string
}

export type DayRollingProductionPointData = {
  date: string
  hour: string
  lower: number
  upper: number
  thermal: number
  similarDays: DayRollingSimilarDayRow[]
}

export type DayRollingPricePredictionResponse = {
  documentType: 'day-rolling-price-prediction'
  contractVersion: string
  productionRoute: string
  localRoute: string
  requestId: string
  area: string
  date: string
  scenarioId: string
  scenarioName: string
  pointMode: DayRollingPricePointMode
  pointModeLabel: string
  productionOutputMode: 'all96' | 'all24' | 'single'
  timeRange: {
    start: string
    end: string
  }
  selectedTimes: string[]
  generatedAt: string
  model: ForecastModelDescriptor
  runtimeStatus: string
  actionManifest: DayRollingActionManifestEntry[]
  validationChecks: DayRollingValidationCheck[]
  summary: {
    averagePrice: number
    maxPrice: number
    maxTime: string
    minPrice: number
    minTime: string
    spread: number
    volatilityIndex: number
    confidence: number
    riskLevel: ForecastRiskMetric['level']
    recommendedAction: string
  }
  controls: {
    supportedPointModes: Array<{
      value: DayRollingPricePointMode
      productionValue: 'all96' | 'all24' | 'single'
      label: string
      pointCount: number
    }>
    selectedFeatures: string[]
    featureCatalog: DayRollingProductionFeature[]
    includeOthers: boolean
    dataSourceConfig: {
      load: string
      wind: string
      solar: string
    }
    dataSourceOptions: {
      load: DayRollingProductionDataSourceOption[]
      wind: DayRollingProductionDataSourceOption[]
      solar: DayRollingProductionDataSourceOption[]
    }
    actions: Array<{
      key: string
      label: string
      localApi: string | null
      method: string | null
      productionApi?: string
      productionMethod?: string
      fileType?: string
    }>
  }
  productionKnnContract: DayRollingProductionKnnContract
  customImportContract: DayRollingCustomImportContract
  customImportSession: null | {
    sessionId: string
    fileName: string
    rowCount: number
    sheetName: string
    selectedSources: string[]
    runtimeStatus: string
  }
  summaryStats: {
    date: string
    hour: string | null
    lowerAvg: number
    upperAvg: number
    thermalAvg: number
  }
  summaryStatsAll: {
    lowerAvg: number
    upperAvg: number
    thermalAvg: number
  }
  similarDaysTableData: DayRollingSimilarDayRow[]
  pointsData: DayRollingProductionPointData[]
  featureDrivers: ForecastFeatureDriver[]
  inputContract: {
    acceptedBodyKeys: string[]
    productionBodyKeys: string[]
    productionResponseKeys: string[]
    staticFeatureGroups: string[]
    sourceFamilies: ForecastFeatureSource[]
    privateCacheTargets: ForecastPrivateCacheTarget[]
    futureModelBoundary: string
  }
  exportProfiles: Array<{
    key: string
    label: string
    pointMode: DayRollingPricePointMode
    productionExportMode: string
    fileType: string
    rowCount: number
    endpoint: string
    productionEndpoint: string
    productionMethod: string
    productionContentType: string
    runtimeMetadataStatus?: string
    responseContentType?: string
    responseDisposition?: string
    missingMetadataFields?: string[]
    gitPolicy: string
  }>
  points: DayRollingPricePredictionPoint[]
  all96Points: DayRollingPricePredictionPoint[]
  hourlyPoints: DayRollingPricePredictionPoint[]
  gitPolicy: {
    metadataCommittable: boolean
    modelOutputsCommittable: boolean
    realDataCommittable: boolean
    ignoredPrivatePath: string
  }
}

export type DayRollingExportMode = '96' | '24'

export type DayRollingPriceTemplateRequest = {
  area?: string
  date?: string
  scenario?: string
  selectedFeatures?: string[]
  dataSourceConfig?: {
    load?: string
    wind?: string
    solar?: string
  }
  singleTimePoint?: string
  singleTimeGrain?: '96' | '24'
  customImportSessionId?: string
}

export type DayRollingPriceExportRequest = DayRollingPricePredictionRequest & {
  exportMode: DayRollingExportMode
}

export type DayRollingPriceTemplateResponse = {
  documentType: 'day-rolling-price-template'
  contractVersion: string
  productionRoute: string
  localRoute: string
  area: string
  date: string
  scenarioId: string
  scenarioName: string
  generatedAt: string
  runtimeStatus: string
  actionManifest: DayRollingActionManifestEntry | null
  validationChecks: DayRollingValidationCheck[]
  templateMethod: string
  templateEndpoint: string
  responseContentType: string
  responseDisposition: string
  fileExtension: string
  fileNameRule: string
  query: {
    outputMode: 'all96' | 'all24' | 'single'
    singleTimePoint: string
    singleTimeGrain: '96' | '24'
    selectedSources: string[]
    selectedFlags: Record<string, boolean>
    queryKeys: string[]
  }
  acceptedFileTypes: string[]
  templateColumns: string[]
  sampleRows: Array<Record<string, string | number>>
  enabledFeatures: string[]
  selectedCustomImportSources: Array<{
    feature: string
    sourceKey: string
    label: string
  }>
  customImportSession: null | {
    sessionId: string
    fileName: string
    rowCount: number
    sheetName: string
    selectedSources: string[]
    runtimeStatus: string
  }
  privateCacheTarget: string
  gitPolicy: string
}

export type DayRollingPriceExportResponse = {
  documentType: 'day-rolling-price-export'
  contractVersion: string
  productionRoute: string
  localRoute: string
  area: string
  date: string
  scenarioId: string
  scenarioName: string
  generatedAt: string
  runtimeStatus: string
  actionManifest: DayRollingActionManifestEntry | null
  validationChecks: DayRollingValidationCheck[]
  exportMode: DayRollingExportMode
  exportLabel: string
  localExportPointMode: DayRollingPricePointMode
  productionExportMode: string
  endpoint: string
  method: string
  requestContentType: string
  responseContentType: string
  responseDisposition: string
  fileExtension: string
  fileNameRule: string
  rowCount: number
  columns: string[]
  previewRows: Array<Record<string, string | number>>
  customImportSession: null | {
    sessionId: string
    fileName: string
    rowCount: number
    sheetName: string
    selectedSources: string[]
    runtimeStatus: string
  }
  summary: {
    area: string
    date: string
    pointCount: number
    averagePrice: number
    maxPrice: number
    minPrice: number
    selectedFeatures: string[]
    includeOthers: boolean
    dataSourceConfig: {
      load: string
      wind: string
      solar: string
    }
    customImportSessionId: string | null
  }
  gitPolicy: string
}

export type DayRollingCustomImportSimulationRequest = DayRollingPricePredictionRequest & {
  uploadFileName?: string
  uploadRowCount?: number
  sheetName?: string
}

export type DayRollingCustomImportSimulationResponse = {
  documentType: 'day-rolling-price-custom-import'
  contractVersion: string
  productionRoute: string
  localRoute: string
  area: string
  date: string
  scenarioId: string
  scenarioName: string
  generatedAt: string
  runtimeStatus: string
  enabled: boolean
  sessionId: string
  actionManifest: DayRollingActionManifestEntry | null
  upload: {
    endpoint: string
    method: string
    contentType: string
    uploadFieldName: string
    paramsFieldName: string
    fileName: string
    rowCount: number
    sheetName: string
    selectedSources: Array<{
      feature: string
      sourceKey: string
      label: string
    }>
  }
  validation: {
    acceptedFileTypes: string[]
    requiredColumns: string[]
    optionalColumns: string[]
    passed: boolean
    issues: string[]
    nextProductionEndpoint: string
    nextProductionMethod: string
  }
  validationChecks: DayRollingValidationCheck[]
  activation: {
    predictionRequestKey: 'customImportSessionId'
    sessionBound: boolean
    nextLocalApi: string
  }
  parsedPreviewRows: Array<Record<string, string | number>>
  gitPolicy: string
}

export type RestoreTodoItem = {
  id: string
  status: 'pending' | 'in_progress' | 'completed'
  title: string
  notes: string
}
