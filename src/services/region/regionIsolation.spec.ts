// 地区隔离运行时矩阵（Epic #1431 S3 · ADR 裁决五 / 二轮评审 B3）
// ----------------------------------------------------------------------------
// 定位：静态声明快照只能证明「声明态没变」，证明不了「运行时没有跨地区/跨公司读取」。
// 本矩阵是运行时正反例，完全自包含（纯函数 + 内联 fixture，不依赖任何私有数据、
// 不起服务、不触网），因此绝不会因缺数据 SKIP，直接补上 verify-strict-region-replay
// 仅抽 4 个云南样本且可整体 SKIP 的缺口。
//
// 挂载：`npm run test:unit`（ci-local quick 档 + CI Quality Gate）⇒ PR 合并前必跑（B3 硬要求）。
//
// 六维覆盖（每维正反例）：
// ① crossRegion 正例（真·全国通用族允许跨地区）
// ② 同 gridScope 正例 + 跨电网负例（国网通用族不得服务南网地区）
// ③ company owner 正例 + 非归属负例（被拒不得回退 Mock）
// ④ 未知/未配置地区（serving-route 无路由 → 诚实空态，不回落基线）
// ⑤ 未登记 capability（fail-closed，不放行）
// ⑥ 切区后缓存失效（缓存键必须含地区，不得跨地区复用）

import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  getFamilyGridScope,
  isCrossRegionFamily,
  resolveCaptureOwner
} from 'shared/schema/entities/capture-families.mjs'
import {
  gridBaselineRegion,
  isRegionStrictRealData,
  REGION_GRID_OPERATOR
} from 'shared/region/constants.mjs'
import { buildGridGeoCacheScope } from '@/features/gridGeo/cache'
import { resolveServingRoute } from '@/services/data/contracts/servingRoutes.gen'
import { isPathAvailableInRegion } from '@/services/governance'
import { getRegionCapabilityForPath, isRegionRouteAvailable, regionCapabilityAllowsRequest } from './regionModules'
import { resolveMechanismProfile } from './mechanismProfile'
import { INSIGHT_PAGE_PATHS, resolveInsightPage } from './insightWorkspace'

const CSG_REGION = 'yunnan'
const SGCC_BASELINE = 'shanxi'
const SGCC_OTHER = 'hebei'
const CGN_YUNNAN_COMPANY = 'comp-cgn-yunnan'

describe('① crossRegion：真·全国通用族允许跨地区共享', () => {
  it('ENSO 指数与数据字典是 crossRegion 公共族', () => {
    expect(isCrossRegionFamily('sdpt_elninolanina')).toBe(true)
    expect(isCrossRegionFamily('system_dict')).toBe(true)
  })

  it('负例：省专属族与 company 私有族一律不得跨地区', () => {
    expect(isCrossRegionFamily('sdpt_zcqxhdl')).toBe(false)
    expect(isCrossRegionFamily('yn_node_price')).toBe(false)
    expect(isCrossRegionFamily('yn_plant_output')).toBe(false)
  })
})

describe('② gridScope：同电网可共享，跨电网必须拒绝', () => {
  it('国网通用族标 sgcc scope', () => {
    expect(getFamilyGridScope('sdpt_zjyap')).toBe('sgcc')
    expect(getFamilyGridScope('sdpt_zptwd')).toBe('sgcc')
  })

  it('正例：同为国网的省份共享该 scope 的基线锚点', () => {
    expect(REGION_GRID_OPERATOR[SGCC_BASELINE]).toBe('sgcc')
    expect(REGION_GRID_OPERATOR[SGCC_OTHER]).toBe('sgcc')
    expect(gridBaselineRegion('sgcc')).toBe(SGCC_BASELINE)
  })

  it('负例：南网地区与国网通用族跨电网——csg 无基线锚点，不得借用国网数据', () => {
    expect(REGION_GRID_OPERATOR[CSG_REGION]).toBe('csg')
    // csg 无基线地区 ⇒ 南网省份缺数据时无处可回退，只能诚实空态（这正是隔离的实现方式）
    expect(gridBaselineRegion('csg')).toBeNull()
  })

  it('company 私有族恒地区+公司双严格，永不参与任何 scope 共享', () => {
    expect(getFamilyGridScope('yn_node_price')).toBeNull()
    expect(getFamilyGridScope('yn_plant_output')).toBeNull()
  })
})

