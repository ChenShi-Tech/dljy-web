/**
 * 跨省跨区送电价格测算（模型级重写）。
 *
 * 计价模型——线损级联正推：逐段 P_out = (P_in + tariff_i) / (1 − η_i)，
 * η_i 为该段线损率，线损作用于全部上游累计电价（含上网电价），
 * 每段「线损」行 = 折算前后差值（发改价格〔2023〕526号：线损费用 = 电能量价格 × η/(1−η) 的多段推广）。
 * 系统运行费与政府性基金在落地环节加价，不再经线损折算。
 *
 * 严格逆反推：逆序逐段 P_in = P_out × (1 − η_i) − tariff_i，与正推共享同一段定义
 * （同一个段数组，两个遍历方向）；反推结果的 landing_price 恒等于用户输入。
 *
 * 结算电量口径：
 * - 送端电量 = annual_energy（万kWh，送端计量）；受端电量 = 送端 × ∏(1−η_i)；
 * - 上网侧收入（annual_grid_revenue）按送端电量计量；落地侧费用（annual_landing_fee）按受端电量计量；
 * - annual_detail 按受端（落地）结算电量分解落地电费：每行金额 = 该行价格增量 × 受端电量，
 *   线损费用为显性行；各段线损行合计正好补偿「上游各段按该段入口计量电量收费」与
 *   「受端计量」之间的差额，因此占比（含线损行）合计闭合到 100%。
 *
 * 入口校验：0 ≤ η < 100、价格 ≥ 0，违规返回显式 error 字段；
 * 反推得到上网电价 ≤ 0 时同样返回 error（不做静默钳位）。
 */
export type InterprovincialMode = 'toEndUser' | 'toSource'

export type InterprovincialPriceForm = {
  source_province: string
  target_province: string
  power_type: string
  /** 送端上网电价（元/kWh，正推入口） */
  grid_price: number
  /** 目标落地电价（元/kWh，逆推入口） */
  landing_price: number
  source_province_td_price: number
  region_energy_price: number
  special_project_price: number
  project_loss_rate: number
  special_project_price2: number
  project_loss_rate2: number
  target_region_energy_price: number
  target_province_td_price: number
  source_loss_rate: number
  target_loss_rate: number
  system_fee: number
  government_fee: number
  /**
   * 输电容量（万kW）。量纲钉死：年利用小时 = annual_energy(万kWh) / transmission_capacity(万kW)，
   * 结果单位为小时，并做 <= 8760 合理性校验（超出返回 warning）。
   */
  transmission_capacity: number
  /** 年送电量（万kWh，按送端计量） */
  annual_energy: number
}

export type InterprovincialBreakdownItem = {
  step: string
  item: string
  description: string
  unit_price: number
  accumulated: number
}

export type InterprovincialAnnualItem = {
  item: string
  /** 金额（万元）＝ 该行价格增量(元/kWh) × 受端结算电量(万kWh) */
  amount: number
  /** 占比（含线损行，合计闭合到 100%） */
  ratio: number
  /** 该行结算电量（万kWh，受端口径） */
  energy: number
}

export type InterprovincialPriceResult = {
  mode: InterprovincialMode
  grid_price: number
  landing_price: number
  annual_fee: number
  /** 上网侧年收入（万元）= 上网电价 × 送端电量 */
  annual_grid_revenue: number
  /** 落地侧年费用（万元）= 落地电价 × 受端电量 */
  annual_landing_fee: number
  /** 受端电量（万kWh）= 送端电量 × ∏(1−η_i) */
  receiving_energy: number
  /** 综合线损率（%）= (1 − ∏(1−η_i)) × 100，与价格级联同一段定义同源 */
  total_loss_rate: number
  annual_hours: number
  breakdown: InterprovincialBreakdownItem[]
  annual_detail: InterprovincialAnnualItem[]
  /** 合理性告警（如年利用小时 > 8760），不阻断计算 */
  warning?: string
  /** 入口校验失败或反推无解时的显式错误；存在时其余数值字段不可用 */
  error?: string
}

