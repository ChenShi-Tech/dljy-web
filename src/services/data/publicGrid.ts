// 公共落点模板（dljy#2890 / #2898 验收③）。
//
// `yn-t0-node-price`（节点电价）写的是**平台公共表** `spot.fact_node_price`——所有公司
// 共读、无公司维度的平台级资产。后端把该模板的写权限收窄为仅平台超管 ADMIN
// （`server/shared/role-matrix.mjs` 的 `PUBLIC_GRID_WRITE_ROLES`，刻意不含 BOSS——
// 公司级角色的写权限止步本公司私有数据）；数据上传中心（判据是上传契约的
// `spotFactLoad` 标志）与导入融合台（判据 `isSpotFactTemplate`）两条提交路径服务端
// 都挂了 403 门，预检等只读路径不受限。
//
// 前端没有现成的「公共落点」模板元数据（共享模板声明只有 ownership 口径，与写权限
// 无关；contracts 响应也不下发 spotFactLoad），故集中定义本清单，与后端
// `PUBLIC_GRID_WRITE_ROLES` 同口径、**以服务端为准**：仅用于模板标注与提交入口置灰
// （体验层，不是安全边界）。服务端契约新增公共落点或调整写角色时须同步维护。
// 上传中心的 dataset 与导入融合台的 templateId 是同名同值字符串。

/** 公共落点模板清单（dataset / templateId 同名同值）。 */
export const PUBLIC_GRID_TEMPLATE_IDS: readonly string[] = Object.freeze(['yn-t0-node-price'])

export function isPublicGridTemplate(templateId: string | null | undefined): boolean {
  return !!templateId && PUBLIC_GRID_TEMPLATE_IDS.includes(templateId)
}

/** 公共落点写权限（与后端 canWritePublicGridData 同口径）：仅平台超管 ADMIN。 */
export function canWritePublicGridData(roleCode: string | null | undefined): boolean {
  return roleCode === 'ADMIN'
}

/** 非 ADMIN 在提交入口看到的只读提示（导入融合台等一次性提交入口）。 */
export const PUBLIC_GRID_COMMIT_HINT =
  '公共曲线，仅平台管理员可提交；请把填好的文件交由平台管理员提交。'

/** 非 ADMIN 在数据上传中心看到的只读提示：预检不受限，可先核对数据再交管理员提交。 */
export const PUBLIC_GRID_PRECHECK_NOTE =
  '公共曲线，仅平台管理员可提交；你可以先预检核对数据，再交管理员提交（预检不落库，不受影响）。'
