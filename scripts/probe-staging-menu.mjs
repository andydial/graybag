#!/usr/bin/env node
/**
 * probe-staging-menu — check staging **through the app's own api module**, not with curl.
 *
 * Three times running, a check of mine passed while Andy's screen disagreed: the menu cache, the
 * session fix, and the catalogue. Every time the difference lived in a layer neither check
 * crossed. `curl` proves PostgREST returns rows; it does not prove `fetchMenu` parses them,
 * that `assertDish` accepts them, or that `storagePublicUrl` builds a URL that resolves — and
 * those are the steps between the wire and the screen.
 *
 * So this imports the real `packages/shared/src/api` and calls the real `configureApi`,
 * `fetchSchools`, `fetchMenuVersion` and `fetchMenu`. It is one layer short of the device (React
 * state and the on-device cache are still beyond it), and that limit is the point of saying so.
 *
 *   set -a && . apps/mobile/.env.staging && set +a && npx tsx scripts/probe-staging-menu.mjs
 */
import * as api from '../packages/shared/src/api/index.ts';

// The app's own configureApi, with the app's own env shape — so this exercises the real client
// construction, the real transport and the real payload validation, not a hand-rolled fetch.
api.configureApi({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

const schools = await api.fetchSchools();
console.log('fetchSchools ->', schools.map((s) => `${s.name} (${s.id.slice(0, 8)})`).join(', '));

for (const s of schools) {
  try {
    const version = await api.fetchMenuVersion(s.id);
    const payload = await api.fetchMenu(s.id);
    console.log(`  ${s.name}: version=${version} dishes=${payload.dishes.length} categories=${payload.categories.length}`);
    if (payload.dishes.length > 0) {
      const d = payload.dishes[0];
      console.log(`     e.g. ${d.name} — ${d.pricePaise}p — image ${d.imageUri ? 'yes' : 'NO'}`);
    }
  } catch (e) {
    console.log(`  ${s.name}: FAILED ${e.name}: ${e.message}`);
  }
}
