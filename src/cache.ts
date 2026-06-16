type Entry<T> = { value: T; expiresAt: number };

export function createCache<T>(ttlMs: number) {
  const store = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  async function get(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = store.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = loader()
      .then((value) => {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  }

  function set(key: string, value: T): void {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function clear(): void {
    store.clear();
  }

  return { get, set, clear };
}
