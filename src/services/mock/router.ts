// Mock 演示路由表（PRD §4.3）：method + path → 合成响应。
//
// 覆盖策略（v1 验收轮）：云南发电集团主线（驾驶舱/申报台/复盘）给定制演示数据；
// 其余接口 fail-open 到「合法空信封」并在控制台与 mockStats.unmatched 记账——
// 绝不回源真实后端（隔离硬保证，PRD 边界 1）。后续轮次按覆盖矩阵逐域补 handler。

import { mockEmptyEnvelopeResponse, mockEnvelopeResponse, mockJsonResponse, mockPipelineEnvelopeResponse } from './envelope'
import { curve96, dateStr, dayLevel, hourlyPrice24, mulberry32, seedOf, TIME_AXIS_96, type CurveKind } from './generators'
import { fixtureFileList, loadFixturePayload, loadRealDayCurve } from './fixtures'
import { mockAgentSessionId, mockAgentStreamResponse } from './agentScript'
import { resolveGridOperatorProfile } from 'shared/region/grid-operator-profiles.mjs'
import type { DeclarationOrder, DeclarationStatus, RiskCheckResult } from '@/services/declarations'

export const mockStats = { intercepted: 0, unmatched: 0 }

type MockContext = { method: string; url: URL; body: Record<string, unknown> }
// handler 允许异步（fixtures 取件是动态 import）；resolveMockRequest 统一 await
type MockHandler = (ctx: MockContext) => Response | Promise<Response>
type MockRoute = { method: string; prefix: string; handler: MockHandler }

const MOCK_COMPANY_ID = 'comp-mock-demo'
const MOCK_SUBJECT_ID = 'GROUP-SX-MOCK'

// ---------------------------------------------------------------------------
// 申报单会话级 mock 存储（PRD §4.3：写操作模拟成功 + 关页即清）
// ---------------------------------------------------------------------------

const DECLARATION_STORE_KEY = 'dljy.mock.declarations'

/** 申报电量曲线按机组容量缩放：curve96 output 峰值 ~550MW，除以 620 使峰值 ≈ 容量的 ~0.89。 */
function capacityScaledCurve(seed: string, date: string, capacityMw: number): number[] {
  return curve96('output', seed, date).map((v) => Math.round(v * (capacityMw / 620) * 10) / 10)
}

function buildSeedOrder({ offset, status, id }: { offset: number; status: DeclarationStatus; id: string }): DeclarationOrder {
  const targetDate = dateStr(offset)
  const createdAt = `${dateStr(offset - 1)}T08:30:00+08:00`
  return {
    id,
    targetDate,
    deadline: `${dateStr(offset - 1)}T10:30:00+08:00`,
    status,
    mode: 'LIVE',
    companyId: MOCK_COMPANY_ID,
    region: 'shanxi',
    subjectId: MOCK_SUBJECT_ID,
    subjectType: 'GENERATOR',
    capacityMw: 660,
    energyCurveMwh96: capacityScaledCurve(id, targetDate, 660),
    priceCurve96: curve96('price', `${id}-price`, targetDate),
    strategySource: 'manual',
    basis: 'synthetic',
    quoteRationale: '演示主线：早晚峰报价、午间平价（山西集团叙事）',
    note: null,
    riskCheck: null,
    approvalRecord:
      status === 'DRAFT' || status === 'PENDING_APPROVAL'
        ? []
        : [
            {
              at: `${dateStr(offset - 1)}T09:12:00+08:00`,
              approver: '演示交易负责人',
              role: 'TRADE_LEAD',
              decision: 'approve',
              gateLevel: 'L2',
              comment: '演示数据：审批通过'
            }
          ],
    receipt: null,
    clearing:
      status === 'CLEARED' || status === 'SETTLED' || status === 'REVIEWED'
        ? { clearedCurveMwh96: capacityScaledCurve(`${id}-cleared`, targetDate, 660), markedAt: `${dateStr(offset)}T17:00:00+08:00`, source: 'mock-demo' }
        : null,
    createdBy: 'mock-demo',
    createdAt,
    updatedAt: createdAt,
    audit: []
  } satisfies DeclarationOrder
}

function seedDeclarations(): DeclarationOrder[] {
  const spec: Array<{ offset: number; status: DeclarationStatus; id: string }> = [
    { offset: 1, status: 'PENDING_APPROVAL', id: 'MOCK-ORD-P1' },
    { offset: 1, status: 'DRAFT', id: 'MOCK-ORD-D1' },
    { offset: 0, status: 'APPROVED', id: 'MOCK-ORD-D0' },
    { offset: -1, status: 'CLEARED', id: 'MOCK-ORD-DM1' },
    { offset: -2, status: 'SETTLED', id: 'MOCK-ORD-DM2' },
    { offset: -3, status: 'REVIEWED', id: 'MOCK-ORD-DM3' }
  ]
  return spec.map(buildSeedOrder)
}

function loadDeclarations(): DeclarationOrder[] {
  try {
    const raw = sessionStorage.getItem(DECLARATION_STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DeclarationOrder[]
      if (Array.isArray(parsed)) {
        // 旧会话存储补种：缺待审批演示单时追加（审批队列待审区不能为空，C.21 验收）
        if (!parsed.some((o) => o.id === 'MOCK-ORD-P1')) {
          const pending = buildSeedOrder({ offset: 1, status: 'PENDING_APPROVAL', id: 'MOCK-ORD-P1' })
          parsed.unshift(pending)
          saveDeclarations(parsed)
        }
        return parsed
      }
    }
  } catch {
    /* 首次访问/隐私模式：落到种子 */
  }
  const seeded = seedDeclarations()
  saveDeclarations(seeded)
  return seeded
}

function saveDeclarations(orders: DeclarationOrder[]): void {
  try {
    sessionStorage.setItem(DECLARATION_STORE_KEY, JSON.stringify(orders))
  } catch {
    /* storage 不可用：本页内存内仍可用（loadDeclarations 每次重读会回到种子，可接受） */
  }
}

function declarationEnvelope(order: DeclarationOrder): Response {
  return mockEnvelopeResponse({ data: order })
}

function riskCheckFor(order: DeclarationOrder): RiskCheckResult {
  const totalMwh = Math.round(order.energyCurveMwh96.reduce((sum, v) => sum + v, 0) * 100) / 100
  const warn = (name: string, detail: string) => ({ checkId: name, name, status: 'FAIL', severity: 'warning', detail })
  const checks = [
    { checkId: 'capacity', name: '容量上限', status: 'PASS', severity: 'hard', detail: `480MW 机组上限内` },
    { checkId: 'priceCap', name: '报价上限', status: 'PASS', severity: 'hard', detail: '价格曲线均在限价内' },
    { checkId: 'quotePrecision', name: '报价精度', status: 'PASS', severity: 'hard', detail: '96 点 0.1 元/MWh 精度' },
    warn('exposure', '午间光伏大发段存在逆负荷敞口，关注偏差考核'),
    { checkId: 'bias', name: '历史偏差', status: 'PASS', severity: 'overridable', detail: '近 7 日偏差率 2.1%' },
    { checkId: 'dataBasis', name: '数据口径', status: 'PASS', severity: 'overridable', detail: '演示数据源（Mock 演示账号）' },
    warn('breakeven', '晚峰段边际成本逼近报价，收益空间收窄'),
    { checkId: 'redLine', name: '交易红线', status: 'PASS', severity: 'hard', detail: '未触及红线规则' },
    { checkId: 'socTrajectory', name: '储能轨迹', status: 'UNAVAILABLE', severity: 'overridable', detail: '非储能主体，跳过' },
    { checkId: 'quoteRationale', name: '报价依据', status: 'PASS', severity: 'overridable', detail: order.quoteRationale ?? '演示主线策略' }
  ]
  return {
    checks,
    passed: true,
    blocked: false,
    blockers: [],
    gateLevel: 'L2',
    totalMwh,
    maxMw: Math.round((Math.max(...order.energyCurveMwh96) * 4) * 10) / 10,
    evaluatedAt: new Date().toISOString(),
    inputs: { mode: 'mock-demo' }
  } as unknown as RiskCheckResult
}

function handleDeclarationList(ctx: MockContext): Response {
  const q = ctx.url.searchParams
  const date = q.get('date')
  const dateFrom = q.get('dateFrom')
  const dateTo = q.get('dateTo')
  const status = q.get('status')
  const mode = q.get('mode')
  let rows = loadDeclarations().filter((order) => {
    if (date && order.targetDate !== date) return false
    if (dateFrom && order.targetDate < dateFrom) return false
    if (dateTo && order.targetDate > dateTo) return false
    if (status && order.status !== status) return false
    if (mode && (order.mode ?? 'LIVE') !== mode) return false
    return true
  })
  const offset = Number(q.get('offset') ?? 0) || 0
  const limit = Number(q.get('limit') ?? 50) || 50
  const total = rows.length
  rows = rows.slice(offset, offset + limit)
  const counts = { LIVE: total, REHEARSAL: 0 }
  return mockEnvelopeResponse({
    data: { rows, total, limit, offset, counts, appliedFilters: { date, dateFrom, dateTo, status, mode } }
  })
}

function handleDeclarationMutation(ctx: MockContext): Response {
  const segs = ctx.url.pathname.slice(DECL_BASE.length + 1).split('/').filter(Boolean)
  if (segs.length === 0) return fallbackResponse(ctx)
  const orders = loadDeclarations()
  // PUT/PATCH /:id → 单段是 id；POST /:id/<action> → 倒数第二段才是 id
  const id = decodeURIComponent(segs.length >= 2 ? segs[segs.length - 2] : segs[0])
  const action = segs.length >= 2 ? segs[segs.length - 1] : 'patch'
  const order = orders.find((o) => o.id === id)
  if (!order) return mockEnvelopeResponse({ code: 404, msg: `演示数据中不存在申报单 ${id}`, data: null }, { status: 404 })
  const now = new Date().toISOString()
  switch (action) {
    case 'preflight': {
      const stage = String(ctx.body.stage ?? 'unknown')
      order.preflight = { ...(order.preflight ?? {}), [stage]: ctx.body.payload } as DeclarationOrder['preflight']
      break
    }
    case 'risk-check': {
      order.riskCheck = riskCheckFor(order)
      if (order.status === 'DRAFT') order.status = 'RISK_CHECKED'
      return declarationEnvelopeAfter(order, { riskCheck: order.riskCheck })
    }
    case 'submit-for-approval':
      order.status = 'PENDING_APPROVAL'
      break
    case 'approve':
      order.status = 'APPROVED'
      order.approvalRecord = [
        ...(order.approvalRecord ?? []),
        { at: now, approver: '演示交易负责人', role: 'TRADE_LEAD', decision: 'approve', gateLevel: 'L2', comment: String(ctx.body.comment ?? '演示数据：审批通过') }
      ]
      break
    case 'submit':
      order.status = 'SUBMITTED'
      // 提交与回执阶段展示回执块（SpotDeclaration 契约的 receipt 结构）
      order.receipt = {
        receiptId: `MOCK-RCP-${Date.now().toString(36)}`,
        gateway: 'mock-demo',
        acknowledgedAt: now,
        idempotencyKey: `mock-${Date.now().toString(36)}`,
        mock: true,
        mode: (order.mode ?? 'LIVE'),
        note: '演示回执（Mock 演示账号，未接真实电网网关）'
      }
      break
    case 'mark-cleared':
      order.status = 'CLEARED'
      order.clearing = {
        clearedCurveMwh96: capacityScaledCurve(`cleared:${id}:${order.targetDate}`, order.targetDate, order.capacityMw ?? 480),
        markedAt: now,
        source: 'mock-demo'
      }
      break
    default: {
      const patch = ctx.body as Partial<DeclarationOrder>
      Object.assign(order, patch)
    }
  }
  saveDeclarations(orders)
  return declarationEnvelope(order)
}

function declarationEnvelopeAfter(order: DeclarationOrder, extra: Record<string, unknown>): Response {
  const orders = loadDeclarations()
  const idx = orders.findIndex((o) => o.id === order.id)
  if (idx >= 0) orders[idx] = order
  saveDeclarations(orders)
  return mockEnvelopeResponse({ data: { ...order, ...extra } })
}

// ---------------------------------------------------------------------------
// 采集族（/api/real*）：曲线契约族（sdpt_zcqxhdl / knn-api_api）按真实管道形状供给，
// 其余族按「逐点行 + p1..p96 内嵌」双形态兜底；全部走「管道可消费」信封
// （realDataConnected:true + served=地区，诚实标注由会话徽标与 x-data-mock 头承担）。
// ---------------------------------------------------------------------------

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

function pFields(curve: number[], count: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 1; i <= count; i++) out[`p${i}`] = curve[i - 1]
  return out
}

// —— 逐日系统负荷真实形状（golden 对齐，C.19）：nameList=366 个「M月D日」日序标签，
// legendList=近 6 年，pjz/zxz/zdz=年×日矩阵（~2.0–3.7 万 MW 双峰季节曲线，老年份按
// 年增长回推）。此前误仿成「96 时点 × 2 年」，与真实页面多年逐日对齐的形状不符。——
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function dayOfYearLabels(): string[] {
  const labels: string[] = []
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= MONTH_DAYS[m]; d++) labels.push(`${m + 1}月${d}日`)
  }
  return labels
}

function yearLoadMatrix(salt: string): { years: string[]; pjz: number[][]; zxz: number[][]; zdz: number[][] } {
  const labels = dayOfYearLabels()
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => `${thisYear - 5 + i}年`)
  const jitter = (year: number, di: number) => (Math.sin(di * 12.9898 + year * 78.233 + salt.length * 3.7) * 0.5 + 0.5) * 900
  const row = (yi: number, scale: number) =>
    labels.map((_, di) => {
      const year = thisYear - 5 + yi
      // 双峰季节形态：夏峰（约 7 月）+ 冬峰（约 1 月），老年份负荷水平按年增长回推
      const summer = 4800 * Math.cos(((di - 190) / 366) * 2 * Math.PI)
      const winter = 2600 * Math.cos(((di - 8) / 366) * 2 * Math.PI)
      const growth = 1 - (thisYear - year) * 0.045
      return Math.round((27000 + summer + winter) * growth * scale + jitter(year, di))
    })
  return {
    years,
    pjz: years.map((_, yi) => row(yi, 1)),
    zxz: years.map((_, yi) => row(yi, 0.9)),
    zdz: years.map((_, yi) => row(yi, 1.12))
  }
}

function dailySystemLoadSource(salt: string) {
  const { years, pjz, zxz, zdz } = yearLoadMatrix(salt)
  return { nameList: dayOfYearLabels(), legendList: years, pjz, zxz, zdz }
}

