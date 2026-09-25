// canWriteSharedResources 客户交付档分支单测（规格场景 AA-06.2，dljy#3226）：
// IS_CUSTOMER_EDITION=true 时写权限放宽到 ADMIN/BOSS（与后端 dljy#3238 的客户版口径一致）。
// vi.mock 是文件级的，无法与内部版用例共存，故单列一个 spec。
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/edition', () => ({ IS_CUSTOMER_EDITION: true, IS_INTERNAL_EDITION: false }))

import { canWriteSharedResources } from '@/services/governance'

describe('canWriteSharedResources（AA-06.2 · 客户交付版）', () => {
  it('AA-06.2：客户版 BOSS = true', () => {
    expect(canWriteSharedResources('BOSS')).toBe(true)
  })

  it('AA-06.2：客户版 ADMIN = true，普通角色仍 = false', () => {
    expect(canWriteSharedResources('ADMIN')).toBe(true)
    expect(canWriteSharedResources('TRADER')).toBe(false)
    expect(canWriteSharedResources(null)).toBe(false)
  })
})
