// canWriteSharedResources 判定口径单测（规格场景 AA-06.2，dljy#3226）：
// 共享资源（推理共享模型管理、模型服务写入）的写操作——内部版仅平台超管 ADMIN 可写。
// 后端（ChenShi-Tech/dljy#3238）是唯一裁决，这里只守前端展示一致用的判定本身；
// 客户交付档分支在 governance.shared-write.customer.spec.ts（文件级 mock edition）。
import { describe, expect, it } from 'vitest'
import { canWriteSharedResources } from '@/services/governance'

describe('canWriteSharedResources（AA-06.2 · 内部版）', () => {
  it('AA-06.2：内部版 ADMIN = true', () => {
    expect(canWriteSharedResources('ADMIN')).toBe(true)
  })

  it('AA-06.2：内部版 BOSS = false（写按钮须禁用，避免点了才 403）', () => {
    expect(canWriteSharedResources('BOSS')).toBe(false)
  })

  it('AA-06.2：普通角色 = false', () => {
    expect(canWriteSharedResources('TRADER')).toBe(false)
    expect(canWriteSharedResources('SETTLEMENT')).toBe(false)
  })

  it('AA-06.2：角色缺失（未登录兜底/旧会话）= false，宁可多锁不可放开', () => {
    expect(canWriteSharedResources(null)).toBe(false)
    expect(canWriteSharedResources(undefined)).toBe(false)
  })
})
