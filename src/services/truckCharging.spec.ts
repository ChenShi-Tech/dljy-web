import { describe, expect, it } from 'vitest'
import {
  calculateTruckChargingInvestment,
  getDefaultTruckChargingForm,
  runTruckChargingSensitivityAnalysis,
  solveFreightRateByTargetIrr,
  type TruckChargingForm
} from './truckCharging'

// 重卡充换电测算（truckCharging.ts）逐年现金流重构回归锁：
// 贷款摊还/折旧期限/残值回收/收入门控/增值税接线/目标 IRR 反算是投资决策的算法基座，
// 用可手算校验的确定性用例锁死，防止回退成「单一年份平推」的粗估口径。

const makeForm = (overrides: Partial<TruckChargingForm> = {}): TruckChargingForm => ({
  ...getDefaultTruckChargingForm(),
  route_segments: getDefaultTruckChargingForm().route_segments,
  ...overrides
})

describe('逐年现金流表（A1/A5/G3）', () => {
  it('贷款期（5 年）结束后利息与本金归零，期内均为正', () => {
    const result = calculateTruckChargingInvestment(makeForm())
    const rows = result.cash_flow
    // 全项目期覆盖：0..project_life 共 11 行（A7）
    expect(rows).toHaveLength(11)
    for (let year = 1; year <= 5; year += 1) {
      expect(rows[year].interest).toBeGreaterThan(0)
      expect(rows[year].principal).toBeGreaterThan(0)
    }
    for (let year = 6; year <= 10; year += 1) {
      expect(rows[year].interest).toBe(0)
      expect(rows[year].principal).toBe(0)
    }
  })

  it('利息逐年递减，首年利息 = 贷款额 × 利率，本金合计 = 贷款额', () => {
    const form = makeForm()
    const result = calculateTruckChargingInvestment(form)
    const rows = result.cash_flow
    const loanAmount = result.total_investment * (form.loan_ratio / 100)
    // 首年利息 = 期初余额（全额贷款）× 利率
    expect(rows[1].interest).toBeCloseTo(loanAmount * form.loan_interest_rate / 100, 1)
    // 等额本息：利息随余额逐年递减
    for (let year = 2; year <= form.loan_term; year += 1) {
      expect(rows[year].interest).toBeLessThan(rows[year - 1].interest)
    }
    // 贷款期内偿还本金合计 = 贷款额（末年清偿浮点尾差）
    const principalTotal = rows.slice(1, form.loan_term + 1).reduce((sum, row) => sum + row.principal, 0)
    expect(principalTotal).toBeCloseTo(loanAmount, 0)
  })

  it('折旧仅在折旧年限内计提，期外为 0', () => {
    const result = calculateTruckChargingInvestment(makeForm({ depreciation_years: 5, project_life: 10 }))
    const rows = result.cash_flow
    for (let year = 1; year <= 5; year += 1) expect(rows[year].depreciation).toBeGreaterThan(0)
    for (let year = 6; year <= 10; year += 1) expect(rows[year].depreciation).toBe(0)
  })

  it('期末年残值进现金流：设备残值 + 土地原值回收（A4/A7）', () => {
    const form = makeForm()
    const result = calculateTruckChargingInvestment(form)
    const rows = result.cash_flow
    // 土地不折旧（A4）：折旧基数 = 总投资 − 土地；残值 = 折旧基数×残值率 + 土地原值
    const expectedSalvage = (result.total_investment - form.land_cost) * (form.salvage_rate / 100) + form.land_cost
    expect(rows[form.project_life].salvage).toBeCloseTo(expectedSalvage, 0)
    // 非期末年无残值
    for (let year = 0; year < form.project_life; year += 1) expect(rows[year].salvage).toBe(0)
    // 残值抬升期末年净现金流（对比无残值年份的融资结构相同年份不可比，这里只验残值列进入 net 的一致性）
    expect(rows[form.project_life].net_cash_flow).toBeCloseTo(
      rows[form.project_life].revenue - rows[form.project_life].cost - rows[form.project_life].tax + rows[form.project_life].salvage,
      1
    )
  })

  it('现金流表覆盖全项目期（project_life=15 时 16 行）', () => {
    const result = calculateTruckChargingInvestment(makeForm({ project_life: 15 }))
    expect(result.cash_flow).toHaveLength(16)
    expect(result.cash_flow[15].year).toBe(15)
  })
})