export function getDefaultInterprovincialForm(): InterprovincialPriceForm {
  return {
    source_province: '新疆',
    target_province: '江苏',
    power_type: '水电',
    grid_price: 0.25,
    landing_price: 0.56,
    source_province_td_price: 0.0349,
    region_energy_price: 0.0075,
    special_project_price: 0.0488,
    project_loss_rate: 4.26,
    special_project_price2: 0,
    project_loss_rate2: 0,
    target_region_energy_price: 0,
    target_province_td_price: 0.12,
    source_loss_rate: 3.49,
    target_loss_rate: 5,
    system_fee: 0.02,
    government_fee: 0.019,
    // 100 万kW（=1000 MW）；旧字段口径为 MW，量纲修正后统一为万kW
    transmission_capacity: 100,
    annual_energy: 300000
  }
}

function round(value: number, digits = 4) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 级联段定义：正推与逆推共享同一份数组，仅遍历方向不同 */
type CascadeSegment = {
  step: string
  item: string
  lossItem: string
  description: string
  tariff: number
  /** 该段线损率 η_i（%），0 表示该段不计线损 */
  lossRate: number
  used: boolean
}

function buildSegments(form: InterprovincialPriceForm): CascadeSegment[] {
  return [
    {
      step: '2',
      item: '送端省输配电价',
      lossItem: '送端省线损',
      description: `${form.source_province}外送输电价格`,
      tariff: form.source_province_td_price,
      lossRate: form.source_loss_rate,
      used: true
    },
    {
      step: '3',
      item: '区域电网电量电价',
      lossItem: '区域电网线损',
      description: '区域电网输电价格',
      tariff: form.region_energy_price,
      lossRate: 0,
      used: true
    },
    {
      step: '4',
      item: '专项工程1输电价',
      lossItem: '专项工程1线损',
      description: '专项工程输电价格',
      tariff: form.special_project_price,
      lossRate: form.project_loss_rate,
      used: true
    },
    {
      step: '5',
      item: '专项工程2输电价',
      lossItem: '专项工程2线损',
      description: form.special_project_price2 > 0 || form.project_loss_rate2 > 0 ? '第二专项工程输电价格' : '未使用',
      tariff: form.special_project_price2,
      lossRate: form.project_loss_rate2,
      used: form.special_project_price2 > 0 || form.project_loss_rate2 > 0
    },
    {
      step: '6',
      item: '受端区域电网电量电价',
      lossItem: '受端区域电网线损',
      description: '受端区域电网电量电价',
      tariff: form.target_region_energy_price,
      lossRate: 0,
      used: true
    },
    {
      step: '7',
      item: '受端省输配电价',
      lossItem: '受端省线损',
      description: `${form.target_province}省级输配电价`,
      tariff: form.target_province_td_price,
      lossRate: form.target_loss_rate,
      used: true
    }
  ]
}

/** 综合线损保有系数 ∏(1−η_i)，与价格级联同一段定义同源 */
function lossRetentionFactor(form: InterprovincialPriceForm) {
  return buildSegments(form).reduce((product, segment) => product * (1 - segment.lossRate / 100), 1)
}

/**
 * 线损级联正推（未取整，供测试与内部复用）：
 * 逐段 P = (P + tariff_i) / (1 − η_i)，最后加系统运行费与政府性基金得到落地电价。
 */
export function cascadeForward(form: InterprovincialPriceForm, gridPrice: number) {
  let price = gridPrice
  for (const segment of buildSegments(form)) {
    price = (price + segment.tariff) / (1 - segment.lossRate / 100)
  }
  return price + form.system_fee + form.government_fee
}

/**
 * 严格逆反推（未取整，供测试与内部复用）：
 * 先扣系统运行费与政府性基金，再逆序逐段 P = P × (1 − η_i) − tariff_i。
 * 与 cascadeForward 共享同一段定义，二者互为精确逆运算。
 */
export function cascadeReverse(form: InterprovincialPriceForm, landingPrice: number) {
  let price = landingPrice - form.system_fee - form.government_fee
  for (const segment of [...buildSegments(form)].reverse()) {
    price = price * (1 - segment.lossRate / 100) - segment.tariff
  }
  return price
}

