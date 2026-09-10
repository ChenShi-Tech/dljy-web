// @vitest-environment happy-dom
// Mock 演示层纯函数单测：会话判定 / 缓存清理 / 路由表兜底语义 / 主线 handler 形状 / 申报动线 /
// 价格曲线真实形态标定 / 采集 fixtures 链路（zrqsb 日期索引 / zptqx 清单 / 真实日曲线同源）。
import { beforeEach, describe, expect, it } from 'vitest'
import { isMockActive, isMockDemoUsername, resetSessionScopedCaches } from './session'
import { resolveMockRequest } from './router'
import { curve96, dateStr } from './generators'
import { hasAnyFixture } from './fixtures'

const USER_KEY = 'dljy_governance_user'

function setUser(username: string | null) {
  if (username === null) {
    localStorage.removeItem(USER_KEY)
    return
  }
  localStorage.setItem(USER_KEY, JSON.stringify({ username, roleCode: 'ADMIN' }))
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('mock 会话判定', () => {
  it('mock- 前缀判定（大小写不敏感）', () => {
    expect(isMockDemoUsername('mock-demo')).toBe(true)
    expect(isMockDemoUsername('  MOCK-boss ')).toBe(true)
    expect(isMockDemoUsername('admin')).toBe(false)
    expect(isMockDemoUsername('demo')).toBe(false)
    expect(isMockDemoUsername(null)).toBe(false)
    expect(isMockDemoUsername(undefined)).toBe(false)
  })

  it('isMockActive 跟随登录态且按原始串刷新', () => {
    setUser(null)
    expect(isMockActive()).toBe(false)
    setUser('mock-demo')
    expect(isMockActive()).toBe(true)
    setUser('admin')
    expect(isMockActive()).toBe(false)
    setUser(null)
    expect(isMockActive()).toBe(false)
  })

  it('缓存清理移除 mock 命名空间与跨账号缓存键', () => {
    sessionStorage.setItem('dljy.mock.declarations', '[]')
    localStorage.setItem('dljy.currentCompanyId', 'comp-x')
    localStorage.setItem('dljy_governance_user', '{"username":"admin"}')
    resetSessionScopedCaches()
    expect(sessionStorage.getItem('dljy.mock.declarations')).toBeNull()
    expect(localStorage.getItem('dljy.currentCompanyId')).toBeNull()
    expect(localStorage.getItem('dljy_governance_user')).not.toBeNull()
  })
})

describe('mock 路由表', () => {
  it('未覆盖接口 fail-open 到空信封（绝不回源），并带 mock 标注头', async () => {
    const res = await resolveMockRequest('GET', new URL('http://localhost/api/some/unknown?family=x'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-data-mock')).toBe('true')
    const body = await jsonOf(res)
    expect(body.code).toBe(200)
    expect(body.mock).toBe(true)
    expect(body.provenance).toMatchObject({ sourceType: 'DEMO' })
  })

  it('云南主线 da_user_price 返回 24 点小时价', async () => {
    const url = new URL('http://localhost/api/real?family=yn_system_forecast&match=da_user_price&dateFrom=2026-09-08&dateTo=2026-09-08&region=yunnan')
    const body = await jsonOf(await resolveMockRequest('GET', url))
    const rows = body.data as Array<{ operateDate: string; timePoint: string; value: number }>
    expect(rows).toHaveLength(24)
    expect(rows[0].timePoint).toBe('00:00')
    expect(typeof rows[0].value).toBe('number')
  })

  it('real-coverage 返回日前/实时两个 datasetKey', async () => {
    const body = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/real-coverage?family=yn_system_forecast&region=yunnan')))
    const datasets = (body.data as { datasets: Array<{ datasetKey: string }> }).datasets
    expect(datasets.map((d) => d.datasetKey)).toEqual(['da_user_price', 'rt_user_price'])
  })

  it('quant/forecast 裸 JSON 端点直出形状（96 点预测 + mock 标注）', { timeout: 30_000 }, async () => {
    const body = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/agent-api/v1/forecast/latest?region_id=yunnan&target=price&target_date=2026-09-09')))
    expect(body.available).toBe(true)
    const run = (body.runs as Array<{ points: number[]; mock: boolean }>)[0]
    expect(run.points).toHaveLength(96)
    expect(run.mock).toBe(true)
  })
})

describe('申报动线（会话级 mock 存储）', () => {
  it('种子列表 → 创建草稿 → 送审转移', async () => {
    const listBody = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/v1/trading/spot/declarations?limit=50')))
    const page = listBody.data as { rows: Array<{ id: string; status: string }>; counts: Record<string, number> }
    expect(page.rows.length).toBeGreaterThanOrEqual(5)
    expect(page.counts.LIVE).toBe(page.rows.length)

    const createBody = await jsonOf(await resolveMockRequest('POST', new URL('http://localhost/api/v1/trading/spot/declarations'), {
      body: JSON.stringify({ targetDate: '2026-09-09', capacityMw: 480, mode: 'LIVE' })
    }))
    const created = createBody.data as { id: string; status: string }
    expect(created.status).toBe('DRAFT')

    const submitBody = await jsonOf(await resolveMockRequest('POST', new URL(`http://localhost/api/v1/trading/spot/declarations/${created.id}/submit-for-approval`), {
      body: JSON.stringify({})
    }))
    expect((submitBody.data as { status: string }).status).toBe('PENDING_APPROVAL')
  })

  it('风险检查返回十项且不硬阻断', async () => {
    const body = await jsonOf(await resolveMockRequest('POST', new URL('http://localhost/api/v1/trading/spot/declarations/MOCK-ORD-D1/risk-check'), {
      body: JSON.stringify({})
    }))
    const data = body.data as { riskCheck: { checks: unknown[]; passed: boolean; blocked: boolean } }
    expect(data.riskCheck.checks).toHaveLength(10)
    expect(data.riskCheck.passed).toBe(true)
    expect(data.riskCheck.blocked).toBe(false)
  })
})

describe('确定性生成器', () => {
  it('同 seedKey 恒同曲线（页面来回切换不跳变）', () => {
    expect(curve96('price', 'k', '2026-09-08')).toEqual(curve96('price', 'k', '2026-09-08'))
    expect(curve96('price', 'k', '2026-09-08')).not.toEqual(curve96('load', 'k', '2026-09-08'))
  })

  it('价格曲线为山西鸭子曲线形态标定（C.20）：午间深谷 / 傍晚尖峰 / 量纲有界', () => {
    for (const date of ['2026-09-08', '2026-09-09', '2026-06-13', '2026-06-14']) {
      const curve = curve96('price', 'spec', date)
      expect(curve).toHaveLength(96)
      const avg = curve.reduce((s, v) => s + v, 0) / 96
      expect(avg, '均价落在真实量纲带内').toBeGreaterThan(120)
      expect(avg).toBeLessThan(420)
      expect(Math.min(...curve), '真实下限 0（负价封底）').toBeGreaterThanOrEqual(0)
      expect(Math.max(...curve), '真实上限 1500（限价）').toBeLessThanOrEqual(1500)
      const night = curve.slice(0, 24).reduce((s, v) => s + v, 0) / 24
      const midday = curve.slice(44, 60).reduce((s, v) => s + v, 0) / 16
      const eveningPeak = Math.max(...curve.slice(68, 84))
      expect(midday, '午间光伏深谷显著低于夜间平台').toBeLessThan(night * 0.55)
      expect(eveningPeak, '傍晚尖峰为全日最高区').toBeGreaterThan(night)
    }
  })

  it('和风天气代理：now/15d/lookup 三形态（驾驶舱天气网格演示数据，C.24）', async () => {
    const now = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/qweather?path=/v7/weather/now&location=112.55,37.87')))
    expect((now.now as { temp: string }).temp).toBeTruthy()
    expect((now.now as { text: string }).text.length).toBeGreaterThan(0)
    const d15 = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/qweather?path=/v7/weather/15d&location=112.55,37.87')))
    const daily = d15.daily as Array<{ fxDate: string; textDay: string; tempMax: string; tempMin: string }>
    expect(daily).toHaveLength(15)
    expect(daily[0].fxDate).toBe(dateStr(0))
    expect(Number(daily[0].tempMax)).toBeGreaterThan(Number(daily[0].tempMin))
    const geo = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/qweather?path=/geo/v2/city/lookup&location=112.55,37.87')))
    expect((geo.location as Array<{ name: string }>)[0].name).toBe('太原')
  })

  it('外部气象源演示应答（天气预报页 Open-Meteo 直连，C.24）', async () => {
    const { mockExternalWeatherResponse } = await import('./externalWeather')
    const fc = await jsonOf(await mockExternalWeatherResponse(new URL('https://api.open-meteo.com/v1/forecast?latitude=37.87&longitude=112.55&daily=weather_code&timezone=Asia%2FShanghai')) as Response)
    expect(fc.current.temperature_2m).toBeTypeOf('number')
    expect(fc.daily.time as unknown[]).toHaveLength(15)
    expect(fc.hourly.time as unknown[]).toHaveLength(360)
    const geo = await jsonOf(await mockExternalWeatherResponse(new URL('https://geocoding-api.open-meteo.com/v1/search?name=%E5%A4%AA%E5%8E%9F&count=10')) as Response)
    expect(geo.results[0].name).toBe('太原')
    expect(await mockExternalWeatherResponse(new URL('https://api.example.com/other'))).toBeNull()
  })

  it('quant 监盘：96 点 da/rt/spread 序列 + 真实峰谷窗口统计', async () => {
    const body = await jsonOf(await resolveMockRequest('POST', new URL('http://localhost/agent-api/agent/quant/monitor'), {
      body: JSON.stringify({ date: '2026-09-08' })
    }))
    const series = body.series as Array<{ time: string; da: number; rt: number; spread: number }>
    expect(series).toHaveLength(96)
    const peakValley = body.peak_valley as { spread_ratio: number }
    expect(Number.isFinite(peakValley.spread_ratio)).toBe(true)
    for (const point of series) {
      expect(Number.isFinite(point.da) && Number.isFinite(point.rt) && Number.isFinite(point.spread)).toBe(true)
    }
  })
})

describe.skipIf(!hasAnyFixture())('采集 fixtures 链路（现货交易域，C.20）', () => {
  it('日前上报：real-list 走侧车内容日期索引，日期 match 命中分组文档', async () => {
    const listBody = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/real-list?family=sdpt_zrqsb')))
    const files = listBody.data as Array<{ file: string; date?: string }>
    expect(files.length).toBeGreaterThanOrEqual(90)
    expect(files.every((f) => typeof f.file === 'string' && typeof f.date === 'string')).toBe(true)
    const dates = files.map((f) => f.date!)
    expect(dates).toContain('2026-06-04')

    const docBody = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/real?family=sdpt_zrqsb&match=2026-06-04&region=shanxi')))
    const doc = docBody.data as Record<string, unknown>
    expect(doc, 'hash 命名族按日期索引命中分组文档').toBeTruthy()
    expect(Array.isArray(doc.dl), '真实文档含电量容器').toBe(true)
  })

  it('日前电量预估：list 子串匹配出真实行集', async () => {
    const body = await jsonOf(await resolveMockRequest('GET', new URL('http://localhost/api/real?family=sdpt_zptqx&match=list&region=shanxi')))
    const rows = (body.data ?? body.rows) as unknown[]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('智能体域价格与驾驶舱同源：quant 监盘取采集窗口内真实曲线', async () => {
    const body = await jsonOf(await resolveMockRequest('POST', new URL('http://localhost/agent-api/agent/quant/monitor'), {
      body: JSON.stringify({ date: '2026-06-02' })
    }))
    expect(body.source, '采集窗口内走 fixtures 真实曲线').toBe('capture-fixture')
    const series = body.series as Array<{ da: number }>
    expect(series).toHaveLength(96)
  })
})
