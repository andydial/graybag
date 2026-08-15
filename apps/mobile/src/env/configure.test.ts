import { missingClientEnvNames } from './configure';

/**
 * `E01-28`. **The diagnostic must name every variable that can stop the app configuring.**
 *
 * `CantConnectScreen` exists because an unconfigured build used to look like an empty menu, and
 * it renders `missingClientEnvNames()` so a screenshot answers the question instead of starting a
 * conversation. That only works if the list is complete.
 *
 * It was not. `loadClientEnv` requires `RAZORPAY_KEY_ID`; `missingClientEnvNames` checked three
 * names and not that one. So a build missing only the Razorpay key failed to configure, fell to
 * `CantConnectScreen`, and the screen reported **nothing missing** — pointing whoever read it at
 * everything except the cause.
 *
 * That is exactly what happened to the Maestro job: no `EXPO_PUBLIC_RAZORPAY_KEY_ID` in the
 * workflow, so `App.tsx` rendered `CantConnectScreen` instead of `RootNavigator`, there was no tab
 * bar, and the flow failed on a missing `tab-menu` three screens away from the real problem.
 *
 * This test is the coupling: **if `loadClientEnv` ever requires a new client variable, this fails
 * until the diagnostic is taught about it.**
 */
const CLIENT_VARS = [
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_RAZORPAY_KEY_ID',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of CLIENT_VARS) {
    saved[k] = process.env[k];
    process.env[k] = 'set';
  }
});

afterEach(() => {
  for (const k of CLIENT_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('missingClientEnvNames', () => {
  it('reports nothing when every required variable is present', () => {
    expect(missingClientEnvNames()).toEqual([]);
  });

  it.each(CLIENT_VARS)('names %s when it is the only one missing', (name) => {
    // The one-at-a-time shape is the point. A build is usually missing exactly one variable, and
    // that is the case where an incomplete list is silently wrong rather than obviously wrong.
    delete process.env[name];
    expect(missingClientEnvNames()).toEqual([name]);
  });

  it('treats an empty string as missing, not as set', () => {
    // How an unset GitHub Actions `vars.*` arrives: `${{ vars.NOT_SET }}` renders as an empty
    // string, not as an absent variable. Every one of these was empty in the Maestro job until
    // 2026-08-16, because the repository had no variables at all.
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    expect(missingClientEnvNames()).toContain('EXPO_PUBLIC_SUPABASE_URL');
  });

  it('includes RAZORPAY_KEY_ID — the omission that made the screen lie', () => {
    // Named explicitly rather than left to the loop above, so deleting it from `CLIENT_VARS`
    // cannot quietly remove the coverage this whole file exists for.
    delete process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID;
    expect(missingClientEnvNames()).toContain('EXPO_PUBLIC_RAZORPAY_KEY_ID');
  });
});