/** 入口校验：0 ≤ η < 100、价格 ≥ 0；违规返回错误描述（显式错误，不静默钳位） */
function validateForm(form: InterprovincialPriceForm, mode: InterprovincialMode): string | undefined {
  const lossEntries: Array<[string, number]> = [
    ['送端线损率', form.source_loss_rate],
    ['专项工程1线损率', form.project_loss_rate],
    ['专项工程2线损率', form.project_loss_rate2],
    ['受端线损率', form.target_loss_rate]
  ]
  for (const [label, value] of lossEntries) {
    if (!Number.isFinite(value) || value < 0 || value >= 100) {
      return `${label}越界：应满足 0 ≤ η < 100，当前为 ${value}`
    }
  }
  const priceEntries: Array<[string, number]> = [
    ['送端省输配电价', form.source_province_td_price],
    ['区域电网电量电价', form.region_energy_price],
    ['专项工程1输电价', form.special_project_price],
    ['专项工程2输电价', form.special_project_price2],
    ['受端区域电网电量电价', form.target_region_energy_price],
    ['受端省输配电价', form.target_province_td_price],
    ['系统运行费', form.system_fee],
    ['政府性基金', form.government_fee],
    mode === 'toEndUser' ? ['送端上网电价', form.grid_price] : ['目标落地电价', form.landing_price]
  ]
  for (const [label, value] of priceEntries) {
    if (!Number.isFinite(value) || value < 0) {
      return `${label}非法：价格必须为 ≥ 0 的有效数值，当前为 ${value}`
    }
  }
  return undefined
}

type ForwardPass = {
  landingPrice: number
  breakdown: InterprovincialBreakdownItem[]
  /** 落地电价的价格增量分解（各行之和 = 落地电价），isLoss 标记线损行 */
  priceComponents: Array<{ item: string; price: number; isLoss: boolean }>
}

/** 正推并生成价格路径（breakdown）与落地电价分项（priceComponents），与 cascadeForward 同一段定义 */
function runForward(form: InterprovincialPriceForm, gridPrice: number): ForwardPass {
  const breakdown: InterprovincialBreakdownItem[] = []
  const priceComponents: ForwardPass['priceComponents'] = []
  let price = gridPrice

  breakdown.push({
    step: '1',
    item: '送端上网电价',
    description: `${form.power_type}在${form.source_province}的上网电价`,
    unit_price: gridPrice,
    accumulated: price
  })
  priceComponents.push({ item: '送端上网电价', price: gridPrice, isLoss: false })

  for (const segment of buildSegments(form)) {
    const afterTariff = price + segment.tariff
    // 级联正推：线损作用于全部上游累计电价（含上网电价）
    const afterLoss = afterTariff / (1 - segment.lossRate / 100)
    const lossDelta = afterLoss - afterTariff
    breakdown.push({ step: segment.step, item: segment.item, description: segment.description, unit_price: segment.tariff, accumulated: afterTariff })
    if (segment.lossRate > 0) {
      // 线损行 = 折算前后差值
      breakdown.push({
        step: '',
        item: segment.lossItem,
        description: `线损率${segment.lossRate}%，作用于全部上游累计电价`,
        unit_price: lossDelta,
        accumulated: afterLoss
      })
    }
    priceComponents.push({ item: segment.item, price: segment.tariff, isLoss: false })
    if (lossDelta > 0) priceComponents.push({ item: `${segment.lossItem}费用`, price: lossDelta, isLoss: true })
    price = afterLoss
  }

  // 系统运行费与政府性基金在落地环节加价，不经线损折算
  breakdown.push({ step: '8', item: '系统运行费用', description: '辅助服务费等', unit_price: form.system_fee, accumulated: price + form.system_fee })
  breakdown.push({ step: '9', item: '政府性基金及附加', description: '可再生能源电价附加等', unit_price: form.government_fee, accumulated: price + form.system_fee + form.government_fee })
  priceComponents.push({ item: '系统运行费用', price: form.system_fee, isLoss: false })
  priceComponents.push({ item: '政府性基金及附加', price: form.government_fee, isLoss: false })

  return { landingPrice: price + form.system_fee + form.government_fee, breakdown, priceComponents }
}

