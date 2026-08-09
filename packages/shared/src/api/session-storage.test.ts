import { describe, expect, it } from 'vitest';

import { CHUNK_SIZE, chunkedStore, memoryStore, type SessionStore } from './session-storage.js';

/**
 * `E03-20`. The interesting failures here are all silent ones: `expo-secure-store` warns
 * rather than throwing above ~2 KB and on some platforms drops the write, so a session that
 * appears to save is gone on the next cold start. Every test below is about a value
 * surviving, or being cleanly absent — never half-present.
 */

/** A store that records every call, so write ORDER can be asserted. */
function tracking(): SessionStore & { keys: () => string[]; log: string[] } {
  const map = new Map<string, string>();
  const log: string[] = [];
  return {
    keys: () => [...map.keys()],
    log,
    getItem: (k) => Promise.resolve(map.get(k) ?? null),
    setItem: (k, v) => {
      log.push(`set ${k}`);
      map.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      log.push(`del ${k}`);
      map.delete(k);
      return Promise.resolve();
    },
  };
}

const big = (n: number) => 'x'.repeat(n);

describe('chunkedStore', () => {
  it('round-trips a small value', async () => {
    const store = chunkedStore(memoryStore());
    await store.setItem('sb-session', '{"access_token":"abc"}');
    await expect(store.getItem('sb-session')).resolves.toBe('{"access_token":"abc"}');
  });

  it('round-trips a value far larger than one chunk', async () => {
    // A Supabase session grows with whatever is in the JWT. This is the case that fails
    // silently without chunking.
    const store = chunkedStore(memoryStore());
    const value = big(CHUNK_SIZE * 4 + 17);

    await store.setItem('sb-session', value);

    await expect(store.getItem('sb-session')).resolves.toBe(value);
  });

  it('never writes an entry near the size limit', async () => {
    const inner = tracking();
    await chunkedStore(inner).setItem('sb-session', big(CHUNK_SIZE * 3));

    for (const key of inner.keys()) {
      const stored = await inner.getItem(key);
      expect(stored?.length ?? 0).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it('returns null for a key that was never written', async () => {
    await expect(chunkedStore(memoryStore()).getItem('sb-session')).resolves.toBeNull();
  });

  it('distinguishes an empty string from an absent value', async () => {
    const store = chunkedStore(memoryStore());
    await store.setItem('sb-session', '');
    await expect(store.getItem('sb-session')).resolves.toBe('');
  });

  it('writes the chunk count LAST', async () => {
    // A crash mid-write must leave no count, which reads as absent. A count written first
    // would promise chunks that are not there — the difference between "signed out" and
    // "holding a token that cannot be refreshed".
    const inner = tracking();
    await chunkedStore(inner).setItem('sb-session', big(CHUNK_SIZE * 2));

    const sets = inner.log.filter((l) => l.startsWith('set '));
    expect(sets[sets.length - 1]).toBe('set sb-session.chunks');
  });

  it('discards a partially written value rather than returning a truncated one', async () => {
    // A truncated JSON string does not fail here — it fails wherever it is parsed, which
    // is a long way from the storage layer.
    const inner = memoryStore();
    const store = chunkedStore(inner);
    await store.setItem('sb-session', big(CHUNK_SIZE * 3));

    await inner.removeItem('sb-session.1');

    await expect(store.getItem('sb-session')).resolves.toBeNull();
  });

  it('cleans up after finding a partial value, so the next read is cheap', async () => {
    const inner = memoryStore();
    const store = chunkedStore(inner);
    await store.setItem('sb-session', big(CHUNK_SIZE * 3));
    await inner.removeItem('sb-session.1');

    await store.getItem('sb-session');

    await expect(inner.getItem('sb-session.chunks')).resolves.toBeNull();
    await expect(inner.getItem('sb-session.0')).resolves.toBeNull();
  });

  it('leaves no stale chunks when a shorter value replaces a longer one', async () => {
    // Four chunks written over six leaves two behind, and the next read concatenates them
    // onto the end. The value parses, and it is wrong.
    const inner = memoryStore();
    const store = chunkedStore(inner);

    await store.setItem('sb-session', big(CHUNK_SIZE * 6));
    await store.setItem('sb-session', big(CHUNK_SIZE * 2));

    await expect(store.getItem('sb-session')).resolves.toBe(big(CHUNK_SIZE * 2));
    await expect(inner.getItem('sb-session.4')).resolves.toBeNull();
  });

  it('removes every chunk on removeItem', async () => {
    const inner = tracking();
    const store = chunkedStore(inner);
    await store.setItem('sb-session', big(CHUNK_SIZE * 3));

    await store.removeItem('sb-session');

    expect(inner.keys()).toEqual([]);
  });

  it('survives a corrupt chunk count', async () => {
    const inner = memoryStore();
    const store = chunkedStore(inner);
    await inner.setItem('sb-session.chunks', 'not-a-number');

    await expect(store.getItem('sb-session')).resolves.toBeNull();
  });
});