describe('收入/成本门控（A2/A3/E3）', () => {
  it('纯充电站：电费收入无条件计且与购电成本平进平出（不受 operation_mode 门控）', () => {
    const result = calculateTruckChargingInvestment(makeForm({ project_type: 'charging', operation_mode: 'owned' }))
    const electricityRevenue = result.revenue_breakdown.find((row) => row.item === '电费收入（平进平出）')
    const electricityCost = result.cost_breakdown.find((row) => row.item === '购电成本')
    expect(electricityRevenue).toBeDefined()
    expect(electricityCost).toBeDefined()
    expect(electricityRevenue!.amount).toBeCloseTo(electricityCost!.amount, 1)
    // 服务费收入照常全额计
    expect(result.revenue_breakdown.find((row) => row.item === '充电服务收入')).toBeDefined()
  })

  it('一体化+自有：自有车充电属内部交易，收入侧不计服务费/电费（合并口径）', () => {
    const result = calculateTruckChargingInvestment(makeForm({ project_type: 'integrated', operation_mode: 'owned' }))
    expect(result.revenue_breakdown.find((row) => row.item === '充电服务收入')).toBeUndefined()
    expect(result.revenue_breakdown.find((row) => row.item === '电费收入（平进平出）')).toBeUndefined()
    // 但购电成本（车队实际电耗）仍全额入账一次
    expect(result.cost_breakdown.find((row) => row.item === '购电成本')).toBeDefined()
  })

  it('混合模式：电费收入按非自有车比例计', () => {
    const form = makeForm({ operation_mode: 'mixed', owned_truck_ratio: 70 })
    const result = calculateTruckChargingInvestment(form)
    const externalRatio = (result.affiliated_truck_count + result.outsourced_truck_count) / result.actual_truck_count
    const electricityRevenue = result.revenue_breakdown.find((row) => row.item === '电费收入（平进平出）')
    const electricityCost = result.cost_breakdown.find((row) => row.item === '购电成本')
    expect(externalRatio).toBeGreaterThan(0)
    expect(externalRatio).toBeLessThan(1)
    expect(electricityRevenue!.amount).toBeCloseTo(electricityCost!.amount * externalRatio, 1)
  })
})

describe('目标 IRR 反算运价（E1 二分搜索）', () => {
  it('反算运价代回主模型后资本金 IRR ≈ target_irr（容差 1e-3）', () => {
    const form = makeForm({ profit_mode: 'by_rate', target_irr: 12 })
    const solved = solveFreightRateByTargetIrr(form)
    expect(solved.converged).toBe(true)
    expect(Number.isFinite(solved.freight_rate)).toBe(true)
    const verify = calculateTruckChargingInvestment({ ...form, profit_mode: 'by_price', freight_rate: solved.freight_rate })
    expect(Math.abs(verify.equity_irr - 12)).toBeLessThan(1e-3)
  })

  it('by_rate 模式主模型直接输出目标 IRR 与收敛标记', () => {
    const result = calculateTruckChargingInvestment(makeForm({ profit_mode: 'by_rate', target_irr: 12 }))
    expect(result.freight_rate_converged).toBe(true)
    expect(Math.abs(result.equity_irr - 12)).toBeLessThan(1e-3)
  })

  it('纯充电站下运价不驱动收入，返回 NaN + converged:false', () => {
    const solved = solveFreightRateByTargetIrr(makeForm({ project_type: 'charging' }))
    expect(solved.converged).toBe(false)
    expect(Number.isNaN(solved.freight_rate)).toBe(true)
  })
})

