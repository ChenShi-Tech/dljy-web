// 此文件由 scripts/build/generate-serving-routes.mjs 生成，禁止手改；事实源 shared/schema/serving-route-registry.mjs，重生成 npm run build:serving-routes
export const SERVING_ROUTE_SCHEMA_VERSION = "serving-route/v1"

export type ServingDatasetId = 'clearing_price' | 'actual_energy' | 'node_price'

export type ServingRoute = {
  engine: 'replay' | 'duckdb' | 'agent-api' | 'postgres'
  familyRef: string | null
  sourceRef: string | null
  match: Record<string, string> | null
  granularityNative: 15 | 30 | 60
  resamplePolicy: 'step_repeat' | 'interpolate' | null
  daRtSeparated: boolean
}

export const SERVING_ROUTES: Record<ServingDatasetId, {
  canonicalUnit: string
  grain: { entity: string; time: string; market: string[] }
  regions: Record<string, ServingRoute>
}> = {
  "clearing_price": {
    "canonicalUnit": "yuan_per_mwh",
    "grain": {
      "entity": "system",
      "time": "quarter_hour",
      "market": [
        "day_ahead",
        "real_time"
      ]
    },
    "regions": {
      "yunnan": {
        "engine": "replay",
        "familyRef": "yn_system_forecast",
        "sourceRef": null,
        "match": {
          "day_ahead": "da_user_price",
          "real_time": "rt_user_price"
        },
        "granularityNative": 60,
        "resamplePolicy": "step_repeat",
        "daRtSeparated": true
      },
      "shanxi": {
        "engine": "replay",
        "familyRef": "sdpt_zcqxhdl",
        "sourceRef": null,
        "match": {
          "day_ahead": "listrs_full",
          "real_time": "listrs_full"
        },
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": true
      }
    }
  },
  "actual_energy": {
    "canonicalUnit": "mwh",
    "grain": {
      "entity": "company",
      "time": "quarter_hour",
      "market": [
        "real_time"
      ]
    },
    "regions": {
      "shanxi": {
        "engine": "replay",
        "familyRef": "sdpt_zptqx",
        "sourceRef": null,
        "match": {
          "real_time": "list"
        },
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": false
      }
    }
  },
  "node_price": {
    "canonicalUnit": "yuan_per_mwh",
    "grain": {
      "entity": "node",
      "time": "quarter_hour",
      "market": [
        "day_ahead",
        "real_time"
      ]
    },
    "regions": {
      "yunnan": {
        "engine": "postgres",
        "familyRef": null,
        "sourceRef": "node_price/market={da,rt}",
        "match": null,
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": true
      },
      "guangdong": {
        "engine": "postgres",
        "familyRef": null,
        "sourceRef": "node_price/market={da,rt}",
        "match": null,
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": true
      },
      "guangxi": {
        "engine": "postgres",
        "familyRef": null,
        "sourceRef": "node_price/market={da,rt}",
        "match": null,
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": true
      },
      "guizhou": {
        "engine": "postgres",
        "familyRef": null,
        "sourceRef": "node_price/market={da,rt}",
        "match": null,
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": true
      },
      "hainan": {
        "engine": "postgres",
        "familyRef": null,
        "sourceRef": "node_price/market={da,rt}",
        "match": null,
        "granularityNative": 15,
        "resamplePolicy": null,
        "daRtSeparated": true
      }
    }
  }
}

/** 按 (dataset, region) 解析读取路由；null = 该地区未配置（诚实不可用，不回落）。 */
export function resolveServingRoute(datasetId: ServingDatasetId, regionId?: string | null): ServingRoute | null {
  if (!regionId) return null
  return SERVING_ROUTES[datasetId]?.regions[regionId] ?? null
}
