// priceModeStorage 测试：模式记忆按 用户×地区×价格对象 分键互不串扰；
// localStorage 不可用（隐私模式/禁用/配额满/抛错）时读写静默、页面行为不受影响。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PRICE_DISPLAY_MODES, readPriceMode, writePriceMode } from './priceModeStorage'

// node 环境没有 localStorage：装一个可替换的内存实现。
function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  }
}

function throwingStorage(): Storage {
  const boom = () => {
    throw new Error('storage disabled')
  }
  return {
    length: 0,
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  }
}

const original = (globalThis as { localStorage?: Storage }).localStorage

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memoryStorage()
})

afterEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = original
})

describe('readPriceMode / writePriceMode', () => {
  it('写入后可读回；无记录回默认 single', () => {
    expect(readPriceMode('admin', 'yunnan', 'prices.user-series')).toBe('single')
    writePriceMode('admin', 'yunnan', 'prices.user-series', 'multi3d')
    expect(readPriceMode('admin', 'yunnan', 'prices.user-series')).toBe('multi3d')
  })

  it('键按 用户×地区×价格对象 区分：不同价格对象/用户/地区的记忆互不串扰', () => {
    writePriceMode('admin', 'yunnan', 'prices.public-node-series', 'heatmap')
    // 另一个价格对象
    expect(readPriceMode('admin', 'yunnan', 'prices.user-series')).toBe('single')
    // 同对象不同用户
    expect(readPriceMode('trader', 'yunnan', 'prices.public-node-series')).toBe('single')
    writePriceMode('trader', 'yunnan', 'prices.public-node-series', 'multi3d')
    expect(readPriceMode('admin', 'yunnan', 'prices.public-node-series')).toBe('heatmap')
    expect(readPriceMode('trader', 'yunnan', 'prices.public-node-series')).toBe('multi3d')
  })

  it('非法值（手改过的脏数据）回 single，不把脏值带进界面', () => {
    writePriceMode('admin', 'yunnan', 'prices.user-series', 'heatmap')
    localStorage.setItem('ynp.prices.mode|admin|yunnan|prices.user-series', '3d!!')
    expect(readPriceMode('admin', 'yunnan', 'prices.user-series')).toBe('single')
  })

  it('localStorage 抛错：读回 single、写不抛错（页面不受影响）', () => {
    ;(globalThis as { localStorage?: Storage }).localStorage = throwingStorage()
    expect(readPriceMode('admin', 'yunnan', 'prices.user-series')).toBe('single')
    expect(() => writePriceMode('admin', 'yunnan', 'prices.user-series', 'heatmap')).not.toThrow()
  })

  it('合法模式枚举恰好是三种', () => {
    expect(PRICE_DISPLAY_MODES).toEqual(['single', 'multi3d', 'heatmap'])
  })
})