describe('③ company owner：归属正例与非归属负例（被拒不得回退 Mock）', () => {
  it('正例：云南私有出力族归属中广核云南', () => {
    expect(resolveCaptureOwner('yn_plant_output', 'yunnan', 'yn_plant_output')).toBe(CGN_YUNNAN_COMPANY)
  })

  it('负例：非归属公司解析结果与请求方不一致 ⇒ 调用方必须拒绝而非回退', () => {
    const owner = resolveCaptureOwner('yn_plant_output', 'yunnan', 'yn_plant_output')
    const requester = 'comp-someone-else'
    expect(owner).not.toBe(requester)
    // 消费侧契约（marketSpatial::resolveScopedOutputSources）据此剔除该源，
    // 剔除后 sources 为空 ⇒ 面板显示 not-configured，绝不改用他司数据或 Mock 顶替
  })

  it('负例：public 族没有 owner，不能被误当作「公司私有已授权」', () => {
    expect(resolveCaptureOwner('sdpt_zcqxhdl', 'shanxi', 'x')).toBeNull()
    expect(resolveCaptureOwner('yn_system_forecast', 'yunnan', 'da_user_price')).toBeNull()
  })
})

describe('④ 未知/未配置地区：诚实空态，不回落基线（B2 红线运行时证明）', () => {
  it('未配置 serving 路由的地区解析为 null（不是回落到山西路由）', () => {
    expect(resolveServingRoute('clearing_price', SGCC_OTHER)).toBeNull()
    expect(resolveServingRoute('clearing_price', 'not-a-region')).toBeNull()
    expect(resolveServingRoute('node_price', SGCC_BASELINE)).toBeNull()
  })

  it('已配置地区各自解析到自己的 family，绝不互相串读', () => {
    expect(resolveServingRoute('clearing_price', CSG_REGION)?.familyRef).toBe('yn_system_forecast')
    expect(resolveServingRoute('clearing_price', SGCC_BASELINE)?.familyRef).toBe('sdpt_zcqxhdl')
  })

  it('严格地区谓词覆盖所有非基线地区', () => {
    expect(isRegionStrictRealData(CSG_REGION)).toBe(true)
    expect(isRegionStrictRealData(SGCC_OTHER)).toBe(true)
    expect(isRegionStrictRealData(SGCC_BASELINE)).toBe(false)
  })

  it('机制画像对未配置地区如实 unknown，不套用他省口径', () => {
    const profile = resolveMechanismProfile(SGCC_OTHER, 'clearing_price')
    expect(profile.daRtSeparated.value).toBe('unknown')
    expect(profile.priceBasis.generation.value).toBe('unknown')
  })
})

describe('⑤ 未登记 capability：fail-closed 不放行', () => {
  const COVERED_PATH = '/sjfx/zrsjg'

  it('未登记地区按 not-configured 拦截（路由与请求双闸）', () => {
    expect(getRegionCapabilityForPath(COVERED_PATH, SGCC_OTHER)?.status).toBe('not-configured')
    expect(isRegionRouteAvailable(COVERED_PATH, SGCC_OTHER)).toBe(false)
    expect(regionCapabilityAllowsRequest(COVERED_PATH, SGCC_OTHER)).toBe(false)
  })

  it('已登记地区不受影响', () => {
    expect(regionCapabilityAllowsRequest(COVERED_PATH, SGCC_BASELINE)).toBe(true)
    expect(regionCapabilityAllowsRequest(COVERED_PATH, CSG_REGION)).toBe(true)
  })
})

describe('⑦ 插槽渲染双闸：角色权限 × 地区能力（回归锚）', () => {
  // 插槽注册携带 capabilityPath 时，内核必须同时过 canAccessPath（RBAC）与
  // isPathAvailableInRegion（地区能力）。只查前者会让 ADMIN/BOSS 绕过地区闸门，
  // 也会让「甲省 capabilityPath 误注册给乙省」在乙省渲染出不该出现的面板。
  it('地区能力闸门对 hidden/not-configured 一律拒绝（与角色无关）', () => {
    // 未登记地区：能力注册表 fail-closed
    expect(isPathAvailableInRegion('/xhjy/yunnan/elasticity', SGCC_OTHER)).toBe(false)
    // 云南本省：能力放行（该省确有此路由）
    expect(isPathAvailableInRegion('/xhjy/yunnan/elasticity', CSG_REGION)).toBe(true)
  })

  it('地区专区路由不对他省放行——即便注册被误配也拦得住', () => {
    expect(isPathAvailableInRegion('/xhjy/yunnan/spread', SGCC_BASELINE)).toBe(false)
    expect(isPathAvailableInRegion('/xhjy/yunnan/spread', 'guangdong')).toBe(false)
  })
})

