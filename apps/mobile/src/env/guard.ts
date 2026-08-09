/**
 * The production guard (`E14-11`, lifting the pattern from the Dubbaa project).
 *
 * `EN2` already asserts that the Razorpay key prefix matches `APP_ENV` — that catches a
 * *mismatched* environment. This catches a **correctly configured production environment
 * being used by a development build**, which `EN2` cannot, because nothing about it is
 * inconsistent: the keys are live, the URL is production, and every check passes.
 *
 * The failure it prevents is silent. A developer testing checkout against production creates
 * a real order for a real child at a real school, charges a real card, and nothing on the
 * screen says so — the app looks identical. The recovery is a refund, a support conversation
 * and a row in the ledger that should not exist.
 *
 * So a dev build against production has to be an explicit act: `EXPO_PUBLIC_ALLOW_PROD=true`,
 * which lives only in `.env.production` and is copied in only by `npm run dev:mobile:prod`.
 * Store builds set no such flag and do not need it — `__DEV__` is false there.
 */

export class ProductionGuardError extends Error {
  constructor() {
    super(
      'Refusing to start a development build against PRODUCTION.\n' +
        '\n' +
        'This environment points at live data and live Razorpay: an order placed here is a\n' +
        'real order for a real child, and a payment is real money.\n' +
        '\n' +
        'If you meant staging:   npm run dev:mobile\n' +
        'If you truly meant prod: set EXPO_PUBLIC_ALLOW_PROD=true in apps/mobile/.env.production\n',
    );
    this.name = 'ProductionGuardError';
  }
}

export interface GuardInput {
  appEnv: string | undefined;
  allowProd: string | undefined;
  isDev: boolean;
}

/**
 * Returns nothing and throws on refusal, rather than returning a boolean.
 *
 * A boolean invites `if (guardOk()) { ... }` and a caller who forgets the `if` gets no guard
 * at all — silently, which is the shape of failure this whole module exists to remove.
 */
export function assertNotAccidentallyProduction({
  appEnv,
  allowProd,
  isDev,
}: GuardInput): void {
  if (!isDev) return; // A store build IS production. That is the point of it.
  if (appEnv !== 'production') return;
  if (allowProd === 'true') return;
  throw new ProductionGuardError();
}

/** Read from the Expo-injected environment. Split out so the logic above stays testable. */
export function guardFromEnvironment(): void {
  assertNotAccidentallyProduction({
    appEnv: process.env.EXPO_PUBLIC_APP_ENV,
    allowProd: process.env.EXPO_PUBLIC_ALLOW_PROD,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}
