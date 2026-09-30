// 生成物（勿手改）：customer-channels.mjs 的类型声明。
export type CustomerChannel = {
  readonly id: string
  readonly name: string
  readonly content: string
  readonly kind: string
  readonly trigger: 'schedule' | 'service' | 'manual' | 'upload' | 'delivery' | 'realtime'
  readonly manualCustomerVisible: true
}

export declare const CUSTOMER_CHANNELS: readonly CustomerChannel[]
export declare function listCustomerChannels(): readonly CustomerChannel[]
export declare function getCustomerChannel(id: string): CustomerChannel | null