describe('新增刚性科目（G1/C1/D1）', () => {
  it('电池更换年净现金流恰好下降 自有车数 × 更换成本（G1）', () => {
    const base = calculateTruckChargingInvestment(makeForm({ battery_replacement_cost: 0 }))
    const withBattery = calculateTruckChargingInvestment(makeForm({ battery_replacement_year: 6, battery_replacement_cost: 25 }))
    const expectedDrop = withBattery.owned_truck_count * 25
    expect(base.cash_flow[6].net_cash_flow - withBattery.cash_flow[6].net_cash_flow).toBeCloseTo(expectedDrop, 1)
    // 其他年份不受影响
    expect(base.cash_flow[5].net_cash_flow).toBeCloseTo(withBattery.cash_flow[5].net_cash_flow, 1)
  })

  it('两部制基本电费按站功率计入年固定成本（C1）', () => {
    const base = calculateTruckChargingInvestment(makeForm({ demand_charge: 0 }))
    const withDemand = calculateTruckChargingInvestment(makeForm({ demand_charge: 30 }))
    const demandRow = withDemand.cost_breakdown.find((row) => row.item === '基本电费（两部制）')
    expect(base.cost_breakdown.find((row) => row.item === '基本电费（两部制）')).toBeUndefined()
    expect(demandRow).toBeDefined()
    expect(demandRow!.amount).toBeCloseTo(withDemand.derived.total_charging_power * 30 * 12 / 10000, 1)
  })

  it('增值税接线后年利润低于未接线（方向性，D1）', () => {
    const noVat = calculateTruckChargingInvestment(makeForm({ vat_rate: 0 }))
    const withVat = calculateTruckChargingInvestment(makeForm({ vat_rate: 13 }))
    expect(withVat.annual_profit).toBeLessThan(noVat.annual_profit)
    expect(withVat.equity_irr).toBeLessThan(noVat.equity_irr)
  })
})

describe('口径守卫（D2/D3）', () => {
  it('loan_ratio=100 时资本金为 0：IRR/NPV/回收期为 NaN 并给出显式提示', () => {
    const result = calculateTruckChargingInvestment(makeForm({ loan_ratio: 100 }))
    expect(Number.isNaN(result.equity_irr)).toBe(true)
    expect(Number.isNaN(result.npv)).toBe(true)
    expect(Number.isNaN(result.payback_period)).toBe(true)
    expect(result.warnings.some((w) => w.includes('资本金为 0'))).toBe(true)
  })

  it('折现率 0% 为合法输入：NPV 有限且等于未折现现金流合计', () => {
    const result = calculateTruckChargingInvestment(makeForm({ discount_rate: 0 }))
    expect(Number.isFinite(result.npv)).toBe(true)
    const undiscountedSum = result.cash_flow.reduce((sum, row) => sum + row.net_cash_flow, 0)
    expect(result.npv).toBeCloseTo(undiscountedSum, 0)
  })
})

