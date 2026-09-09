// @vitest-environment happy-dom
// 复盘天气服务测试：守三类诚实语义——缺日不入 Map（再分析延迟近几日）、整体失败返回 null
// （区别于部分缺日）、未登记地区不出代表点（不出别处的数）。格式化函数锁「留空不出 —」口径。
// 坏掉的症状：天气源挂了页面冒出装饰性温度，或别省天气串进当前复盘。
// （happy-dom pragma：reviewWeather → api.ts → regionContext 模块级读 localStorage，
//  node project 纯 jsdom 缺席会炸模块加载；按 DEVELOPMENT.md §5.1 按文件切环境。）
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDailyWeather,
  regionWeatherCity,
  weatherCellText,
  weatherChipText,
  weatherChipTooltip,
  weatherIconKind
} from './reviewWeather'

const TAIYUAN = { city: '太原', lon: 112.55, lat: 37.87 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('regionWeatherCity', () => {
  it('登记地区给代表点；未登记地区返回 null（不外借别省坐标）', () => {
    expect(regionWeatherCity('shanxi')).toMatchObject({ city: '太原' })
    expect(regionWeatherCity('yunnan')).toMatchObject({ city: '昆明' })
    expect(regionWeatherCity('sichuan')).toBeNull()
  })
})

describe('fetchDailyWeather', () => {
  const okBody = {
    daily: {
      time: ['2026-05-15', '2026-05-16', '2026-05-17'],
      weather_code: [3, 63, null],
      temperature_2m_max: [28.9, 21.5, null],
      temperature_2m_min: [19.5, 17.6, 15.1]
    }
  }

  it('逐日聚合为 Map（温度取整、WMO 码转中文）；缺温度的日不入 Map（再分析延迟场景）', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, json: async () => okBody }))
    vi.stubGlobal('fetch', fetchMock)
    const map = await fetchDailyWeather(TAIYUAN, '2026-05-15', '2026-05-17')
    expect(map).not.toBeNull()
    expect(map!.size).toBe(2) // 05-17 缺 max 温度，如实缺席
    expect(map!.get('2026-05-15')).toMatchObject({ txt: '阴', tMin: 20, tMax: 29 })
    expect(map!.get('2026-05-16')!.txt).toBe('中雨')
    // 请求 URL 带区间与代表点坐标
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('archive-api.open-meteo.com')
    expect(url).toContain('start_date=2026-05-15')
    expect(url).toContain('latitude=37.87')
  })

  it('HTTP 失败 / 响应无 daily / 请求异常 → 整体 null（调用方给失败态而非空 Map 冒充成功）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
    expect(await fetchDailyWeather(TAIYUAN, '2026-05-15', '2026-05-16')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ daily: { time: [] } }) })))
    expect(await fetchDailyWeather(TAIYUAN, '2026-05-15', '2026-05-16')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await fetchDailyWeather(TAIYUAN, '2026-05-15', '2026-05-16')).toBeNull()
  })

  it('日期形状/区间非法直接 null，不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchDailyWeather(TAIYUAN, '2026-5-15', '2026-05-16')).toBeNull()
    expect(await fetchDailyWeather(TAIYUAN, '2026-05-16', '2026-05-15')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('展示格式化', () => {
  const w = { date: '2026-05-15', wmo: 3, txt: '阴', tMin: 20, tMax: 29 }
  it('单元格：无数据返回空串（留空，不出「—」冒充观测值）', () => {
    expect(weatherCellText(w)).toBe('阴 20~29°')
    expect(weatherCellText(undefined)).toBe('')
  })
  it('chip 文本与悬停全文：前一日缺数如实标注，口径注记带「不进考核」', () => {
    expect(weatherChipText(w)).toBe('阴 20~29°')
    const tip = weatherChipTooltip('太原', w, undefined)
    expect(tip).toContain('太原 2026-05-15：阴，20~29°C')
    expect(tip).toContain('前一日无天气数据')
    expect(tip).toContain('不进任何考核计算')
    const tip2 = weatherChipTooltip('太原', w, { date: '2026-05-14', wmo: 0, txt: '晴', tMin: 18, tMax: 27 })
    expect(tip2).toContain('前一日 05-14：晴，18~27°C')
  })
  it('WMO 码图标分类：晴/雨/雪/雷/雾/云各归其类', () => {
    expect(weatherIconKind(0)).toBe('sun')
    expect(weatherIconKind(3)).toBe('cloud')
    expect(weatherIconKind(63)).toBe('rain')
    expect(weatherIconKind(73)).toBe('snow')
    expect(weatherIconKind(95)).toBe('storm')
    expect(weatherIconKind(45)).toBe('fog')
  })
})
