import { describe, expect, it } from 'vitest';
import { EnvError, SERVER_ONLY_VARS, loadClientEnv, loadServerEnv } from './env.js';

const CLIENT_OK = {
  APP_ENV: 'staging',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  RAZORPAY_KEY_ID: 'rzp_test_abc123',
} as const;

const SERVER_OK = {
  ...CLIENT_OK,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RAZORPAY_KEY_SECRET: 'key-secret',
  RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
} as const;

/** Collect the problem strings from an EnvError, or fail if none was thrown. */
function problemsFrom(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof EnvError) return e.problems;
    throw e;
  }
  throw new Error('expected EnvError, but nothing was thrown');
}

describe('loadClientEnv', () => {
  it('accepts a well-formed client environment', () => {
    expect(loadClientEnv({ ...CLIENT_OK })).toEqual({
      appEnv: 'staging',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      razorpayKeyId: 'rzp_test_abc123',
    });
  });

  it('omits sentryDsn rather than setting it undefined when unset', () => {
    expect('sentryDsn' in loadClientEnv({ ...CLIENT_OK })).toBe(false);
    expect(loadClientEnv({ ...CLIENT_OK, SENTRY_DSN: 'https://dsn' }).sentryDsn).toBe('https://dsn');
  });

  it.each(SERVER_ONLY_VARS)('refuses to load when %s is present', (name) => {
    const problems = problemsFrom(() => loadClientEnv({ ...CLIENT_OK, [name]: 'oops' }));
    expect(problems.join('\n')).toContain(name);
  });

  it('names every leaked secret at once, not just the first', () => {
    const source = { ...CLIENT_OK } as Record<string, string>;
    for (const name of SERVER_ONLY_VARS) source[name] = 'oops';
    const problems = problemsFrom(() => loadClientEnv(source));
    for (const name of SERVER_ONLY_VARS) expect(problems.join('\n')).toContain(name);
  });

  it('treats an empty server-only var as absent rather than leaked', () => {
    expect(() => loadClientEnv({ ...CLIENT_OK, SUPABASE_SERVICE_ROLE_KEY: '   ' })).not.toThrow();
  });
});

describe('APP_ENV', () => {
  it('rejects a missing APP_ENV', () => {
    const { APP_ENV: _drop, ...rest } = CLIENT_OK;
    expect(problemsFrom(() => loadClientEnv(rest)).join('\n')).toContain('APP_ENV is missing');
  });

  it('rejects an unknown APP_ENV', () => {
    const problems = problemsFrom(() => loadClientEnv({ ...CLIENT_OK, APP_ENV: 'prod' }));
    expect(problems.join('\n')).toContain('APP_ENV is "prod"');
  });
});

describe('Razorpay test/live isolation', () => {
  it('accepts a test key in local and staging', () => {
    for (const appEnv of ['local', 'staging']) {
      expect(loadClientEnv({ ...CLIENT_OK, APP_ENV: appEnv }).razorpayKeyId).toBe('rzp_test_abc123');
    }
  });

  it('accepts a live key in production', () => {
    const env = loadClientEnv({ ...CLIENT_OK, APP_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_xyz' });
    expect(env.razorpayKeyId).toBe('rzp_live_xyz');
  });

  it('REFUSES a live key outside production, and says why in capitals', () => {
    for (const appEnv of ['local', 'staging']) {
      const problems = problemsFrom(() =>
        loadClientEnv({ ...CLIENT_OK, APP_ENV: appEnv, RAZORPAY_KEY_ID: 'rzp_live_xyz' }),
      );
      expect(problems.join('\n')).toContain('LIVE key outside production');
      expect(problems.join('\n')).toContain('real money would move');
    }
  });

  it('refuses a test key in production', () => {
    const problems = problemsFrom(() =>
      loadClientEnv({ ...CLIENT_OK, APP_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_test_abc' }),
    );
    expect(problems.join('\n')).toContain('must start with "rzp_live_"');
  });

  it('refuses a key with no recognisable prefix', () => {
    const problems = problemsFrom(() => loadClientEnv({ ...CLIENT_OK, RAZORPAY_KEY_ID: 'abc123' }));
    expect(problems.join('\n')).toContain('must start with "rzp_test_"');
  });

  it('does not report a prefix problem when the key is simply missing', () => {
    const { RAZORPAY_KEY_ID: _drop, ...rest } = CLIENT_OK;
    const problems = problemsFrom(() => loadClientEnv(rest));
    expect(problems).toEqual(['RAZORPAY_KEY_ID is missing or empty.']);
  });

  it('applies the same rule on the server path', () => {
    const problems = problemsFrom(() =>
      loadServerEnv({ ...SERVER_OK, APP_ENV: 'staging', RAZORPAY_KEY_ID: 'rzp_live_xyz' }),
    );
    expect(problems.join('\n')).toContain('LIVE key outside production');
  });
});

describe('loadServerEnv', () => {
  it('accepts a well-formed server environment', () => {
    const env = loadServerEnv({ ...SERVER_OK });
    expect(env.supabaseServiceRoleKey).toBe('service-role-key');
    expect(env.razorpayWebhookSecret).toBe('webhook-secret');
    expect('razorpayWebhookSecretPrevious' in env).toBe(false);
  });

  it('accepts the previous webhook secret during a rotation', () => {
    const env = loadServerEnv({ ...SERVER_OK, RAZORPAY_WEBHOOK_SECRET_PREVIOUS: 'older' });
    expect(env.razorpayWebhookSecretPrevious).toBe('older');
  });

  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'])(
    'requires %s',
    (name) => {
      const source = { ...SERVER_OK } as Record<string, string | undefined>;
      delete source[name];
      expect(problemsFrom(() => loadServerEnv(source))).toContain(`${name} is missing or empty.`);
    },
  );

  it('reports every missing variable in one go, so a deploy is fixed in one pass', () => {
    const problems = problemsFrom(() => loadServerEnv({ APP_ENV: 'staging' }));
    expect(problems.sort()).toEqual([
      'RAZORPAY_KEY_ID is missing or empty.',
      'RAZORPAY_KEY_SECRET is missing or empty.',
      'RAZORPAY_WEBHOOK_SECRET is missing or empty.',
      'SUPABASE_ANON_KEY is missing or empty.',
      'SUPABASE_SERVICE_ROLE_KEY is missing or empty.',
      'SUPABASE_URL is missing or empty.',
    ]);
  });

  it('treats a whitespace-only value as missing', () => {
    expect(problemsFrom(() => loadServerEnv({ ...SERVER_OK, RAZORPAY_KEY_SECRET: '   ' })))
      .toContain('RAZORPAY_KEY_SECRET is missing or empty.');
  });
});
