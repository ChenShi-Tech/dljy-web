// 中长期售电接口客户端的幂等键（dljy#2939）。
// 守什么：补充资料的幂等键覆盖文件完整内容——只改中间内容的两份文件必须得到不同的键，同一文件重试得到同一个键。
// 坏掉的症状：修订过的大文件与旧版本首尾相同，上传被服务端当成重复请求重放旧文件，或以「同键不同内容」拒绝。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ apiPost: vi.fn() }))

// 使用真实 api.ts 的键派生（32 位 FNV-1a），只替换发请求的函数；api.ts 依赖的地区上下文在 node 环境会读 window，换成常量。
vi.mock('@/services/region/regionContext', async () => ({ currentRegion: (await import('vue')).ref({ id: 'yunnan' }), currentRegionId: (await import('vue')).ref('yunnan') }))
vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiPost: hoisted.apiPost }))
vi.mock('@/services/company/companyApi', () => ({ companyUnselected: () => false }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp') }))

import { ApiError } from '@/services/api'
import { addEvidence, contentFingerprint, midlongFailureOf } from './midlongApi'

const keyOf = (call: unknown[]) => ((call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'])

beforeEach(() => {
  hoisted.apiPost.mockReset()
  hoisted.apiPost.mockResolvedValue({ data: { evidence: { id: 1 } } })
})

describe('补充资料幂等键', () => {
  const head = 'A'.repeat(400)
  const tail = 'Z'.repeat(400)
  const upload = (middle: string) => ({ fileName: '确认单.txt', documentType: 'ELECTRONIC_CONFIRMATION' as const, contentBase64: `${head}${middle}${tail}` })

  it('首尾相同、只改中间内容的两份文件得到不同的键；同一文件重试得到同一个键', async () => {
    await addEvidence(7, upload('version-1'))
    await addEvidence(7, upload('version-2'))
    await addEvidence(7, upload('version-1'))
    const [first, revised, retry] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(revised).not.toBe(first)
    expect(retry).toBe(first)
  })

  it('键不被压回 32 位：审查给出的 32 位 FNV 碰撞样例（同长度内容 00000bpb / 00001ld5）得到不同的键', async () => {
    const same = { fileName: 'same.bin', documentType: 'OTHER' as const }
    await addEvidence(1, { ...same, contentBase64: '00000bpb' })
    await addEvidence(1, { ...same, contentBase64: '00001ld5' })
    const [a, b] = hoisted.apiPost.mock.calls.map(keyOf)
    expect(a).not.toBe(b)
  })

  it('指纹覆盖全部字符：任意位置的单字符差异都会改变指纹', () => {
    const base = 'x'.repeat(10_000)
    const fingerprints = new Set([0, 1, 5_000, 9_998, 9_999].map((i) => contentFingerprint(`${base.slice(0, i)}y${base.slice(i + 1)}`)))
    fingerprints.add(contentFingerprint(base))
    expect(fingerprints.size).toBe(6)
  })
})

describe('错误状态', () => {
  it('HTTP 200 但信封 code 为 403/404：状态取信封 code，页面才能进入无权限/不存在状态', () => {
    const envelope = (code: number) => new ApiError('拒绝', { status: 200, code, payload: { code, msg: '拒绝', data: { errorCode: 'SCOPE_DENIED', details: null } } as never })
    expect(midlongFailureOf(envelope(403)).status).toBe(403)
    expect(midlongFailureOf(envelope(404)).status).toBe(404)
    expect(midlongFailureOf(new ApiError('存储不可用', { status: 503, code: 503, payload: { code: 503, msg: '', data: null } as never })).status).toBe(503)
  })
})
