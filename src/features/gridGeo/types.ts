// 2.5D（Cesium 的 Columbus View）已于 2026-09-08 下线：它既没有 2D 的取数轻量，
// 也没有 3D 的地形表现，实际使用中只是三档里被跳过的那一档。
export type GridGeoViewMode = '2d' | '3d'
export type GridGeoTerrainProvider = 'arcgis-terrain' | 'cesium-world-terrain' | 'ellipsoid'
export type GridGeoTerrainStatus = {
  kind: GridGeoTerrainProvider
  status: 'loading' | 'ready' | 'fallback' | 'error'
  label: string
  error?: string
  fallbackFrom?: GridGeoTerrainProvider
}
export type GridGeoWeatherLayer = 'none' | 'wind' | 'temperature' | 'precipitation' | 'irradiance' | 'cloud'
export type GridGeoPlantType = 'wind' | 'solar' | 'hydro' | 'thermal' | 'storage' | 'other'
export type GridGeoAccuracyLevel = 'site' | 'village' | 'township' | 'county' | 'approximate'
export type GridGeoConfidence = 'verified' | 'probable' | 'unverified'
export type GridGeoVisibility = 'public' | 'company' | 'user'
export type GridGeoLocationStatus = 'located' | 'approximate' | 'unresolved'
export type GridGeoNodeKind = 'pricing' | 'bus' | 'substation' | 'boundary' | 'other'

export type GridGeoEvidence = {
  title: string
  url: string
  publisher?: string
  accessedAt?: string
}

export type GridGeoPlantLocationRegistryItem = {
  sourcePlantId: string
  standardName: string
  aliases: string[]
  verificationStatus: 'verified' | 'approximate' | 'unresolved'
  plantId: string | null
  reason: string | null
  reviewedAt: string
  evidence: GridGeoEvidence[]
}

export type GridGeoPlant = {
  plantId: string
  standardName: string
  aliases: string[]
  plantType: GridGeoPlantType
  capacityMw: number | null
  status: string
  regionId: string
  ownerCompanyId: string
  ownerUserId?: string | null
  subjectType: string
  version: number
  gridOperator: 'csg' | 'sgcc' | 'mengxi' | 'other'
  visibility: GridGeoVisibility
  sourceRef: string
  location: {
    longitude: number
    latitude: number
    elevationM?: number | null
    coordinateSystem: 'WGS84'
    locationLabel: string
    accuracyLevel: GridGeoAccuracyLevel
    confidence: GridGeoConfidence
    uncertaintyMeters: number
    displayPolicy: 'exact-marker' | 'uncertainty-halo'
    coordinateSource: {
      name: string
      url: string
      license?: string
      accessedAt?: string
    } | null
    evidence: GridGeoEvidence[]
  }
  nodeRefs: Array<{
    nodeName: string
    relationType: 'pricing'
    assetId?: string
  }>
  integrationRefs: Partial<Record<'plantMasterFamily' | 'plantNodeFamily' | 'capacityFamily' | 'outputFamily' | 'outputDataset' | 'nodePriceFamily' | 'settlementFamily' | 'settlementDataset' | 'forecastEndpoint', string>> & Record<string, unknown>
  dataMeta: {
    sourceType: 'IMPORT' | 'MANUAL'
    mock: false
    productionWrite: false
    visibility: GridGeoVisibility
    contractVersion: string
    verifiedAt: string | null
    note: string
  }
  overrideState: {
    hasOverrides: boolean
    count: number
    fieldPaths: string[]
    latestVersion: number | null
    updatedAt: string | null
  }
  storageMeta: {
    sourceType: 'DB'
    mock: false
    productionWrite: false
    schemaVersion: string
    updatedAt: string
  }
}

