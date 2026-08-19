// unwrap 请求序号守卫（#1350）：共享 fetch 层只应用「最新发起请求」响应的地区头
// 快速切换数据族/地区时较早的请求若最后返回，其过期地区头不得覆盖 RegionDataBanner 状态。
import { describe, expect, it, vi } from 'vitest'

// api.ts 模块求值时 regionContext 会读 window.localStorage 初始化当前地区，
// 须先 stub window 再动态 import（node 环境无 window）。
vi.stubGlobal('window', {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { origin: 'http://localhost' }
})

const { unwrap, nextRegionHeaderSeq, regionDataStatus } = await import('@/services/api')

function servedResponse(served: string, fallback = 'false') {
  return new Response(JSON.stringify({ code: 200 }), {
    status: 200,
    headers: { 'x-region-served': served, 'x-region-fallback': fallback }
  })
}

function resetStatus() {
  regionDataStatus.value = { requested: null, served: null, fallback: false, mock: false, visibility: null, accessDenied: null }
}

describe('unwrap 地区头 seq 守卫（#1350）', () => {
  it('最新请求的响应应用地区头', async () => {
    resetStatus()
    const seq = nextRegionHeaderSeq()
    await unwrap(servedResponse('yunnan'), '/real', seq)
    expect(regionDataStatus.value.served).toBe('yunnan')
  })

  it('过期请求（较早发起、较晚返回）的响应不覆盖地区头状态', async () => {
    resetStatus()
    // 请求 A 先发起（seq 1）；随后请求 B 发起（seq 2）。B 先返回（应用 yunnan），
    // A 最后才返回：其 shanxi 回退头不得覆盖 B 已应用的状态
    const seqA = nextRegionHeaderSeq()
    const seqB = nextRegionHeaderSeq()
    await unwrap(servedResponse('yunnan'), '/real', seqB) // B 先到：应用
    await unwrap(servedResponse('shanxi', 'true'), '/real', seqA) // A 后到：过期跳过
    expect(regionDataStatus.value.served).toBe('yunnan')
    expect(regionDataStatus.value.fallback).toBe(false)
  })

  it('新请求最后返回时正常覆盖旧请求已应用的状态', async () => {
    resetStatus()
    const seqA = nextRegionHeaderSeq()
    const seqB = nextRegionHeaderSeq()
    await unwrap(servedResponse('shanxi', 'true'), '/real', seqA) // A 先到：应用（此时仍是当前请求）
    await unwrap(servedResponse('yunnan'), '/real', seqB) // B 后到：最新 → 覆盖
    expect(regionDataStatus.value.served).toBe('yunnan')
    expect(regionDataStatus.value.fallback).toBe(false)
  })

  it('不带 seq 的历史调用保持原行为（无条件应用）', async () => {
    resetStatus()
    await unwrap(servedResponse('yunnan'), '/real')
    expect(regionDataStatus.value.served).toBe('yunnan')
  })

  it('无地区头的响应即使是最新也不清空状态', async () => {
    resetStatus()
    await unwrap(servedResponse('yunnan'), '/real', nextRegionHeaderSeq())
    const seq = nextRegionHeaderSeq()
    const plain = new Response(JSON.stringify({ code: 200 }), { status: 200 })
    await unwrap(plain, '/auth/login', seq)
    expect(regionDataStatus.value.served).toBe('yunnan')
  })

  it('无头请求不推进已应用序号：其后返回的旧带头响应仍生效', async () => {
    resetStatus()
    const seqA = nextRegionHeaderSeq() // 取数请求 A（带地区头）
    const seqB = nextRegionHeaderSeq() // 随后发起的无头请求 B（/auth/info）
    await unwrap(new Response(JSON.stringify({ code: 200 }), { status: 200 }), '/auth/info', seqB)
    // A 的带头响应在 B 之后返回：不得被 B 的取号作废
    await unwrap(servedResponse('yunnan'), '/real', seqA)
    expect(regionDataStatus.value.served).toBe('yunnan')
  })

  it('带头响应之间仍按序号守卫：旧带头响应不覆盖新带头响应', async () => {
    resetStatus()
    const seqA = nextRegionHeaderSeq()
    const seqB = nextRegionHeaderSeq()
    await unwrap(servedResponse('shanxi', 'true'), '/real', seqA) // A 后到：跳过
    await unwrap(servedResponse('yunnan'), '/real', seqB) // B 后到：应用
    expect(regionDataStatus.value.served).toBe('yunnan')
  })
})