describe('测算口径修复（codex 审查问题 1-4）', () => {
  it('问题1：一体化下只改 daily_mileage 时充电量/站功率/购电成本同步缩放，IRR 单调变化', () => {
    const base = calculateTruckChargingInvestment(makeForm())
    const longer = calculateTruckChargingInvestment(makeForm({ daily_mileage: 720 }))
    // 日充电量 = 综合电耗 × daily_mileage × 车数：里程 ×1.2 → 充电量/站功率 ×1.2
    expect(longer.derived.daily_total_charging).toBeCloseTo(base.derived.daily_total_charging * 1.2, 0)
    expect(longer.derived.total_charging_power).toBeCloseTo(base.derived.total_charging_power * 1.2, 0)
    const baseCost = base.cost_breakdown.find((row) => row.item === '购电成本')!
    const longerCost = longer.cost_breakdown.find((row) => row.item === '购电成本')!
    expect(longerCost.amount).toBeCloseTo(baseCost.amount * 1.2, 0)
    // 载货里程与充电需求同步扩大，公里边际利润为正 → IRR 单调上升
    expect(longer.equity_irr).toBeGreaterThan(base.equity_irr)
  })

  it('问题2：贷款 20 年/项目 10 年时，期末现金流含剩余本金一次性清偿，本金合计 = 贷款额', () => {
    const form = makeForm({ loan_term: 20, project_life: 10 })
    const result = calculateTruckChargingInvestment(form)
    const rows = result.cash_flow
    const loanAmount = result.total_investment * (form.loan_ratio / 100)
    // 债务不得凭空消失：项目期内偿还本金合计 = 贷款额（期末年清偿余额）
    const principalTotal = rows.slice(1).reduce((sum, row) => sum + row.principal, 0)
    expect(principalTotal).toBeCloseTo(loanAmount, 0)
    // 期末年清偿的余额远大于常规年金本金
    expect(rows[10].principal).toBeGreaterThan(rows[9].principal * 2)
    expect(result.warnings.some((w) => w.includes('期末现金流一次性清偿'))).toBe(true)
    // 期内偿清（loan_term ≤ project_life）不受影响、无该提示
    const normal = calculateTruckChargingInvestment(makeForm({ loan_term: 5, project_life: 10 }))
    expect(normal.warnings.some((w) => w.includes('期末现金流一次性清偿'))).toBe(false)
  })

  it('问题3：回程空载（return_load_factor=0）时自有车运费收入为满载往返假设的一半', () => {
    const emptyReturn = calculateTruckChargingInvestment(makeForm({ return_load_factor: 0 }))
    const fullReturn = calculateTruckChargingInvestment(makeForm({ return_load_factor: 100 }))
    const emptyRevenue = emptyReturn.revenue_breakdown.find((row) => row.item === '自有车辆运输收入')!
    const fullRevenue = fullReturn.revenue_breakdown.find((row) => row.item === '自有车辆运输收入')!
    // 载货里程 = daily_mileage/2 × (1 + 带货率)：0% 恰为 100%（等价旧的全里程满载口径）的一半
    expect(emptyRevenue.amount).toBeCloseTo(fullRevenue.amount / 2, 0)
    // 手算锚点：50 车 × (600/2)km × 30t × 0.45元/吨km × 330天 / 10000 = 6682.5 万元
    expect(emptyRevenue.amount).toBeCloseTo(6682.5, 0)
  })

  it('问题4：by_volume 模式年运量由 日运量×运营天数 派生，改日运量同步传导到运费收入', () => {
    const base = calculateTruckChargingInvestment(makeForm({ calc_mode: 'by_volume', operation_mode: 'outsourced' }))
    const higher = calculateTruckChargingInvestment(
      makeForm({ calc_mode: 'by_volume', operation_mode: 'outsourced', daily_transport_volume: 3600 })
    )
    const baseRow = base.revenue_breakdown.find((row) => row.item === '外委运输收入')!
    const higherRow = higher.revenue_breakdown.find((row) => row.item === '外委运输收入')!
    // 年运量 = 3000t/日 × 330 天（不再读独立的 annual_transport_volume=100 万吨）
    expect(baseRow.amount).toBeCloseTo(3000 * 0.45 * 300 * 330 / 10000, 0)
    // 日运量 ×1.2 → 运费收入 ×1.2（车队规模与运量收入同源联动）
    expect(higherRow.amount).toBeCloseTo(baseRow.amount * 1.2, 0)
    expect(higher.actual_truck_count).toBeGreaterThan(base.actual_truck_count)
  })
})

describe('敏感性分析按模式过滤（F4）', () => {
  it('一体化+全自有：服务费为纯内部交易不列示；运价/电价/车价/站造价保留', () => {
    const sensitivity = runTruckChargingSensitivityAnalysis(makeForm())
    const keys = Object.keys(sensitivity.sensitivity_results)
    expect(keys).not.toContain('充电服务费')
    expect(keys).toContain('运输运价')
    expect(keys).toContain('购电价格')
    expect(keys).toContain('充电站造价')
  })

  it('纯充电站：运价与车辆单价不列示', () => {
    const sensitivity = runTruckChargingSensitivityAnalysis(makeForm({ project_type: 'charging' }))
    const keys = Object.keys(sensitivity.sensitivity_results)
    expect(keys).not.toContain('运输运价')
    expect(keys).not.toContain('车辆单价')
    expect(keys).toContain('充电服务费')
  })

  it('纯重卡：充电站造价不列示，电价/服务费经电耗单源生效（C2）', () => {
    const sensitivity = runTruckChargingSensitivityAnalysis(makeForm({ project_type: 'truck' }))
    const keys = Object.keys(sensitivity.sensitivity_results)
    expect(keys).not.toContain('充电站造价')
    expect(keys).toContain('购电价格')
    expect(keys).toContain('充电服务费')
  })
})

