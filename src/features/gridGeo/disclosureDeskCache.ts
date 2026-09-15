export type DeskCacheContext = { scopeKey?: string; refreshKey?: number }

const TTL = 30_000
const MAX_ENTRIES = 64
const MAX_SCOPES = 32
type Entry = { scope: string; expires: number; request: Promise<unknown> }
const entries = new Map<string, Entry>()
const scopes = new Map<string, { version: number; expires: number }>()

function forgetScope(scope: string) {
  scopes.delete(scope)
  for (const [key, entry] of entries) if (entry.scope === scope) entries.delete(key)
}

/** Short-lived public-data cache. Missing company scope disables reuse; old refresh generations cannot repopulate it. */
export function readDisclosureDeskCached<T>(region: string, context: DeskCacheContext, query: string[], read: () => Promise<T>, retain: (value: T) => boolean): Promise<T> {
  if (!context.scopeKey) return read()
  const now = Date.now()
  for (const [scope, state] of scopes) if (state.expires <= now) forgetScope(scope)
  for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key)
  const scope = JSON.stringify([region, context.scopeKey])
  const version = context.refreshKey ?? 0
  const previous = scopes.get(scope)
  // A superseded caller may still be finishing date batches. Read without retention rather than rolling the generation back.
  if (previous && version < previous.version) return read()
  if (previous && version > previous.version) forgetScope(scope)
  const state = scopes.get(scope) ?? { version, expires: now + TTL }
  state.expires = now + TTL
  scopes.delete(scope); scopes.set(scope, state)
  while (scopes.size > MAX_SCOPES) forgetScope(scopes.keys().next().value!)
  const key = JSON.stringify([scope, version, ...query])
  const cached = entries.get(key)
  if (cached) {
    entries.delete(key); entries.set(key, cached)
    return cached.request as Promise<T>
  }
  const entry: Entry = { scope, expires: now + TTL, request: Promise.resolve() }
  const request = read().then((value) => {
    if (entries.get(key) === entry && scopes.get(scope) === state) {
      if (retain(value)) entry.expires = Date.now() + TTL
      else entries.delete(key)
    }
    return value
  }, (error: unknown) => {
    if (entries.get(key) === entry) entries.delete(key)
    throw error
  })
  entry.request = request
  entries.set(key, entry)
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  return request
}
