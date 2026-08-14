import { describe, expect, it } from 'vitest'
import {
  calculateToEndUser,
  calculateToSource,
  cascadeForward,
  cascadeReverse,
  getDefaultInterprovincialForm,
  type InterprovincialPriceForm
} from './interprovincialPrice'

function form(overrides: Partial<InterprovincialPriceForm> = {}): InterprovincialPriceForm {
  return { ...getDefaultInterprovincialForm(), ...overrides }
}

/** 线性同余伪随机数：测试可复现 */
function makeRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

describe('正推/逆推往返一致性', () => {
  it('多组随机参数下 |forward(reverse(x)) − x| < 1e-9 且 |reverse(forward(g)) − g| < 1e-9', () => {
    const random = makeRandom(20260717)
    for (let index = 0; index < 50; index += 1) {
      const candidate = form({
        source_province_td_price: random() * 0.1,
        region_energy_price: random() * 0.05,
        special_project_price: random() * 0.08,
        special_project_price2: random() * 0.05,
        target_region_energy_price: random() * 0.05,
        target_province_td_price: random() * 0.2,
        source_loss_rate: random() * 15,
        project_loss_rate: random() * 15,
        project_loss_rate2: random() * 15,
        target_loss_rate: random() * 15,
        system_fee: random() * 0.05,
        government_fee: random() * 0.05
      })
      const landing = 0.3 + random() * 1.7
      expect(Math.abs(cascadeForward(candidate, cascadeReverse(candidate, landing)) - landing)).toBeLessThan(1e-9)
      const grid = 0.1 + random() * 0.9
      expect(Math.abs(cascadeReverse(candidate, cascadeForward(candidate, grid)) - grid)).toBeLessThan(1e-9)
    }
  })

  it('公开 API 往返：反推上网价再正推可复原落地价（4 位精度内）', () => {
    const base = form()
    const reversed = calculateToSource(base)
    expect(reversed.error).toBeUndefined()
    const forward = calculateToEndUser({ ...base, grid_price: reversed.grid_price })
    expect(forward.landing_price).toBeCloseTo(base.landing_price, 3)
  })
})

describe('线损级联手算对拍', () => {
  it('单段线损：P = (上网价 + 输电价) / (1 − η)，线损作用于全部上游累计电价', () => {
    const candidate = form({
      grid_price: 1,
      source_province_td_price: 0.1,
      source_loss_rate: 10,
      region_energy_price: 0,
      special_project_price: 0,
      project_loss_rate: 0,
      special_project_price2: 0,
      project_loss_rate2: 0,
      target_region_energy_price: 0,
      target_province_td_price: 0,
      target_loss_rate: 0,
      system_fee: 0.02,
      government_fee: 0.019
    })
    // 手算：(1 + 0.1) / 0.9 = 1.222222…，加系统运行费与基金 = 1.261222…
    expect(cascadeForward(candidate, 1)).toBeCloseTo(1.1 / 0.9 + 0.039, 9)
    const result = calculateToEndUser(candidate)
    expect(result.landing_price).toBeCloseTo(1.2612, 4)
    // 线损行 = 折算前后差值 = 1.1 × 0.1/0.9
    const lossRow = result.breakdown.find((row) => row.item === '送端省线损')
    expect(lossRow).toBeDefined()
    expect(lossRow!.unit_price).toBeCloseTo(1.1 * 0.1 / 0.9, 4)
    // 综合线损率与价格级联同源
    expect(result.total_loss_rate).toBeCloseTo(10, 6)
  })

  it('两段线损级联：后段线损作用于含前段线损的累计电价', () => {
    const candidate = form({
      grid_price: 0.5,
      source_province_td_price: 0.04,
      source_loss_rate: 4,
      region_energy_price: 0,
      special_project_price: 0.05,
      project_loss_rate: 5,
      special_project_price2: 0,
      project_loss_rate2: 0,
      target_region_energy_price: 0,
      target_province_td_price: 0.1,
      target_loss_rate: 6,
      system_fee: 0,
      government_fee: 0
    })
    const step1 = (0.5 + 0.04) / 0.96
    const step2 = (step1 + 0.05) / 0.95
    const expected = (step2 + 0.1) / 0.94
    expect(cascadeForward(candidate, 0.5)).toBeCloseTo(expected, 9)
    expect(calculateToEndUser(candidate).total_loss_rate).toBeCloseTo((1 - 0.96 * 0.95 * 0.94) * 100, 2)
  })
})