/** 采集族载荷：单日（dateFrom=dateTo）或多日（逐日一行/一日多行）。 */
function capturedPayload(ctx: MockContext): Record<string, unknown> {
  const family = ctx.url.searchParams.get('family') ?? ''
  const match = ctx.url.searchParams.get('match') ?? ''
  // 契约层（fetchReplay 等）不带 dateFrom/dateTo 时默认供给近 60 天区间——
  // 市场洞察重页的横轴是「运行日期区间」，单点序列在图上不可见。
  const hasRange = ctx.url.searchParams.get('dateFrom') != null
  const dateFrom = ctx.url.searchParams.get('dateFrom') ?? dateStr(-59)
  const dateTo = ctx.url.searchParams.get('dateTo') || (hasRange ? dateFrom : dateStr(0))
  const dates: string[] = []
  for (let d = dateFrom; d <= dateTo && dates.length < 90; d = addDays(d, 1)) dates.push(d)

  // —— 市场洞察重页契约（sdpt_zcqxhdl 按 match 分派，形状对齐 marketInsightHeavyPages 适配器）——
  if (family === 'sdpt_zcqxhdl') {
    // 出清现货电量分析（__list__ 连续序列：timePoints=运行日期区间，series 与 legend 平行的逐日数组）
    if (match.includes('__list__')) {
      const daily = (kind: CurveKind, salt: string) => dates.map((d) => {
        const c = curve96(kind, `${salt}:${d}`, d)
        return Math.round((c.reduce((s, v) => s + v, 0) / 96) * 10) / 10
      })
      const daDaily = daily('price', 'clear-da')
      const rtDaily = daily('price', 'clear-rt')
      const energyDaily = dates.map((d, i) => Math.round(daily('renewable', 'clear-e')[i] * 24))
      const loadDaily = daily('load', 'clear-l')
      return {
        nameList: dates,
        legend: ['日前价出清', '实时价出清', '日前出清现货电量', '日前负荷预测', '系统负荷实际值', '价格差'],
        yAxisIndexList: [0, 0, 1, 1, 1, 2],
        series: [
          daDaily,
          rtDaily,
          energyDaily,
          loadDaily,
          loadDaily.map((v) => Math.round(v * 103) / 100),
          rtDaily.map((v, i) => Math.round((v - daDaily[i]) * 10) / 10)
        ]
      }
    }
    // 逐日系统负荷（query__）：真实形状 = 366 日序标签 × 近 6 年矩阵（golden 对齐）
    if (match.startsWith('query__')) {
      return { system: dailySystemLoadSource('qload'), misplace: dailySystemLoadSource('qmis') }
    }
    // 价格-新能源 / 价格-统调负荷 24 小时散点（_list24__/fhlist24__<date>）。
    // 形状对齐 golden：xd 行 p1..p24 为 [指标值, 价格] 二元组；参照线行 {date,type,hj,jz,p1..p24}；
    // list24 线容器 xnyzd/xnyg/xnygd(+xnyz)，fhlist24 仅 xnyzd(+xnyz)；rqdj=30 日滚动 24 点价。
    if (/^_?list24__|^fhlist24__/.test(match)) {
      const isLoad = match.startsWith('fhlist24')
      const day = match.split('__')[1] ?? dateFrom
      const price = curve96('price', `rel-p:${day}`, day)
      const metric = curve96(isLoad ? 'load' : 'renewable', `rel-m:${day}`, day)
      const xdRow: Record<string, unknown> = { date: day }
      for (let h = 1; h <= 24; h++) {
        xdRow[`p${h}`] = [Math.round(metric[h * 4 - 2] * (isLoad ? 3.4 : 6.5)), Math.round(price[h * 4 - 2] * 10) / 10]
      }
      const lineRow = (kind: CurveKind, salt: string, scale: number, lineDay: string, type: string, id: number) => {
        const curve = curve96(kind, `rel-${salt}:${lineDay}`, lineDay)
        const hourly = Array.from({ length: 24 }, (_, h) => Math.round(curve[h * 4] * scale))
        return {
          id,
          prov_id: 1,
          date: addDays(lineDay, 1),
          drrq: addDays(lineDay, 1),
          type,
          hj: Math.round(hourly.reduce((s, v) => s + v, 0) * 10) / 10,
          jz: Math.round((hourly.reduce((s, v) => s + v, 0) / 24) * 10) / 10,
          ...pFields(hourly, 24)
        }
      }
      const rolling = (salt: string) => Array.from({ length: 30 }, (_, i) => {
        const d = addDays(day, -29 + i)
        const curve = curve96('price', `rel-rqdj:${salt}:${d}`, d)
        const hourly = Array.from({ length: 24 }, (_, h) => Math.round(curve[h * 4] * 10) / 10)
        return {
          id: i + 1,
          prov_id: 1,
          date: d,
          drrq: addDays(d, 1),
          type: '0',
          hj: Math.round(hourly.reduce((s, v) => s + v, 0) * 10) / 10,
          jz: Math.round((hourly.reduce((s, v) => s + v, 0) / 24) * 10) / 10,
          ...pFields(hourly, 24)
        }
      })
      if (isLoad) {
        return {
          rqdj: rolling('fh'),
          xnyzd: [lineRow('load', 'zd', 3.4, day, '3', 1)],
          xd: [xdRow],
          xnyz: [lineRow('load', 'zz', 3.1, day, '4', 2)]
        }
      }
      return {
        rqdj: rolling('xny'),
        xnyzd: [lineRow('renewable', 'zd', 6.8, day, '3', 1)],
        xnyg: [lineRow('renewable', 'zg', 5.9, day, '2', 2)],
        xd: [xdRow],
        xnygd: [0, 1, 2, 3, 4].map((i) => lineRow('renewable', `gd${i}`, 2.4 + i * 0.3, addDays(day, -i), String(5 + i), i + 1)),
        xnyz: [lineRow('renewable', 'zz', 5.6, day, '1', 3)]
      }
    }
    // 价格分析（listrs_full）与出清曲线管道默认：dmx + rqdj + rjz + rmx
    // 无日期参数（契约层）默认供 365 天——价格分析的 3D/切面图按日期区间裁剪，跨度即数据量
    const zDates = hasRange ? dates : Array.from({ length: 365 }, (_, i) => dateStr(i - 364))
    const dmx = zDates.map((date, index) => {
      const curve = curve96('price', `${family}:${date}`, date)
      const jz = Math.round((curve.reduce((s, v) => s + v, 0) / 96) * 100) / 100
      return { id: index + 1, provId: 1, date, drrq: addDays(date, 1), type: '0', hj: Math.round(curve.reduce((s, v) => s + v, 0) * 100) / 100, jz, ...pFields(curve, 96) }
    })
    const rqdj = zDates.map((date) => {
      const curve = curve96('price', `${family}:${date}`, date)
      const hourly = Array.from({ length: 24 }, (_, h) => Math.round(((curve[h * 4] + curve[h * 4 + 2]) / 2) * 100) / 100)
      return { date, type: '0', hj: Math.round(hourly.reduce((s, v) => s + v, 0) * 100) / 100, jz: Math.round((hourly.reduce((s, v) => s + v, 0) / 24) * 100) / 100, ...pFields(hourly, 24) }
    })
    const rjz: Array<Record<string, unknown>> = []
    const rmx: Array<Record<string, unknown>> = []
    for (const date of zDates) {
      for (const [type, key] of [['0', 'da'], ['1', 'rt']] as const) {
        const c = curve96('price', `listrs:${key}:${date}`, date)
        const max = Math.round(Math.max(...c) * 10) / 10
        const min = Math.round(Math.min(...c) * 10) / 10
        const avg = Math.round((c.reduce((s, v) => s + v, 0) / 96) * 10) / 10
        // rjz 行携带完整 96 点日内均价曲线（价格分析「时点切面」直接消费）；
        // rmx 是统计行——真实件 p4..p96 为 null，形状照抄（null 键也要在，golden 全集护栏比对）
        rjz.push({ id: null, provId: 1, date, drrq: addDays(date, 1), type, hj: Math.round(c.reduce((s, v) => s + v, 0) * 100) / 100, jz: avg, ...pFields(c, 96) })
        const rmxTail: Record<string, unknown> = {}
        for (let p = 4; p <= 96; p++) rmxTail[`p${p}`] = null
        rmx.push({ id: null, provId: 1, date, drrq: addDays(date, 1), type, hj: null, jz: null, p1: max, p2: min, p3: avg, ...rmxTail })
      }
    }
    return { dmx, rqdj, rjz, rmx, _match: match }
  }
  // 逐日系统负荷（sdpt_actualLoad query__）：真实形状 = 366 日序标签 × 近 6 年矩阵
  if (family === 'sdpt_actualLoad') {
    // query2：逐年 {year, jqList(节气节日), nameList(抽样日), legendList, pjz/zxz/zdz(4 行抽样日值)}
    if (match.startsWith('query2')) {
      const terms: Array<[string, string]> = [
        ['元旦', '01-01'], ['小寒', '01-05'], ['大寒', '01-20'], ['春节', '02-04'], ['立春', '02-04'], ['雨水', '02-19'],
        ['惊蛰', '03-05'], ['春分', '03-20'], ['清明', '04-05'], ['谷雨', '04-20'], ['立夏', '05-05'], ['小满', '05-21'],
        ['芒种', '06-05'], ['夏至', '06-21'], ['小暑', '07-07'], ['大暑', '07-22'], ['立秋', '08-07'], ['处暑', '08-23'],
        ['白露', '09-07'], ['秋分', '09-23'], ['寒露', '10-08'], ['霜降', '10-23'], ['立冬', '11-07'], ['小雪', '11-22'],
        ['大雪', '12-06'], ['冬至', '12-21'], ['国庆', '10-01']
      ]
      const queryRand = mulberry32(seedOf(`aload-query2:${match}`))
      const system = ['2026', '2025', '2024', '2023', '2022', '2021'].map((year, yi) => ({
        year,
        jqList: terms.map(([jjrmc, md], ti) => ({
          id: yi * 100 + ti,
          riqi: `${year}-${md}`,
          jjrmc,
          jjr: ['元旦', '春节', '清明', '劳动节', '端午', '中秋', '国庆'].includes(jjrmc)
        })),
        nameList: ['1月5日', '2月5日', '4月5日', '6月5日', '7月5日', '8月5日', '9月5日', '11月5日', '12月5日'],
        legendList: ['日前负荷', '实时负荷', '日前新能源', '实时新能源'],
        pjz: [0, 1, 2, 3].map((row) => Array.from({ length: 9 }, (_, i) => Math.round((27000 + queryRand() * 14000 - row * 900 + i * 120) * 100) / 100)),
        zxz: [0, 1, 2, 3].map((row) => Array.from({ length: 9 }, (_, i) => Math.round((15500 + queryRand() * 11000 - row * 700 + i * 90) * 100) / 100)),
        zdz: [0, 1, 2, 3].map((row) => Array.from({ length: 9 }, (_, i) => Math.round((32000 + queryRand() * 9500 - row * 800 + i * 130) * 100) / 100))
      }))
      return { system, _match: match }
    }
    return { system: dailySystemLoadSource('aload'), misplace: dailySystemLoadSource('amis'), _match: match }
  }
  // —— 综合数据分析（sdpt_zsjfx_idx：meta 日期索引 + 逐日曲线文档）——
  if (family === 'sdpt_zsjfx_idx') {
    if (match === 'zsjfx_meta') {
      const dates30 = dates.length >= 30 ? dates : dates.concat(Array.from({ length: 30 - dates.length }, (_, i) => dateStr(dates.length + i)))
      return {
        dates: dates30,
        goodDates: dates30.slice(-10),
        groups: { 价格: ['日前出清价', '实时出清价'], 负荷: ['系统负荷'], 新能源: ['新能源出力'] },
        // yzConfig = Y 轴定义数组（name/min/max/interval），typeAxis 的值是其下标
        typeAxis: { 日前出清价: 0, 实时出清价: 0, 系统负荷: 1, 新能源出力: 1 },
        yzConfig: [
          { name: '价格 (元/MWh)', min: 0, max: 600, interval: 100 },
          { name: '负荷/出力 (MW)', min: 0, max: 16000, interval: 2000 }
        ],
        colorMap: { 日前出清价: '#409eff', 实时出清价: '#67c23a', 系统负荷: '#e6a23c', 新能源出力: '#934294' },
        defaults: ['日前出清价', '实时出清价', '系统负荷', '新能源出力']
      }
    }
    if (match.startsWith('zsjfx_day__')) {
      const day = match.slice('zsjfx_day__'.length)
      return {
        date: day,
        series: {
          日前出清价: curve96('price', `zsjfx-da:${day}`, day),
          实时出清价: curve96('price', `zsjfx-rt:${day}`, day),
          系统负荷: curve96('load', `zsjfx-l:${day}`, day),
          新能源出力: curve96('renewable', `zsjfx-r:${day}`, day)
        }
      }
    }
  }
  // —— 分时行情（sdpt_fshq：rqlx0/rqlx1 日文档 + dataDet 买卖盘逐笔）——
  if (family === 'sdpt_fshq') {
    if (match.startsWith('dataDet__id')) {
      // 买卖盘逐笔（C.22）：正弦波过于规律，改播种随机过程——最新价随机游走（±12 步长 +
      // 8% 概率 ±30 跳变，钳位 90–780 与软化后价格观感一致），挂单量为对数均匀分布
      //（小单为主、偶发大单），价差分层随价格水平伸缩。同一点位 id 恒同序列。
      const nameList = TIME_AXIS_96
      const rand = mulberry32(seedOf(`fshq-datadet:${match}`))
      let px = 240 + rand() * 140
      const zxjg = nameList.map(() => {
        px = Math.min(780, Math.max(90, px + (rand() - 0.5) * 24 + (rand() < 0.08 ? (rand() - 0.5) * 60 : 0)))
        return Math.round(px * 10) / 10
      })
      const qty = () => Math.round((4 + Math.exp(rand() * 3.4)) * 10) / 10
      // 价差档位：每点抽一档价差与档间步进，买侧递减/卖侧递增，保证 1/2/3 档有序
      const ladder = (side: 'b' | 's') => {
        const rows = zxjg.map((p) => {
          const base = 1.5 + rand() * 3
          const step = 1.5 + rand() * 2
          return [0, 1, 2].map((lvl) => Math.round((side === 'b' ? p - base - lvl * step : p + base + lvl * step) * 10) / 10)
        })
        return [0, 1, 2].map((lvl) => rows.map((r) => r[lvl]))
      }
      const [mrj1, mrj2, mrj3] = ladder('b')
      const [mcj1, mcj2, mcj3] = ladder('s')
      const dataMap = {
        mrl1: nameList.map(qty), mrl2: nameList.map(qty), mrl3: nameList.map(qty),
        mcl1: nameList.map(qty), mcl2: nameList.map(qty), mcl3: nameList.map(qty),
        mrj1, mrj2, mrj3,
        mcj1, mcj2, mcj3,
        zxjg
      }
      // renderBuySell 门槛：d.dataMap + d.nameList 非空；chartConfigMap 与真实件同形（量程配置）
      return { data: { title: '买卖盘逐笔（演示）', nameList, dataMap, chartConfigMap: { min: -480, max: 480, interval: 96 } } };
    }
    const day = match.split('__')[1] ?? dateFrom
    const rq = curve96('price', `fshq-rq:${day}`, day)
    const ss = curve96('price', `fshq-ss:${day}`, day)
    // 主图 opData 行结构：[时间标签, 开, 收, 低, 高, 成交量]（kdata 取 r[1..4]，vol 取 r[5]；
    // [0] 与真实件同为字符串标签）
    const dayNum = Number(day.slice(-2))
    const opData = ss.map((close, i) => {
      const open = i === 0 ? close : ss[i - 1]
      const low = Math.round(Math.min(open, close) * 0.98 * 10) / 10
      const high = Math.round(Math.max(open, close) * 1.02 * 10) / 10
      const hour = Math.floor(i / 4)
      return [
        `${day} ${hour}:00 ( ${dayNum}号 ) `,
        Math.round(open * 10) / 10,
        Math.round(close * 10) / 10,
        low,
        high,
        Math.round(300 + Math.abs(Math.sin(i / 7)) * 500)
      ]
    })
    // markLineList = 整点竖线标记（真实件 rqlx0 24 条 / rqlx1 20 条，此处统一 24 条）
    const markLineList = Array.from({ length: 24 }, (_, h) => ({ xAxis: h * 4, name: `${h}:00` }))
    const extendMap: Record<string, unknown> = {}
    // 锚点铺满 0..119（真实件 120 个：含次日时段），供主图逐点联动买卖盘
    for (let i = 0; i < 120; i++) {
      const dayOffset = i < 96 ? day : addDays(day, 1)
      const hhmmLabel = `${String(Math.floor((i % 96) / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`
      extendMap[`data_${i}`] = { id: 1000 + i, title: `${dayOffset} ${hhmmLabel} 现货收盘（演示）` }
    }
    // FshqView 严格读 res.data —— 载荷必须挂在 data 字段下
    return { data: {
      title: `${day} 分时行情（演示）`,
      nameList: TIME_AXIS_96,
      opData,
      rqjycgsList: rq.map((v) => Math.round(v * 1.03 * 10) / 10),
      rqjycdctjList: rq.map((v) => Math.round(v * 0.97 * 10) / 10),
      rqjcqList: rq,
      ssjcqList: ss,
      value: ss,
      dataMap: { nameList: TIME_AXIS_96 },
      markLineList,
      ssjycdcList: [],
      rqjhgList: [],
      ssjhgList: [],
      extendMap
    } };
  }
  // 日滚动价格预测（KNN）逐日 96 点文档：顶层 { drrq, p1..p96 }
  if (family === 'knn-api_api') {
    const curve = curve96('price', `knn:${dateFrom}`, dateFrom)
    return { drrq: dateFrom, date: dateFrom, ...pFields(curve, 96) }
  }
  // 市场洞察驾驶舱（sdpt_console）：三套图按各自契约供数
  if (family === 'sdpt_console') {
    const m = match.replace(/\.json$/, '')
    const days = (n: number) => Array.from({ length: n }, (_, i) => dateStr(i - n + 1))
    if (m === 'getCorpNewEnergyChart') {
      // 逐日 energy 值：对每日 96 点曲线取均值缩放（不能按"天序号当小时下标"取值，
      // 否则前段天取到夜间 0 值、柱状整段不可见）
      const dayAvg = (key: string) => dates.map((d) => {
        const c = curve96('renewable', `${key}:${d}`, d)
        return Math.round((c.reduce((s, v) => s + v, 0) / 96) * 8)
      })
      const neTotal = dayAvg('ne-total')
      return {
        data: {
          dateList: dates,
          corpTotalList: neTotal,
          yyTotalList: neTotal.map((v) => Math.round(v * 0.82 * 10) / 10),
          corpWindList: neTotal.map((v) => Math.round(v * 0.55 * 10) / 10),
          yyWindList: neTotal.map((v) => Math.round(v * 0.42 * 10) / 10),
          corpLightList: neTotal.map((v) => Math.round(v * 0.34 * 10) / 10),
          yyLightList: neTotal.map((v) => Math.round(v * 0.26 * 10) / 10),
          highList: dates.map((_, i) => 24 + Math.round(Math.abs(Math.sin(i * 1.7)) * 8)),
          lowList: dates.map((_, i) => 12 + Math.round(Math.abs(Math.cos(i * 1.3)) * 6)),
          realTimeAvgPriceList: dates.map((d) => Math.round(curve96('price', `rt-avg:${d}`, d).reduce((s, v) => s + v, 0) / 96)),
          dayBeforeAvgPriceList: dates.map((d) => Math.round(curve96('price', `da-avg:${d}`, d).reduce((s, v) => s + v, 0) / 96)),
          dayBeforeAvgSbPriceList: dates.map((d) => Math.round(curve96('price', `da-avg-sb:${d}`, d).reduce((s, v) => s + v, 0) / 96)),
          dayBeforeAvgJsPriceList: dates.map((d) => Math.round(curve96('price', `da-avg-js:${d}`, d).reduce((s, v) => s + v, 0) / 96))
        }
      }
    }
    if (['d859fbde03', '275c1ef9fa', '317f0f0bbd', '0b36fa2030', '0144aacb91', '7db3560c48'].includes(m)) {
      const kindByHash: Record<string, { type: string; scale: number }> = {
        d859fbde03: { type: 'LOAD', scale: 120 },
        '275c1ef9fa': { type: 'INDUSTRY_LOAD', scale: 70 },
        '317f0f0bbd': { type: 'NEW_ENERGY', scale: 45 },
        '0b36fa2030': { type: 'EXPORT', scale: 35 },
        '0144aacb91': { type: 'MUST_STOP', scale: 14 },
        // 火电非停容量真实量纲 ~1.5e3（golden 全集护栏校准）：负荷曲线 ~9.6e3 × 0.18 ≈ 1.7e3
        '7db3560c48': { type: 'CC_SW', scale: 0.18 }
      }
      const { type, scale } = kindByHash[m]
      const titleByHash: Record<string, string> = {
        d859fbde03: '统调负荷',
        '275c1ef9fa': '工业负荷',
        '317f0f0bbd': '新能源出力',
        '0b36fa2030': '外送电力',
        '0144aacb91': '必停机组容量',
        '7db3560c48': '火电非停容量'
      }
      const dates = days(60)
      const base = curve96('load', `console:${m}`, dates[0])
      const pick = (salt: number) => dates.map((_, i) => Math.round(base[(i * 7 + salt) % 96] * scale * 10) / 10)
      return {
        data: {
          title: titleByHash[m] ?? type,
          type,
          dateList: dates,
          yaxisMax: Math.round(520 * scale),
          yaxisMin: Math.round(180 * scale),
          d3List: pick(3),
          d2List: pick(2),
          d1List: pick(1),
          actualValueList: pick(0),
          xnyZclList: pick(5),
          sxzList: pick(8),
          szzList: pick(11),
          xxzList: pick(13),
          // 在线容量随档位 scale 推导（golden 全集护栏校准：CC_SW 档真实在线容量 ~1e3 量级，
          // 硬编码 3 万会把小容量档的数值域顶穿）
          forecastOnlineCapList: dates.map((_, i) => 500 + Math.round(scale * 250) + Math.round(Math.abs(Math.sin(i / 5)) * Math.round(scale * 60))),
          actualOnlineCapList: dates.map((_, i) => 500 + Math.round(scale * 260) + Math.round(Math.abs(Math.cos(i / 6)) * Math.round(scale * 55)))
        }
      }
    }
    if (m.startsWith('getAveragePriceChart') || /^[0-9a-f]+$/.test(m)) {
      // 变体 token（'001' 等）也产出有效曲线——否则 35 个并行变体会落入通用兜底，
      // 每个生成数 MB 的无用行集，同步序列化阻塞主线程（洞察页卡顿根因）
      const hashToken = m.startsWith('getAveragePriceChart') ? (m.split('__')[1] ?? '0') : m
      const idx = parseInt(hashToken, 16) || 0
      const day = dateStr(-(idx % 35))
      const da = curve96('price', `console-da:${day}`, day)
      // 实时 = 日前 + 均值为零的小抖动：diffPriceList/diffPriceTotal 才与真实件同量级
      // （真实日均价的 diff 总量接近 0，独立双曲线求和会漂出数千——golden 全集护栏抓到）
      const wiggle = mulberry32(seedOf(`console-avg-rt:${day}`))
      const rt = da.map((v) => Math.round((v + (wiggle() - 0.5) * 90) * 10) / 10)
      const diff = rt.map((v, i) => Math.round((v - da[i]) * 10) / 10)
      return {
        data: {
          value: day,
          dayTime: day,
          days: 1,
          minPrice: Math.round(Math.min(...da) - 10),
          maxPrice: Math.round(Math.max(...da) + 10),
          minDiffPrice: -60,
          maxDiffPrice: 60,
          diffPriceTotal: Math.round(diff.reduce((s, v) => s + v, 0) * 10) / 10,
          dayAheadPriceList: da,
          dayAheadPriceList2: da.map((v) => Math.round(v * 0.97 * 10) / 10),
          realTimePriceList: rt,
          diffPriceList: diff
        }
      }
    }
    // 天气列表（getWeatherList）：cols=列定义（label/prop），tableData=按 prop 键的逐日天气行
    if (m === 'getWeatherList') {
      const utf8Hex = (text: string) => Array.from(new TextEncoder().encode(text)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
      const cities = ['太原', '晋中', '忻州', '大同', '朔州', '吕梁', '临汾', '运城', '长治', '晋城', '阳泉']
      const weatherRand = mulberry32(seedOf(`console-weather:${dateFrom}`))
      const condText = ['晴', '多云', '阴', '小雨', '阵雨']
      const cols = cities.map((city) => ({ label: city, prop: `city_${utf8Hex(city)}` }))
      cols.push({ label: '日期', prop: 'dateIYOtQ9u-KKRHcLR__cQB-' }, { label: '星期', prop: 'weekIYOtQ9u-KKRHcLR__cQB-' })
      const tableData = Array.from({ length: 15 }, (_, row) => {
        const record: Record<string, unknown> = {
          'dateIYOtQ9u-KKRHcLR__cQB-': String((row % 28) + 1).padStart(2, '0'),
          'weekIYOtQ9u-KKRHcLR__cQB-': ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][row % 7]
        }
        for (const city of cities) {
          const high = 24 + Math.round(weatherRand() * 12)
          record[`city_${utf8Hex(city)}`] = {
            date: `${dateStr(0)}T00:00:00.000+08:00`,
            cityName: city,
            codeDay: String(1 + Math.floor(weatherRand() * 15)),
            textDay: condText[Math.floor(weatherRand() * condText.length)],
            high,
            low: high - (6 + Math.round(weatherRand() * 5)),
            windScale: 1 + Math.floor(weatherRand() * 4)
          }
        }
        return record
      })
      return { data: { cols, tableData } }
    }
    // 未识别的 sdpt_console match：轻量空载荷（严禁落入通用行集——数 MB 垃圾序列化会阻塞主线程）
    return { data: {} }
  }
  // 市场归因面板（loadMarketAnalysis）：9 个族 key 并行拉取后仅采纳 captured 行，
  // 非 captured 一律回落面板内置合成数据集——因此这里返回空行集即可（零载荷成本，
  // 面板图表由内置数据集渲染），严禁落入通用行集（数 MB × 9 并发会阻塞主线程数秒）。
  if (family === 'market_analysis' || family === 'market_retail_packages') {
    return { data: [], rows: [] }
  }
  // 日前电量预估（sdpt_zptqx/list：rows 过滤 type=4 行 → 表格 + 96 点曲线）
  if (family === 'sdpt_zptqx') {
    const rows = ['日前电量预估', '修正电量预估', '上月同日预估'].map((label, t) => {
      const c = curve96('output', `zptqx:${label}:${t}:${dateFrom}`, dateFrom)
      const hj = Math.round((c.reduce((s, v) => s + v, 0) / 4) * 100) / 100
      return {
        id: t + 1,
        provId: 1,
        sdgs: '山西演示发电集团',
        sdgsId: 1,
        khlx: '1',
        week: '周一',
        czry: '演示交易员',
        czsj: `${dateFrom} 09:30:00`,
        total: hj,
        beizhu: '',
        type: '4',
        date: dateFrom,
        label,
        hj,
        ...pFields(c, 96)
      }
    })
    return { rows, data: rows, total: rows.length, code: 200, msg: 'ok', _match: match }
  }
  // 日前上报（sdpt_zrqsb：match=运行日 → 分组 96 点文档，dl/jg/jgc/zcqjj/策略组）
  if (family === 'sdpt_zrqsb') {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(match) ? match : (dates[0] ?? dateStr(0))
    // 行元数据与真实件同形（全集护栏比对键集合）：操作痕迹 + 归属 + 查询口径
    const rowMeta = (extra: Record<string, unknown> = {}) => ({
      czsj: `${day} 09:30:00`,
      prov_id: 1,
      sdgs_id: 'sdgs-demo',
      date: day,
      khlx: '1',
      riqi: day,
      czry: '演示交易员',
      queryDate: day,
      ...extra
    })
    const groupRows = (kind: CurveKind, salt: string, scale: number, withTypes: number[]) =>
      withTypes.map((t, gi) => {
        const c = curve96(kind, `zrqsb:${salt}:${t}:${day}`, day)
        return {
          id: gi + 1,
          type: String(t),
          hj: Math.round((c.reduce((s, v) => s + v, 0) / 4) * 100) / 100,
          ...rowMeta(t === 0 ? { sdgs: '山西演示发电集团', total: Math.round(c.reduce((s, v) => s + v, 0) * 1000) / 1000 } : {}),
          ...pFields(c, 96)
        }
      })
    const daPrice = curve96('price', `zrqsb-da:${day}`, day)
    const rtPrice = curve96('price', `zrqsb-rt:${day}`, day)
    const jgcRow = (() => {
      const c = rtPrice.map((v, i) => Math.round((v - daPrice[i]) * 10) / 10)
      return {
        id: 1,
        type: '0',
        heji: Math.round(c.reduce((s, v) => s + v, 0) * 100) / 100,
        hj: Math.round((c.reduce((s, v) => s + Math.abs(v), 0) / 96) * 100) / 100,
        ...pFields(c, 96)
      }
    })()
    // ccbl = 出清比例（96 点 4 段重复的小时值），audioRQSB = 上报音频标志位（真实件 "0"/"1"）
    const ccblValue = daPrice.map((v, i) => Math.round((80 + (i % 4) * 3.2 + (v % 37)) * 100) / 100)
    return {
      data: {
        audioRQSB: '0',
        ccbl: {
          key: { ccblHeji: Math.round(ccblValue.reduce((s, v) => s + v, 0) / 96 * 100) / 100 },
          value: ccblValue
        },
        xjfw: [],
        clqx: '1',
        dl: groupRows('output', 'dl', 1, [0, 1]),
        jg: [0, 1].map((t, gi) => {
          const c = curve96('price', `zrqsb-jg:${t}:${day}`, day)
          return {
            id: gi + 1,
            type: String(t),
            prov_id: 1,
            jk_type: '1',
            jz: Math.round((c.reduce((s, v) => s + v, 0) / 96) * 100) / 100,
            drrq: day,
            rksj: `${day} 09:30:00`,
            date: day,
            hj: Math.round((c.reduce((s, v) => s + v, 0) / 96) * 100) / 100,
            ...pFields(c, 96)
          }
        }),
        jgc: [jgcRow],
        zcqjj: [(() => {
          const c = curve96('load', `zrqsj-zcqjj:${day}`, day)
          return {
            id: 1,
            type: '0',
            sjlx: 1,
            jylx: '1',
            bdrq1: day,
            bdrq2: day,
            jyrq: day,
            hj: Math.round((c.reduce((s, v) => s + v, 0) / 4) * 100) / 100,
            ...pFields(c, 96)
          }
        })()],
        jq: groupRows('price', 'jq', 1, [0, 1]),
        jq2: groupRows('price', 'jq2', 1, [0]),
        cl: groupRows('load', 'cl', 1, [0]),
        zxcl: groupRows('renewable', 'zxcl', 1, [0])
      }
    }
  }
  // 中长期分时（sdpt_zfsdjy）：持仓量监控月/日两图 + 分时段交易台账
  if (family === 'sdpt_zfsdjy') {
    const seriesObj = (name: string, valueList: Array<number | null>) => ({ name, valueList })
    // 分时段交易台账（list）：13 个交易日 × 成交电量/出清电价/持仓电量 = 39 行，24 点
    if (match === 'list') {
      const companies = ['山西演示售电有限公司', '演示售电二号公司', '演示售电三号公司']
      const jylxByDay = ['11', '12', '170', '52', '191', '11', '12', '170', '52', '191', '11', '12', '170']
      const sjlxRows = [
        { sjlx: '23', kind: 'output' as CurveKind, scale: 1 },
        { sjlx: '24', kind: 'price' as CurveKind, scale: 1 },
        { sjlx: '51', kind: 'output' as CurveKind, scale: 0.62 }
      ]
      const rows: Array<Record<string, unknown>> = []
      let idx = 0
      for (let d = 0; d < 13; d++) {
        const jyrq = dateStr(-45 + d * 2)
        for (const spec of sjlxRows) {
          idx++
          const curve = curve96(spec.kind, `zfsdjy:${d}:${spec.sjlx}`, jyrq)
          // 行水平因子（C.22）：每笔成交相对基准曲线有 ±14% 的日间起伏
          const rowLevel = dayLevel(`zfsdjy:${spec.sjlx}`, `${jyrq}:${d}`)
          const hourly = Array.from({ length: 24 }, (_, h) => Math.round(curve[h * 4] * spec.scale * rowLevel * 10) / 10)
          const sum = hourly.reduce((s, v) => s + v, 0)
          rows.push({
            sdgs: companies[d % 3],
            jyrq,
            bdrq1: jyrq,
            bdrq2: addDays(jyrq, 1),
            jylx: jylxByDay[d],
            sjlx: spec.sjlx,
            czry: '演示交易员',
            czsj: `${jyrq} 09:3${idx % 10}:00`,
            heji: spec.sjlx === '24' ? Math.round((sum / 24) * 100) / 100 : Math.round(sum * 10) / 10,
            ...pFields(hourly, 24)
          })
        }
      }
      return { data: rows, rows, total: rows.length }
    }
    // 持仓量监控·月维度（ccljkDay__<月>）：nameList=当月逐日，bar 持仓电量 + 合计/最大/均价线
    if (match.startsWith('ccljkDay__')) {
      const month = /^\d{4}-\d{2}$/.test(match.slice(10)) ? match.slice(10) : dateStr(0).slice(0, 7)
      const [y, m] = month.split('-').map(Number)
      const days = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
      // 日持仓（C.22）：日水平因子 0.86–1.14（周末 −8%）+ 8% 概率的调整日 ±10%。
      // 纯逐点抖动取日均会被抵消成近似直线，乘日水平因子后柱间有真实起伏、又不过分跳变。
      const dailyEnergy = (salt: string, share: number) => days.map((d) => {
        const r = mulberry32(seedOf(`ccljk:${salt}:${d}`))
        const event = r() < 0.08 ? 1 + (r() - 0.5) * 0.2 : 1
        return Math.round(9600 * share * dayLevel(salt, d) * event * 10) / 10
      })
      const ltr = dailyEnergy('ltr', 1)
      const rq = dailyEnergy('rq', 0.34)
      const ss = dailyEnergy('ss', 0.22)
      const ld = dailyEnergy('ld', 0.09)
      const total = ltr.map((v, i) => Math.round((v + rq[i] + ss[i] + ld[i]) * 10) / 10)
      return {
        data: {
          nameList: days,
          value01: seriesObj('中长期持仓电量', ltr),
          value02: seriesObj('日前持仓电量', rq),
          value03: seriesObj('实时持仓电量', ss),
          value04: seriesObj('绿电持仓电量', ld),
          value05: seriesObj('合计电量', total),
          value06: seriesObj('最大持仓电量', total.map((v) => Math.round(v * 1.12 * 10) / 10)),
          value07: seriesObj('持仓均价', days.map((d) => {
            const c = curve96('price', `ccljk-price:${d}`, d)
            return Math.round((c.reduce((s, v) => s + v, 0) / 96) * 10) / 10
          }))
        }
      }
    }
    // 持仓量监控·日维度（ccljkTime__<日>）：nameList=24 时点，柱 + 合计/预估/均价线
    if (match.startsWith('ccljkTime__')) {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(match.slice(11)) ? match.slice(11) : dateStr(-1)
      // 三类持仓分时形态各异（C.22）：双边=基荷平坦、月内集中=白天高原、日滚动=晚峰为主，
      // 各自叠加日水平因子与逐点 ±5% 抖动——避免三条同形曲线只差平移的复制感
      const rand = mulberry32(seedOf(`ccljkt:${day}`))
      const level = dayLevel('ccljkt', day)
      const base = 210 // MWh/h 量级（演示公司口径）
      const bell = (center: number, width: number) => (h: number) => Math.exp(-((h - center) ** 2) / width)
      const hourly = (shape: (h: number) => number) => Array.from({ length: 24 }, (_, h) =>
        Math.max(0, Math.round(base * shape(h) * level * (0.95 + rand() * 0.1) * 10) / 10))
      const sb = hourly(() => 1.02)
      const jn = hourly((h) => 0.62 + 0.42 * bell(11, 16)(h) + 0.3 * bell(16, 22)(h))
      const rg = hourly((h) => 0.34 + 0.62 * bell(19.5, 7)(h) + 0.18 * bell(10, 10)(h))
      return {
        data: {
          nameList: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
          value01: seriesObj('双边持仓电量', sb),
          value02: seriesObj('月内集中持仓电量', jn),
          value03: seriesObj('日滚动持仓电量', rg),
          value04: seriesObj('合计电量', sb.map((v, i) => Math.round((v + jn[i] + rg[i]) * 10) / 10)),
          value05: seriesObj('日滚动预估', rg.map((v) => Math.round(v * (0.97 + rand() * 0.06) * 10) / 10)),
          value06: seriesObj('持仓均价', (() => {
            const c = curve96('price', `ccljkt-jj:${day}`, day)
            return Array.from({ length: 24 }, (_, h) => Math.round(c[h * 4] * 10) / 10)
          })())
        }
      }
    }
  }
  // 省间中长期电量计划（sdpt_zptjg list_tag92_full）：{date,drrq,jz,hj,p1..p96} 逐日 96 点计划行
  if (family === 'sdpt_zptjg' && match.includes('tag92')) {
    // 逐日形状漂移（C.22）：峰位/峰宽/爬坡斜率/夜间平台逐日独立抽样 + 日水平因子 + 逐点
    // ±4% 抖动——30 天不再是一组只差平移的同形曲线，起伏有界（夜间 ~140–200、午峰 ~440–530）
    const rows = dates.map((date) => {
      const w = mulberry32(seedOf(`zptjg-warp:${date}`))
      const peakH = 11.5 + w() * 3
      const width = 5.2 + w() * 2.4
      const ramp = 0.78 + w() * 0.44
      const night = 140 + w() * 60
      const amp = 300 + w() * 90
      const level = dayLevel('zptjg', date)
      const pts = Array.from({ length: 96 }, (_, s) => {
        const h = s / 4
        const shape = night + amp * Math.exp(-((h - peakH) ** 2) / width) * (h < peakH ? ramp : 1)
        return Math.round(Math.max(0, shape * level * (0.96 + w() * 0.08)) * 10) / 10
      })
      return {
        date,
        drrq: addDays(date, 1),
        jz: Math.round((pts.reduce((s, v) => s + v, 0) / 96) * 100) / 100,
        hj: Math.round(pts.reduce((s, v) => s + v, 0) * 10) / 10,
        ...pFields(pts, 96)
      }
    })
    return { data: rows, rows, total: rows.length }
  }
  // 云南专用族保留（地区切换后仍可对照演示）
  if (family === 'yn_system_forecast' && match.includes('user_price')) {
    const rt = match.includes('rt')
    const rows = dates.flatMap((date) =>
      hourlyPrice24(match, date).map((value, h) => ({
        operateDate: date,
        timePoint: `${String(h).padStart(2, '0')}:00`,
        value: rt ? Math.round(value * 1.06 * 10) / 10 : value
      }))
    )
    return { data: rows, rows, total: rows.length }
  }
  // 空间资产演示族（气象/辐照/as-of/出力）：消费方为 weatherImpact / plantOutputClient
  // 的演示会话分支（isMockActive 放行 mock 信封），行契约见 gridGeo/weatherImpact.ts。
  const gridRegion = ctx.url.searchParams.get('region') ?? gridDemoRegionId()
  if (family === 'mock_grid_plant_output') {
    const rows = gridDemoOutputRows(dates)
    return { data: rows, rows, total: rows.length }
  }
  if (family === 'mock_grid_meteo') {
    const rows = gridDemoMeteoRows(dates, gridRegion)
    return { data: rows, rows, total: rows.length }
  }
  if (family === 'mock_grid_irradiance') {
    const rows = gridDemoIrradianceRows(dates, gridRegion)
    return { data: rows, rows, total: rows.length }
  }
  if (family === 'weather_asof') {
    const rows = gridDemoAsOfRows(dates, gridRegion)
    return { data: rows, rows, total: rows.length }
  }
  // 通用族：逐点行（value/timePoint），已知 p 字段契约的族均有专用分支
  const kind = /load|fzqhd|负荷/.test(family + match)
    ? 'load'
    : /renewable|zgnr|新能源|output|出力/.test(family + match)
      ? 'renewable'
      : 'price'
  let rows = dates.flatMap((date) => {
    const curve = curve96(kind, `${family}:${match}:${date}`, date)
    return TIME_AXIS_96.map((timePoint, i) => ({
      operateDate: date,
      operate_date: date,
      date,
      timePoint,
      time: timePoint,
      value: curve[i]
    }))
  })
  const limit = Number(ctx.url.searchParams.get('limit') ?? 0)
  if (limit > 0 && rows.length > limit) rows = rows.slice(-limit)
  return { data: rows, rows, total: rows.length, _filter: { total: rows.length, returned: rows.length, truncated: rows.length < limit ? false : dates.length * 96 > limit } }
}

