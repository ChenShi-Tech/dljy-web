// 「合同入门」步骤定义的结构守卫（ChenShi-Tech/dljy#3404）。
// 守什么：每个指向对话框内元素的步骤都声明 resumeTo，且指回更早的、页面上的「打开对话框」那一步。
// 坏掉的症状：填到一半刷新页面，对话框没了，导引停在「没找到要指的位置」出不来（实机走查踩到过）。
import { describe, expect, it } from 'vitest'
import { contractBasicsGuide } from './contractBasics'

describe('合同入门步骤定义', () => {
  const steps = contractBasicsGuide.steps
  const indexOf = (id: string) => steps.findIndex((step) => step.id === id)

  it('对话框内的步骤都声明 resumeTo，且指回更早的页面级步骤', () => {
    const dialogSteps = steps.filter((step) => step.within === 'dialog' || step.within === 'drawer')
    expect(dialogSteps.length).toBeGreaterThan(0)
    for (const step of dialogSteps) {
      expect(step.resumeTo, `步骤 ${step.id} 缺少 resumeTo`).toBeTruthy()
      const back = indexOf(step.resumeTo!)
      expect(back, `步骤 ${step.id} 的 resumeTo=${step.resumeTo} 不存在`).toBeGreaterThanOrEqual(0)
      expect(back, `步骤 ${step.id} 的 resumeTo 必须在它之前`).toBeLessThan(indexOf(step.id))
      const target = steps[back]
      expect(target.within === 'dialog' || target.within === 'drawer', `步骤 ${step.id} 的 resumeTo 不能也在对话框里`).toBe(false)
    }
  })

  it('步骤 id 不重复', () => {
    const ids = steps.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('来源命名空间步骤', () => {
  const byId = (id: string) => contractBasicsGuide.steps.find((step) => step.id === id)!
  const doneOf = (id: string, values: Record<string, unknown>) => {
    const advance = byId(id).advance
    if (advance.kind !== 'form') throw new Error(`${id} 不是表单推进条件`)
    const ctx = { runTag: 'GUIDE-TEST', regionId: 'yunnan', practiceCompanyId: 'p', artifacts: {}, go: () => {} }
    return advance.done(values, ctx)
  }

  it('默认来源 MANUAL 不算完成（否则这一步在用户看到前就自动跳过、练习数据不带教学演示标记）', () => {
    expect(doneOf('2-3', { sourceNamespace: 'MANUAL' })).toBe(false)
    expect(doneOf('2-3', { sourceNamespace: 'TEST-GUIDE' })).toBe(true)
    expect(doneOf('3-2', { externalContractNo: 'X-01', contractName: '【教学演示】n', sourceNamespace: 'MANUAL' })).toBe(false)
    expect(doneOf('3-2', { externalContractNo: 'X-01', contractName: '【教学演示】n', sourceNamespace: 'TEST-GUIDE' })).toBe(true)
  })
})

describe('讲解型步骤', () => {
  it('默认值本身就满足条件的讲解步骤改为手动推进（否则卡片还没显示就被自动跳过）', () => {
    for (const id of ['3-1', '4-2']) {
      expect(contractBasicsGuide.steps.find((step) => step.id === id)?.advance.kind, id).toBe('manual')
    }
  })
})
