// db.ts constructs the Supabase client at import time, which builds a Realtime
// client that references WebSocket and (for auth) localStorage. Neither exists
// in the node test environment, so importing any module in the db.ts graph
// would throw. Provide minimal no-op globals; no test exercises realtime/auth.
class FakeWebSocket {}
if (typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
}

if (typeof (globalThis as any).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}
