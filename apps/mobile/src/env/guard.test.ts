import { ProductionGuardError, assertNotAccidentallyProduction } from './guard';

const run = (over: Partial<Parameters<typeof assertNotAccidentallyProduction>[0]> = {}) =>
  assertNotAccidentallyProduction({
    appEnv: 'production',
    allowProd: undefined,
    isDev: true,
    ...over,
  });

describe('assertNotAccidentallyProduction', () => {
  /**
   * The case the guard exists for, and the one `EN2` cannot catch: nothing here is
   * inconsistent. The keys are live, the URL is production, every existing check passes —
   * and a checkout placed against it is a real order for a real child.
   */
  it('refuses a dev build against production', () => {
    expect(() => run()).toThrow(ProductionGuardError);
  });

  it('allows it when explicitly opted in', () => {
    expect(() => run({ allowProd: 'true' })).not.toThrow();
  });

  it('treats anything other than the exact string "true" as not opted in', () => {
    // A half-set flag must fail closed. `ALLOW_PROD=1` and `ALLOW_PROD=yes` are somebody
    // guessing at the syntax, and guessing right by accident is worse than being told.
    for (const value of ['1', 'yes', 'TRUE', 'True', '', ' true', undefined]) {
      expect(() => run({ allowProd: value })).toThrow(ProductionGuardError);
    }
  });

  it('does not interfere with staging or local', () => {
    expect(() => run({ appEnv: 'staging' })).not.toThrow();
    expect(() => run({ appEnv: 'local' })).not.toThrow();
  });

  it('never fires in a release build — a store build IS production', () => {
    expect(() => run({ isDev: false })).not.toThrow();
    expect(() => run({ isDev: false, allowProd: undefined })).not.toThrow();
  });

  it('says what to do instead, not just that it refused', () => {
    // An error a developer cannot act on is an error they work around.
    try {
      run();
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('npm run dev:mobile');
      expect((error as Error).message).toContain('EXPO_PUBLIC_ALLOW_PROD=true');
    }
  });

  it('returns void rather than a boolean', () => {
    // A boolean invites `if (guardOk()) {...}`, and a caller who forgets the `if` gets no
    // guard at all — silently, which is the failure shape this module exists to remove.
    expect(run({ appEnv: 'staging' })).toBeUndefined();
  });
});
