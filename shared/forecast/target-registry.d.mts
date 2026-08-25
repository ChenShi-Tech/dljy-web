/** 预测标的注册表的类型声明。事实源与语义注释见同名 .mjs（dljy#2446）。 */

/** 时间粒度词汇。slotsPerDay 由 intervalMinutes 推导，注册表不重复存。 */
export type ForecastGranularity = '15min' | '60min' | 'daily';

/** 物理量纲 —— 决定单位。与 skillFamily 正交。 */
export type ForecastQuantity = 'price' | 'power' | 'temperature';

/**
 * skill 门禁的分母族。**与 quantity 正交**：temp 的量纲是 °C 却走电价族分母
 * （rolling_report 既有行为），合并成一个字段就得二选一并改变门禁口径。
 */
export type ForecastSkillFamily = 'spot_price' | 'power' | 'daily_price';

/** 取数来源类别，与 remote_inference._TARGET_SOURCES 的值前缀一一对应。 */
export type ForecastDataSourceKind = 'normalized' | 'synth' | 'module';

export type ForecastDataSource = {
  kind: ForecastDataSourceKind;
  /** normalized/synth 为列名；module 为模块路径 */
  ref: string;
  /** blocked = 平台取不到数，目录层标 available:false 并给出 blockedReason */
  status: 'available' | 'blocked';
};

export type ForecastTargetSpec = {
  id: string;
  /** Python Enum 成员名（= id.toUpperCase()） */
  enumName: string;
  labelZh: string;
  quantity: ForecastQuantity;
  skillFamily: ForecastSkillFamily;
  granularity: ForecastGranularity;
  /** 取数宽表里的列名；null = 需独立 loader（见 loaderRef）或已 blocked */
  column: string | null;
  loaderRef: string | null;
  dataSource: ForecastDataSource;
  /** status='blocked' 时必填，须含 dljy#NNNN */
  blockedReason: string | null;
  /** 外生特征（不含目标当期值） */
  exoFeatures: string[];
  weatherDerived: string[];
  /**
   * 与本标的同值或可由其精确推出的列 —— 入特征即目标泄漏。
   * `_excluded` 的字面量比较拦不住换了名的同一列（dljy#2444）。
   */
  aliasColumns: string[];
  /** CORE-CAP-014 契约的对应枚举值；null = Core 不覆盖 */
  coreTarget: string | null;
  noteZh?: string;
};

export declare const FORECAST_TARGET_REGISTRY_VERSION: string;

export declare const GRANULARITIES: Readonly<Record<ForecastGranularity, Readonly<{
  intervalMinutes: number;
  fieldRegistryName: string;
}>>>;

export declare const QUANTITIES: Readonly<Record<ForecastQuantity, Readonly<{ unit: string }>>>;

export declare const SKILL_FAMILIES: Readonly<Record<ForecastSkillFamily, Readonly<{
  labelZh: string;
  referencesRef: string;
}>>>;

export declare const DATA_SOURCE_KINDS: readonly ForecastDataSourceKind[];

export declare const REGION_DRIVERS: Readonly<Record<string, string>>;
export declare const REGION_EXTRA_FEATURES: Readonly<Record<string, readonly string[]>>;

/** 泄漏的第二种形态：由当期量派生的比值/差值列（如 renewable_ratio = renewable / load）。 */
export declare const DERIVED_LEAKS: Readonly<Record<string, readonly string[]>>;

export declare const FORECAST_TARGETS: ForecastTargetSpec[];

/** 标的 id 有序列表（= ForecastTarget 枚举顺序）。前端下拉直接用它。 */
export declare const FORECAST_TARGET_IDS: readonly string[];

export declare function slotsPerDay(granularity: ForecastGranularity): number;
export declare function forecastTarget(id: string): ForecastTargetSpec | null;
export declare function targetUnit(id: string): string | null;
export declare function targetSlotsPerDay(id: string): number | null;
/** 平台有取数路径的标的 id（blocked 的不在其中）。 */
export declare function suppliableTargetIds(): string[];
/** 列名 → 该列会泄漏的标的集合（同值别名 + 派生量两个来源合并）。 */
export declare function leakedTargetsByColumn(): Record<string, string[]>;
/** 自洽校验，返回错误描述数组（空 = 自洽）。 */
export declare function validateForecastTargetRegistry(
  targets?: ForecastTargetSpec[]
): string[];