/**
 * 采集族取数：**fixtures（真实采集回放件）优先，合成器兜底**（PRD 附录 C.19）。
 * fixtures 命中时原样供出采集文件的原始载荷（含 data 容器与平台字段），capturedAt 用
 * 侧车真实采集时刻——日期覆盖窗口、曲线统计特征与真实有数账号一致；未命中（窗口外
 * 日期、未携带族、dataDet 未采样 id 等）回落 capturedPayload 合成器，保持页面永不空转。
 * 两条路径都走「管道可消费」演示信封，诚实标注由会话徽标 + x-data-mock 头承担。
 */
/**
 * 合成器直连入口（golden 全集 spec 专用）：handleCaptured 在携带族上 fixtures-first，
 * 经 resolveMockRequest 拿到的"mock 侧"其实是 fixture 原件——等价断言会退化为
 * fixture-vs-fixture 空转（C.23 发现）。spec 用本函数绕开 fixtures-first，直接取
 * 合成器输出与 golden 采集件做结构等价对比。
 */
export function synthesizeCapturedPayload(family: string, match: string): Record<string, unknown> {
  return capturedPayload({
    method: 'GET',
    url: new URL(`http://localhost/api/real?family=${encodeURIComponent(family)}&match=${encodeURIComponent(match)}&region=shanxi`),
    body: {}
  })
}

async function handleCaptured(ctx: MockContext): Promise<Response> {
  const family = ctx.url.searchParams.get('family') ?? ''
  const match = ctx.url.searchParams.get('match') ?? ''
  const fixture = await loadFixturePayload(family, match)
  if (fixture) {
    return mockPipelineEnvelopeResponse({
      ...fixture.payload,
      family,
      datasetKey: match,
      ...(fixture.entry.capturedAt ? { capturedAt: fixture.entry.capturedAt } : {})
    })
  }
  const payload = capturedPayload(ctx)
  return mockPipelineEnvelopeResponse({
    ...payload,
    family,
    datasetKey: match,
    capturedAt: `${dateStr(0)}T00:00:00+08:00`
  })
}

// ---------------------------------------------------------------------------
// quant / forecast（裸 JSON 客户端）。
// 价格曲线优先取采集 fixtures 的真实日前/实时曲线（与驾驶舱/市场洞察同一天同值，跨页
// 一致），窗口外回落形态标定的合成曲线（generators PRICE_PROFILE_96）。
// ---------------------------------------------------------------------------

