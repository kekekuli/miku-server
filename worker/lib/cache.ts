export async function withCache<T>(
  kv: KVNamespace,
  key: string,
  ttl: number,
  fn: () => Promise<T | null>,
): Promise<T | null> {
  const cached = await kv.get(key);
  if (cached !== null) return cached === '' ? null : (JSON.parse(cached) as T);

  const result = await fn();
  await kv.put(key, result === null ? '' : JSON.stringify(result), { expirationTtl: ttl });
  return result;
}