export type GridGeoPlantIntegrations = {
  asset: { plantId: string; version: number; regionId: string; ownerCompanyId: string }
  identity: {
    plantNames: string[]
    nodeName: string | null
    mappingPolicy: 'exact-only'
    fallbackToPortfolio: false
  }
  domains: {
    nodePrice: { status: 'configured' | 'missing'; endpoint: string; marketKinds: Array<'da' | 'rt'>; stableRef: { nodeName: string } | null; sourceType: 'API' }
    output: { status: 'configured' | 'missing'; family: string | null; dataset: string | null; stableRef: { plantNames: string[] }; sourceType: 'CAPTURE' }
    forecast: { status: 'configured' | 'missing'; endpoint: string; displaySource: string | null; stableRef: { plantNames: string[] }; sourceType: 'CAPTURE' }
    settlement: { status: 'configured' | 'missing'; family: string | null; dataset: string | null; stableRef: { plantNames: string[] }; sourceType: 'CAPTURE' }
  }
  navigation: Record<'nodePrice' | 'output' | 'forecast' | 'settlement' | 'risk', string>
  contractVersion: string
}

export type GridMarketLayer = 'none' | 'priceSpread' | 'outputDeviation' | 'risk'
export type GridMarketMetric = {
  plantId: string
  nodeName: string | null
  priceSpread: number | null
  daAverage: number | null
  rtAverage: number | null
  outputDeviationMw: number | null
  outputDeviationPercent: number | null
  riskScore: number | null
  outputPointCount: number
  anomalyCount: number
}

export type GridGeoNode = {
  grouping?: { stationName: string | null; stationSegment: string; nodeSegment: string; voltageLevelKv: number | null; stationVoltageKv: number | null; basis: 'name-parsed' | 'unparsed' }
  assetId: string
  assetType: 'node'
  nodeId: string
  standardName: string
  nodeName: string
  aliases: string[]
  nodeKind: GridGeoNodeKind
  voltageLevelKv: number | null
  status: string
  locationStatus: GridGeoLocationStatus
  location: GridGeoPlant['location'] | null
  marketRefs: Record<string, unknown>
  regionId: string
  ownerCompanyId: string
  ownerUserId?: string | null
  version: number
  gridOperator: GridGeoPlant['gridOperator']
  visibility: GridGeoVisibility
  sourceRef: string
  dataMeta: GridGeoPlant['dataMeta']
  overrideState: GridGeoPlant['overrideState']
  storageMeta: GridGeoPlant['storageMeta']
}

export type GridGeoRevision<T = GridGeoPlant | GridGeoNode> = {
  revisionId: string
  assetId: string
  assetVersion: number
  operation: 'SEED' | 'CREATE' | 'UPDATE' | 'REVERT' | 'IMPORT' | 'IMPORT_UPDATE' | 'DEACTIVATE'
  before: T | null
  after: T | null
  actor: { userId: string; role: string; companyId: string; regionId: string }
  reason: string | null
  evidence: GridGeoEvidence[]
  requestId: string
  revertOf: string | null
  createdAt: string
}

export type GridGeoNodeStationGroup = {
  groupKey: string
  stationName: string | null
  displayName: string
  nodeCount: number
  regionId: string
  gridOperator: GridGeoNode['gridOperator']
  voltageLevels: number[]
  unknownVoltageCount: number
  summary: { locatedCount: number; approximateCount: number; unresolvedCount: number }
  priceReferenceCount: number
}

export type GridGeoNodeListResponse = {
  code: number
  data: {
    items: GridGeoNode[]
    groups?: GridGeoNodeStationGroup[]
    totalNodes?: number
    summary: { visibleCount: number; locatedCount: number; approximateCount: number; unresolvedCount: number; overriddenCount: number }
    pageSummary?: { visibleCount: number; locatedCount: number; approximateCount: number; unresolvedCount: number; overriddenCount: number }
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
    dataAvailability: { status: 'available' | 'empty' | 'missing'; fallback: false }
  }
  total: number
  sourceType: 'DB'
  mock: false
  productionWrite: false
}

export type GridGeoSummary = {
  visibleCount: number
  windCount: number
  solarCount: number
  totalCapacityMw: number
  verifiedCount: number
  approximateCount: number
  overriddenCount: number
}

export type GridGeoWeatherSnapshot = {
  plantId: string
  validAt: string
  intervalSeconds: number | null
  weatherCode: number
  weatherLabel: string
  weatherCategory: 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm' | 'unknown'
  temperatureC: number | null
  relativeHumidityPercent: number | null
  precipitationMm: number | null
  cloudCoverPercent: number | null
  windSpeedMs: number | null
  windDirectionDeg: number | null
  shortwaveRadiationWm2: number | null
  sampledLocation: {
    longitude: number
    latitude: number
    elevationM: number | null
    timezone: string
  }
}

