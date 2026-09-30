// 生成物（勿手改）：数据采集注册表的客户可见投影。
// 由 scripts/build/build-data-collection-registry.mjs 从 shared/data-collection/registry.mjs 派生，
// 字段白名单 ["id","name","content","trigger","manualCustomerVisible"] + kind——不含凭据键名/落点表名/内部通道/运维状态。
// verify:data-collection-registry 门禁对拍零漂移。
export const CUSTOMER_CHANNELS = Object.freeze([
  {
    "id": "weather-export",
    "name": "云南气象（Open-Meteo）",
    "content": "Open-Meteo 实况 + 预报（增量刷新近 7 天实况 + 未来 3 天预报）与 ERA5 历史归档",
    "kind": "weather-export",
    "trigger": "schedule",
    "manualCustomerVisible": true
  },
  {
    "id": "spot-export",
    "name": "云南现货数据（节点电价/结算/损益导出包）",
    "content": "云南现货月度导出包：manifest 契约校验 + DIM 层 + 节点电价/系统供需",
    "kind": "spot-export",
    "trigger": "manual",
    "manualCustomerVisible": true
  },
  {
    "id": "spot-ingest",
    "name": "现货节点电价 Parquet 摄取（历史数据包/存量清单通道）",
    "content": "节点电价清单协议 CSV 摄取重建为 Parquet（yn_node_price 族；Python ETL 经 agent-python 桥）",
    "kind": "spot-ingest",
    "trigger": "manual",
    "manualCustomerVisible": true
  },
  {
    "id": "forecast-etl",
    "name": "云南预测 ETL（统调负荷/水电 T0/T1 摄取 + 派生）",
    "content": "yunnan_normalize 把统调负荷/水电清单协议 CSV 摄取并派生预测输入（yn_system_supply 族）",
    "kind": "forecast-etl",
    "trigger": "schedule",
    "manualCustomerVisible": true
  },
  {
    "id": "cgn-yunnan-prices",
    "name": "中广核云南厂侧 API（节点/场站电价 → 私有 PostgreSQL）",
    "content": "中广核厂侧 API 节点电价/场站电价（日前与实时，15m/1h）→ 私有 PG",
    "kind": "cgn-yunnan-prices",
    "trigger": "schedule",
    "manualCustomerVisible": true
  },
  {
    "id": "cgn-yunnan-market",
    "name": "中广核云南厂侧 API（市场曲线/公共披露 → 私有 PostgreSQL）",
    "content": "市场曲线 11 条 + 公开披露 26 类 → 私有 PG",
    "kind": "cgn-yunnan-market",
    "trigger": "schedule",
    "manualCustomerVisible": true
  }
])

export function listCustomerChannels() {
  return CUSTOMER_CHANNELS
}

export function getCustomerChannel(id) {
  return CUSTOMER_CHANNELS.find((ch) => ch.id === id) ?? null
}
