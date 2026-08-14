// 现货 96 点价格曲线数据源：回放服务优先，合成降级（标注 demo）。
// 驾驶舱主图与申报工作台共用；合成形态与后端 harness 合成逻辑同形，保证演示一致。
import { fetchCaptured } from '@/services/captured'
import { currentRegion } from '@/services/region/regionContext'
import { createSpotPriceLoaders, curveStats } from '@/services/market/spotPriceCore'
import type { CurvePoint, SpotCurve } from '@/services/market/spotPriceCore'

// 走 fetchCaptured：自动带当前地区 region + 写 regionDataStatus（使申报工作台等
// 消费方的 RegionDataBanner 生效），同时复用可注入核心逻辑供门禁脚本验证降级行为。
// resolveRegion 把请求地区交给核心逻辑做「命中地区 == 请求地区」校验（#1459）：
// fetchCaptured 只保证请求带上 region，回放层仍可能回退到基线地区，回退结果不得
// 被当成本地区真实出清曲线。
const loaders = createSpotPriceLoaders(fetchCaptured, { resolveRegion: () => currentRegion.value.id })

export const { loadClearingCurve, loadForecastCurve } = loaders
export { curveStats }
export type { CurvePoint, SpotCurve }
