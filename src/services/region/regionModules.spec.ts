import { describe, expect, it } from 'vitest'
import { firstAccessiblePath, isPathAvailableInRegion } from '@/services/governance'
import {
  getRegionCapabilityForPath,
  getRegionSubCapability,
  isRegionRouteAvailable,
  regionCapabilityAllowsRequest,
  resolveRegionModuleForPath
} from './regionModules'

// 注册表内任一能力覆盖路由（insight 组经典页）。注意 statusByRegion 除 shanxi/yunnan 外，
// 广东/四川已经 #770 声明式试点登记为 degraded，它们不是「未登记」。
const COVERED_PATH = '/sjfx/zrsjg'
// 注册表覆盖面之外的合成路径（能力注册表不管它，保持兼容放行）。
const UNCOVERED_PATH = '/no-such-page-for-spec'
// 未在任何能力声明里登记状态的地区（国网省份、非试点）。
const UNREGISTERED_REGION = 'hebei'

describe('未登记地区能力 fail-closed（ADR 裁决四）', () => {
  it('覆盖面内 + 未登记地区 → not-configured，而非 null 放行', () => {
    const capability = getRegionCapabilityForPath(COVERED_PATH, UNREGISTERED_REGION)
    expect(capability).not.toBeNull()
    expect(capability?.status).toBe('not-configured')
  })

  it('not-configured 路由不放行', () => {
    expect(isRegionRouteAvailable(COVERED_PATH, UNREGISTERED_REGION)).toBe(false)
  })

  it('not-configured 不发契约请求', () => {
    expect(regionCapabilityAllowsRequest(COVERED_PATH, UNREGISTERED_REGION)).toBe(false)
  })

  it('已登记地区行为不变（shanxi/yunnan 按注册表状态判定）', () => {
    for (const region of ['shanxi', 'yunnan']) {
      const capability = getRegionCapabilityForPath(COVERED_PATH, region)
      expect(capability?.status).not.toBe('not-configured')
      expect(isRegionRouteAvailable(COVERED_PATH, region)).toBe(capability?.status !== 'hidden')
    }
  })

  it('覆盖面之外的路由保持兼容放行（null 语义不变）', () => {
    expect(getRegionCapabilityForPath(UNCOVERED_PATH, UNREGISTERED_REGION)).toBeNull()
    expect(isRegionRouteAvailable(UNCOVERED_PATH, UNREGISTERED_REGION)).toBe(true)
    expect(regionCapabilityAllowsRequest(UNCOVERED_PATH, UNREGISTERED_REGION)).toBe(true)
  })

  it('hidden 子能力继续 hidden（收紧不放松）', () => {
    // zrxgx.xnyzd 是山西 sdpt_zcqxhdl 专有维度，云南登记 hidden，既有语义回归锚点。
    expect(getRegionSubCapability('insight', 'zrxgx.xnyzd', 'yunnan')?.status).toBe('hidden')
  })

  it('子能力对未登记地区同样 fail-closed', () => {
    expect(getRegionSubCapability('insight', 'zrxgx.xnyzd', UNREGISTERED_REGION)?.status).toBe('not-configured')
  })
})