describe('严格逆反推（不覆盖用户输入）', () => {
  it('反推结果的 landing_price 等于用户输入', () => {
    const candidate = form({ landing_price: 0.56 })
    const result = calculateToSource(candidate)
    expect(result.error).toBeUndefined()
    expect(result.landing_price).toBe(0.56)
    expect(result.grid_price).toBeGreaterThan(0)
  })

  it('落地价过低导致上网价 ≤ 0 时返回显式 error 而非静默钳位', () => {
    const result = calculateToSource(form({ landing_price: 0.05 }))
    expect(result.error).toBeTruthy()
    expect(result.grid_price).toBe(0)
  })
})

describe('入口校验与合理性告警', () => {
  it('线损率越界（η ≥ 100 或 η < 0）返回显式错误', () => {
    expect(calculateToEndUser(form({ source_loss_rate: 100 })).error).toContain('送端线损率')
    expect(calculateToEndUser(form({ target_loss_rate: -1 })).error).toContain('受端线损率')
  })

  it('价格为负返回显式错误', () => {
    expect(calculateToEndUser(form({ grid_price: -0.1 })).error).toContain('送端上网电价')
    expect(calculateToSource(form({ target_province_td_price: -0.01 })).error).toContain('受端省输配电价')
  })

  it('年利用小时 = 年电量(万kWh)/容量(万kW)，超 8760 给出告警', () => {
    // 300000 万kWh / 100 万kW = 3000 h
    const normal = calculateToEndUser(form({ annual_energy: 300000, transmission_capacity: 100 }))
    expect(normal.annual_hours).toBe(3000)
    expect(normal.warning).toBeUndefined()
    const overloaded = calculateToEndUser(form({ annual_energy: 300000, transmission_capacity: 30 }))
    expect(overloaded.annual_hours).toBe(10000)
    expect(overloaded.warning).toContain('8760')
  })
})

describe('年度费用电量口径', () => {
  it('受端电量 = 送端 × ∏(1−η)，收入/费用分别按送端/受端电量计量', () => {
    const candidate = form()
    const result = calculateToEndUser(candidate)
    const retention = (1 - candidate.source_loss_rate / 100)
      * (1 - candidate.project_loss_rate / 100)
      * (1 - candidate.project_loss_rate2 / 100)
      * (1 - candidate.target_loss_rate / 100)
    expect(result.receiving_energy).toBeCloseTo(candidate.annual_energy * retention, 1)
    expect(result.annual_grid_revenue).toBeCloseTo(candidate.grid_price * candidate.annual_energy, 1)
    // landing_price 展示值取整到 4 位小数，用相对误差比较
    expect(result.annual_landing_fee / (result.landing_price * result.receiving_energy)).toBeCloseTo(1, 4)
  })

  it('annual_detail 占比含线损行且合计闭合到 100%', () => {
    const result = calculateToEndUser(form())
    expect(result.annual_detail.some((row) => row.item.includes('线损'))).toBe(true)
    const ratioSum = result.annual_detail.reduce((sum, row) => sum + row.ratio, 0)
    expect(ratioSum).toBeCloseTo(1, 2)
    const amountSum = result.annual_detail.reduce((sum, row) => sum + row.amount, 0)
    expect(amountSum).toBeCloseTo(result.annual_landing_fee, 0)
  })
})