export type GridGeoWeatherResponse = {
  code: number
  data: {
    items: GridGeoWeatherSnapshot[]
    summary: {
      locationCount: number
      averageTemperatureC: number | null
      averageWindSpeedMs: number | null
      maximumWindSpeedMs: number | null
      totalCurrentPrecipitationMm: number | null
      averageCloudCoverPercent: number | null
      alertCount: number
    }
    fetchedAt?: string
    expiresAt?: string
    dataAvailability: { status: 'available' | 'empty' | 'disabled' | 'unavailable' | 'stale'; reason?: string; fallback: boolean }
  }
  provider?: {
    id: 'open-meteo'
    name: string
    endpointHost: string
    modelSelection: string
    spatialMeaning: string
    license: string
    termsUrl: string
    attributionUrl: string
    commercialUseRequiresPlan: true
    cacheTtlSeconds: number
  }
  basis: 'real'
  sourceType: 'API'
  mock: false
  productionWrite: false
}

export type GridGeoCatalogMeta = {
  catalogId: string
  title: string
  regionId: string
  ownerCompanyId: string
  contractVersion: string
  locatedPlantCount: number
  totalPlantCountInCurrentDim: number
  unresolvedPlantCount: number | null
  sourceType: 'DB'
  mock: false
  productionWrite: false
  visibility: 'company'
  updatedAt: string
}

export type GridDisclosureCategory = 'maintenance' | 'outage' | 'intervention' | 'congestion' | 'constraint'

export type GridDisclosureGroup = {
  groupKey: string
  label: string
  kind: 'plant' | 'object' | 'unclassified'
  regionId: string
  total: number
  countsByCategory: Record<GridDisclosureCategory, number>
}

export type GridDisclosureEvent = {
  eventId: string
  personalFavorite?: boolean
  providerId: string
  category: GridDisclosureCategory
  title: string
  summary: string
  regionId: string
  spatialBinding: { kind: 'region' | 'grid' | 'section'; ref: string | null; label: string; coordinates: null }
  effectiveAt: string | null
  expiresAt: string | null
  publishedAt: string | null
  businessDate?: string | null
  effectiveDate?: string | null
  sourceImportedAt?: string | null
  timeQuality?: { effective: 'source' | 'business-date' | 'unknown'; published: 'source' | 'unknown'; intervalBasis?: 'actual' | 'planned' | 'source' | 'point' | 'unknown'; issues: string[] }
  /** 披露身份标注（#3092，GB04）：identity=annotate 时返回；versions>1 表示同一事件被重复披露（当前行是第 version 版）。 */
  identity?: { rule: 'source-interval' | 'planned-interval-text' | 'exact-record' | null; key: string | null; versions: number; version: number }
  source: {
    file: string
    recordId: string
    url: string | null
    sourceTable: string
    time?: { startField?: string | null; endField?: string | null }
    sourceType: 'IMPORT'
    mock: false
    productionWrite: false
    dataAvailability: 'available'
    license: string
    originalLinkStatus: string
  }
  confidence: 'verified-source-row'
  importedAt: string
}

export type GridDisclosureOverlay = {
  eventId: string
  scope: 'company' | 'user'
  favorite: boolean
  note: string
  tags: string[]
  version: number
  updatedBy: string
  updatedAt: string
}

export type GridDisclosureOverview = {
  total: number
  dayOnlyCount: number
  dayOnlyCountsByCategory: Record<GridDisclosureCategory, number>
  countsByCategory: Record<GridDisclosureCategory, number>
  buckets: Array<{ from: string; to: string; count: number; countsByCategory: Record<GridDisclosureCategory, number> }>
  coverage: {
    from: string | null
    to: string | null
    total: number
    timeBasis: 'businessDate'
    publishedTimeKnown: number
    sourceImportedTimeKnown: number
    effectiveTimeKnown: number
  }
  bucket: 'hour' | 'day'
  /** 身份归并计数（#3092，GB04）：identity=annotate 时返回；unidentified 是身份不足保留未归并的记录数。 */
  identity?: { rawCount: number; identifiedRawCount: number; distinctCount: number; unidentifiedCount: number }
  dataAvailability: { status: 'available' | 'missing' | 'not-configured'; reason: string; fallback: false }
}

