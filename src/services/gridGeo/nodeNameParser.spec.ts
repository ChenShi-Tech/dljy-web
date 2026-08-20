// 节点名解析 L0 的确定性用例（Epic #1431 S4 · #1439）。
// 样本全部取自南网五省节点电价真实数据（6,599 个唯一 nodeName，2026-08-06 全量抽样），
// 不构造想象形态，解析器改错即直接影响节点管理补录的电压等级，故用可手算校验的用例锁死。
import { describe, expect, it } from 'vitest'
import { parseGridNodeName } from './nodeNameParser'

describe('parseGridNodeName · 站段自带电压前缀（A 型）', () => {
  it('站段与节点段电压一致时取节点段', () => {
    expect(parseGridNodeName('110kV上洪站.110kV#1母')).toEqual({
      voltageLevelKv: 110, stationName: '上洪站', stationVoltageKv: 110, basis: 'node-segment'
    })
  })

  it('节点段含线路描述时仍取其首个电压', () => {
    expect(parseGridNodeName('110kV三亚华盛站.110kV三亚华盛站110kV塘华笔线盛侧')).toEqual({
      voltageLevelKv: 110, stationName: '三亚华盛站', stationVoltageKv: 110, basis: 'node-segment'
    })
  })
})

describe('parseGridNodeName · 站段为纯站名（B 型）', () => {
  it('电压只出现在节点段', () => {
    expect(parseGridNodeName('卧龙变.500kV#2M')).toEqual({
      voltageLevelKv: 500, stationName: '卧龙变', stationVoltageKv: null, basis: 'node-segment'
    })
  })

  it('下划线写在 kV 之前（220_KV）', () => {
    expect(parseGridNodeName('双水B厂.220_KV#2')).toEqual({
      voltageLevelKv: 220, stationName: '双水B厂', stationVoltageKv: null, basis: 'node-segment'
    })
  })

  it('下划线写在 kV 之后（220kV_）', () => {
    expect(parseGridNodeName('启港站.220kV_#6')).toEqual({
      voltageLevelKv: 220, stationName: '启港站', stationVoltageKv: null, basis: 'node-segment'
    })
  })
})

describe('parseGridNodeName · 两段电压不一致（实测 145 例，非脏数据）', () => {
  // 220kV 变电站里的 110kV 母线节点：voltageLevelKv 描述节点，故取 110；
  // 站级 220 单独保留在 stationVoltageKv，两者都不丢。
  it('取节点段电压，站级电压另存', () => {
    expect(parseGridNodeName('220kV三都站.110kV#1母')).toEqual({
      voltageLevelKv: 110, stationName: '三都站', stationVoltageKv: 220, basis: 'node-segment'
    })
  })

  it('节点段带母线分段描述时同样以节点段为准', () => {
    expect(parseGridNodeName('220kV吉阳站.110kV#2母A段母线')).toEqual({
      voltageLevelKv: 110, stationName: '吉阳站', stationVoltageKv: 220, basis: 'node-segment'
    })
  })
})

describe('parseGridNodeName · 名称不含电压时诚实留空', () => {
  it('两段都无电压书写 → voltageLevelKv 为 null 且 basis=unresolved', () => {
    expect(parseGridNodeName('云峰村光伏电站.云峰村光伏电站云家线')).toEqual({
      voltageLevelKv: null, stationName: '云峰村光伏电站', stationVoltageKv: null, basis: 'unresolved'
    })
  })

  it('不用同站其它节点的电压回填（站名相同也不猜）', () => {
    // 与上一例同站，仍必须是 null，回填会把「未知」伪装成「已知」。
    expect(parseGridNodeName('云峰村光伏电站.云峰村光伏电站另一回线').voltageLevelKv).toBeNull()
  })
})

describe('parseGridNodeName · 回退与边界', () => {
  it('节点段无电压但站段有前缀 → 回退站级并标 basis=station-prefix', () => {
    expect(parseGridNodeName('220kV古海站.#1母')).toEqual({
      voltageLevelKv: 220, stationName: '古海站', stationVoltageKv: 220, basis: 'station-prefix'
    })
  })

  it('无点分隔时整串按站段处理', () => {
    expect(parseGridNodeName('元谋变')).toEqual({
      voltageLevelKv: null, stationName: '元谋变', stationVoltageKv: null, basis: 'unresolved'
    })
  })

  it('站段仅有电压前缀而无站名 → stationName 为 null', () => {
    expect(parseGridNodeName('220kV.110kV#1母').stationName).toBeNull()
  })

  it('空串与纯空白返回全空结果', () => {
    const empty = { voltageLevelKv: null, stationName: null, stationVoltageKv: null, basis: 'unresolved' }
    expect(parseGridNodeName('')).toEqual(empty)
    expect(parseGridNodeName('   ')).toEqual(empty)
  })

  it('越界电压视为不可信（与 grid-geo API [0,1000] 校验一致）', () => {
    expect(parseGridNodeName('某站.9999kV#1母').voltageLevelKv).toBeNull()
    expect(parseGridNodeName('某站.0kV#1母').voltageLevelKv).toBeNull()
  })

  it('站段电压只认行首前缀，站名内部的数字不误当电压', () => {
    // 「220」出现在站名中部而非前缀位，不应被当作站级电压。
    expect(parseGridNodeName('龙泉220站.110kV#1母').stationVoltageKv).toBeNull()
  })

  it('不推断连接关系：线路名里的对端站不进任何字段', () => {
    const parsed = parseGridNodeName('功果桥水电厂.功果桥水电厂功果桥大理I回')
    expect(parsed.stationName).toBe('功果桥水电厂')
    expect(parsed.voltageLevelKv).toBeNull()
  })
})