// 公司私有族在无源地区应整体隐藏（而非降级卡），规则与逐族清单见
// docs/data/family-visibility-inventory.md。
// ⚠️ 这里必须用单测而非 UI 实机验证：guangdong/sichuan 不在 REAL_DATA_REGION_IDS（{yunnan,shanxi}）内，
// 切换面板禁用、localStorage 写入也会被 regionContext 拒绝回落默认地区，UI 上根本切不过去；
// 靠点页面「验证」这两省只会得到云南的结果（假绿）。
describe('公司私有族在无源地区 hidden', () => {
  // sdpt_zrqsb：三德普华私有族，仅山西宿主可读。
  const ZRQSB = '/xhjy/zrqsb'
  // sdpt_zptqx：同属三德普华的私有族（曾误标 public，匿名可读全量 888 行，已更正）。
  const ZPTQX = '/xhjy/zptqx'
  // sdpt_zfsdjy：同上（#1617 合并后复查发现），中长期合同台账 + 逐日持仓电量/持仓均价。
  const ZFSDJY_PATHS = ['/zcqjy/zfsdjy', '/zcqjy/zccljk']
  // 依赖三德普华私有族的两个预测子能力。
  const PRIVATE_FORECAST_TABS = ['forecast.tab.gscwfh', 'forecast.tab.renewable-ab']
  const NO_SOURCE_REGIONS = ['yunnan', 'guangdong', 'sichuan']

  it('三德普华私有族页面仅山西可用，其余已登记地区 hidden 且不放行、不发请求', () => {
    // ZPTQX 曾误标 public、非宿主地区留 degraded；定级更正后与 ZRQSB 同口径收紧为 hidden。
    for (const path of [ZRQSB, ZPTQX, ...ZFSDJY_PATHS]) {
      expect(getRegionCapabilityForPath(path, 'shanxi')?.status).toBe('available')
      expect(isRegionRouteAvailable(path, 'shanxi')).toBe(true)

      for (const region of NO_SOURCE_REGIONS) {
        expect(getRegionCapabilityForPath(path, region)?.status).toBe('hidden')
        expect(isRegionRouteAvailable(path, region)).toBe(false)
        expect(regionCapabilityAllowsRequest(path, region)).toBe(false)
      }
    }
  })

  it('私有族预测 tab 在所有无源地区 hidden（漏声明会回落 not-configured 而被当降级卡渲染）', () => {
    for (const id of PRIVATE_FORECAST_TABS) {
      expect(getRegionSubCapability('forecast', id, 'shanxi')?.status).toBe('available')
      for (const region of NO_SOURCE_REGIONS) {
        expect(getRegionSubCapability('forecast', id, region)?.status).toBe('hidden')
      }
    }
  })

  it('地区专属 tab「云南披露对照」只在云南可见', () => {
    expect(getRegionSubCapability('forecast', 'forecast.tab.yn-disclosure', 'yunnan')?.status).toBe('available')
    for (const region of ['shanxi', 'guangdong', 'sichuan']) {
      expect(getRegionSubCapability('forecast', 'forecast.tab.yn-disclosure', region)?.status).toBe('hidden')
    }
  })

  // 二阶影响：TRADER 的默认落地页恰是 /xhjy/zptqx。把它在非宿主地区收紧为 hidden 后，
  // 该角色在那些地区必须有兜底，否则一登录就停在一个不可达页面（或反复重定向）。
  // firstAccessiblePath 的 defaultRoute→/dashboard 回落负责这件事，锁住它，
  // 免得日后有人把 /dashboard 也收紧却没发现这条依赖。
  it('以私有族页面为默认落地页的角色，在无源地区回落到可用页', () => {
    expect(firstAccessiblePath({ roleCode: 'TRADER' }, 'shanxi')).toBe('/xhjy/zptqx')
    for (const region of NO_SOURCE_REGIONS) {
      expect(isPathAvailableInRegion('/xhjy/zptqx', region)).toBe(false)
      const landing = firstAccessiblePath({ roleCode: 'TRADER' }, region)
      expect(landing).toBe('/dashboard')
      expect(isPathAvailableInRegion(landing, region)).toBe(true)
    }
  })

  it('public 族载体保持 degraded（缺的是本省采集、不是授权，入口应保留）', () => {
    // 反例锚点：私有族收紧不得误伤公共族。以下 tab 均依赖 public 族 sdpt_zptjg
    // （云南有该族采集，缺的只是特定 tag 切片），它们必须继续 degraded、入口保留。
    for (const id of ['forecast.tab.jgyc', 'forecast.tab.gsfhyc', 'forecast.tab.jjkj', 'forecast.tab.rqhdcl']) {
      expect(getRegionSubCapability('forecast', id, 'yunnan')?.status).toBe('degraded')
    }
  })
})

