// 平台申报宽表口径码 · 前端出口（#1529）
// ---------------------------------------------------------------------------
// 守的不变量：视图层消费宽表「type→口径」字典只经本出口（分层守卫：views/components
// 禁直接 import shared/schema/**）；唯一事实源在主仓 shared/schema/declaration-codes.mjs，
// 经 sync:web 白名单携带（与 Python 侧 declaration_codes_gen.py 同源派生，主仓
// verify:declaration-codes 门禁锁两端一致）。
// 坏掉的症状：若本出口与事实源脱节（例如 sync 未跟上），declarationCodes.spec 的
// 逐项断言会红——杜绝「组件里重抄一份字典」的 #1498 病灶复发。
// 关联：dljy#1529 / dljy#1498；主仓 PR ChenShi-Tech/dljy#2485。
export {
  DECLARATION_CODES_SCHEMA_VERSION,
  DECLARATION_QTY_TYPE_CODES,
  DECLARATION_PRICE_TYPE_CODES,
} from 'shared/schema/declaration-codes.mjs'
