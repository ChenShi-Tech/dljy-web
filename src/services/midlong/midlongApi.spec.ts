// 中长期售电接口客户端的幂等键（dljy#2939）。
// 守什么：补充资料的幂等键覆盖文件完整内容——只改中间内容的两份文件必须得到不同的键，同一文件重试得到同一个键。
// 坏掉的症状：修订过的大文件与旧版本首尾相同，上传被服务端当成重复请求重放旧文件，或以「同键不同内容」拒绝。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ apiPost: vi.fn() }))

// 真实 api.ts 在 node 环境会读 window；这里用直接拼接规范内容的替身，断言针对「哪些内容参与了键派生」。
vi.mock('@/services/api', () => ({
  ApiError: class extends Error {},
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: hoisted.apiPost,
  idempotencyKeyOf: (prefix: string, canonical: unknown) => `${prefix}:${JSON.stringify(canonical)}`,
}))
vi.mock('@/services/company/companyApi', () => ({ companyUnselected: () => false }))
vi.mock('@/services/company/companyContext', async () => ({ selectedCompanyId: (await import('vue')).ref('comp-a') }))

import { addEvidence, contentFingerprint } from './midlongApi'

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

  it('指纹覆盖全部字符：任意位置的单字符差异都会改变指纹', () => {
    const base = 'x'.repeat(10_000)
    const fingerprints = new Set([0, 1, 5_000, 9_998, 9_999].map((i) => contentFingerprint(`${base.slice(0, i)}y${base.slice(i + 1)}`)))
    fingerprints.add(contentFingerprint(base))
    expect(fingerprints.size).toBe(6)
  })
})