describe('中长期售电合同入口仅云南开通（dljy#2939）', () => {
  it('列表、详情子路径与月度持仓在云南可用，其余已登记地区 hidden；前缀相似路径不被详情规则覆盖', () => {
    for (const path of ['/zcqjy/contracts', '/zcqjy/contracts/123', '/zcqjy/positions']) {
      expect(isRegionRouteAvailable(path, 'yunnan')).toBe(true)
      for (const region of ['shanxi', 'guangdong', 'sichuan']) {
        expect(getRegionCapabilityForPath(path, region)?.status).toBe('hidden')
        expect(isRegionRouteAvailable(path, region)).toBe(false)
      }
    }
    expect(getRegionCapabilityForPath('/zcqjy/contracts-export', 'shanxi')?.route).toBeNull()
  })

  it('P2 分时持仓、场站维度持仓与分解集详情同样只在云南可用（dljy#2971）', () => {
    for (const path of ['/zcqjy/positions/intervals', '/zcqjy/positions/stations', '/zcqjy/curves/7']) {
      expect(isRegionRouteAvailable(path, 'yunnan')).toBe(true)
      for (const region of ['shanxi', 'guangdong', 'sichuan']) {
        expect(getRegionCapabilityForPath(path, region)?.status).toBe('hidden')
        expect(isRegionRouteAvailable(path, region)).toBe(false)
      }
    }
    expect(getRegionCapabilityForPath('/zcqjy/curves-export', 'shanxi')?.route).toBeNull()
  })

  it('敞口看板归现货模块、交易月历在云南隐藏（dljy#2988）', () => {
    // 路径仍在 /zcqjy 下，但按精确 routePaths 解析到现货模块，不被中长期的 /zcqjy 前缀吃掉。
    const exposure = getRegionCapabilityForPath('/zcqjy/exposure', 'yunnan')
    expect(exposure?.module.id).toBe('spot-trading')
    expect(exposure?.status).toBe('degraded')
    expect(getRegionCapabilityForPath('/zcqjy/exposure', 'shanxi')?.status).toBe('available')
    // 同前缀的中长期页面仍解析到中长期模块。
    expect(getRegionCapabilityForPath('/zcqjy/positions', 'yunnan')?.module.id).toBe('midlong-trading')
    expect(getRegionCapabilityForPath('/zcqjy/contracts', 'yunnan')?.module.id).toBe('midlong-trading')
    // 云南属南网，不取国网月历：隐藏而不是显示空页面。
    for (const southernGrid of ['yunnan', 'guangdong']) {
      expect(getRegionCapabilityForPath('/zcqjy/zjyap', southernGrid)?.status, southernGrid).toBe('hidden')
      expect(isRegionRouteAvailable('/zcqjy/zjyap', southernGrid), southernGrid).toBe(false)
    }
    expect(getRegionCapabilityForPath('/zcqjy/zjyap', 'shanxi')?.status).toBe('available')
    // 四川同属国网，保留经国网基线回退读山西月历的既有口径，不随南网一起隐藏。
    expect(getRegionCapabilityForPath('/zcqjy/zjyap', 'sichuan')?.status).not.toBe('hidden')
  })

  it('精确路径优先于前缀，不受模块声明顺序影响（dljy#2988）', () => {
    // 故意把「持有 /zcqjy 前缀」的模块排在前面，把「精确登记 /zcqjy/exposure」的模块排在后面：
    // 只有先做全局精确匹配才会命中后者。按声明顺序逐个判断会错判成前缀那个模块。
    const prefixOwner = { id: 'prefix-owner', routePaths: ['/zcqjy/contracts'], routePrefixes: ['/zcqjy'] }
    const exactOwner = { id: 'exact-owner', routePaths: ['/zcqjy/exposure'], routePrefixes: ['/xhjy'] }
    expect(resolveRegionModuleForPath([prefixOwner, exactOwner], '/zcqjy/exposure')?.id).toBe('exact-owner')
    expect(resolveRegionModuleForPath([prefixOwner, exactOwner], '/zcqjy/contracts')?.id).toBe('prefix-owner')
    // 没有精确登记时仍按前缀回退。
    expect(resolveRegionModuleForPath([prefixOwner, exactOwner], '/zcqjy/zfsdjy')?.id).toBe('prefix-owner')
    expect(resolveRegionModuleForPath([prefixOwner, exactOwner], '/no-such')).toBeNull()
  })

  it('P3 售电计划与交易执行同样只在云南可用（dljy#2973）', () => {
    for (const path of ['/zcqjy/plans', '/zcqjy/execution']) {
      expect(isRegionRouteAvailable(path, 'yunnan')).toBe(true)
      for (const region of ['shanxi', 'guangdong', 'sichuan']) {
        expect(getRegionCapabilityForPath(path, region)?.status).toBe('hidden')
        expect(isRegionRouteAvailable(path, region)).toBe(false)
      }
    }
  })
})
