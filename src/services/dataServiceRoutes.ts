// #2169 P2-2a：数据管理路径族 → data-service（:8190）改道判定（纯函数，无 window 依赖）。
// 与 server/data-service/index.mjs 的装配面对齐（上传中心/导入中心写链/摄取触发/
// 治理只读三端点/grid-access/sichuan-ingest 转发/中广核数据源控制面）。
// `/v1/settlements`（台账读，复盘中心交易页消费）：平台侧处理器已随 full-suite 演示域
// 退役（#1642/Epic #1637），唯一处理器在 data-service 的 routeImportHub——不改道即落
// 平台 BFF 的「/api/v1 下未匹配任何已注册域」404，故随六族一并走 /data-svc。
// （本仓此前停留在「按边界留平台」的旧判断，与主仓 #2189 的修正不同步，实测复现 404。）
export const DATA_SVC_ROOT = '/data-svc'

const DATA_SVC_EXACT = new Set([
  '/v1/market/trades/import',
  '/v1/settlements/import',
  '/v1/settlements',
  '/v1/power/import',
  '/v1/customer-load/import',
  '/v1/market-analysis/import',
  '/v1/governance/catalog',
  '/v1/governance/quality',
  '/v1/governance/backup',
  '/v1/governance/db-health',
  '/v1/sichuan-ingest',
  '/v1/sichuan-ingest/trigger',
  '/v1/sichuan-ingest/health',
])

const DATA_SVC_PREFIXES = [
  '/v1/data-upload',
  '/v1/import-templates',
  '/v1/import-hub',
  '/v1/ingest/',
  '/v1/grid-access',
  '/v1/data-sources/cgn-yunnan',
]

/**
 * 数据管理路径族判定：命中返回 /data-svc 代理形态完整路径，否则 null（走平台 BFF）。
 *
 * 判定只看 pathname：`?query` / `#hash` 先剥掉、改道后原样带回。此前拿整串字面量查精确集合，
 * `/v1/sichuan-ingest/trigger` 命中而 `/v1/sichuan-ingest/trigger?menuCode=…` 落空 → 单数据集
 * 手动触发打到平台 BFF 已退役的 /api/v1 报 404（dljy#2501）。「query 由调用方走 params 传」只是
 * 口头约定，缝本身必须对拼进字面量的 query 稳。
 */
export function dataServicePath(path: string): string | null {
  const cut = path.search(/[?#]/)
  const pathname = cut >= 0 ? path.slice(0, cut) : path
  const suffix = cut >= 0 ? path.slice(cut) : ''
  const normalized = pathname.startsWith('/api/') ? pathname.slice(4) : pathname
  if (!normalized.startsWith('/v1/')) return null
  if (DATA_SVC_EXACT.has(normalized) || DATA_SVC_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return `${DATA_SVC_ROOT}/api${normalized}${suffix}`
  }
  return null
}