// 实时价对日前价做有界跟随（C.22）：|rt-da| 收敛到 max(35, 28%·da) 内。真实采集里实时
// 顶格平台（1500）对日前（~400）的价差柱会拉到 ±1000，整图只剩柱子；有界偏差保留形态
// 与告警空间，又不至于把日前曲线压成贴地直线。同为确定性函数（同输入恒同输出）。
function boundedFollow(da: number[], rtRaw: number[]): number[] {
  return rtRaw.map((v, i) => {
    const bound = Math.max(35, da[i] * 0.28)
    const dev = v - da[i]
    return Math.round((da[i] + Math.max(-bound, Math.min(bound, dev))) * 10) / 10
  })
}

async function quantMonitor(ctx: MockContext): Promise<Response> {
  const date = String(ctx.body.date ?? dateStr(0))
  const real = await loadRealDayCurve(date)
  const da = real.da ?? curve96('price', `da:${date}`, date)
  const rt = boundedFollow(da, real.rt ?? curve96('price', `rt:${date}`, date))
  const series = TIME_AXIS_96.map((time, i) => ({
    time,
    da: da[i],
    rt: Math.round(rt[i] * 10) / 10,
    spread: Math.round((rt[i] - da[i]) * 10) / 10
  }))
  // 傍晚尖峰（18–20.5 时）vs 午间光伏深谷（11:30–14.5 时）——山西鸭子曲线的真实峰谷窗口
  const peak = series.slice(72, 82).map((p) => p.da)
  const valley = series.slice(46, 58).map((p) => p.da)
  const avg = (arr: number[]) => Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10
  return mockJsonResponse({
    date,
    source: real.da ? 'capture-fixture' : 'mock-demo',
    spread_threshold: 60,
    price_basis: 'user_unified',
    price_note: real.da ? '演示数据（真实采集回放，Mock 演示账号）' : '演示数据（Mock 演示账号，不接真实数据）',
    series,
    alerts: [],
    peak_valley: {
      avg_price: { peak: avg(peak), flat: avg(series.slice(20, 36).map((p) => p.da)), valley: avg(valley) },
      peak_valley_spread: Math.round((avg(peak) - avg(valley)) * 10) / 10,
      spread_ratio: Math.round((avg(peak) / Math.max(1, avg(valley))) * 10) / 10
    }
  })
}

// 中长期敞口（C.22 重写）：series 为「当月逐日 × 24 小时」逐时序列（前端敞口热力图按
// floor(i/24)×i%24 映射日×时，逐日 30 点会把热力挤成两天）。合同分解按 mode 给小时权重
// （uniform/peak_valley/solar_shaped），预计出力按 expected_source 给形状（renewable 午间
// 单峰/load 双峰），逐日叠加日水平因子（新能源日另抽云量 0.55–1.15）与逐点抖动——
// 替代两条正弦的解析曲线，起伏有界（±14% 日间、±4% 逐点）。
function quantExposure(ctx: MockContext): Response {
  const month = /^\d{4}-\d{2}$/.test(String(ctx.body.month)) ? String(ctx.body.month) : dateStr(0).slice(0, 7)
  const mode = ['uniform', 'peak_valley', 'solar_shaped'].includes(String(ctx.body.mode)) ? String(ctx.body.mode) : 'peak_valley'
  const expectedSource = String(ctx.body.expected_source) === 'load' ? 'load' : 'renewable'
  const contractTotal = Math.max(1, Number(ctx.body.total_mwh) || 7200)
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const monthDates = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  const contractWeight = (h: number) => {
    if (mode === 'uniform') return 1
    if (mode === 'solar_shaped') return 1 + 1.35 * Math.exp(-((h - 13) ** 2) / 9)
    return h >= 8 && h < 21 ? 1.45 : 0.66 // peak_valley：峰段 08–21 时
  }
  const expectedShape = (h: number) => {
    if (expectedSource === 'load') {
      return 0.72 + 0.5 * Math.exp(-((h - 11) ** 2) / 14) + 0.35 * Math.exp(-((h - 20) ** 2) / 8)
    }
    return Math.max(0.02, Math.sin(((h - 6.5) / 13) * Math.PI)) // 新能源：午间单峰
  }
  // 各自按 24h 均值归一，小时基准电量 = 月合同总量 / (天数×24)
  const mean = (fn: (h: number) => number) => Array.from({ length: 24 }, (_, h) => fn(h)).reduce((s, v) => s + v, 0) / 24
  const cwNorm = 1 / mean(contractWeight)
  const esNorm = 1 / mean(expectedShape)
  const baseHour = contractTotal / (days * 24)
  const rand = mulberry32(seedOf(`exposure:${month}:${mode}:${expectedSource}`))
  const jitter = () => 1 + (rand() - 0.5) * 0.08
  const series: Array<{ datetime: string; contracted: number; expected: number; gap: number }> = []
  let contractedSum = 0
  let expectedSum = 0
  let sellExposure = 0
  let buyExposure = 0
  for (const date of monthDates) {
    const level = dayLevel(`exp:${expectedSource}`, date)
    const cloud = expectedSource === 'renewable' ? 0.78 + rand() * 0.5 : 1
    for (let h = 0; h < 24; h++) {
      const contracted = Math.max(0, baseHour * contractWeight(h) * cwNorm * jitter())
      const expected = Math.max(0, baseHour * expectedShape(h) * esNorm * level * cloud * jitter())
      const gap = Math.round((expected - contracted) * 10) / 10
      const c = Math.round(contracted * 10) / 10
      const e = Math.round(expected * 10) / 10
      contractedSum += c
      expectedSum += e
      if (gap >= 0) sellExposure += gap
      else buyExposure -= gap
      series.push({ datetime: `${date} ${String(h).padStart(2, '0')}:00`, contracted: c, expected: e, gap })
    }
  }
  const round1 = (v: number) => Math.round(v * 10) / 10
  return mockJsonResponse({
    month,
    mode,
    total_mwh: round1(contractedSum),
    hedge_ratio: Math.round((contractedSum / Math.max(1, expectedSum)) * 1000) / 1000,
    spot_sell_exposure_mwh: round1(sellExposure),
    spot_buy_exposure_mwh: round1(buyExposure),
    interpretation: `演示口径：合同按 ${mode === 'uniform' ? '均匀' : mode === 'peak_valley' ? '峰平谷' : '光伏跟踪'}分解，预计出力取${expectedSource === 'renewable' ? '新能源（午间大发时段系统性卖出敞口）' : '负荷（晚峰时段买入敞口）'}形状，覆盖约 ${Math.round((contractedSum / Math.max(1, expectedSum)) * 100)}%。`,
    daily_mwh: round1(contractedSum / days),
    source: 'mock-demo',
    warning: '演示数据（Mock 演示账号，不接真实数据）',
    series
  })
}

// 复盘六维主数据（ReviewResult）：申报/实际双曲线 + 偏差 + 回测；价格取采集 fixtures 的
// 真实日前/实时曲线（与驾驶舱/监盘同日同值，实时按 boundedFollow 有界跟随），窗口外回落
// 标定合成曲线。实际电量 = 申报 × 逐点 ±4% 扰动 + 一个 ±12% 的短时少发/超发事件窗口
// （C.22）：偏差可见但不失真，替代两条同形正弦的复制感。
async function quantReview(ctx: MockContext): Promise<Response> {
  const date = String(ctx.body.date ?? dateStr(-1))
  const real = await loadRealDayCurve(date)
  const declared = curve96('output', `review-declared:${date}`, date).map((v) => Math.round(v * dayLevel('review-decl', date) * 10) / 10)
  const drift = mulberry32(seedOf(`review-actual:${date}`))
  const evtStart = 24 + Math.floor(drift() * 48)
  const evtLen = 4 + Math.floor(drift() * 5)
  const evtFactor = drift() < 0.5 ? 0.88 : 1.12
  const actual = declared.map((v, i) => {
    const wobble = 0.96 + drift() * 0.08
    const factor = i >= evtStart && i < evtStart + evtLen ? evtFactor : 1
    return Math.round(Math.max(0, v * wobble * factor) * 10) / 10
  })
  const daPrice = real.da ?? curve96('price', `review-da:${date}`, date)
  const rtPrice = boundedFollow(daPrice, real.rt ?? curve96('price', `review-rt:${date}`, date))
  const detail = TIME_AXIS_96.map((time, i) => ({
    datetime: `${date} ${time}:00`,
    declared: declared[i],
    actual: actual[i],
    deviation: Math.round((actual[i] - declared[i]) * 10) / 10,
    assessed_mwh: Math.max(0, Math.round((Math.abs(actual[i] - declared[i]) - 2) * 10) / 10),
    da_price: daPrice[i],
    rt_price: rtPrice[i]
  }))
  const totalAbs = Math.round(detail.reduce((s, p) => s + Math.abs(p.deviation), 0) * 10) / 10
  const worst = detail.reduce((w, p) => (Math.abs(p.deviation) > Math.abs(w.deviation) ? p : w), detail[0])
  const avgDa = Math.round((daPrice.reduce((s, v) => s + v, 0) / 96) * 10) / 10
  return mockJsonResponse({
    date,
    source: real.da ? 'capture-fixture' : 'mock-demo',
    declared_source: 'declaration_order:MOCK-ORD-DM1',
    actual_source: 'mock-demo',
    caliber_caveats: ['演示数据：申报与实际为演示曲线，价格取真实采集回放，考核金额为演示口径，非结算依据'],
    warning: '演示模式（Mock 演示账号，不接真实数据）',
    deviation: {
      points: 96,
      total_abs_deviation_mwh: totalAbs,
      assessed_mwh: Math.round(totalAbs * 0.35 * 10) / 10,
      estimated_penalty_yuan: Math.round(totalAbs * 0.35 * 320),
      tolerance_pct: Number(ctx.body.tolerance_pct ?? 5),
      worst_point: { datetime: worst.datetime, deviation: worst.deviation }
    },
    backtest: {
      points: 96,
      da_revenue_yuan: Math.round(detail.reduce((s, p) => s + p.declared * (p.da_price ?? 0), 0) / 4),
      avg_da_price: avgDa,
      da_rt_spread_pnl_yuan: 18_600,
      note: '演示口径：日前出清收入按演示价格曲线估算'
    },
    detail
  })
}

// 预测曲线：以目标日真实日前价为基线叠加 ±3% 模型噪声（预测对比图形态与真实出清一致），
// 采集窗口外回落标定合成曲线；区间带随基线幅度缩放（真实价差大时带宽随之收放）。
async function forecastBaseCurve(source: string, targetDate: string): Promise<{ points: number[]; real: boolean }> {
  const real = await loadRealDayCurve(targetDate)
  if (real.da) {
    const noise = mulberry32(seedOf(`predict-noise:${source}:${targetDate}`))
    const points = real.da.map((v) => Math.round(v * (0.97 + noise() * 0.06) * 10) / 10)
    return { points, real: true }
  }
  return { points: curve96('price', `${source}:${targetDate}`, targetDate), real: false }
}

async function forecastPredict(ctx: MockContext): Promise<Response> {
  const targetDate = String(ctx.body.target_date ?? dateStr(1))
  const modelType = String(ctx.body.model_type ?? 'knn')
  const { points, real } = await forecastBaseCurve(`predict:${modelType}`, targetDate)
  return mockJsonResponse({
    available: true,
    target_date: targetDate,
    model_id: `mock_${modelType}`,
    points,
    lower: points.map((v) => Math.max(0, Math.round((v - 38) * 10) / 10)),
    upper: points.map((v) => Math.round((v + 44) * 10) / 10),
    basis: 'forecast',
    mock: true,
    predicted_at: new Date().toISOString(),
    metrics: { mae: 38.6, rmse: 51.2, naive_mae: 55.4, knn_mae: 42.9, passes_gate: true, n_test_days: 15, beats_naive: true },
    ...(real ? { source: 'capture-fixture' } : {})
  })
}

async function forecastLatest(ctx: MockContext): Promise<Response> {
  const targetDate = ctx.url.searchParams.get('target_date') ?? dateStr(1)
  const { points } = await forecastBaseCurve('fc', targetDate)
  return mockJsonResponse({
    available: true,
    target_date: targetDate,
    runs: [{
      model_id: 'mock_da_price_lgbm',
      model_version: 'v1.0-demo',
      status: 'ok',
      points,
      lower: points.map((v) => Math.max(0, Math.round((v - 38) * 10) / 10)),
      upper: points.map((v) => Math.round((v + 44) * 10) / 10),
      predicted_at: new Date().toISOString(),
      basis: 'demo',
      mock: true
    }]
  })
}

async function spreadSeries(ctx: MockContext): Promise<Response> {
  const date = ctx.url.searchParams.get('date') ?? dateStr(0)
  const real = await loadRealDayCurve(date)
  const da = real.da ?? curve96('price', `spread-da:${date}`, date)
  const rt = real.rt ?? curve96('price', `spread-rt:${date}`, date)
  return mockJsonResponse({
    date, source: real.da ? 'capture-fixture' : 'mock-demo', threshold: 60, mock: true,
    series: TIME_AXIS_96.map((time, i) => ({ time, da: da[i], rt: Math.round(rt[i] * 10) / 10, spread: Math.round((rt[i] - da[i]) * 10) / 10 })),
    alerts: [], positive_mwh: 412, negative_mwh: 286
  })
}

// ---------------------------------------------------------------------------
// 盯盘告警（alertClient：/agent-api/agent/alerts，裸 JSON 客户端）。
// 契约红线：响应体必须带 alerts 数组——alertClient 原样透传 JSON，此前走未匹配
// 兜底空信封时 alerts 键缺失，风控阈值面板读到 undefined.length 使整页渲染冻结。
// ---------------------------------------------------------------------------

type MockAlert = {
  id: string
  ts: number
  kind: string
  severity: 'high' | 'medium' | 'low'
  region_id: string
  region_name: string
  title: string
  detail: string
  basis: string
  status: 'open'
}

const mockAlertStore: MockAlert[] = [
  {
    id: 'mock-alert-1',
    ts: Date.now() - 42 * 60_000,
    kind: 'spread',
    severity: 'high',
    region_id: 'shanxi',
    region_name: '山西',
    title: '实时-日前价差越限',
    detail: '09:45 时点价差 128.4 元/MWh，超过阈值 80 元/MWh（演示数据）',
    basis: '价差异动哨兵',
    status: 'open'
  },
  {
    id: 'mock-alert-2',
    ts: Date.now() - 118 * 60_000,
    kind: 'deviation',
    severity: 'medium',
    region_id: 'shanxi',
    region_name: '山西',
    title: '申报偏差越限',
    detail: '12:15 时点申报偏差 -18.6 MWh，超出 ±5% 免考核带（演示数据）',
    basis: '申报偏差哨兵',
    status: 'open'
  },
  {
    id: 'mock-alert-3',
    ts: Date.now() - 5 * 60 * 60_000,
    kind: 'renewable',
    severity: 'low',
    region_id: 'shanxi',
    region_name: '山西',
    title: '新能源出力偏离预测',
    detail: '午间时段实际出力低于预测约 12%，注意调整日前申报（演示数据）',
    basis: '出力跟踪哨兵',
    status: 'open'
  }
]

function alertListHandler(): Response {
  return mockJsonResponse({ alerts: mockAlertStore, open_count: mockAlertStore.length })
}

// ---------------------------------------------------------------------------
// 智能体（会话/SSE/历史）
// ---------------------------------------------------------------------------

function agentSessionCreate(ctx: MockContext): Response {
  const scenario = String(ctx.body.scenario ?? 'chat')
  return mockJsonResponse({
    id: mockAgentSessionId(scenario),
    scenario,
    title: String(ctx.body.title || '演示会话'),
    status: 'idle'
  })
}

function agentMessage(ctx: MockContext): Response {
  const question = String(ctx.body.message ?? ctx.body.content ?? ctx.body.text ?? ctx.body.prompt ?? '')
  return mockAgentStreamResponse(question)
}

function agentStream(): Response {
  return mockAgentStreamResponse('演示续流')
}

function historyHandler(ctx: MockContext): Response {
  if (ctx.method === 'GET' && ctx.url.pathname.endsWith('/sessions')) {
    return mockEnvelopeResponse({ data: [] })
  }
  if (ctx.method === 'GET') {
    return mockEnvelopeResponse({ data: { id: 'mock', scenario: 'chat', turns: [] } })
  }
  return mockEnvelopeResponse({ data: {} })
}

// 复盘事件库 / 决策日志演示数据（形状对齐 decisionLogApi.coerceEntry / reviewStoreApi 的
// coercion 契约：缺哈希/缺字段会被前端整行丢弃，宁可少不可错）。
function chainHashDemo(key: string): string {
  return (seedOf(`mock-chain:${key}`) >>> 0).toString(16).padStart(8, '0')
}

const decisionLogRows = (() => {
  const specs = [
    { targetDate: dateStr(-1), decisionPoint: '日前申报定价', judgement: '晚峰段报价上浮 8%，博弈容量紧张行情', rationale: '晚峰连续三日触及 430 元/MWh，边际成本约 320 元/MWh，上浮仍具竞争力', p10: 300, p50: 430, p90: 620, confidence: 0.7 },
    { targetDate: dateStr(-2), decisionPoint: '午间低谷买入窗口', judgement: '午间光伏大发段按底价申报购入', rationale: '11–14 时均价 60 元/MWh 附近，现货买入成本显著低于中长期均价 232 元/MWh', p10: 30, p50: 62, p90: 120, confidence: 0.8 },
    { targetDate: dateStr(-3), decisionPoint: '中长期补仓节奏', judgement: '暂缓月内集中交易，等待月末流动性', rationale: '持仓覆盖 62% 已达下限，月末价差收益不足以覆盖敞口成本', p10: 210, p50: 240, p90: 280, confidence: 0.6 }
  ]
  let prev = 'GENESIS'
  return specs.map((spec, i) => {
    const hash = chainHashDemo(`dl-${i}`)
    const row = {
      id: `mock-dl-${i + 1}`,
      seq: i + 1,
      at: `${spec.targetDate}T09:${String(10 + i * 5).padStart(2, '0')}:00+08:00`,
      ...spec,
      author: '演示交易员',
      correctionOf: null,
      prevHash: prev,
      hash,
      actual: null,
      lesson: null
    }
    prev = hash
    return row
  })
})()

const improvementActionRows = [
  { id: 'mock-ia-1', action: '午间低谷段申报基价改为随光伏出力预测动态浮动', owner: '演示交易员', dueDate: dateStr(7), status: 'open', updatedAt: `${dateStr(-1)}T18:00:00+08:00` },
  { id: 'mock-ia-2', action: '晚峰报价上限从限价 90% 收敛到 80%，降低末段成交失败率', owner: '演示交易负责人', dueDate: dateStr(-2), status: 'done', updatedAt: `${dateStr(-2)}T17:30:00+08:00` },
  { id: 'mock-ia-3', action: '建立周末负荷下调 5% 的申报修正清单并逐项核对', owner: '演示分析师', dueDate: dateStr(3), status: 'open', updatedAt: `${dateStr(-3)}T16:00:00+08:00` },
  { id: 'mock-ia-4', action: '复盘报告模板补充「限价尖峰时段应对」章节', owner: '演示交易负责人', dueDate: dateStr(-5), status: 'carried_over', updatedAt: `${dateStr(-4)}T10:00:00+08:00` }
]

const riskEventRows = [
  { id: 'mock-re-1', eventTime: `${dateStr(-1)}T19:30:00+08:00`, eventType: '价差异动', riskLevel: 'high', impactYuan: 12_400, nearMiss: false },
  { id: 'mock-re-2', eventTime: `${dateStr(-2)}T12:15:00+08:00`, eventType: '申报偏差', riskLevel: 'medium', impactYuan: 3_200, nearMiss: false },
  { id: 'mock-re-3', eventTime: `${dateStr(-3)}T10:00:00+08:00`, eventType: '操作失误', riskLevel: 'low', impactYuan: null, nearMiss: true }
]

