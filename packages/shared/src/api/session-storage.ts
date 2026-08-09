/**
 * Where the Supabase session is kept between app launches — `E03-20`, closing `E03-09`.
 *
 * ## Why this is an interface and not a direct import
 *
 * `packages/shared` is imported by `apps/web` too, and `expo-secure-store` is a native
 * module that does not exist in a browser. Importing it here would make the shared package
 * unbuildable for the web app, and the failure would appear as a bundling error a long way
 * from its cause. So the store is injected: `apps/mobile` supplies the secure one at
 * start-up, and anything that does not supply one gets no persistence rather than a crash.
 *
 * ## Why the size limit matters
 *
 * `expo-secure-store` is backed by the iOS keychain and Android EncryptedSharedPreferences,
 * and warns above ~2 KB per entry. A Supabase session — access token, refresh token, and a
 * user object that grows with whatever is in the JWT — is comfortably capable of exceeding
 * that. When it does, the write does not throw: it warns and, on some platforms, silently
 * fails, so the session appears to save and is gone on the next launch. That is a bug that
 * only reproduces on a cold start, which is the hardest kind to catch in review.
 *
 * `chunkedStore` splits values across numbered keys so no single entry approaches the
 * limit, and reassembles them on read. It records how many chunks it wrote, so a partially
 * written session is detected and discarded rather than half-restored.
 */

/** The shape Supabase's `auth.storage` option expects. Matches `MenuStorage` in `menu/`. */
export interface SessionStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Conservative. The documented warning threshold is around 2048 bytes; staying well under
 * it leaves room for the key name and any per-platform overhead, and the cost of an extra
 * chunk is one more keychain round trip on a path that runs once per launch.
 */
export const CHUNK_SIZE = 1536;

const countKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

/**
 * Wrap a key/value store so values are written in chunks that stay under the size limit.
 *
 * Reads are strict on purpose: if the recorded chunk count and the chunks actually present
 * disagree, the value is treated as absent and cleaned up. A half-restored session is worse
 * than none — it produces a client that believes it is signed in and holds a token that
 * cannot be refreshed.
 */
export function chunkedStore(inner: SessionStore): SessionStore {
  return {
    async getItem(key) {
      const rawCount = await inner.getItem(countKey(key));
      if (rawCount === null) return null;

      const count = Number.parseInt(rawCount, 10);
      if (!Number.isInteger(count) || count < 1) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await inner.getItem(chunkKey(key, i));
        if (part === null) {
          // A missing chunk means an interrupted write or a partially cleared store.
          // Discard the lot rather than returning a truncated JSON string, which would
          // fail to parse somewhere far less obvious.
          await this.removeItem(key);
          return null;
        }
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const parts: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        parts.push(value.slice(i, i + CHUNK_SIZE));
      }
      // At least one chunk, so an empty string round-trips as an empty string rather than
      // as absent — those mean different things to the caller.
      if (parts.length === 0) parts.push('');

      // Clear first: writing four chunks over a previous six leaves two stale ones, and
      // the next read would happily concatenate them onto the end.
      await this.removeItem(key);

      for (const [i, part] of parts.entries()) {
        await inner.setItem(chunkKey(key, i), part);
      }
      // The count goes LAST. A crash mid-write then leaves no count, which reads as
      // absent — rather than a count that promises chunks which are not there.
      await inner.setItem(countKey(key), String(parts.length));
    },

    async removeItem(key) {
      const rawCount = await inner.getItem(countKey(key));
      const count = rawCount === null ? 0 : Number.parseInt(rawCount, 10);

      // Remove the count first, so an interruption leaves orphaned chunks that read as
      // absent rather than a count pointing at chunks that are being deleted.
      await inner.removeItem(countKey(key));
      if (Number.isInteger(count)) {
        for (let i = 0; i < count; i++) {
          await inner.removeItem(chunkKey(key, i));
        }
      }
    },
  };
}

/** An in-memory store. The default when no platform store is supplied, and for tests. */
export function memoryStore(): SessionStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}
