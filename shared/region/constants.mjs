// 采集数据的统一基线地区常量（前后端共享）。
//
// 消除历史「sqlite 基线 'base' / capture-raw 基线 'shanxi' / 前端默认 'yunnan'」
// 三处不一致的潜伏 bug：seed 写死 'base' 时，前端 fetchCaptured(region='yunnan')
// → sqlite 查 yunnan 失败 → 回退 'base' → 返回山西口径数据，地区隔离在 sqlite 层失效。
//
// CAPTURE_BASELINE_REGION：采集数据的「归一化锚点地区」。真实采集数据来自山西现货，
//   #346 阶段B 地区第一级重构后落 capture-raw/shanxi/ 子目录，故锚点 = 'shanxi'。
//   normRegion（capture-store.mjs）对非法/空 region 兜底到此值仅为请求健壮性，
//   **非数据回退**——地区第一级下每地区只读自身分区，非 shanxi 地区绝不串读山西真实数据。
//   capture.sqlite（capture-store.mjs）与 capture-raw（capture-replay.mjs captureDir）统一用此锚点。
//   前端 UI 默认地区（regions.ts defaultRegionId='yunnan'）是用户业务偏好，与数据锚点无关，不在本文件。
export const CAPTURE_BASELINE_REGION = 'shanxi'

// 「真实或空」严格地区策略：**所有非基线地区**只回放自己的真实采集/导入数据；缺失时
// **不回退基线（山西）真实数据**，而是落到按地区差异化的合成模拟（mock-capture，标
// mock:true）或空。目的：避免把山西真实口径串读到任一其他地区，让每个地区只显示自己的
// 真实数据或明确的模拟/空。基线（山西）自身仍回放其扁平真实采集，不受影响。
//
// 与前端 `REAL_DATA_REGION_IDS`（regions.ts）**解耦**——前端管「UI 可切换」
// (=有专属真实数据、灰不灰，当前 [yunnan, shanxi])，后端谓词管「数据策略」
// (=所有非基线地区一律不回退)。二者不再镜像、各司其职共同达成严格地区隔离。
//
// REGION_STRICT_REAL_DATA：信息性集合，记录「已确认接入专属真实采集/导入数据」的
// 非基线地区（供文档/展示引用）；数据策略以下方 isRegionStrictRealData 谓词为准
// （谓词覆盖所有非基线地区，不依赖本集合）。
export const REGION_STRICT_REAL_DATA = new Set(['yunnan'])

// 判断某地区是否启用「真实或空、不回退山西」策略。
// 反转判定（#346-A2）：除基线（山西）外的所有合法地区一律严格、不回退——
// 基线自身回放扁平真实采集，其余地区真实或空。非法/空 region 返回 false（交由请求层
// normRegion 归一化到基线作锚点，仅防 sqlite 报错，非数据回退）。
export function isRegionStrictRealData(region) {
  return typeof region === 'string'
    && region !== CAPTURE_BASELINE_REGION
    && /^[a-z][a-z-]*$/.test(region)
}

// region id → 地区中文名（落盘行 area 字段/展示用）。全省覆盖，单一来源。
// 与 src/data/regions.ts::provinceRegionProfiles 的 shortName 一致。
// 用途：替代历史 `region==='yunnan'?'云南':'山西'` 硬编码——非云南地区一律被误标「山西」是
// 串读隐患（#346-A3）；未登记地区回退 region id 本身（诚实未知，绝不默认山西）。
export const AREA_LABEL_BY_REGION = {
  beijing: '北京', tianjin: '天津', hebei: '河北', shanxi: '山西',
  'inner-mongolia': '内蒙古', liaoning: '辽宁', jilin: '吉林', heilongjiang: '黑龙江',
  shanghai: '上海', jiangsu: '江苏', zhejiang: '浙江', anhui: '安徽', fujian: '福建',
  jiangxi: '江西', shandong: '山东', henan: '河南', hubei: '湖北', hunan: '湖南',
  guangdong: '广东', guangxi: '广西', hainan: '海南', chongqing: '重庆', sichuan: '四川',
  guizhou: '贵州', yunnan: '云南', tibet: '西藏', shaanxi: '陕西', gansu: '甘肃',
  qinghai: '青海', ningxia: '宁夏', xinjiang: '新疆',
  'hong-kong': '香港', macau: '澳门', taiwan: '台湾'
}

// 取地区中文名；未登记 → 回退 region id 本身（不默认「山西」，避免跨地区串读误标）。
export function areaLabelForRegion(region) {
  if (typeof region !== 'string' || !region) return null
  return AREA_LABEL_BY_REGION[region] || region
}

// —— 地区 → 电网运营商 权威表（Issue #575：电网数据分层） ——
// 电网通用数据（gridScope）按此判定「同电网」：sgcc(国家电网) / csg(南方电网) / mengxi(蒙西) / other(特殊区)。
// 与 src/data/regions.ts::gridOperator 一致（state-grid→sgcc / china-southern-grid→csg /
// inner-mongolia-grid→mengxi / special-region·taiwan-grid→other）。国网通用只在国网地区间共享，
// 南网通用只在南网地区间共享，绝不跨电网串读（数据完整性）。
export const REGION_GRID_OPERATOR = {
  beijing: 'sgcc', tianjin: 'sgcc', hebei: 'sgcc', shanxi: 'sgcc', liaoning: 'sgcc',
  jilin: 'sgcc', heilongjiang: 'sgcc', shanghai: 'sgcc', jiangsu: 'sgcc', zhejiang: 'sgcc',
  anhui: 'sgcc', fujian: 'sgcc', jiangxi: 'sgcc', shandong: 'sgcc', henan: 'sgcc',
  hubei: 'sgcc', hunan: 'sgcc', chongqing: 'sgcc', sichuan: 'sgcc', tibet: 'sgcc',
  shaanxi: 'sgcc', gansu: 'sgcc', qinghai: 'sgcc', ningxia: 'sgcc', xinjiang: 'sgcc',
  guangdong: 'csg', guangxi: 'csg', hainan: 'csg', guizhou: 'csg', yunnan: 'csg',
  'inner-mongolia': 'mengxi',
  'hong-kong': 'other', macau: 'other', taiwan: 'other'
}

// 各电网的基线地区（电网通用数据的物化锚点）：国网现货真实采集落 shanxi/。
// 南网通用暂无采集（南网数据现为 yn_* 地区专属），故 csg 基线留待接入（返回 null 即不回退）。
export const GRID_BASELINE_REGION = {
  sgcc: CAPTURE_BASELINE_REGION // 'shanxi'
}

// 取地区所属电网（未登记 → null，交由调用方按「地区严格」处理，不默认任何电网）。
export function regionGridOperator(region) {
  return (typeof region === 'string' && REGION_GRID_OPERATOR[region]) || null
}

// 取某电网的基线地区（电网通用数据回退锚点）；无基线（如 csg 暂未接入）→ null。
export function gridBaselineRegion(grid) {
  return GRID_BASELINE_REGION[grid] ?? null
}
