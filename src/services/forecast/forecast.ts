import { apiGet, apiPost } from '@/services/api'
import type {
  ForecastFeaturePackage,
  ForecastFeatureOverrides,
  ForecastFeatureSet,
  ForecastQualityMetrics,
  ForecastRequest,
  ForecastResponse,
  DayRollingPriceExportRequest,
  DayRollingPriceExportResponse,
  DayRollingCustomImportSimulationRequest,
  DayRollingCustomImportSimulationResponse,
  DayRollingPricePredictionRequest,
  DayRollingPricePredictionResponse,
  DayRollingPriceTemplateRequest,
  DayRollingPriceTemplateResponse,
  ForecastScenario,
  ForecastSeriesPoint
} from '@/services/types'

export type {
  ForecastFeaturePackage,
  ForecastFeaturePackageRow,
  ForecastFeatureSource,
  ForecastFeatureOverrides,
  ForecastFeatureSet,
  ForecastModelDescriptor,
  ForecastModelProvider,
  ForecastQualityMetrics,
  ForecastRequest,
  ForecastResponse,
  DayRollingExportMode,
  DayRollingCustomImportSimulationRequest,
  DayRollingCustomImportSimulationResponse,
  DayRollingPriceExportRequest,
  DayRollingPriceExportResponse,
  DayRollingPricePredictionRequest,
  DayRollingPricePredictionResponse,
  DayRollingPriceTemplateRequest,
  DayRollingPriceTemplateResponse,
  DayRollingPricePointMode,
  ForecastRiskMetric,
  ForecastScenario,
  ForecastSeriesPoint,
  ForecastPrivateCacheTarget,
  ForecastTarget,
  StrategyAction,
  StrategyAdvice
} from '@/services/types'

export async function listForecastScenarios() {
  const response = await apiGet<ForecastScenario[]>('/forecast/scenarios')
  return response.data ?? []
}

export async function getForecastFeaturePackage(params: Pick<ForecastRequest, 'target' | 'area' | 'date' | 'scenario'>) {
  const response = await apiGet<ForecastFeaturePackage>('/forecast/feature-package', params)
  return response.data!
}

export async function runForecast(request: ForecastRequest): Promise<ForecastResponse> {
  const response = await apiPost<ForecastResponse>('/forecast/run', request)
  return response.data!
}

export async function runDayRollingPricePrediction(request: DayRollingPricePredictionRequest): Promise<DayRollingPricePredictionResponse> {
  const response = await apiPost<DayRollingPricePredictionResponse>('/forecast/day-rolling-price', request)
  return response.data!
}

export async function getDayRollingPriceTemplate(params: DayRollingPriceTemplateRequest): Promise<DayRollingPriceTemplateResponse> {
  const response = await apiGet<DayRollingPriceTemplateResponse>('/forecast/day-rolling-price/template', {
    area: params.area,
    date: params.date,
    scenario: params.scenario,
    selectedFeatures: params.selectedFeatures?.join(','),
    loadSource: params.dataSourceConfig?.load,
    windSource: params.dataSourceConfig?.wind,
    solarSource: params.dataSourceConfig?.solar,
    singleTimePoint: params.singleTimePoint,
    singleTimeGrain: params.singleTimeGrain,
    customImportSessionId: params.customImportSessionId
  })
  return response.data!
}

export async function exportDayRollingPrice(request: DayRollingPriceExportRequest): Promise<DayRollingPriceExportResponse> {
  const response = await apiPost<DayRollingPriceExportResponse>('/forecast/day-rolling-price/export', request)
  return response.data!
}

export async function simulateDayRollingCustomImport(request: DayRollingCustomImportSimulationRequest): Promise<DayRollingCustomImportSimulationResponse> {
  const response = await apiPost<DayRollingCustomImportSimulationResponse>('/forecast/day-rolling-price/custom-import', request)
  return response.data!
}
