# 当日披露的检修与运行原文

云南多目标总览在原有13项数值数据之前增加“检修与运行记录”。这是授权导出数据的只读展示，不调用模型，不声称实时连接官方，也不声称包括源头尚未导出的全部公告。

- 来源目录及字段由BFF的`/api/v1/grid/geo-assets/disclosures/daily-records/catalog`提供；页面没有自造模型/数据集占位。
- 首批6类：云南设备检修、南网输变电检修、云南必开必停名单、云南人工干预、云南非计划停运、跨省优先送电下限。无省份字段的表明确全网；云南表只接受云南原始行。
- 两个分时空表（必开必停分时信息、机组出力约束）不生成曲线/空入口，只在来源限制中说明。
- 按`operate_date`（源记录日期）筛选；计划停复电时间、实际时间与导入时间分别保留原文，不推算时长、不冒称官方发布时间。
- 目录加载后最多2路读取6类首页；提供类别计数、关键词搜索、20条分页、滚动原文区、字段/来源展开。缺记录、源缺失、认证失败不混成一种空态。
- `src/services/forecast/dailyDisclosureRecords.ts`（文本接口服务）复用统一认证头，传当前公司/地区，并拒绝模拟、跨日期、跨地区或来源不符响应。
- `src/components/forecast/DailyDisclosureTexts.vue`（文本展示组件）同步清空失效数据，等同一轮公司/日期更新完成再取数；页请求与整批请求分别失效，原文只用Vue文本插值，禁止HTML渲染。
- 复用现有白底、主题色、字号令牌、6px圆角。六类选择等宽纵排，窄屏两列/一列且标题单行；长原文允许自然换行。记录滚动区可键盘聚焦，详情为原生details。

自动验证：`npm run test:unit -- src/services/forecast/dailyDisclosureRecords.spec.ts src/components/forecast/DailyDisclosureTexts.component.spec.ts src/components/forecast/DailyDisclosureOverview.component.spec.ts --maxWorkers 2`；另跑lint/check/test:unit/test:coverage/build。

视觉验收限制：浏览器访问曾被明确拒绝，未获新确认前不重试或换工具绕过。此处自动测试不代表已完成浏览器首屏/窄屏与设计图的逐项截图验收。既有概念`deliverables/nanyang_prediction_enable_20260830_v1/当日披露总览_设计参考_20260831.png`位于项目根目录；本次新增文本区是用户要求的功能延展。
