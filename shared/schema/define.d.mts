// 类型侧伴随定义：让前端 `Infer<typeof schema>` 从同一份 .mjs 运行时 schema 推导出实体类型。
// 后端运行时用 define.mjs，前端类型用本文件——同源，零重复。

export type FieldOpts<T> = {
  required?: boolean
  default?: T | (() => T)
  alias?: string | string[]
}

export type StringField<R extends boolean = boolean> = { kind: 'string'; required?: R } & FieldOpts<string>
export type NumberField = { kind: 'number' } & FieldOpts<number>
export type EnumField<V extends string = string> = { kind: 'enum'; values: readonly V[] } & FieldOpts<V>
export type Field = StringField | NumberField | EnumField
export type ObjectSchema<F extends Record<string, Field> = Record<string, Field>> = { kind: 'object'; fields: F }

export function str<R extends boolean = false>(opts?: { required?: R } & FieldOpts<string>): StringField<R>
export function num(opts?: FieldOpts<number>): NumberField
export function enumOf<V extends string>(values: readonly V[], opts?: FieldOpts<V>): EnumField<V>
export function object<F extends Record<string, Field>>(fields: F): ObjectSchema<F>

type FieldType<F extends Field> =
  F extends EnumField<infer V> ? V :
  F extends NumberField ? number | null :
  F extends StringField ? string | null :
  never

// 由 schema 推导出的 mart 实体类型（不含 server 托管的 id/companyId/source/时间戳）。
export type Infer<S extends ObjectSchema> = { [K in keyof S['fields']]: FieldType<S['fields'][K]> }

export function parse<S extends ObjectSchema>(schema: S, input: unknown): { ok: boolean; value: Infer<S>; errors: string[] }
export function fieldNames(schema: ObjectSchema): string[]
// 类型级行校验：判定一行是否「字段齐备且类型正确」符合 schema（真实数据守门，不做修补）。
export function matchesSchema(schema: ObjectSchema, row: unknown): boolean
