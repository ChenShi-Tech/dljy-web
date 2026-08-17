// #2169 P2-2a：数据管理路径族 → data-service（:8190）改道判定（纯函数，无 window 依赖）。
// 与 server/data-service/index.mjs 的装配面对齐（上传中心/导入中心写链/摄取触发/
// 治理只读三端点/grid-access/sichuan-ingest 转发/中广核数据源控制面）。
// 刻意排除：`/v1/settlements`（台账读）——复盘中心（交易页）消费，读服务面按边界留平台；
// retailSettlement 走 /agent-api multipart 通道，收编在 P2-2b。
export const DATA_SVC_ROOT = '/data-svc'

const DATA_SVC_EXACT = new Set([
  '/v1/market/trades/import',
  '/v1/settlements/import',
  '/v1/power/import',
  '/v1/customer-load/import',
  '/v1/market-analysis/import',
  '/v1/governance/catalog',
  '/v1/governance/quality',
  '/v1/governance/backup',
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

/** 数据管理路径族判定：命中返回 /data-svc 代理形态完整路径，否则 null（走平台 BFF）。 */
export function dataServicePath(path: string): string | null {
  const normalized = path.startsWith('/api/') ? path.slice(4) : path
  if (!normalized.startsWith('/v1/')) return null
  if (DATA_SVC_EXACT.has(normalized) || DATA_SVC_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return `${DATA_SVC_ROOT}/api${normalized}`
  }
  return null
}