export type GridDisclosureProvider = {
  providerId: string
  gridOperator: 'csg' | 'sgcc'
  name: string
  regionIds: string[]
  sourceType: 'IMPORT' | 'API'
  mock: false
  productionWrite: false
  access: string
  originalLinkPolicy: string
  license: string
  eventCount: number
  dataAvailability: { status: 'available' | 'missing' | 'not-configured'; reason: string }
}

export type GridOperatorAvailabilityStatus = 'available' | 'partial' | 'degraded' | 'missing' | 'not-configured'

export type GridOperatorProfile = {
  id: 'csg' | 'sgcc'
  label: string
  shortLabel: string
  operatingArea: string
  regionIds: string[]
  hierarchy: string[]
  terminology: Record<'marketArea' | 'provinceMarket' | 'pricingNode' | 'zonePrice' | 'unifiedClearing' | 'intertie' | 'disclosure' | 'systemSupply', string>
  visual: { accent: string; secondary: string; warning: string; surface: string; gradient: string[]; pattern: string; glyph: string }
  defaultCamera: { longitude: number; latitude: number; heightM: number; headingDeg: number; pitchDeg: number }
  nodeFields: string[]
  intertieFields: string[]
  principles: string[]
  profileVersion: string
  region: { id: string; label: string; gridOperator: 'csg' | 'sgcc' }
  dataAvailability: Record<'assets' | 'nodes' | 'topology' | 'disclosure' | 'weather' | 'marketTimeseries', { status: GridOperatorAvailabilityStatus; reason: string }>
  dataPolicy: { fallback: 'none-across-grid'; cacheNamespace: string; clearOnOperatorChange: true; sourceType: 'CONFIG'; mock: false; productionWrite: false }
}

export type GridTopologyProviderStatus = 'not-configured' | 'available' | 'degraded' | 'missing' | 'unauthorized' | 'error'

export type GridTopologyReadinessItem = {
  id: string
  label: string
  status: 'missing' | 'ready'
  required: boolean
}

export type GridTopologyManifest = {
  contractVersion: string
  provider: {
    id: string
    label: string
    status: GridTopologyProviderStatus
    configurationVisible: boolean
  }
  topologyVersion: string | null
  sourceVersion: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  updatedAt: string | null
  authorizationRef: string | null
  license: string | { name: string; url: string; redistribution: string } | null
  gridOperator: 'csg' | 'sgcc'
  regionId: string
  ownerCompanyId: string | null
  crs: 'WGS84'
  classification: string
  capabilities: {
    featureKinds: string[]
    queryModes: string[]
    geometryRequired: boolean
    physics: false
  }
  readiness: GridTopologyReadinessItem[]
  featureCounts: Record<string, number>
  dataAvailability: {
    status: GridTopologyProviderStatus
    reason: string
    regionRequested: string
    regionServed: string | null
    fallback: false
  }
}

export type GridTopologyManifestResponse = {
  code: number
  data: GridTopologyManifest
  sourceType: 'CONFIG' | 'DB' | 'IMPORT'
  basis?: 'captured'
  mock: false
  productionWrite: false
}

export type GridTopologyFeatureKind = 'substation' | 'bus' | 'node' | 'branch' | 'section' | 'intertie'
export type GridTopologyPosition = [longitude: number, latitude: number] | [longitude: number, latitude: number, elevationM: number]
export type GridTopologyGeometry =
  | { type: 'Point'; coordinates: GridTopologyPosition }
  | { type: 'LineString'; coordinates: GridTopologyPosition[] }
  | { type: 'MultiLineString'; coordinates: GridTopologyPosition[][] }
export type GridTopologyFeatureRefs = Partial<{
  sourceFeatureId: string
  plantId: string
  nodeId: string
  substationId: string
  busId: string
  fromBusId: string
  toBusId: string
  memberFeatureIds: string[]
}>

export type GridTopologyFeature = {
  featureId: string
  kind: GridTopologyFeatureKind
  name: string
  status: string
  topologyVersion: string
  sourceRef: string
  classification: 'public' | 'restricted'
  ownerCompanyId: string
  regionId: string
  gridOperator: 'csg' | 'sgcc'
  geometry: GridTopologyGeometry
  refs?: GridTopologyFeatureRefs
}

