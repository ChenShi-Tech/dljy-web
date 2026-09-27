// ============================================================================
// disclosure-table-specs.mjs — 南网披露表上传规格（issue #2825）
// ----------------------------------------------------------------------------
// 整年导出 information_disclosure/ 有 26 张 tb_disclosure_* 表，7 张已接入
// （6 张事件表 → grid.disclosure_events，1 张 → yn_hydro_group_limit 族）；本注册表
// 承载其中有数值的 18 张表（原 17 张，加断面约束的 96 点数值投影）的上传规格，
// 是「表头形状」的单一事实源。断面事件与数值投影并存，不重写事件身份：
//   ① shared/schema/upload-contracts.mjs 的披露契约（模板/预检列）由它派生
//   ② scripts/private-cache-adapters/yn-disclosure-upload.mjs 的行归一化由它驱动
// 两处消费同一份声明，结构零漂移。
//
// 两张 0 行表（forecast_unit_output_constraint / forecast_must_run_stop_unit_info）
// 是导出方未提供数据，**有意不登记**（不建空契约空落点）；其表头形状已留档于
// issue #2825 归类结论评论，将来拿到数据按同款结构补 spec 即可。
//
// 落点判据（为何不走 grid.disclosure_events）见 issue #2825 评论：披露事件表无任何
// 数值列（title/summary 文本事件），度量型披露数据进 capture 通用长表保数值语义。
// ============================================================================

/** 全部披露表共用的 capture 族（通用披露度量长表，datasetKey=源表短名区分）。 */
export const DISCLOSURE_METRIC_FAMILY = 'yn_disclosure_metric'

/** 导出方统一加在每张表前的 5 列（id/operate_date/source_file/imported_at/序号）。 */
export const DISCLOSURE_PREFIX_COLUMNS = Object.freeze([
  { name: 'id', type: 'string', required: false },
  { name: 'operate_date', type: 'date', required: true },
  { name: 'source_file', type: 'string', required: false },
  { name: 'imported_at', type: 'string', required: false },
  { name: '序号', type: 'string', required: false },
])

