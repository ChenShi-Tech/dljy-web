// 申报前情报清单的地区能力声明回归。
//
// 这条边界坏掉的后果是最坏的一类：按钮照常可点 → 智能体拿不到检修数据 → 它可能
// "尽力回答"而编出看似合理的检修安排 → 用户据此调整报价。所以「无信源即置灰」
// 必须被测试锁死，而不是靠 UI 里一个容易被后人删掉的条件。
import { describe, expect, it } from 'vitest'

import {
  DISCLOSURE_SUPPORTED_REGIONS,
  resolveIntelCapability,
} from '@/data/declarationIntelCapability'

describe('检修/联络线披露的地区门', () => {
  it('山西已接入 PMOS 信源 → 放行', () => {
    expect(resolveIntelCapability('maintenance_disclosure', 'shanxi').status).toBe('supported')
  })

  it.each(['yunnan', 'guangdong', 'sichuan', 'gansu'])('%s 无信源 → 置灰并给出具体原因', (region) => {
    const cap = resolveIntelCapability('maintenance_disclosure', region)
    expect(cap.status).toBe('unsupported')
    // 原因必须具体到"缺什么"，不能只说"暂不支持"——否则用户不知道能不能人工补
    expect(cap.reason).toContain('检修/联络线披露信源')
  })

  it('地区大小写与空白不应绕过门禁', () => {
    for (const raw of ['YUNNAN', ' Yunnan ', 'YuNnAn']) {
      expect(resolveIntelCapability('maintenance_disclosure', raw).status).toBe('unsupported')
    }
    for (const raw of ['SHANXI', ' shanxi ']) {
      expect(resolveIntelCapability('maintenance_disclosure', raw).status).toBe('supported')
    }
  })

  it('空地区按不支持处理（fail-closed）', () => {
    expect(resolveIntelCapability('maintenance_disclosure', '').status).toBe('unsupported')
  })
})

describe('其余两项不做 UI 层预判', () => {
  // 竞价空间与持仓敞口的工具对缺数已有 available:false 的诚实返回，
  // 由工具层给该地区的真实空态，UI 预判反而会误挡住有数据的地区。
  it.each(['bidding_space', 'position_exposure'] as const)('%s 对所有地区放行', (key) => {
    for (const region of ['yunnan', 'shanxi', 'unknown-region', '']) {
      expect(resolveIntelCapability(key, region).status).toBe('supported')
    }
  })
})

describe('已接入地区清单', () => {
  it('与门禁判定一致（防清单与逻辑漂移）', () => {
    for (const region of DISCLOSURE_SUPPORTED_REGIONS) {
      expect(resolveIntelCapability('maintenance_disclosure', region).status).toBe('supported')
    }
  })
})