const reviewCaseRows = [
  { id: 'mock-case-1', caseNo: 'DEMO-2026-018', caseType: 'decision', title: '晚峰报价上浮博弈：兑现与偏差', visibility: 'internal', lessons: 'P50 定价贴近实况，但 P90 区间偏窄，未覆盖限价尖峰情景。', createdAt: `${dateStr(-1)}T18:30:00+08:00` },
  { id: 'mock-case-2', caseNo: 'DEMO-2026-014', caseType: 'deviation', title: '午间申报偏差 3.5% 免考核带边缘复盘', visibility: 'internal', lessons: '光伏实际出力低于预测 12% 的时段应触发人工复核清单。', createdAt: `${dateStr(-4)}T17:00:00+08:00` }
]

// ---------------------------------------------------------------------------
// 公司域 / 结算 / 通用兜底
// ---------------------------------------------------------------------------

const MOCK_COMPANIES = [
  { companyId: MOCK_COMPANY_ID, name: '山西演示能源集团有限公司', shortName: '山西演示集团', tier: 'GROUP', subjectTypes: ['GENERATOR', 'RETAILER', 'STORAGE'] },
  { companyId: 'comp-mock-gen-1', name: '山西演示发电一号有限公司', shortName: '演示发电一号', tier: 'COMPANY', parentCompanyId: MOCK_COMPANY_ID, subjectTypes: ['GENERATOR'] },
  { companyId: 'comp-mock-gen-2', name: '山西演示发电二号有限公司', shortName: '演示发电二号', tier: 'COMPANY', parentCompanyId: MOCK_COMPANY_ID, subjectTypes: ['GENERATOR'] },
  { companyId: 'comp-mock-retail', name: '山西演示售电有限公司', shortName: '演示售电', tier: 'COMPANY', parentCompanyId: MOCK_COMPANY_ID, subjectTypes: ['RETAILER'] }
]

function companyOptions(): Response {
  return mockEnvelopeResponse({ data: MOCK_COMPANIES, rows: MOCK_COMPANIES })
}

function companyRows(kind: string, ctx: MockContext): Response {
  const date = ctx.url.searchParams.get('date') ?? dateStr(0)
  if (kind === 'stations') {
    const rows = [
      { id: 1, companyId: MOCK_COMPANY_ID, name: '大同演示风电场', capacityMw: 300, energyType: 'WIND', regionCode: 'SX', province: '山西', status: 'ACTIVE' },
      { id: 2, companyId: MOCK_COMPANY_ID, name: '朔州演示光伏电站', capacityMw: 260, energyType: 'SOLAR', regionCode: 'SX', province: '山西', status: 'ACTIVE' },
      { id: 3, companyId: 'comp-mock-gen-1', name: '演示发电一号电厂', capacityMw: 660, energyType: 'THERMAL', regionCode: 'SX', province: '山西', status: 'ACTIVE' },
      { id: 4, companyId: 'comp-mock-gen-2', name: '演示发电二号电厂', capacityMw: 600, energyType: 'THERMAL', regionCode: 'SX', province: '山西', status: 'ACTIVE' }
    ]
    return mockEnvelopeResponse({ rows, data: rows, total: rows.length })
  }
  if (kind === 'units') {
    const rows = [1, 2, 3, 4, 5, 6].map((i) => ({
      id: i,
      companyId: MOCK_COMPANY_ID,
      stationId: (i % 2) + 1,
      name: `演示 ${i % 2 === 1 ? '风电' : '光伏'}机组 #${i}`,
      capacityMw: i % 2 === 1 ? 100 : 65,
      status: 'ACTIVE'
    }))
    return mockEnvelopeResponse({ rows, data: rows, total: rows.length })
  }
  if (kind === 'unit-output') {
    const curve = curve96('output', `unit:${date}`, date)
    const rows = [1, 2, 3].flatMap((unitId) =>
      TIME_AXIS_96.map((timePoint, i) => ({
        id: unitId * 1000 + i,
        unitId,
        operateDate: date,
        timePoint,
        outputMw: Math.round(curve[i] / 3 * 10) / 10
      }))
    )
    return mockEnvelopeResponse({ rows, data: rows, total: rows.length })
  }
  if (kind === 'profile') {
    const row = {
      companyId: MOCK_COMPANY_ID,
      name: '山西演示能源集团有限公司',
      shortName: '山西演示集团',
      tier: 'GROUP',
      regionCode: 'SX',
      province: '山西',
      address: '山西省太原市演示路 1 号',
      status: 'ACTIVE'
    }
    return mockEnvelopeResponse({ data: row, rows: [row] })
  }
  return mockEnvelopeResponse({ rows: [], data: [], total: 0 })
}

function fallbackResponse(ctx: MockContext): Response {
  mockStats.unmatched += 1
  console.warn(`[mock-demo] 未覆盖接口（返回空演示信封，不回源真实后端）: ${ctx.method} ${ctx.url.pathname}`)
  return mockEmptyEnvelopeResponse(ctx.method, ctx.url.pathname)
}

// ---------------------------------------------------------------------------
// 空间资产演示数据（/api/v1/grid/geo-assets/*，PRD R4：空间资产 8 子页可见可演示）
// 讲述线：演示集团 8 座场站 + 定价节点 + 授权网架 + 披露事件 + 格点天气。
// 坐标按当前地区中心平移（切地区后场站仍落在地图视口内）；ownerCompanyId/regionId
// 回显请求上下文，保证驾驶舱 mappingMatchesScope 等作用域校验通过。
// ---------------------------------------------------------------------------

const GRID_REGION_STORAGE_KEY = 'dljy.currentRegionId'
const GRID_SHANXI_CENTER: [number, number] = [112.4, 37.7]

const GRID_REGION_CENTERS: Record<string, [number, number]> = {
  shanxi: [112.4, 37.7], yunnan: [102.7, 25.0], sichuan: [104.0, 30.6],
  guangdong: [113.3, 23.1], guangxi: [108.3, 22.8], guizhou: [106.7, 26.6], hainan: [109.9, 19.2]
}

const GRID_PLANT_SPECS = [
  { id: 'mock-plt-01', name: '大同演示风电场', type: 'wind', mw: 300, lon: 113.62, lat: 40.05, ele: 1420, label: '大同市云州区', node: '大同演示定价节点' },
  { id: 'mock-plt-02', name: '朔州演示光伏电站', type: 'solar', mw: 260, lon: 112.72, lat: 39.52, ele: 1360, label: '朔州市平鲁区', node: '朔州演示定价节点' },
  { id: 'mock-plt-03', name: '忻州演示风电场', type: 'wind', mw: 200, lon: 111.84, lat: 38.91, ele: 1550, label: '忻州市五寨县', node: '忻州演示定价节点' },
  { id: 'mock-plt-04', name: '太原演示热电厂', type: 'thermal', mw: 660, lon: 112.53, lat: 37.68, ele: 810, label: '太原市清徐县', node: '太原演示定价节点' },
  { id: 'mock-plt-05', name: '吕梁演示水电厂', type: 'hydro', mw: 180, lon: 111.24, lat: 37.89, ele: 1130, label: '吕梁市方山县', node: '吕梁演示定价节点' },
  { id: 'mock-plt-06', name: '长治演示热电厂', type: 'thermal', mw: 600, lon: 113.23, lat: 36.33, ele: 740, label: '长治市潞城区', node: '长治演示定价节点' },
  { id: 'mock-plt-07', name: '运城演示光伏电站', type: 'solar', mw: 150, lon: 110.69, lat: 34.69, ele: 520, label: '运城市芮城县', node: '运城演示定价节点' },
  { id: 'mock-plt-08', name: '大同演示储能电站', type: 'storage', mw: 100, lon: 113.31, lat: 39.71, ele: 1290, label: '大同市新荣区', node: '大同储能演示节点' }
] as const

function gridDemoRegionId(): string {
  try { return window.localStorage.getItem(GRID_REGION_STORAGE_KEY) || 'shanxi' } catch { return 'shanxi' }
}

function gridDemoCompanyOf(ctx: MockContext): string {
  return ctx.url.searchParams.get('company') || MOCK_COMPANY_ID
}

function gridDemoOperatorOf(regionId: string): 'csg' | 'sgcc' {
  const operator = resolveGridOperatorProfile(regionId)?.region?.gridOperator
  return operator === 'csg' ? 'csg' : 'sgcc'
}

function gridDemoShifted(center: [number, number], lon: number, lat: number): [number, number] {
  return [
    Math.round((lon + center[0] - GRID_SHANXI_CENTER[0]) * 1000) / 1000,
    Math.round((lat + center[1] - GRID_SHANXI_CENTER[1]) * 1000) / 1000
  ]
}

function gridDemoNow(): string {
  return `${dateStr(0)}T08:00:00+08:00`
}

function gridDemoEvidence(title: string) {
  return [{ title, url: 'mock://grid-geo/evidence', publisher: '演示集团（Mock）', accessedAt: gridDemoNow() }]
}

function gridDemoLocation(spec: (typeof GRID_PLANT_SPECS)[number]) {
  const [lon, lat] = gridDemoShifted(gridDemoCenter(), spec.lon, spec.lat)
  return {
    longitude: lon,
    latitude: lat,
    elevationM: spec.ele,
    coordinateSystem: 'WGS84',
    locationLabel: spec.label,
    accuracyLevel: 'site',
    confidence: 'verified',
    uncertaintyMeters: 0,
    displayPolicy: 'exact-marker',
    coordinateSource: { name: '演示坐标源（Mock）', url: 'mock://grid-geo/crs', license: 'demo-only', accessedAt: gridDemoNow() },
    evidence: gridDemoEvidence(`${spec.name}位置证据`)
  }
}

function gridDemoCenter(): [number, number] {
  return GRID_REGION_CENTERS[gridDemoRegionId()] ?? GRID_SHANXI_CENTER
}

function gridDemoPlants(ctx?: MockContext) {
  const regionId = gridDemoRegionId()
  const companyId = ctx ? gridDemoCompanyOf(ctx) : MOCK_COMPANY_ID
  const operator = gridDemoOperatorOf(regionId)
  return GRID_PLANT_SPECS.map((spec, index) => ({
    plantId: spec.id,
    standardName: spec.name,
    aliases: [`${spec.name}一期`],
    plantType: spec.type,
    capacityMw: spec.mw,
    status: 'ACTIVE',
    regionId,
    ownerCompanyId: companyId,
    ownerUserId: null,
    subjectType: 'GENERATOR',
    version: 1,
    gridOperator: operator,
    visibility: 'company',
    sourceRef: `mock://grid-geo/${spec.id}`,
    location: gridDemoLocation(spec),
    nodeRefs: [{ nodeName: spec.node, relationType: 'pricing', assetId: `mock-node-${String(index + 1).padStart(2, '0')}` }],
    integrationRefs: { plantMasterFamily: 'mock_grid_plant_master', outputFamily: 'mock_grid_plant_output', nodePriceFamily: 'mock_node_price' },
    dataMeta: { sourceType: 'MANUAL', mock: true, productionWrite: false, visibility: 'company', contractVersion: '1.0.0', verifiedAt: gridDemoNow(), note: '演示数据（Mock 演示账号专用）' },
    overrideState: { hasOverrides: false, count: 0, fieldPaths: [], latestVersion: null, updatedAt: null },
    storageMeta: { sourceType: 'DB', mock: true, productionWrite: false, schemaVersion: '1.0.0', updatedAt: gridDemoNow() }
  }))
}

function gridDemoNodes(ctx?: MockContext) {
  const regionId = gridDemoRegionId()
  const companyId = ctx ? gridDemoCompanyOf(ctx) : MOCK_COMPANY_ID
  const operator = gridDemoOperatorOf(regionId)
  return gridDemoPlants(ctx).map((plant, index) => ({
    assetId: `mock-node-${String(index + 1).padStart(2, '0')}`,
    assetType: 'node',
    nodeId: `mock-node-${String(index + 1).padStart(2, '0')}`,
    standardName: GRID_PLANT_SPECS[index].node,
    nodeName: GRID_PLANT_SPECS[index].node,
    aliases: [] as string[],
    nodeKind: 'pricing',
    voltageLevelKv: 220,
    status: 'ACTIVE',
    locationStatus: 'located',
    location: {
      ...gridDemoLocation(GRID_PLANT_SPECS[index]),
      longitude: Math.round((plant.location.longitude + 0.12) * 1000) / 1000,
      latitude: Math.round((plant.location.latitude + 0.09) * 1000) / 1000,
      coordinateSource: null,
      evidence: []
    },
    marketRefs: { priceFamily: 'mock_node_price' },
    regionId,
    ownerCompanyId: companyId,
    ownerUserId: null,
    version: 1,
    gridOperator: operator,
    visibility: 'company',
    sourceRef: `mock://grid-geo/nodes/${index + 1}`,
    dataMeta: { sourceType: 'MANUAL', mock: true, productionWrite: false, visibility: 'company', contractVersion: '1.0.0', verifiedAt: gridDemoNow(), note: '演示节点（Mock 演示账号专用）' },
    overrideState: { hasOverrides: false, count: 0, fieldPaths: [], latestVersion: null, updatedAt: null },
    storageMeta: { sourceType: 'DB', mock: true, productionWrite: false, schemaVersion: '1.0.0', updatedAt: gridDemoNow() }
  }))
}

function gridDemoWeather(ctx?: MockContext) {
  const items = gridDemoPlants(ctx).map((plant, index) => {
    const c = curve96('load', `wx:${plant.plantId}`, dateStr(0))
    // curve96 幅度是 MW/价格量级，气象字段用 modulo 归一到物理量纲
    const v = (salt: number, mod: number) => c[(index * 7 + salt) % 96] % mod
    const cloudCoverPercent = v(13, 100)
    return {
      plantId: plant.plantId,
      validAt: `${dateStr(0)}T08:00:00+08:00`,
      intervalSeconds: 900,
      weatherCode: cloudCoverPercent > 60 ? 3 : 1,
      weatherLabel: cloudCoverPercent > 60 ? '多云' : '晴',
      weatherCategory: cloudCoverPercent > 60 ? 'cloud' : 'clear',
      temperatureC: Math.round(2 + v(7, 180) / 6),
      relativeHumidityPercent: 30 + v(5, 60),
      precipitationMm: index % 3 === 0 ? Math.round(v(1, 200)) / 100 : 0,
      cloudCoverPercent,
      windSpeedMs: Math.round((3 + v(11, 80) / 10) * 10) / 10,
      windDirectionDeg: v(3, 360),
      shortwaveRadiationWm2: GRID_PLANT_SPECS[index].type === 'solar' ? 400 + v(9, 500) : 150 + v(9, 300),
      sampledLocation: {
        longitude: plant.location.longitude,
        latitude: plant.location.latitude,
        elevationM: plant.location.elevationM ?? 0,
        timezone: 'Asia/Shanghai'
      }
    }
  })
  const nums = (pick: (item: (typeof items)[number]) => number | null) => items.map(pick).filter((v): v is number => v != null)
  const avg = (list: number[]) => list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length * 10) / 10 : null
  return {
    items,
    summary: {
      locationCount: items.length,
      averageTemperatureC: avg(nums((i) => i.temperatureC)),
      averageWindSpeedMs: avg(nums((i) => i.windSpeedMs)),
      maximumWindSpeedMs: nums((i) => i.windSpeedMs).length ? Math.max(...nums((i) => i.windSpeedMs)) : null,
      totalCurrentPrecipitationMm: avg(nums((i) => i.precipitationMm)),
      averageCloudCoverPercent: avg(nums((i) => i.cloudCoverPercent)),
      alertCount: 0
    },
    fetchedAt: gridDemoNow(),
    expiresAt: `${dateStr(0)}T09:00:00+08:00`,
    dataAvailability: { status: 'available', reason: '演示格点天气（Mock，非真实气象源）', fallback: false }
  }
}

function gridDemoTopologyManifest(ctx?: MockContext) {
  const regionId = gridDemoRegionId()
  const operator = gridDemoOperatorOf(regionId)
  return {
    contractVersion: '1.0.0',
    provider: { id: 'mock-dispatch', label: operator === 'sgcc' ? '国网演示调度（Mock）' : '南网演示调度（Mock）', status: 'available', configurationVisible: true },
    topologyVersion: 'mock-topo-v1',
    sourceVersion: 'mock-src-v1',
    effectiveFrom: `${dateStr(-90)}T00:00:00+08:00`,
    effectiveTo: null,
    updatedAt: gridDemoNow(),
    authorizationRef: 'mock://grid-geo/auth',
    license: { name: '演示授权（Mock）', url: 'mock://grid-geo/license', redistribution: 'demo-only' },
    gridOperator: operator,
    regionId,
    ownerCompanyId: ctx ? gridDemoCompanyOf(ctx) : MOCK_COMPANY_ID,
    crs: 'WGS84',
    classification: '演示授权网架（Mock）',
    capabilities: { featureKinds: ['substation', 'bus', 'branch'], queryModes: ['viewport', 'all'], geometryRequired: true, physics: false },
    readiness: [
      { id: 'provider', label: 'Provider 已配置', status: 'ready', required: true },
      { id: 'authorization', label: '授权范围已确认', status: 'ready', required: true },
      { id: 'geometry', label: '几何数据可用', status: 'ready', required: true },
      { id: 'license', label: '许可已登记', status: 'ready', required: true }
    ],
    featureCounts: { substation: 4, bus: 8, branch: 8 },
    dataAvailability: { status: 'available', reason: '演示授权网架已配置（Mock）', regionRequested: regionId, regionServed: regionId, fallback: false }
  }
}

function gridDemoTopologyFeatures(ctx?: MockContext) {
  const regionId = gridDemoRegionId()
  const companyId = ctx ? gridDemoCompanyOf(ctx) : MOCK_COMPANY_ID
  const operator = gridDemoOperatorOf(regionId)
  const center = gridDemoCenter()
  const common = { topologyVersion: 'mock-topo-v1', sourceRef: 'mock://grid-geo/topology', classification: 'public', ownerCompanyId: companyId, regionId, gridOperator: operator, status: 'IN_SERVICE' }
  const substations = [0, 1, 2, 3].map((i) => ({
    featureId: `mock-sub-${i + 1}`,
    kind: 'substation',
    name: `${['北', '东', '南', '西'][i]}部演示变电站`,
    ...common,
    geometry: { type: 'Point', coordinates: gridDemoShifted(center, 110.8 + i * 1.2, 39.3 - (i % 2) * 1.8) },
    refs: { substationId: `mock-sub-${i + 1}` }
  }))
  const buses = substations.flatMap((sub, i) => [0, 1].map((j) => ({
    featureId: `mock-bus-${i * 2 + j + 1}`,
    kind: 'bus',
    name: `${sub.name} ${j + 1} 号母线`,
    ...common,
    geometry: { type: 'Point', coordinates: [sub.geometry.coordinates[0] + j * 0.02, sub.geometry.coordinates[1]] as [number, number] },
    refs: { substationId: sub.featureId, busId: `mock-bus-${i * 2 + j + 1}` }
  })))
  const plants = gridDemoPlants(ctx)
  const branches = plants.map((plant, i) => {
    const target = substations[i % 4].geometry.coordinates
    return {
      featureId: `mock-branch-${i + 1}`,
      kind: 'branch',
      name: `${plant.standardName}并网线`,
      ...common,
      geometry: { type: 'LineString', coordinates: [[plant.location.longitude, plant.location.latitude] as [number, number], target] },
      refs: { plantId: plant.plantId, substationId: substations[i % 4].featureId, fromBusId: `mock-bus-${(i % 4) * 2 + 1}`, toBusId: `mock-bus-${(i % 4) * 2 + 2}` }
    }
  })
  return [...substations, ...buses, ...branches]
}

