/**
 * Refuse to write test data into production. Andy's rule, 2026-08-17.
 *
 *     import { assertNotProductionWrite } from './lib/prod-write-guard.mjs';
 *     assertNotProductionWrite(supabaseUrl, 'create a recipient and an order');
 *
 * ## Why this is code and not a paragraph
 *
 * The rule — *no test data is ever created in production* — was written after a verification
 * sweep left three orders, two children, three consent records, a payment, an enquiry and three
 * webhook events on the live project. Every one of those was created deliberately, by someone
 * who knew what production was, in the belief that a small verification was worth it.
 *
 * That is the point. A rule against writing to production is broken by people who have read the
 * rule and think this case is different, so a paragraph in `CLAUDE.md` is necessary and not
 * sufficient. `grant-operator.mjs` already had the right shape for the neighbouring problem —
 * it refuses to grant permissions to the customer persona, and the refusal is deliberately not
 * overridable by a flag — and this is the same idea one level up.
 *
 * ## The override, and why it looks like that
 *
 * Some things genuinely can only be proven on production: a live payment, a real webhook
 * signature, an email actually leaving the building. Andy's rule allows those **with his
 * explicit go-ahead, given what it will write, before it runs**. So the escape hatch is not a
 * boolean — a boolean is something you set once and forget in a shell profile. It is a sentence
 * describing what is about to be written:
 *
 *     GRAYBAG_PROD_WRITE="Andy approved 2026-08-19: one live ₹5 order to prove settlement" \
 *       node scripts/whatever.mjs
 *
 * It must be at least 30 characters, and it is echoed to stderr before the script proceeds, so
 * the terminal history says what was done and on whose authority. `yes`, `1` and `true` are
 * refused, because the whole value of the hatch is that it cannot be set thoughtlessly.
 */

/** The live project. `docs/environments.md` §2. */
export const PRODUCTION_REF = 'bdamkuugbqjajbndjoxn';

/** Known non-production projects, named so a typo in a ref is not silently "not production". */
export const STAGING_REF = 'jcagqjsibcpjyskvebeq';

const OVERRIDE = 'GRAYBAG_PROD_WRITE';
const MIN_REASON = 30;

/**
 * The project ref inside a target, or null when it is not a Supabase project (local, empty,
 * nonsense).
 *
 * Two forms, because the scripts use both: the REST host `https://<ref>.supabase.co`, and the
 * pooler URI `postgresql://postgres.<ref>:pw@aws-0-….pooler.supabase.com`. Recognising only the
 * first would leave every `psql`-based script unguarded, which is most of the ones that write.
 */
export function projectRef(target) {
  if (typeof target !== 'string') return null;
  const host = target.match(/https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)/i);
  if (host) return host[1].toLowerCase();
  const pooler = target.match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9]{20})[:@]/i);
  return pooler ? pooler[1].toLowerCase() : null;
}

export function isProduction(target) {
  return projectRef(target) === PRODUCTION_REF;
}

/**
 * Throw unless it is safe to write to `target`.
 *
 * @param {string} target        the Supabase URL (or database URL) about to be written to
 * @param {string} whatItWrites  a plain description — "a recipient and a cancelled order"
 */
export function assertNotProductionWrite(target, whatItWrites) {
  if (!isProduction(target)) return;

  const reason = (process.env[OVERRIDE] ?? '').trim();
  const trivial = ['1', 'true', 'yes', 'y', 'ok', 'go'].includes(reason.toLowerCase());

  if (reason.length >= MIN_REASON && !trivial) {
    process.stderr.write(
      `\n⚠️  WRITING TO PRODUCTION (${PRODUCTION_REF})\n` +
        `    about to write: ${whatItWrites}\n` +
        `    authority:      ${reason}\n\n`,
    );
    return;
  }

  const detail = trivial
    ? `${OVERRIDE} is set to "${reason}", which is not a sentence anybody can be held to.`
    : reason.length > 0
      ? `${OVERRIDE} is set but is only ${reason.length} characters; ${MIN_REASON} are needed.`
      : `${OVERRIDE} is not set.`;

  throw new Error(
    `Refusing to write to PRODUCTION.\n\n` +
      `  target : ${target}\n` +
      `  would  : ${whatItWrites}\n\n` +
      `No test data is created in production — not by a person, not by CI, not by a smoke\n` +
      `script, not "just once to verify". Verification happens on staging.\n\n` +
      `${detail}\n\n` +
      `If this genuinely can only be proven on production — a live payment, a real webhook\n` +
      `signature, an email actually sending — Andy has to agree first, knowing what it will\n` +
      `write. Then say so where the next person can read it:\n\n` +
      `  ${OVERRIDE}="Andy approved <date>: <what and why>" node <script>\n`,
  );
}