describe('⑥ 切区缓存失效：缓存键必须含地区维度', () => {
  // 直接断言生产实现（gridGeo 缓存模块导出、client.ts::cacheScope 唯一调用的
  // key builder）：在测试里复制一份期望实现，会让生产函数漏掉地区/公司维度时依然
  // 全绿。

  it('同公司切地区 ⇒ 键不同，旧地区响应不会被复用', () => {
    expect(buildGridGeoCacheScope('yunnan', 'c1')).not.toBe(buildGridGeoCacheScope('shanxi', 'c1'))
  })

  it('同地区切公司 ⇒ 键不同，跨租户不复用', () => {
    expect(buildGridGeoCacheScope('yunnan', 'c1')).not.toBe(buildGridGeoCacheScope('yunnan', 'c2'))
  })

  it('键必须同时携带两个维度（漏任一维度即回归）', () => {
    const key = buildGridGeoCacheScope('yunnan', 'comp-cgn-yunnan')
    expect(key).toContain('yunnan')
    expect(key).toContain('comp-cgn-yunnan')
    // 无公司上下文时占位可辨识，不与真实公司键碰撞
    expect(buildGridGeoCacheScope('yunnan', null)).toBe('yunnan:no-company')
    expect(buildGridGeoCacheScope('yunnan', null)).not.toBe(buildGridGeoCacheScope('yunnan', 'c1'))
  })

  it('机制画像随地区变化（消费方切区必须重算，不得缓存跨地区结果）', () => {
    const yunnan = resolveMechanismProfile('yunnan', 'clearing_price')
    const shanxi = resolveMechanismProfile('shanxi', 'clearing_price')
    // 原先用 daRtSeparated 作为差异证据，#1531 后两地区都是 true（山西也接上真分价了）
    // 改用仍然逐地区不同的字段：原生粒度（云南 60min / 山西 15min）与电网归属。
    expect(yunnan.granularityNative.value).not.toBe(shanxi.granularityNative.value)
    expect(yunnan.gridOperator.value).not.toBe(shanxi.gridOperator.value)
  })
})

describe('⑦ 市场洞察规范入口（dljy#2995）：未登记地区留在洞察域，不借用他省数据', () => {
  beforeAll(async () => {
    const { installRegionPackages } = await import('@/features/regions')
    installRegionPackages()
  })

  it('六条规范路径四地区路由层均放行：守卫不踢，内容由工作区注册决定', () => {
    for (const path of Object.values(INSIGHT_PAGE_PATHS)) {
      expect(isPathAvailableInRegion(path, 'shanxi'), path).toBe(true)
      expect(isPathAvailableInRegion(path, 'yunnan'), path).toBe(true)
      expect(isPathAvailableInRegion(path, 'guangdong'), path).toBe(true)
      expect(isPathAvailableInRegion(path, 'sichuan'), path).toBe(true)
    }
  })

  it('未登记工作区的地区（广东/四川）解析为 not-registered：宿主显示未开通、不发任何请求', () => {
    for (const regionId of ['guangdong', 'sichuan']) {
      for (const pageId of ['overview', 'prices', 'supply', 'plants', 'research'] as const) {
        expect(resolveInsightPage(regionId, pageId), `${regionId}/${pageId}`).toEqual({ kind: 'not-registered' })
      }
    }
  })

  it('云南开关未开时同样 not-registered；打开后未交付页落本省占位，绝不解析成山西页面', () => {
    vi.unstubAllEnvs()
    expect(resolveInsightPage('yunnan', 'grid-boundaries')).toEqual({ kind: 'not-registered' })
    vi.stubEnv('VITE_YUNNAN_INSIGHT_WORKSPACE', '1')
    const pending = resolveInsightPage('yunnan', 'grid-boundaries')
    expect(pending).toMatchObject({ kind: 'fallback', reason: 'page-not-delivered' })
    // 占位仍指向云南本省登记的 descriptor，不会把山西的已交付页拿来渲染
    expect(pending.kind === 'fallback' && pending.page?.pageId).toBe('grid-boundaries')
    vi.unstubAllEnvs()
  })
})