function annualHours(form: InterprovincialPriceForm) {
  if (form.transmission_capacity <= 0) return 0
  // 年利用小时 = 年电量(万kWh) / 输电容量(万kW)，万 与 万 相消，量纲为小时
  return Math.round(form.annual_energy / form.transmission_capacity)
}

function errorResult(mode: InterprovincialMode, message: string): InterprovincialPriceResult {
  return {
    mode,
    grid_price: 0,
    landing_price: 0,
    annual_fee: 0,
    annual_grid_revenue: 0,
    annual_landing_fee: 0,
    receiving_energy: 0,
    total_loss_rate: 0,
    annual_hours: 0,
    breakdown: [],
    annual_detail: [],
    error: message
  }
}

function buildResult(
  mode: InterprovincialMode,
  form: InterprovincialPriceForm,
  gridPrice: number,
  landingPrice: number,
  pass: ForwardPass
): InterprovincialPriceResult {
  const retention = lossRetentionFactor(form)
  // 送端电量按上网侧计量，受端电量 = 送端 × ∏(1−η)
  const sendEnergy = form.annual_energy
  const receiveEnergy = sendEnergy * retention
  // 上网侧收入用送端电量、落地侧费用用受端电量
  const annualGridRevenue = gridPrice * sendEnergy
  const annualLandingFee = landingPrice * receiveEnergy

  // 年度明细：按受端结算电量分解落地电费（线损为显性行）；
  // 占比分母取分项合计，保证含线损行的占比合计闭合到 100%
  const componentTotal = pass.priceComponents.reduce((sum, component) => sum + component.price * receiveEnergy, 0)
  const annualDetail: InterprovincialAnnualItem[] = pass.priceComponents.map((component) => {
    const amount = component.price * receiveEnergy
    return {
      item: component.item,
      amount: round(amount, 2),
      ratio: componentTotal > 0 ? round(amount / componentTotal, 4) : 0,
      energy: round(receiveEnergy, 2)
    }
  })

  const hours = annualHours(form)
  const warning = hours > 8760
    ? `年利用小时数 ${hours} 超过 8760 小时，请核对年电量（万kWh）与输电容量（万kW）的量纲`
    : undefined

  return {
    mode,
    grid_price: round(gridPrice),
    landing_price: round(landingPrice),
    annual_fee: round(mode === 'toEndUser' ? annualLandingFee : annualGridRevenue, 2),
    annual_grid_revenue: round(annualGridRevenue, 2),
    annual_landing_fee: round(annualLandingFee, 2),
    receiving_energy: round(receiveEnergy, 2),
    // 综合线损率与价格级联同源（同一段定义）
    total_loss_rate: round((1 - retention) * 100, 2),
    annual_hours: hours,
    breakdown: pass.breakdown.map((item) => ({
      ...item,
      unit_price: round(item.unit_price),
      accumulated: round(item.accumulated)
    })),
    annual_detail: annualDetail,
    ...(warning ? { warning } : {})
  }
}

export function calculateToEndUser(form: InterprovincialPriceForm): InterprovincialPriceResult {
  const invalid = validateForm(form, 'toEndUser')
  if (invalid) return errorResult('toEndUser', invalid)
  const pass = runForward(form, form.grid_price)
  return buildResult('toEndUser', form, form.grid_price, pass.landingPrice, pass)
}

export function calculateToSource(form: InterprovincialPriceForm): InterprovincialPriceResult {
  const invalid = validateForm(form, 'toSource')
  if (invalid) return errorResult('toSource', invalid)

  const basePrice = cascadeReverse(form, form.landing_price)
  if (basePrice <= 0) {
    // 显式错误而非静默钳位：落地价不足以覆盖通道费用与线损
    return errorResult('toSource', '落地电价过低：扣除各环节输电费与线损后送端上网电价 ≤ 0，无可行解')
  }

  const pass = runForward(form, basePrice)
  // 严格逆反推：landing_price 传入用户输入原值，不用正推重算值（pass.landingPrice）覆盖
  return buildResult('toSource', form, basePrice, form.landing_price, pass)
}