/** 96 点时刻列名（00:00…23:45，15 分钟粒度，宽表 unpivot 的列集）。 */
export const DISCLOSURE_TIME_POINTS = Object.freeze(
  Array.from({ length: 96 }, (_, i) => {
    const minutes = i * 15
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
)

// ── 17 张有数据表的规格 ──────────────────────────────────────────────────────
// mode:
//   'wide'   96 点时刻列横排 → 每时刻一行 (timePoint, value)；dims 全为维度/留痕列，
//            wideScalars 是时刻列之外可能出现的标量列（如 forecast_reserve 尾部的
//            「日期,容量」——实读全年 3670 行全空，为空时不产行）。
//   'scalar' 维度 + 少量数值/枚举列 → 每个非空值列一行 (metric=列名, value/textValue)。
// dims: field=长表列名；name=源表头原文；aux=true 表示仅留痕不参与行有效性判定；
//       type='number' 表示该维度是数值（段序号）。
// values: metric=落库指标名（=源列名，语义直读）；kind=number 走 value / enum 走 textValue。
// metricLabel（仅 wide）: 该表 96 点的指标名，取自源文件名主题词（20250701备用信息.xls
//   → 「备用」），不臆造语义。
export const DISCLOSURE_TABLE_SPECS = Object.freeze({
  // ── 宽表（96 点 unpivot）5 张 ──
  actual_interprov_tie_line: {
    title: '省间联络线输电情况（96 点）',
    mode: 'wide',
    metricLabel: '省间联络线输电',
    dims: [
      { field: 'channelName', name: '通道名称' },
      { field: 'regionName', name: '区域名称' },
    ],
  },
  actual_key_channel_transmission: {
    title: '重要通道实际输电情况（96 点）',
    mode: 'wide',
    metricLabel: '重要通道输电',
    // 「区域名称」列实测位于 96 点之后（解析按表头名取值，与列序无关），且整年 6171 行
    // 该列**全空**（导出方有列无值）——降为留痕列落 null，不作为键维度拒整表。
    dims: [
      { field: 'channelName', name: '通道名称' },
      { field: 'regionName', name: '区域名称', aux: true },
    ],
  },
  actual_key_line_transformer_flow: {
    title: '重要线路与变压器平均潮流（96 点）',
    mode: 'wide',
    metricLabel: '线路变压器潮流',
    // 同上：「区域名称」在 96 点之后且整年 1452 行全空，留痕列。
    dims: [
      { field: 'channelName', name: '通道名称' },
      { field: 'regionName', name: '区域名称', aux: true },
    ],
  },
  actual_transmission_section_constraint: {
    title: '实际输电断面正反向限值（96 点）',
    mode: 'wide',
    metricLabel: '输电断面限值',
    dims: [
      { field: 'channelName', name: '通道名称' },
      { field: 'dataType', name: '数据类型' },
      // 原始整包此列全空。仅保留已知南网范围，不按通道名推断省份。
      { field: 'regionName', name: '区域名称', aux: true },
    ],
  },
  forecast_external_tie_line: {
    title: '区外联络线（96 点）',
    mode: 'wide',
    metricLabel: '区外联络线',
    dims: [{ field: 'channelName', name: '区外联络线' }],
  },
  forecast_reserve: {
    title: '备用信息（96 点）',
    mode: 'wide',
    metricLabel: '备用',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'dataType', name: '类型' },
      // 尾部「日期」列（与 operate_date 冗余的导出方附加列），仅留痕。
      { field: 'innerDate', name: '日期', aux: true },
    ],
    wideScalars: [{ metric: '容量', name: '容量' }],
  },

  // ── 维度 + 标量 12 张 ──
  actual_grid_load_summary: {
    title: '电网负荷总体情况',
    mode: 'scalar',
    dims: [
      { field: 'itemName', name: '数据项名称' },
      { field: 'regionName', name: '区域名称' },
    ],
    values: [
      { metric: '最高负荷', name: '最高负荷', kind: 'number' },
      { metric: '最低负荷', name: '最低负荷', kind: 'number' },
      { metric: '平均负荷', name: '平均负荷', kind: 'number' },
    ],
  },
  actual_peak_reserve: {
    title: '高峰正备用信息',
    mode: 'scalar',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'innerDate', name: '日期', aux: true },
    ],
    values: [{ metric: '容量', name: '容量', kind: 'number' }],
  },
  actual_stable_section: {
    title: '稳定断面信息（实际运行）',
    mode: 'scalar',
    dims: [{ field: 'sectionName', name: '断面名称' }],
    values: [{ metric: '最大负载率', name: '最大负载率', kind: 'number' }],
  },
  forecast_hydro_weekly_output: {
    title: '水电周预测出力',
    mode: 'scalar',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'innerDate', name: '日期', aux: true },
    ],
    values: [{ metric: '平均出力（MW）', name: '平均出力（MW）', kind: 'number' }],
  },
  forecast_interprov_priority_limit: {
    title: '日前跨省优先计划电量限值',
    mode: 'scalar',
    dims: [
      { field: 'categoryName', name: '送电类别名称' },
      { field: 'noteText', name: '限值原因', aux: true },
    ],
    values: [{ metric: '送端电量下限', name: '送端电量下限', kind: 'number' }],
  },
  forecast_must_run_stop_unit_list: {
    title: '必开必停机组名单',
    mode: 'scalar',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'plantName', name: '电厂名称' },
      { field: 'unitName', name: '机组名称' },
    ],
    values: [{ metric: '必开/必停', name: '必开/必停', kind: 'enum' }],
  },
  forecast_non_da_new_energy_capacity: {
    title: '不参与日前市场的新能源总容量',
    mode: 'scalar',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'innerDate', name: '日期', aux: true },
    ],
    values: [{ metric: '不参与日前市场的新能源总容量（兆瓦）', name: '不参与日前市场的新能源总容量（兆瓦）', kind: 'number' }],
  },
  forecast_peak_regulation_demand: {
    title: '日前省区调峰需求披露',
    mode: 'scalar',
    dims: [{ field: 'regionName', name: '所属区域' }],
    values: [{ metric: '是否开展调峰', name: '是否开展调峰', kind: 'enum' }],
  },
  forecast_price_weight: {
    title: '价格权重信息（机组分段报价权重）',
    mode: 'scalar',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'plantName', name: '电厂名称' },
      { field: 'unitName', name: '机组名称' },
      // 「时间」是披露时点戳（如 20250715_11:00:04），非运行时刻——tagText 留痕。
      { field: 'tagText', name: '时间', aux: true },
      { field: 'segmentNo', name: '段序号', type: 'number' },
    ],
    values: [
      { metric: '分段起始容量', name: '分段起始容量', kind: 'number' },
      { metric: '分段终止容量', name: '分段终止容量', kind: 'number' },
      { metric: '价格权重', name: '价格权重', kind: 'number' },
    ],
  },
  forecast_transmission_capacity: {
    title: '输电通道可用容量',
    mode: 'scalar',
    dims: [{ field: 'channelName', name: '通道名称' }],
    values: [{ metric: '最大可用容量', name: '最大可用容量', kind: 'number' }],
  },
  forecast_unit_group: {
    title: '机组群信息（机组出力比例）',
    mode: 'scalar',
    dims: [
      { field: 'regionName', name: '所属区域' },
      { field: 'groupName', name: '机组群名称' },
      { field: 'plantName', name: '电厂名称' },
      { field: 'unitName', name: '机组名称' },
    ],
    values: [{ metric: '机组出力所占比例（百分比）', name: '机组出力所占比例（百分比）', kind: 'number' }],
  },
  forecast_unit_maintenance_capacity: {
    title: '机组检修信息（区域总容量）',
    mode: 'scalar',
    dims: [{ field: 'innerDate', name: '日期', aux: true }],
    values: [{ metric: '南方区域总容量（兆瓦）', name: '南方区域总容量（兆瓦）', kind: 'number' }],
  },
})

export const DISCLOSURE_DATASET_KEYS = Object.freeze(Object.keys(DISCLOSURE_TABLE_SPECS))
