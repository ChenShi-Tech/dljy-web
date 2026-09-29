// 公开披露来源与「发布方」口径共享契约的类型侧伴随定义（#3571）。
// 运行时值来自 grid-disclosure-providers.mjs。

export type CsgDisclosureProviderId = 'csg-authorized-export' | 'csg-disclosure-file'

export declare const CSG_DISCLOSURE_PUBLISHER: 'csg'
export declare const CSG_AUTHORIZED_EXPORT_PROVIDER: 'csg-authorized-export'
export declare const CSG_DISCLOSURE_FILE_PROVIDER: 'csg-disclosure-file'
export declare const CSG_DISCLOSURE_PROVIDER_IDS: readonly CsgDisclosureProviderId[]
export declare const CSG_PUBLISHER_KEY: 'csg-authorized-export'
export declare const CSG_DISCLOSURE_PROVIDER_NAMES: Readonly<Record<CsgDisclosureProviderId, string>>

export declare function isCsgDisclosureProvider(providerId: string | null | undefined): boolean
export declare function disclosurePublisherKey(providerId: string | null | undefined): string
export declare function publisherProviderIds(providerId: string | null | undefined): string[]

/** 来源登记里查名称所需的最小形状（/providers 返回的来源条目满足它）。 */
export interface DisclosureProviderNameEntry {
  readonly providerId: string
  readonly name?: string | null
}
export declare function disclosureEventSourceName(
  providers: readonly DisclosureProviderNameEntry[],
  providerId: string | null | undefined,
): string