const GRID_DISCLOSURE_CATEGORIES = ['maintenance', 'outage', 'intervention', 'congestion', 'constraint'] as const
const GRID_DISCLOSURE_TITLES: Record<string, string[]> = {
  maintenance: ['500kV 演示甲线计划检修', '220kV 演示乙线间隔检修'],
  outage: ['演示电厂 2 号机组临时停运', '演示变电站 1 号主变故障停运'],
  intervention: ['演示断面潮流人工干预', '演示机组出力受限干预'],
  congestion: ['演示北通道断面阻塞', '演示南送断面越限'],
  constraint: ['演示系统备用约束生效', '演示新能源消纳约束']
}

function gridDemoDisclosureEvents(_ctx?: MockContext) {
  const regionId = gridDemoRegionId()
  return Array.from({ length: 12 }, (_, i) => {
    const category = GRID_DISCLOSURE_CATEGORIES[i % GRID_DISCLOSURE_CATEGORIES.length]
    const day = dateStr(-i)
    return {
      eventId: `mock-disc-${String(i + 1).padStart(2, '0')}`,
      providerId: 'mock-grid-disclosure',
      category,
      title: GRID_DISCLOSURE_TITLES[category][i % 2],
      summary: '演示模式：事件为合成数据，不对应任何真实电网操作。',
      regionId,
      spatialBinding: { kind: i % 3 === 0 ? 'grid' : 'section', ref: `mock-branch-${(i % 8) + 1}`, label: `演示断面 ${String(i % 8 + 1).padStart(2, '0')}`, coordinates: null },
      effectiveAt: `${day}T06:00:00+08:00`,
      expiresAt: `${addDays(day, 3)}T22:00:00+08:00`,
      publishedAt: `${addDays(day, -1)}T17:00:00+08:00`,
      source: { file: `disclosure-${day}.json`, recordId: `row-${i + 1}`, url: null, sourceTable: 'mock_disclosure', sourceType: 'IMPORT', mock: true, productionWrite: false, dataAvailability: 'available', license: '演示授权（Mock）', originalLinkStatus: 'mock' },
      confidence: 'verified-source-row',
      importedAt: `${addDays(day, -1)}T18:00:00+08:00`
    }
  })
}

function gridDemoIntegrations(plant: ReturnType<typeof gridDemoPlants>[number]) {
  const names = [plant.standardName, ...plant.aliases]
  return {
    asset: { plantId: plant.plantId, version: plant.version, regionId: plant.regionId, ownerCompanyId: plant.ownerCompanyId },
    identity: { plantNames: names, nodeName: plant.nodeRefs[0]?.nodeName ?? null, mappingPolicy: 'exact-only', fallbackToPortfolio: false },
    domains: {
      nodePrice: { status: 'configured', endpoint: '/agent-api/v1/spot/node-price/series', marketKinds: ['da', 'rt'], stableRef: { nodeName: plant.nodeRefs[0]?.nodeName ?? null }, sourceType: 'API' },
      output: { status: 'configured', family: 'mock_grid_plant_output', dataset: 'mock_grid_plant_output', stableRef: { plantNames: names }, sourceType: 'CAPTURE' },
      forecast: { status: 'missing', endpoint: '', displaySource: null, stableRef: { plantNames: [] as string[] }, sourceType: 'CAPTURE' },
      settlement: { status: 'missing', family: null, dataset: null, stableRef: { plantNames: [] as string[] }, sourceType: 'CAPTURE' }
    },
    navigation: { nodePrice: '/xhjy', output: '/sjzt', forecast: '', settlement: '', risk: '' },
    contractVersion: '1.0.0'
  }
}

function gridDemoManifest(ctx?: MockContext) {
  const regionId = gridDemoRegionId()
  const companyId = ctx ? gridDemoCompanyOf(ctx) : MOCK_COMPANY_ID
  const plants = gridDemoPlants(ctx)
  return {
    catalogId: 'mock-grid-catalog',
    title: '演示集团空间资产目录（Mock）',
    regionId,
    ownerCompanyId: companyId,
    contractVersion: '1.0.0',
    locatedPlantCount: plants.length,
    totalPlantCountInCurrentDim: plants.length,
    unresolvedPlantCount: 0,
    sourceType: 'DB',
    mock: true,
    productionWrite: false,
    visibility: 'company',
    updatedAt: gridDemoNow(),
    apiPrefix: '/api/v1/grid/geo-assets',
    operatorProfile: resolveGridOperatorProfile(regionId),
    capabilities: {
      viewModes: ['2d', '2.5d', '3d'],
      filters: ['plantType', 'status', 'visibility'],
      interactions: ['select', 'focus', 'terrain-tour'],
      futureIntegrationRefs: ['outputFamily', 'nodePriceFamily'],
      allowedRoles: ['ADMIN', 'BOSS', 'GROUP', 'COMPANY'],
      writeRoles: ['ADMIN'],
      editableFieldPaths: ['location'],
      canWrite: true,
      physics: { powerFlow: false, topology: false, sectionConstraint: false }
    },
    enumValues: {
      plantTypes: ['wind', 'solar', 'hydro', 'thermal', 'storage', 'other'],
      nodeKinds: ['pricing', 'bus', 'substation', 'boundary', 'other'],
      locationStatuses: ['located', 'approximate', 'unresolved'],
      accuracyLevels: ['site', 'village', 'township', 'county', 'approximate'],
      confidenceLevels: ['verified', 'probable', 'unverified'],
      visibilityLevels: ['public', 'company', 'user'],
      terrainProviders: ['arcgis-terrain', 'cesium-world-terrain', 'ellipsoid'],
      weatherLayers: ['none', 'wind', 'temperature', 'precipitation', 'irradiance', 'cloud']
    },
    storage: { available: true, sourceType: 'DB', schemaVersion: 1, versionedOverrides: true, optimisticLocking: true, idempotencyRequired: true },
    terrain: {
      defaultProvider: 'ellipsoid',
      providers: [
        { id: 'ellipsoid', tokenRequired: false, sourceType: 'BUILTIN' },
        { id: 'cesium-world-terrain', tokenRequired: true, tokenEnv: 'VITE_CESIUM_ION_TOKEN', sourceType: 'API' },
        { id: 'arcgis-terrain', tokenRequired: false, sourceType: 'API' }
      ],
      supportsRuntimeSwitch: true,
      supportsVerticalExaggeration: true
    },
    weather: { endpoint: '/api/v1/grid/geo-assets/weather/current', provider: 'open-meteo', layers: ['wind', 'temperature', 'precipitation', 'irradiance', 'cloud'], basis: 'real', sourceType: 'API', mock: true, productionWrite: false },
    cache: {
      assets: { layer: 'client-memory', ttlMs: 60000, requestCoalescing: true, invalidateOnWrite: true },
      integrations: { layer: 'client-memory', ttlMs: 300000, requestCoalescing: true, invalidateOnWrite: true },
      weather: { layer: 'server-memory', ttlMs: 900000, staleOnError: true },
      terrain: { layer: 'provider-http-browser', offlineExportAllowed: false },
      imagery: { layer: 'provider-http-browser', offlineExportAllowed: false }
    },
    degradation: [
      { level: 0, id: 'online', terrain: true, imagery: true, weather: true },
      { level: 1, id: 'cached', terrain: true, imagery: true, weather: 'stale-labeled' },
      { level: 2, id: 'no-weather', terrain: true, imagery: true, weather: false },
      { level: 3, id: 'ellipsoid', terrain: false, imagery: true, weather: false },
      { level: 4, id: 'offline-asset', terrain: false, imagery: false, weather: false }
    ],
    performance: { lazyCesium: true, requestCoalescing: true, weakNetworkLod: true, budgets: { vendorCesiumBytes: 4200000, featureChunkBytes: 262144, assetListP95Ms: 800 } }
  }
}

// —— 空间资产配套 captured 演示族（气象/辐照/as-of/出力；演示分支消费，见 marketSpatialScope）——

const GRID_METEO_STATIONS = [
  { stationId: 'MOCK-ST-01', lon: 113.5, lat: 39.9 },
  { stationId: 'MOCK-ST-02', lon: 112.4, lat: 37.6 },
  { stationId: 'MOCK-ST-03', lon: 111.3, lat: 35.4 }
]

