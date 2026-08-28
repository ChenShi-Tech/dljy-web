import { describe, expect, it } from 'vitest'

import { DATA_BASIS_LABEL, isDecisionGrade, worstBasis } from './dataBasis'
import { SPOT_DECLARATION_BASIS_VALUES } from './contracts/spotDeclarationContract.gen'

describe('DataBasis 与申报契约 v6 对齐（dljy-web#51）', () => {
  it('契约 basis 枚举的每个值都有可见标签（角标不会渲染成 undefined）', () => {
    for (const basis of SPOT_DECLARATION_BASIS_VALUES) {
      expect(DATA_BASIS_LABEL[basis], basis).toBeTruthy()
    }
  })

  it('provisional 非决策级，弱于 captured、强于 illustrative', () => {
    expect(isDecisionGrade('provisional')).toBe(false)
    expect(worstBasis('captured', 'provisional')).toBe('provisional')
    expect(worstBasis('provisional', 'illustrative')).toBe('illustrative')
    expect(worstBasis('real', 'provisional', 'synthetic')).toBe('synthetic')
  })
})