export type GridTopologySnapshotResponse = {
  code: number
  data: GridTopologyManifest & {
    query?: Record<string, unknown>
    features: GridTopologyFeature[]
    total: number
    nextCursor: string | null
  }
  sourceType: 'CONFIG' | 'DB' | 'IMPORT'
  basis?: 'captured'
  mock: false
  productionWrite: false
}

export type GridGeoListData = {
  items: GridGeoPlant[]
  summary: GridGeoSummary
  catalog: GridGeoCatalogMeta | null
  dataAvailability: {
    status: 'available' | 'empty' | 'missing'
    reason?: string
    regionRequested?: string
    regionServed?: string | null
    fallback: false
  }
}

export type GridGeoListResponse = {
  code: number
  data: GridGeoListData
  total: number
  sourceType: 'DB'
  mock: false
  productionWrite: false
}

export type GridGeoManifest = GridGeoCatalogMeta & {
  apiPrefix: string
  operatorProfile: GridOperatorProfile
  capabilities: {
    viewModes: GridGeoViewMode[]
    filters: string[]
    interactions: string[]
    futureIntegrationRefs: string[]
    allowedRoles: string[]
    writeRoles: string[]
    editableFieldPaths: string[]
    canWrite: boolean
    physics: { powerFlow: false; topology: false; sectionConstraint: false }
  }
  enumValues: {
    plantTypes: GridGeoPlantType[]
    nodeKinds: GridGeoNodeKind[]
    locationStatuses: GridGeoLocationStatus[]
    accuracyLevels: GridGeoAccuracyLevel[]
    confidenceLevels: GridGeoConfidence[]
    visibilityLevels: GridGeoVisibility[]
    terrainProviders: GridGeoTerrainProvider[]
    weatherLayers: GridGeoWeatherLayer[]
  }
  storage: {
    available: true
    sourceType: 'DB'
    schemaVersion: number | null
    versionedOverrides: true
    optimisticLocking: true
    idempotencyRequired: true
  }
  terrain: {
    defaultProvider: GridGeoTerrainProvider
    providers: Array<{ id: GridGeoTerrainProvider; tokenRequired: boolean; tokenEnv?: string; sourceType: 'API' | 'BUILTIN' }>
    supportsRuntimeSwitch: true
    supportsVerticalExaggeration: true
  }
  weather: {
    endpoint: string
    provider: 'open-meteo'
    layers: GridGeoWeatherLayer[]
    basis: 'real'
    sourceType: 'API'
    mock: false
    productionWrite: false
  }
  cache: {
    assets: { layer: 'client-memory'; ttlMs: number; requestCoalescing: true; invalidateOnWrite: true }
    integrations: { layer: 'client-memory'; ttlMs: number; requestCoalescing: true; invalidateOnWrite: true }
    weather: { layer: 'server-memory'; ttlMs: number; staleOnError: true }
    terrain: { layer: 'provider-http-browser'; offlineExportAllowed: false }
    imagery: { layer: 'provider-http-browser'; offlineExportAllowed: false }
  }
  degradation: Array<{
    level: number
    id: 'online' | 'cached' | 'offline-asset' | 'no-weather' | 'ellipsoid'
    terrain: boolean
    imagery: boolean
    weather: boolean | 'stale-labeled'
  }>
  performance: {
    lazyCesium: true
    requestCoalescing: true
    weakNetworkLod: true
    budgets: { vendorCesiumBytes: number; featureChunkBytes: number; assetListP95Ms: number }
  }
}

export type GridGeoSelection = {
  plantId: string
  x: number
  y: number
}

export type GridGeoMapSelection =
  | { kind: 'plant'; assetId: string; plantId: string; x: number; y: number }
  | { kind: 'node'; assetId: string; nodeId: string; x: number; y: number }

export type GridGeoRuntimeStatus = {
  network: 'normal' | 'weak'
  renderMode: 'continuous' | 'on-demand'
  webgl: 'ready' | 'lost' | 'restored' | 'unavailable'
  tileCacheSize: number
  reducedMotion: boolean
  effectiveType: string
  dataSaver: boolean
}