function gridDemoOutputRows(dates: string[]): Record<string, unknown>[] {
  const plants = gridDemoPlants()
  const rows: Record<string, unknown>[] = []
  for (const date of dates) {
    for (const plant of plants) {
      const base = curve96('output', `gout:${plant.plantId}:${date}`, date)
      const scale = (plant.capacityMw ?? 100) / 660
      for (let p = 1; p <= 96; p++) {
        const actual = Math.round(base[p - 1] * scale * 10) / 10
        const minute = p * 15
        const timePoint = `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
        rows.push(
          { id: `${plant.plantId}-${date}-a${p}`, date, plant: plant.standardName, standardPlant: plant.standardName, unitName: null, point: p, timePoint, dataType: '子站回传', seriesRole: 'actual', valueMw: actual },
          { id: `${plant.plantId}-${date}-p${p}`, date, plant: plant.standardName, standardPlant: plant.standardName, unitName: null, point: p, timePoint, dataType: '最终下发', seriesRole: 'plan', valueMw: Math.round(actual * 1.04 * 10) / 10 },
          { id: `${plant.plantId}-${date}-f${p}`, date, plant: plant.standardName, standardPlant: plant.standardName, unitName: null, point: p, timePoint, dataType: '超短期预测', seriesRole: 'forecast', valueMw: Math.round(actual * 0.95 * 10) / 10 }
        )
      }
    }
  }
  return rows
}

function gridDemoMeteoRows(dates: string[], regionId: string): Record<string, unknown>[] {
  const center = GRID_REGION_CENTERS[regionId] ?? GRID_SHANXI_CENTER
  const rows: Record<string, unknown>[] = []
  for (const date of dates) {
    for (const station of GRID_METEO_STATIONS) {
      const [lon, lat] = gridDemoShifted(center, station.lon, station.lat)
      const wind = curve96('renewable', `wind:${station.stationId}:${date}`, date)
      for (let h = 0; h < 24; h++) {
        rows.push({
          date,
          time: `${String(h).padStart(2, '0')}:00`,
          stationId: station.stationId,
          lat,
          lon,
          temp: Math.round((wind[h * 4] % 180) / 6 * 10) / 10,
          humidity: 30 + (wind[h * 4 + 1] % 60),
          windSpeed100: Math.round((3 + (wind[h * 4] % 80) / 10) * 10) / 10,
          precipitation: h % 7 === 0 ? Math.round(wind[h * 4] % 200) / 100 : 0,
          cloudCover: wind[h * 4 + 2] % 100
        })
      }
    }
  }
  return rows
}

function gridDemoIrradianceRows(dates: string[], regionId: string): Record<string, unknown>[] {
  const center = GRID_REGION_CENTERS[regionId] ?? GRID_SHANXI_CENTER
  const rows: Record<string, unknown>[] = []
  for (const date of dates) {
    for (const station of GRID_METEO_STATIONS) {
      const [lon, lat] = gridDemoShifted(center, station.lon, station.lat)
      const sun = curve96('renewable', `ghi:${station.stationId}:${date}`, date)
      for (let h = 0; h < 24; h++) {
        rows.push({
          date,
          time: `${String(h).padStart(2, '0')}:00`,
          stationId: station.stationId,
          lat,
          lon,
          ghi: h >= 7 && h <= 17 ? Math.round((sun[h * 4] % 130) * 8) : 0
        })
      }
    }
  }
  return rows
}

function gridDemoAsOfRows(dates: string[], regionId: string): Record<string, unknown>[] {
  const center = GRID_REGION_CENTERS[regionId] ?? GRID_SHANXI_CENTER
  const rows: Record<string, unknown>[] = []
  for (const date of dates) {
    for (const station of GRID_METEO_STATIONS) {
      const [lon, lat] = gridDemoShifted(center, station.lon, station.lat)
      // 三条预报运行轨（D-2 12:00 / D-1 12:00 / D 日内 00:00），供 weatherTracks
      // 的 as-of 时间门按轨各自挑选（forecastAt ≤ 决策截止 ＜ validAt）。
      const runs = [
        { tag: 'd2', forecastAt: `${addDays(date, -2)}T12:00:00+08:00`, ingestedAt: `${addDays(date, -2)}T13:00:00+08:00` },
        { tag: 'd1', forecastAt: `${addDays(date, -1)}T12:00:00+08:00`, ingestedAt: `${addDays(date, -1)}T13:00:00+08:00` },
        { tag: 'intraday', forecastAt: `${date}T00:00:00+08:00`, ingestedAt: `${date}T01:00:00+08:00` }
      ]
      for (const run of runs) {
        const wind = curve96('renewable', `asof:${station.stationId}:${run.tag}:${date}`, date)
        for (let h = 0; h < 24; h++) {
          rows.push({
            provider: 'open-meteo-demo',
            forecastRunId: `mock-run-${run.tag}-${date}`,
            modelVersion: 'demo-model-v1',
            featureVersion: 'demo-feat-v1',
            forecastAt: run.forecastAt,
            validAt: `${date}T${String(h).padStart(2, '0')}:00:00+08:00`,
            ingestedAt: run.ingestedAt,
            regionId,
            stationId: station.stationId,
            plantId: null,
            lat,
            lon,
            leadHours: run.tag === 'd2' ? 48 : run.tag === 'd1' ? 24 : h,
            sourceType: 'MOCK',
            basis: 'demo',
            values: {
              temp: Math.round((wind[h * 4] % 180) / 6 * 10) / 10,
              wind_speed_100m: Math.round((3 + (wind[(h * 4 + 8) % 96] % 80) / 10) * 10) / 10,
              ghi: h >= 7 && h <= 17 ? Math.round((wind[(h * 4 + 16) % 96] % 130) * 8) : 0,
              precipitation: 0
            }
          })
        }
      }
    }
  }
  return rows
}

// —— 空间资产节点电价（/agent-api/v1/spot/node-price/*，演示会话放行未登记地区）——

// rt 相对 da 的节点级差异偏移：让「实时-日前价差」图层在各节点间有可辨识的信号差异
function spotRtCurve(curve: number[], nodeIndex: number): number[] {
  return curve.map((v) => v * (1.02 + nodeIndex * 0.015) + 2 + nodeIndex * 3)
}

function spotNodePriceDaily(ctx: MockContext): Response {
  const date = ctx.url.searchParams.get('date') ?? dateStr(0)
  const market = ctx.url.searchParams.get('market') ?? 'da'
  const items = GRID_PLANT_SPECS.map((spec, nodeIndex) => {
    const curve = curve96('price', `np:${spec.node}:${date}`, date)
    const scaled = market === 'rt' ? spotRtCurve(curve, nodeIndex) : curve
    return {
      node_name: spec.node,
      avg: Math.round(scaled.reduce((s, v) => s + v, 0) / 96 * 10) / 10,
      max: Math.round(Math.max(...scaled) * 10) / 10,
      min: Math.round(Math.min(...scaled) * 10) / 10,
      neg_share_pct: 0,
      points: 96
    }
  })
  return mockJsonResponse({ code: 200, message: 'ok', data: { count: items.length, items }, mock: true, sourceType: 'MOCK', productionWrite: false })
}

function spotNodePriceSeries(ctx: MockContext): Response {
  const date = ctx.url.searchParams.get('date') ?? dateStr(0)
  const market = ctx.url.searchParams.get('market') ?? 'da'
  const node = ctx.url.searchParams.get('node') ?? GRID_PLANT_SPECS[0].node
  const nodeIndex = Math.max(0, GRID_PLANT_SPECS.findIndex((spec) => spec.node === node))
  const base = curve96('price', `np:${node}:${date}`, date)
  const scaled = market === 'rt' ? spotRtCurve(base, nodeIndex) : base
  const series = TIME_AXIS_96.map((time, i) => ({ time_point: `${date} ${time}`, price: Math.round(scaled[i] * 10) / 10 }))
  return mockJsonResponse({ code: 200, message: 'ok', data: { series, points: series.length }, mock: true, sourceType: 'MOCK', productionWrite: false })
}

function spotNodePriceHeatmap(ctx: MockContext): Response {
  const date = ctx.url.searchParams.get('date') ?? dateStr(0)
  const nodes = GRID_PLANT_SPECS.map((spec) => spec.node)
  const timePoints = TIME_AXIS_96.filter((_, i) => i % 4 === 0)
  const matrix = nodes.map((node) => timePoints.map((_, slot) => {
    const curve = curve96('price', `np:${node}:${date}`, date)
    return Math.round(curve[slot * 4] * 10) / 10
  }))
  return mockJsonResponse({ code: 200, message: 'ok', data: { nodes, time_points: timePoints, matrix }, mock: true, sourceType: 'MOCK', productionWrite: false })
}

// —— 省级边界（/api/v1/grid 之外的 /api/v1/geo/boundary/:adcode，2D 平面图 echarts 底图）——
// 真实链路由后端 server/geo-boundary-api.mjs 鉴权提供（数据/审图红线：不进 public 静态目录）。
// 演示会话不回源真实后端（R1），故把同一份 DataV 边界文件随 mock worktree 本地携带，
// 以同样信封形状 {code,msg,data:FeatureCollection} 供数；真实账号不进 mock 守卫、零改动。
const GEO_BOUNDARY_FILES = import.meta.glob('./geo-boundary/*.json', { eager: true, import: 'default' }) as Record<string, { type?: string; features?: unknown[] }>

function geoBoundaryHandler(ctx: MockContext): Response {
  const adcode = ctx.url.pathname.split('/').pop() ?? ''
  if (!/^\d{6}$/.test(adcode)) {
    return mockJsonResponse({ code: 400, msg: '非法的行政区划码', mock: true, sourceType: 'MOCK' }, { status: 400 })
  }
  const entry = Object.entries(GEO_BOUNDARY_FILES).find(([path]) => path.endsWith(`/${adcode}.json`))
  const geo = entry?.[1]
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    return mockJsonResponse({ code: 404, msg: `无该行政区划的边界数据：${adcode}`, mock: true, sourceType: 'MOCK' }, { status: 404 })
  }
  return mockJsonResponse({ code: 200, msg: 'ok', data: geo, mock: true, sourceType: 'MOCK', productionWrite: false })
}


// ---------------------------------------------------------------------------
// 路由表与解析入口
// ---------------------------------------------------------------------------

/**
 * 和风天气代理（apiGet('/qweather')）演示应答（PRD C.24）。
 * 真实天气按 key 计费、不宜采集入库（无 fixtures 族），Open-Meteo 外网回退又被跨源
 * 护栏拦截——不补此 handler，演示会话的天气网格/当前天气挂件永远为空。
 * 按和风原始响应形状供数（string 数值），播种确定性：同城市同日恒同天气。
 */
function mockQweatherResponse(params: URLSearchParams): Record<string, unknown> {
  const path = params.get('path') ?? ''
  const location = params.get('location') ?? ''
  const COND = ['晴', '多云', '少云', '阴', '小雨', '阵雨', '雷阵雨']
  if (path.includes('/geo/v2/city/lookup')) {
    const isCoords = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(location)
    if (isCoords) {
      const [lonStr, latStr] = location.split(',').map((s) => s.trim())
      const lon = Number(lonStr)
      const lat = Number(latStr)
      const cities: Array<[string, number, number]> = [
        ['太原', 112.55, 37.87], ['大同', 113.3, 40.08], ['朔州', 112.43, 39.33], ['忻州', 112.73, 38.42],
        ['晋中', 112.75, 37.69], ['阳泉', 113.58, 37.87], ['吕梁', 111.14, 37.52], ['长治', 113.12, 36.19],
        ['临汾', 111.52, 36.09], ['晋城', 112.85, 35.49], ['运城', 111.0, 35.03]
      ]
      let best = cities[0]
      let bestD = Number.POSITIVE_INFINITY
      for (const city of cities) {
        const d = (city[1] - lon) ** 2 + (city[2] - lat) ** 2
        if (d < bestD) { bestD = d; best = city }
      }
      return { code: '200', location: [{ name: best[0], lat: latStr, lon: lonStr, adm1: '山西省', adm2: best[0] }] }
    }
    const kw = (location || '太原').trim().slice(0, 12)
    return { code: '200', location: [{ name: kw, lat: '37.87', lon: '112.55', adm1: '山西省', adm2: kw }] }
  }
  if (path.includes('/v7/weather/now')) {
    const rand = mulberry32(seedOf(`qweather-now:${location}:${dateStr(0)}`))
    const high = 22 + Math.round(rand() * 13)
    return {
      code: '200',
      now: {
        temp: String(high - 4 + Math.round(rand() * 3)),
        text: COND[Math.floor(rand() * COND.length)],
        feelsLike: String(high - 2),
        humidity: String(38 + Math.round(rand() * 50)),
        windDir: '西南风',
        windScale: String(1 + Math.floor(rand() * 4)),
        windSpeed: String(6 + Math.round(rand() * 22))
      }
    }
  }
  // 默认 15d 日预报：和风字段名（fxDate/textDay/tempMax/tempMin/humidity），string 数值
  const rand = mulberry32(seedOf(`qweather-15d:${location}`))
  const daily = Array.from({ length: 15 }, (_, i) => {
    const tempMax = 21 + Math.round(rand() * 14)
    const textDay = COND[Math.floor(rand() * COND.length)]
    return {
      fxDate: dateStr(i),
      textDay,
      textNight: i % 3 === 0 ? '晴' : '多云',
      tempMax: String(tempMax),
      tempMin: String(tempMax - 5 - Math.round(rand() * 5)),
      humidity: String(38 + Math.round(rand() * 50)),
      windScaleDay: `${1 + Math.floor(rand() * 3)}-${3 + Math.floor(rand() * 3)}`,
      windDirDay: '西南风'
    }
  })
  return { code: '200', daily }
}

const DECL_BASE = '/api/v1/trading/spot/declarations'

const ROUTES: MockRoute[] = [
  { method: 'GET', prefix: '/api/real-coverage', handler: () => mockEnvelopeResponse({ data: { datasets: [
    { datasetKey: 'da_user_price', start: dateStr(-30), end: dateStr(0) },
    { datasetKey: 'rt_user_price', start: dateStr(-30), end: dateStr(0) }
  ] } }) },
  // 和风天气代理（驾驶舱天气网格/当前天气挂件）：演示会话直接供数，见 mockQweatherResponse
  { method: 'GET', prefix: '/api/qweather', handler: (ctx) => mockJsonResponse(mockQweatherResponse(ctx.url.searchParams)) },
  { method: 'GET', prefix: '/api/real-list', handler: (ctx) => {
    // 文件清单：date（fetchCapturedDates 消费）+ file（HomeConsoleView 按文件名取数）。
    // fixtures 优先：有携带族的族直接回真实文件清单（{file,bytes,date}，bytes 降序——与
    // 后端 listCaptured 同形同序），日期窗口即真实采集窗口；未携带族回落合成清单。
    const family = ctx.url.searchParams.get('family') ?? ''
    const fixtureFiles = fixtureFileList(family)
    if (fixtureFiles.length > 0) {
      const files = fixtureFiles.map(({ file, bytes, date }) => ({ file, bytes, ...(date ? { date } : {}) }))
      return mockPipelineEnvelopeResponse({ data: files, rows: files, total: files.length })
    }
    let files: Array<{ file: string; date: string }> = Array.from({ length: 30 }, (_, i) => ({
      file: `${family || 'default'}__full__${dateStr(-i)}.json`,
      date: dateStr(-i)
    }))
    if (family === 'sdpt_zrqsb') {
      // 日前上报：视图默认运行日 2026-06-04，日期清单须覆盖采集窗口（2026-04-01 起）
      files = []
      for (let d = '2026-04-01'; d <= dateStr(0) && files.length < 200; d = addDays(d, 1)) {
        files.push({ file: `${d}.json`, date: d })
      }
    }
    if (family === 'sdpt_console') {
      files = [
        { file: 'getCorpNewEnergyChart.json', date: dateStr(0) },
        ...['d859fbde03', '275c1ef9fa', '317f0f0bbd', '0b36fa2030', '0144aacb91', '7db3560c48'].map((h) => ({ file: `${h}.json`, date: dateStr(0) })),
        ...Array.from({ length: 35 }, (_, i) => ({ file: `getAveragePriceChart__${(i + 1).toString(16).padStart(3, '0')}.json`, date: dateStr(-i) }))
      ]
    }
    return mockPipelineEnvelopeResponse({ data: files, rows: files, total: files.length })
  } },
  { method: 'GET', prefix: '/api/real', handler: handleCaptured },
  { method: 'GET', prefix: `${DECL_BASE}/meta`, handler: (ctx) => {
    const targetDate = ctx.url.searchParams.get('date') ?? dateStr(1)
    // D-1 10:30 (+08:00) 截止：截止时刻 = 目标交易日前一自然日的 10:30
    const deadline = new Date(Date.parse(`${targetDate}T10:30:00+08:00`) - 86400000).toISOString()
    const msRemaining = Date.parse(deadline) - Date.now()
    return mockEnvelopeResponse({ data: { targetDate, deadline, deadlineHHmm: '10:30', now: new Date().toISOString(), msRemaining, expired: msRemaining <= 0 } })
  } },
  { method: 'GET', prefix: DECL_BASE, handler: (ctx) => {
    const id = decodeURIComponent(ctx.url.pathname.slice(DECL_BASE.length + 1) ?? '')
    const order = loadDeclarations().find((o) => o.id === id)
    if (!order) return handleDeclarationList(ctx)
    return declarationEnvelope(order)
  } },
  { method: 'POST', prefix: `${DECL_BASE}/`, handler: handleDeclarationMutation },
  { method: 'POST', prefix: DECL_BASE, handler: (ctx) => {
    const orders = loadDeclarations()
    const now = new Date().toISOString()
    const targetDate = String(ctx.body.targetDate ?? dateStr(1))
    const capacityMw = Number(ctx.body.capacityMw ?? 480)
    const order = {
      id: `MOCK-ORD-${Date.now().toString(36)}`,
      targetDate,
      deadline: `${dateStr(-1)}T10:30:00+08:00`,
      status: 'DRAFT',
      mode: ctx.body.mode === 'REHEARSAL' ? 'REHEARSAL' : 'LIVE',
      companyId: MOCK_COMPANY_ID,
      region: 'shanxi',
      subjectId: MOCK_SUBJECT_ID,
      subjectType: 'GENERATOR',
      capacityMw,
      energyCurveMwh96: (ctx.body.energyCurveMwh96 as number[] | undefined) ?? capacityScaledCurve(targetDate, targetDate, capacityMw),
      priceCurve96: (ctx.body.priceCurve96 as number[] | null | undefined) ?? curve96('price', targetDate, targetDate),
      strategySource: String(ctx.body.strategySource ?? 'manual'),
      basis: 'synthetic',
      quoteRationale: String(ctx.body.quoteRationale ?? '演示主线策略'),
      note: null,
      riskCheck: null,
      approvalRecord: [],
      receipt: null,
      clearing: null,
      createdBy: 'mock-demo',
      createdAt: now,
      updatedAt: now,
      audit: []
    } satisfies DeclarationOrder
    orders.unshift(order)
    saveDeclarations(orders)
    return declarationEnvelope(order)
  } },
  { method: 'PUT', prefix: DECL_BASE, handler: handleDeclarationMutation },
  { method: 'PATCH', prefix: DECL_BASE, handler: handleDeclarationMutation },
  { method: 'GET', prefix: '/api/v1/market/fundamentals', handler: (ctx) => {
    // S2 供需基本面（FundamentalEntry）：调度口径满分可信度，四要素 + 备用/煤价。
    // 量纲对齐山西真实规模：全省系统负荷 ~2.7–3.4 万 MW、新能源预测 ~4–7 千 MW。
    const date = ctx.url.searchParams.get('date') ?? dateStr(0)
    const load = curve96('load', `fund:${date}`, date)
    const ren = curve96('renewable', `fund:${date}`, date)
    const LOAD_SCALE = 3.6
    const REN_SCALE = 8.2
    const entry = (slot_label: string, field: string, value_mw: number) => ({
      slot_label,
      field,
      value_mw,
      source_kind: 'dispatch',
      credibility: 'A',
      note: '演示数据（调度口径）',
      entered_by: 'mock-demo',
      entered_at: `${date}T06:00:00+08:00`
    })
    const entries = [
      entry('all-day', 'system_load_mw', Math.round((load.reduce((s, v) => s + v, 0) / 96) * LOAD_SCALE)),
      entry('h10', 'system_load_mw', Math.round(load[40] * LOAD_SCALE)),
      entry('h20', 'system_load_mw', Math.round(load[80] * LOAD_SCALE)),
      entry('all-day', 'renewable_forecast_mw', Math.round((ren.reduce((s, v) => s + v, 0) / 96) * REN_SCALE)),
      entry('h12', 'renewable_forecast_mw', Math.round(ren[48] * REN_SCALE)),
      entry('all-day', 'dispatchable_max_mw', 26_000),
      entry('all-day', 'net_import_mw', 3_200),
      entry('all-day', 'reserve_mw', 3_800),
      entry('all-day', 'coal_price_yuan_per_ton', 795)
    ]
    return mockEnvelopeResponse({ data: { entries, region: ctx.url.searchParams.get('region') ?? 'shanxi', date } })
  } },
  { method: 'PUT', prefix: '/api/v1/market/fundamentals', handler: (ctx) => mockEnvelopeResponse({ data: { saved: Array.isArray(ctx.body.entries) ? ctx.body.entries.length : 0 }, msg: '演示模式：基本面已模拟保存' }) },
  { method: 'GET', prefix: '/api/v1/settlements', handler: (ctx) => {
    // 复盘「结算导入对照」：视图按中文键消费（ ImportedSettlementRow，历史导入口径）
    const month = ctx.url.searchParams.get('month') ?? dateStr(0).slice(0, 7)
    const rows = [
      { 结算月份: month, 结算对象: '山西演示发电集团有限公司', 电量: 288_600, 电费: 41_725_800, 偏差费用: 86_400 },
      { 结算对象: '山西演示发电一号公司', 结算月份: month, 电量: 121_400, 电费: 17_562_100, 偏差费用: 31_200 },
      { 结算月份: month, 结算对象: '山西演示售电有限公司', 电量: 96_200, 电费: 13_918_400, 偏差费用: 18_700 }
    ]
    return mockEnvelopeResponse({ data: { rows }, rows, total: rows.length })
  } },
  { method: 'GET', prefix: '/api/company/list', handler: () => mockEnvelopeResponse({ rows: MOCK_COMPANIES }) },
  { method: 'GET', prefix: '/api/company/companies', handler: companyOptions },
  { method: 'GET', prefix: '/api/company/stations', handler: (ctx) => companyRows('stations', ctx) },
  { method: 'GET', prefix: '/api/company/units', handler: (ctx) => companyRows('units', ctx) },
  { method: 'GET', prefix: '/api/company/unit-output', handler: (ctx) => companyRows('unit-output', ctx) },
  { method: 'GET', prefix: '/api/company/profile', handler: (ctx) => companyRows('profile', ctx) },
  { method: 'GET', prefix: '/api/company/', handler: (ctx) => companyRows('generic', ctx) },
  { method: 'POST', prefix: '/api/company/', handler: (ctx) => mockEnvelopeResponse({ data: ctx.body }) },
  { method: 'PATCH', prefix: '/api/company/', handler: (ctx) => mockEnvelopeResponse({ data: ctx.body }) },

  // —— 空间资产 gridGeo（PRD R4：8 子页演示数据；前缀序 = 特化在前，防 startsWith 误吞）——
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/manifest', handler: (ctx) => mockEnvelopeResponse({ data: gridDemoManifest(ctx) }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/operator-profile', handler: (ctx) => mockEnvelopeResponse({ data: resolveGridOperatorProfile(ctx.url.searchParams.get('region') || gridDemoRegionId()) ?? resolveGridOperatorProfile('shanxi') }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/plants/location-registry', handler: (ctx) => {
    const items = gridDemoPlants(ctx).map((plant) => ({
      sourcePlantId: plant.plantId,
      standardName: plant.standardName,
      aliases: plant.aliases,
      verificationStatus: 'verified',
      plantId: plant.plantId,
      reason: null,
      reviewedAt: gridDemoNow(),
      evidence: gridDemoEvidence(`${plant.standardName}位置核验`)
    }))
    return mockEnvelopeResponse({ data: { items, summary: { total: items.length, verified: items.length, approximate: 0, unresolved: 0 } }, sourceType: 'IMPORT' })
  } },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/plants/', handler: (ctx) => {
    // /plants/{plantId}[/{integrations|revisions}]
    const segments = ctx.url.pathname.replace(/\/+$/, '').split('/')
    const tail = segments.slice(segments.indexOf('plants') + 1)
    const plant = gridDemoPlants(ctx).find((item) => item.plantId === decodeURIComponent(tail[0] ?? ''))
    if (!plant) return mockEnvelopeResponse({ data: null })
    if (tail[1] === 'integrations') return mockEnvelopeResponse({ data: gridDemoIntegrations(plant), sourceType: 'CONFIG' })
    if (tail[1] === 'revisions') {
      const revision = {
        revisionId: `mock-rev-${plant.plantId}-1`, assetId: plant.plantId, assetVersion: 1, operation: 'SEED',
        before: null, after: plant,
        actor: { userId: 'mock-demo', role: 'ADMIN', companyId: plant.ownerCompanyId, regionId: plant.regionId },
        reason: '演示种子版本（Mock）', evidence: [], requestId: `mock-req-${plant.plantId}`, revertOf: null, createdAt: gridDemoNow()
      }
      return mockEnvelopeResponse({ data: { rows: [revision], total: 1, currentVersion: 1 } })
    }
    if (tail[1]) return mockEnvelopeResponse({ data: null })
    return mockEnvelopeResponse({ data: plant })
  } },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/plants', handler: (ctx) => {
    const plants = gridDemoPlants(ctx)
    return mockEnvelopeResponse({
      data: {
        items: plants,
        summary: { visibleCount: plants.length, windCount: plants.filter((p) => p.plantType === 'wind').length, solarCount: plants.filter((p) => p.plantType === 'solar').length, totalCapacityMw: plants.reduce((s, p) => s + (p.capacityMw ?? 0), 0), verifiedCount: plants.length, approximateCount: 0, overriddenCount: 0 },
        catalog: null,
        dataAvailability: { status: 'available', reason: '演示空间资产（Mock）', regionRequested: gridDemoRegionId(), regionServed: gridDemoRegionId(), fallback: false }
      },
      total: plants.length,
      sourceType: 'DB'
    })
  } },
  { method: 'PATCH', prefix: '/api/v1/grid/geo-assets/plants/', handler: (ctx) => mockEnvelopeResponse({ data: { asset: ctx.body, revisionId: `mock-rev-${Date.now()}`, revertOf: null, idempotent: false } }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/nodes/', handler: (ctx) => {
    // /nodes/{nodeId}[/{revisions}]
    const segments = ctx.url.pathname.replace(/\/+$/, '').split('/')
    const tail = segments.slice(segments.indexOf('nodes') + 1)
    const node = gridDemoNodes(ctx).find((item) => item.nodeId === decodeURIComponent(tail[0] ?? ''))
    if (!node) return mockEnvelopeResponse({ data: null })
    if (tail[1] === 'revisions') {
      const revision = {
        revisionId: `mock-rev-${node.nodeId}-1`, assetId: node.nodeId, assetVersion: 1, operation: 'SEED',
        before: null, after: node,
        actor: { userId: 'mock-demo', role: 'ADMIN', companyId: node.ownerCompanyId, regionId: node.regionId },
        reason: '演示种子版本（Mock）', evidence: [], requestId: `mock-req-${node.nodeId}`, revertOf: null, createdAt: gridDemoNow()
      }
      return mockEnvelopeResponse({ data: { rows: [revision], total: 1, currentVersion: 1 } })
    }
    return mockEnvelopeResponse({ data: node })
  } },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/nodes', handler: (ctx) => {
    const items = gridDemoNodes(ctx)
    return mockEnvelopeResponse({
      data: {
        items,
        summary: { visibleCount: items.length, locatedCount: items.length, approximateCount: 0, unresolvedCount: 0, overriddenCount: 0 },
        pagination: { page: 1, pageSize: items.length, total: items.length, totalPages: 1 },
        dataAvailability: { status: 'available', fallback: false }
      },
      total: items.length,
      sourceType: 'DB'
    })
  } },
  { method: 'POST', prefix: '/api/v1/grid/geo-assets/nodes', handler: (ctx) => mockEnvelopeResponse({ data: { asset: { ...(ctx.body as Record<string, unknown>), assetId: `mock-node-new-${Date.now()}`, version: 1 }, revisionId: `mock-rev-${Date.now()}`, revertOf: null, idempotent: false } }) },
  { method: 'PATCH', prefix: '/api/v1/grid/geo-assets/nodes/', handler: (ctx) => mockEnvelopeResponse({ data: { asset: ctx.body, revisionId: `mock-rev-${Date.now()}`, revertOf: null, idempotent: false } }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/topology/manifest', handler: (ctx) => mockEnvelopeResponse({ data: gridDemoTopologyManifest(ctx), sourceType: 'CONFIG' }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/topology/evidence', handler: (ctx) => {
    const regionId = gridDemoRegionId()
    const operator = gridDemoOperatorOf(regionId)
    const features = gridDemoTopologyFeatures(ctx)
    return mockEnvelopeResponse({
      data: {
        contractVersion: '1.0.0',
        registryVersion: 'mock-evidence-1',
        items: [{
          sourceId: 'mock-osm-demo',
          sourceRef: 'mock-osm-demo@mock-v1',
          status: 'authorized',
          version: 'mock-v1',
          asOf: gridDemoNow(),
          crs: 'WGS84',
          regionId,
          gridOperator: operator,
          availability: 'available',
          reason: 'ok',
          features: features.map((feature) => ({
            stableId: feature.featureId,
            kind: feature.kind === 'branch' ? 'line' : 'substation',
            originKey: `mock-${feature.featureId}`,
            sourceRef: 'mock-osm-demo@mock-v1',
            name: feature.name,
            voltage: feature.kind === 'substation' ? '500kV' : '220kV',
            geometryStatus: 'resolved',
            geometry: feature.geometry
          })),
          unresolvedFeatureIds: [],
          license: '演示授权（Mock）',
          licenseUrl: 'mock://grid-geo/license',
          attribution: '演示集团（Mock）',
          revocable: true
        }],
        dataAvailability: { status: 'available', reason: '演示授权证据已登记（Mock）', regionRequested: regionId, regionServed: regionId, fallback: false }
      },
      sourceType: 'IMPORT'
    })
  } },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/topology/snapshot', handler: (ctx) => {
    const features = gridDemoTopologyFeatures(ctx)
    return mockEnvelopeResponse({ data: { ...gridDemoTopologyManifest(ctx), query: { lod: Number(ctx.url.searchParams.get('lod') ?? 0) }, features, total: features.length, nextCursor: null }, sourceType: 'CONFIG' })
  } },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/weather/current', handler: (ctx) => mockEnvelopeResponse({ data: gridDemoWeather(ctx), basis: 'demo', sourceType: 'API' }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/disclosures/providers', handler: () => mockEnvelopeResponse({
    data: {
      providers: [{
        providerId: 'mock-grid-disclosure',
        gridOperator: gridDemoOperatorOf(gridDemoRegionId()),
        name: '演示电网信息披露（Mock）',
        regionIds: [gridDemoRegionId()],
        sourceType: 'IMPORT',
        mock: true,
        productionWrite: false,
        access: '演示授权导出',
        originalLinkPolicy: '演示模式不提供外链',
        license: '演示授权（Mock）',
        eventCount: 12,
        dataAvailability: { status: 'available', reason: '演示披露已编译（Mock）' }
      }],
      contractVersion: '1.0.0'
    }
  }) },
  { method: 'PUT', prefix: '/api/v1/grid/geo-assets/disclosures/events/', handler: (ctx) => mockEnvelopeResponse({ data: { overlay: { ...(ctx.body as Record<string, unknown>), eventId: ctx.url.pathname.split('/').pop(), version: 1, updatedBy: 'mock-demo', updatedAt: gridDemoNow() } } }) },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/disclosures/events/', handler: (ctx) => {
    const eventId = ctx.url.pathname.split('/').pop() ?? ''
    const event = gridDemoDisclosureEvents(ctx).find((item) => item.eventId === eventId)
    if (!event) return mockEnvelopeResponse({ data: null })
    return mockEnvelopeResponse({ data: { event, overlays: [] } })
  } },
  { method: 'GET', prefix: '/api/v1/grid/geo-assets/disclosures/events', handler: (ctx) => {
    const items = gridDemoDisclosureEvents(ctx)
    const categories = [...new Set(items.map((item) => item.category))]
    return mockEnvelopeResponse({
      data: { items, total: items.length, page: 1, pageSize: items.length, categories, dataAvailability: { status: 'available', reason: '演示披露事件（Mock）', fallback: false } }
    })
  } },
  { method: 'GET', prefix: '/agent-api/v1/spot/node-price/daily', handler: spotNodePriceDaily },
  { method: 'GET', prefix: '/agent-api/v1/spot/node-price/series', handler: spotNodePriceSeries },
  { method: 'GET', prefix: '/agent-api/v1/spot/node-price/heatmap', handler: spotNodePriceHeatmap },
  { method: 'GET', prefix: '/api/v1/geo/boundary/', handler: geoBoundaryHandler },
  { method: 'GET', prefix: '/agent-api/agent/alerts', handler: () => alertListHandler() },
  { method: 'POST', prefix: '/agent-api/agent/alerts/scan', handler: () => {
    const created: MockAlert = {
      id: `mock-alert-${Date.now()}`,
      ts: Date.now(),
      kind: 'spread',
      severity: 'medium',
      region_id: 'shanxi',
      region_name: '山西',
      title: '扫描新增：晚峰价差收窄',
      detail: '扫描时点价差 52.3 元/MWh，接近阈值，持续关注（演示数据）',
      basis: '价差异动哨兵',
      status: 'open'
    }
    mockAlertStore.unshift(created)
    return mockJsonResponse({ ok: true, created: 1, msg: '演示模式：已模拟扫描，新增 1 条告警' })
  } },
  { method: 'POST', prefix: '/agent-api/agent/alerts/', handler: (ctx) => {
    // /alerts/<id>/dismiss：从演示告警存储中移除对应条目
    const id = ctx.url.pathname.split('/')[4]
    const idx = mockAlertStore.findIndex((a) => a.id === id)
    if (idx >= 0) mockAlertStore.splice(idx, 1)
    return mockJsonResponse({ ok: true })
  } },
  { method: 'DELETE', prefix: '/agent-api/agent/alerts', handler: () => {
    mockAlertStore.length = 0
    return mockJsonResponse({ ok: true })
  } },
  { method: 'GET', prefix: '/agent-api/agent/quant/monitor', handler: quantMonitor },
  { method: 'POST', prefix: '/agent-api/agent/quant/monitor', handler: quantMonitor },
  { method: 'GET', prefix: '/agent-api/agent/quant/exposure', handler: quantExposure },
  { method: 'POST', prefix: '/agent-api/agent/quant/exposure', handler: quantExposure },
  { method: 'POST', prefix: '/agent-api/agent/quant/review', handler: quantReview },
  { method: 'POST', prefix: '/agent-api/agent/quant/cvar', handler: () => mockJsonResponse({
    var_95: 3.1, var_99: 5.4, cvar_95: 4.2, cvar_99: 6.8, max_drawdown: 0.082,
    volatility: 0.14, sharpe_ratio: 1.36, sortino_ratio: 1.72, tail_risk: 0.03,
    source: 'mock-demo', mock: true
  }) },
  { method: 'GET', prefix: '/agent-api/agent/quant/reports', handler: () => mockJsonResponse({
    reports: Array.from({ length: 6 }, (_, i) => {
      const d = dateStr(-i)
      return { session_id: `mock-report-${i}`, path: `/mock/reports/${d}.md`, title: `${d} 交易复盘日报`, mtime: Date.parse(`${d}T18:00:00+08:00`) }
    })
  }) },
  { method: 'GET', prefix: '/agent-api/agent/review/template-instances', handler: () => {
    const week = `${dateStr(0).slice(0, 4)}-W${Math.ceil((Number(dateStr(0).slice(5, 7)) * 4 + Number(dateStr(0).slice(8, 10))) / 7)}`
    const instances = [
      { id: 'mi-01', template_id: 'T07', period_key: `daily:${dateStr(-1)}`, status: 'pending', due_at: `${dateStr(0)}T18:00:00+08:00`, updated_at: `${dateStr(-1)}T09:00:00+08:00` },
      { id: 'mi-02', template_id: 'T08', period_key: `daily:${dateStr(-1)}`, status: 'draft', due_at: `${dateStr(0)}T18:00:00+08:00`, updated_at: `${dateStr(0)}T08:30:00+08:00` },
      { id: 'mi-03', template_id: 'S3', period_key: `daily:${dateStr(0)}`, status: 'pending', due_at: `${dateStr(1)}T10:00:00+08:00`, updated_at: `${dateStr(-1)}T17:00:00+08:00` },
      { id: 'mi-04', template_id: 'T02', period_key: `weekly:${week}`, status: 'draft', due_at: `${dateStr(2)}T18:00:00+08:00`, updated_at: `${dateStr(-2)}T14:00:00+08:00` },
      { id: 'mi-05', template_id: 'T05', period_key: `weekly:${week}`, status: 'submitted', due_at: `${dateStr(-1)}T18:00:00+08:00`, updated_at: `${dateStr(-2)}T10:00:00+08:00` }
    ]
    return mockJsonResponse({ code: 200, data: instances, instances })
  } },
  { method: 'PATCH', prefix: '/agent-api/agent/review/template-instances/', handler: () => mockJsonResponse({ code: 200 }) },
  // —— 复盘事件库 / 决策日志（裸 JSON 客户端，C.21 验收修复：此前未覆盖 →
  //    「决策日志/改进记录暂时无法读取」降级提示，复盘中心决策评价/改进验证两 tab 空态）——
  { method: 'GET', prefix: '/agent-api/agent/review/decision-logs/verify', handler: () => mockJsonResponse({ code: 200, data: { engine: 'server-sha256', verdict: 'ok' } }) },
  { method: 'POST', prefix: '/agent-api/agent/review/decision-logs', handler: (ctx) => mockJsonResponse({ code: 200, data: { id: `mock-dl-${Date.now().toString(36)}`, seq: decisionLogRows.length + 1, ...ctx.body } }) },
  { method: 'GET', prefix: '/agent-api/agent/review/decision-logs', handler: (ctx) => {
    // 视图按所选复盘日的 target_date 过滤——按请求日期改写种子条目，任意复盘日都有决策日志
    const target = ctx.url.searchParams.get('target_date')
    const rows = target
      ? decisionLogRows.map((row, i) => ({
          ...row,
          id: `mock-dl-${target}-${i + 1}`,
          targetDate: target,
          at: `${target}T09:${String(10 + i * 5).padStart(2, '0')}:00+08:00`
        }))
      : decisionLogRows
    return mockJsonResponse({ code: 200, data: rows })
  } },
  { method: 'GET', prefix: '/agent-api/agent/review/improvement-actions', handler: () => mockJsonResponse({ code: 200, data: improvementActionRows }) },
  { method: 'POST', prefix: '/agent-api/agent/review/improvement-actions', handler: (ctx) => mockJsonResponse({ code: 200, data: { id: `mock-ia-${Date.now().toString(36)}`, status: 'open', ...ctx.body } }) },
  { method: 'GET', prefix: '/agent-api/agent/review/risk-events', handler: () => mockJsonResponse({ code: 200, data: riskEventRows }) },
  { method: 'GET', prefix: '/agent-api/agent/review/cases', handler: () => mockJsonResponse({ code: 200, data: reviewCaseRows }) },
  { method: 'GET', prefix: '/agent-api/agent/quant/', handler: (ctx) => {
    const date = ctx.url.searchParams.get('date') ?? dateStr(0)
    const curve = curve96('price', `quant:${ctx.url.pathname}:${date}`, date)
    return mockJsonResponse({
      mock: true,
      source: 'mock-demo',
      note: '演示模式（Mock 演示账号，不接真实数据）',
      total: curve.length,
      points: curve,
      series: TIME_AXIS_96.map((time, i) => ({ time, value: curve[i], da: curve[i], rt: Math.round(curve[i] * 1.05 * 10) / 10, spread: Math.round(curve[i] * 0.05 * 10) / 10 }))
    })
  } },
  { method: 'POST', prefix: '/agent-api/agent/quant/', handler: (ctx) => {
    const date = String(ctx.body.date ?? dateStr(0))
    const curve = curve96('price', `quant:${ctx.url.pathname}:${date}`, date)
    return mockJsonResponse({
      mock: true,
      source: 'mock-demo',
      note: '演示模式（Mock 演示账号，不接真实数据）',
      total: curve.length,
      points: curve,
      series: TIME_AXIS_96.map((time, i) => ({ time, value: curve[i], da: curve[i], rt: Math.round(curve[i] * 1.05 * 10) / 10, spread: Math.round(curve[i] * 0.05 * 10) / 10 }))
    })
  } },
  { method: 'GET', prefix: '/agent-api/v1/market-insight/bundle', handler: (ctx) => {
    const date = ctx.url.searchParams.get('date') ?? dateStr(0)
    const region = ctx.url.searchParams.get('region') ?? 'shanxi'
    const da = curve96('price', `insight-da:${date}`, date)
    const rt = curve96('price', `insight-rt:${date}`, date)
    const elasticityCurve = curve96('price', `elasticity:${date}`, date).map((v) => ({ x: Math.round((v % 300) + 50), y: Math.round((v % 200) + 20) }))
    return mockJsonResponse({
      meta: { schema_version: 1, date, region, region_name: ctx.url.searchParams.get('region_name') ?? '山西', market: ctx.url.searchParams.get('market') ?? '山西电力市场', generated_at: new Date().toISOString() },
      basis: 'synthetic',
      sourceType: 'MOCK',
      mock: true,
      productionWrite: false,
      data_availability: [
        { key: 'snapshot', label: '市场快照', status: 'mock', source: 'mock-demo', note: '演示数据' },
        { key: 'elasticity', label: '价格弹性', status: 'mock', source: 'mock-demo', note: '演示数据' },
        { key: 'spread', label: '日前-实时价差', status: 'mock', source: 'mock-demo', note: '演示数据' },
        { key: 'forecast_band', label: '预测区间', status: 'mock', source: 'mock-demo', note: '演示数据' }
      ],
      blocks: {
        snapshot: {
          renewable_forecast: { summary: { value: 1860, unit: 'MW' }, unit: 'MW', status: 'mock', source: 'mock-demo', preview: da.slice(0, 24) },
          platform_load: { summary: { value: 12450, unit: 'MW' }, unit: 'MW', status: 'mock', source: 'mock-demo', preview: rt.slice(0, 24) },
          day_avg_price: { summary: { value: 268, unit: '元/MWh' }, unit: '元/MWh', status: 'mock', source: 'mock-demo' },
          weather: { summary: { value: '晴转多云 18~29℃' }, status: 'mock', source: 'mock-demo' }
        },
        elasticity: { available: true, status: 'mock', points: elasticityCurve, slope: -0.42, r2: 0.81, note: '演示弹性曲线' },
        spread: {
          available: true, status: 'mock', threshold: 60,
          series: TIME_AXIS_96.map((time, i) => ({ time, da: da[i], rt: Math.round(rt[i] * 10) / 10, spread: Math.round((rt[i] - da[i]) * 10) / 10 })),
          positive_mwh: 412, negative_mwh: 286
        },
        node_price: { available: true, status: 'mock', nodes: [
          { node: '太原演示节点', price: 261.4 }, { node: '大同演示节点', price: 238.7 }, { node: '临汾演示节点', price: 279.2 }
        ] },
        forecast_band: {
          band: { p10: 182, p50: 268, p90: 396 },
          p10: da.map((v) => Math.max(0, Math.round(v - 42))),
          p50: da,
          p90: da.map((v) => Math.round(v + 48))
        },
        anomalies: [
          { type: 'spread_outlier', severity: 'mid', time: `${date} 20:15`, value: 118.4, threshold: 60, message: '演示：晚峰时段日前-实时价差超阈值' },
          { type: 'negative_price', severity: 'low', time: `${date} 13:30`, value: -12.6, threshold: 0, message: '演示：午间光伏大发出现负价风险提示' }
        ]
      },
      narrative: '演示模式：山西市场 synthetic 洞察快照（Mock 演示账号，不接真实数据）。',
      gaps: [],
      assumptions: { note: '全部数值为前端演示数据' },
      ui: { components: [{ component: 'snapshot-card', block: 'snapshot' }, { component: 'elasticity-chart', block: 'elasticity' }, { component: 'spread-chart', block: 'spread' }] }
    })
  } },
  { method: 'GET', prefix: '/agent-api/v1/spot/elasticity', handler: () => mockJsonResponse({
    available: true, status: 'mock', slope: -0.42, r2: 0.81, segments: ['工业', '商业', '居民'],
    points: curve96('price', 'elasticity', dateStr(0)).map((v) => ({ x: Math.round((v % 300) + 50), y: Math.round((v % 200) + 20) })),
    mock: true, note: '演示数据'
  }) },
  { method: 'GET', prefix: '/agent-api/v1/spot/spread', handler: spreadSeries },
  { method: 'GET', prefix: '/agent-api/v1/forecast/models', handler: () => mockJsonResponse({
    target: 'price',
    models: [
      { id: 'knn', name: 'KNN 相似日（基线）', tier: 'baseline', available: true, supportedTargets: ['price', 'load', 'renewable'] },
      { id: 'xgboost', name: 'XGBoost', tier: 'core', available: true, supportedTargets: ['price', 'load', 'renewable'] },
      { id: 'lightgbm', name: 'LightGBM', tier: 'core', available: true, supportedTargets: ['price', 'load', 'renewable'] }
    ]
  }) },
  { method: 'POST', prefix: '/agent-api/v1/forecast/predict', handler: forecastPredict },
  { method: 'POST', prefix: '/agent-api/v1/forecast/backtest', handler: () => mockJsonResponse({
    basis: 'forecast',
    aggregate: { mae: 38.6, rmse: 51.2, naive_mae: 55.4, knn_mae: 42.9, mase_vs_naive: 0.7, improve_vs_knn_pct: 10.0, n_test_days: 15, beats_naive: true },
    per_day: [],
    mock: true
  }) },
  { method: 'GET', prefix: '/agent-api/v1/forecast/latest', handler: forecastLatest },
  { method: 'GET', prefix: '/agent-api/agent/forecast/bid-plans/latest', handler: (ctx) => {
    const targetDate = ctx.url.searchParams.get('target_date') ?? dateStr(1)
    return mockJsonResponse({
      plan: {
        plan_id: `mock-plan-${targetDate}`,
        target_date: targetDate,
        status: 'ok',
        price_model_id: 'mock_da_price_v1',
        frontier: [
          { lambda: 0.82, risk_level: 'conservative', total_declared_mwh: 452.6, expected_profit_yuan: 158400, expected_revenue_yuan: 192100, expected_penalty_yuan: 4300, var_loss_yuan: 8900, cvar_loss_yuan: 12400 },
          { lambda: 1.0, risk_level: 'neutral', total_declared_mwh: 480.2, expected_profit_yuan: 216000, expected_revenue_yuan: 268300, expected_penalty_yuan: 6100, var_loss_yuan: 15200, cvar_loss_yuan: 20800 },
          { lambda: 1.24, risk_level: 'aggressive', total_declared_mwh: 511.8, expected_profit_yuan: 262500, expected_revenue_yuan: 331200, expected_penalty_yuan: 12800, var_loss_yuan: 26400, cvar_loss_yuan: 35700 }
        ],
        basis: { settlement_mock_fields: ['settlement_coef'] }
      },
      mock: true,
      note: '演示报价方案（Mock 演示账号）：决策支持参考·非申报/结算依据'
    })
  } },
  { method: 'POST', prefix: '/pi-api/agent/sessions', handler: agentSessionCreate },
  { method: 'POST', prefix: '/agent-api/agent/sessions', handler: agentSessionCreate },
  { method: 'GET', prefix: '/pi-api/agent/sessions', handler: () => mockJsonResponse({ status: 'ok' }) },
  { method: 'GET', prefix: '/agent-api/agent/sessions', handler: () => mockJsonResponse({ status: 'ok' }) },
  { method: 'POST', prefix: '/pi-api/agent/sessions/', handler: (ctx) => (ctx.url.pathname.endsWith('/stream') ? agentStream() : agentMessage(ctx)) },
  { method: 'POST', prefix: '/agent-api/agent/sessions/', handler: (ctx) => (ctx.url.pathname.endsWith('/stream') ? agentStream() : agentMessage(ctx)) },
  { method: 'GET', prefix: '/pi-api/agent/sessions/', handler: agentStream },
  { method: 'GET', prefix: '/agent-api/agent/sessions/', handler: agentStream },
  { method: 'GET', prefix: '/api/agent-history/', handler: historyHandler },
  { method: 'POST', prefix: '/api/agent-history/', handler: historyHandler },
  { method: 'PATCH', prefix: '/api/agent-history/', handler: historyHandler },
  { method: 'DELETE', prefix: '/api/agent-history/', handler: historyHandler }
]

function parseBody(init?: RequestInit): Record<string, unknown> {
  const raw = init?.body
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** mock 态统一入口：按路由表解析，未命中走 fail-open 兜底（绝不回源真实后端）。
 *  异步签名：fixtures 取件（动态 import JSON）在 handler 内完成；fetch 守卫本身是
 *  async 包装，直接返回该 Promise 即可，真实账号路径零影响。 */
export async function resolveMockRequest(method: string, url: URL, init?: RequestInit): Promise<Response> {
  mockStats.intercepted += 1
  const ctx: MockContext = { method, url, body: parseBody(init) }
  for (const route of ROUTES) {
    if (route.method === method && url.pathname.startsWith(route.prefix)) {
      return route.handler(ctx)
    }
  }
  return fallbackResponse(ctx)
}
