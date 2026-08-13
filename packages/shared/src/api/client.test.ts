import { beforeEach, describe, expect, it } from 'vitest';

import { configureApi, storagePublicUrl } from './client.js';


/**
 * `E16-43`. Storage holds a KEY; React Native needs a URL. The conversion lives here because
 * this is the one module that knows which project is configured — and because six screens each
 * holding a hostname is how an environment promotion goes wrong.
 */
describe('storagePublicUrl', () => {
  beforeEach(() => {
    configureApi({
      appEnv: 'local',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon',
    } as never);
  });

  it('builds an absolute public URL from a storage key', () => {
    expect(storagePublicUrl('dish-images', 'dishes/veg.png')).toBe(
      'https://example.supabase.co/storage/v1/object/public/dish-images/dishes/veg.png',
    );
  });

  it('is idempotent — a URL that has already been resolved is returned unchanged', () => {
    const url = 'https://cdn.example.com/a.png';
    expect(storagePublicUrl('dish-images', url)).toBe(url);
  });

  /**
   * Null rather than a half-built URL. A bare key handed to `<Image>` fails silently as a
   * broken image; null reaches the "no photo" branch every dish surface already draws properly
   * — the brand tile, never a grey box.
   */
  it('returns null for no key rather than a URL that resolves to nothing', () => {
    expect(storagePublicUrl('dish-images', null)).toBeNull();
    expect(storagePublicUrl('dish-images', '')).toBeNull();
  });

  it('does not double the slash when the configured origin has a trailing one', () => {
    configureApi({
      appEnv: 'local',
      supabaseUrl: 'https://example.supabase.co/',
      supabaseAnonKey: 'anon',
    } as never);
    expect(storagePublicUrl('dish-images', '/dishes/veg.png')).toBe(
      'https://example.supabase.co/storage/v1/object/public/dish-images/dishes/veg.png',
    );
  });
});
