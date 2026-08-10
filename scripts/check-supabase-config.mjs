#!/usr/bin/env node
/**
 * Assert the Supabase **project** configuration the repo does not own.
 *
 *     SUPABASE_ACCESS_TOKEN=... node scripts/check-supabase-config.mjs staging
 *
 * ## Why this exists
 *
 * `supabase/config.toml` configures the **local** stack and nothing else. Every hosted project
 * setting — auth email templates, Site URL, the redirect allow-list, OTP length and expiry,
 * rate limits, SMTP — lives in the dashboard. It is not in a migration, not in a test, and
 * invisible to CI. So it looks configured because nothing says otherwise.
 *
 * It cost a day: the magic-link template still used `{{ .ConfirmationURL }}`, so Supabase
 * emailed a link while the app sat waiting for a six-digit code, and the link opened a blank
 * page because Site URL was never set. Nothing in the repository could have caught that, and
 * nothing would have caught it again the day we point at production — with real parents on the
 * other end.
 *
 * This reads the live config through the Management API and asserts it against what the app
 * actually needs.
 *
 * ## Why it is not in the smoke test
 *
 * It needs the network and a management token, and — more importantly — **every failure here is
 * fixed in a dashboard by Andy, not in a pull request.** A red smoke test that no code change
 * can turn green trains people to ignore the smoke test. It runs in `integration.yml` and in
 * the cutover runbook, where somebody can act on it.
 */
const ENVIRONMENTS = {
  staging: { ref: 'jcagqjsibcpjyskvebeq', siteUrlMustNotBeLocalhost: true },
  // Filled in when the production project exists (`E01-05`). Deliberately not guessed: a wrong
  // ref here would assert a healthy config on a project nobody is using.
  production: { ref: process.env.SUPABASE_PRODUCTION_REF ?? '', siteUrlMustNotBeLocalhost: true },
};

const env = process.argv[2] ?? 'staging';
const target = ENVIRONMENTS[env];
if (!target) {
  console.error(`Unknown environment "${env}". Expected one of: ${Object.keys(ENVIRONMENTS).join(', ')}`);
  process.exit(2);
}
if (!target.ref) {
  console.error(`No project ref for "${env}". Set SUPABASE_PRODUCTION_REF once the project exists.`);
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(
    'SUPABASE_ACCESS_TOKEN is not set.\n' +
      'In CI it is already a repository secret. Locally: export it, or read it from the CLI\'s\n' +
      "keychain entry — security find-generic-password -s 'Supabase CLI' -w",
  );
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`Management API returned ${res.status} for ${env} (${target.ref}).`);
  process.exit(2);
}
const config = await res.json();

/**
 * What the app needs, and why. Each check names the symptom a user would see, because
 * "site_url is wrong" tells whoever reads the failure nothing about what breaks.
 */
const checks = [
  {
    name: 'OTP emails carry a code, not a magic link',
    ok: () => {
      const template = config.mailer_templates_magic_link_content ?? '';
      // An empty template means Supabase's default, which is a ConfirmationURL link.
      if (template.trim() === '') return false;
      return template.includes('{{ .Token }}') && !template.includes('{{ .ConfirmationURL }}');
    },
    why:
      'The app asks for a six-digit code and shows a six-box input. If the template sends a\n' +
      '    link, a parent receives a link, taps it, and lands on a blank page while the app waits\n' +
      '    for a code that never arrives. This is the defect that cost 2026-08-10.',
  },
  {
    name: 'OTP length matches what the app asks for',
    ok: () => config.mailer_otp_length === 6,
    actual: () => `mailer_otp_length = ${config.mailer_otp_length}`,
    why:
      'SignInScreen says "six-digit code" and labels the field "Six-digit code". A project set\n' +
      '    to 8 emails an eight-digit code, and the screen is lying to the person reading it.',
  },
  {
    name: 'Site URL is set and is not localhost',
    ok: () => {
      const url = config.site_url ?? '';
      return url !== '' && !/localhost|127\.0\.0\.1/.test(url);
    },
    actual: () => `site_url = ${JSON.stringify(config.site_url)}`,
    why:
      'Any link Supabase generates — including a password-less email that falls back to a link —\n' +
      '    is built from this. Unset, every such link opens a blank localhost page on the\n' +
      "    recipient's phone.",
  },
  {
    name: 'Redirect allow-list is not empty',
    ok: () => (config.uri_allow_list ?? '') !== '',
    actual: () => `uri_allow_list = ${JSON.stringify(config.uri_allow_list)}`,
    why:
      'Empty means only Site URL is permitted. The app scheme (graybag-staging://) has to be\n' +
      '    here before any deep link or OAuth callback can return to the app.',
  },
  {
    name: 'Email rate limit is workable for real families',
    ok: () => (config.rate_limit_email_sent ?? 0) >= 10,
    actual: () => `rate_limit_email_sent = ${config.rate_limit_email_sent} per hour`,
    why:
      'This is the whole project, not per user. At 2/hour the third parent to sign in during a\n' +
      '    school-gate rush gets nothing, and reports the app as broken.',
  },
  {
    name: 'A real SMTP sender is configured',
    ok: () => (config.smtp_host ?? null) !== null,
    actual: () => `smtp_host = ${JSON.stringify(config.smtp_host)}`,
    why:
      "Supabase's built-in email service is for development. It is rate-limited to a handful of\n" +
      '    messages an hour and does not guarantee delivery — which for an OTP-only product means\n' +
      '    nobody can sign in. **Blocks production, not staging.**',
    productionOnly: true,
  },
  {
    name: 'Signup is enabled',
    ok: () => config.disable_signup !== true,
    why: 'First sign-in IS registration (`AR4`). Disabled, no new parent can ever create an account.',
  },
  {
    name: 'Email autoconfirm is OFF',
    ok: () => config.mailer_autoconfirm === false,
    actual: () => `mailer_autoconfirm = ${config.mailer_autoconfirm}`,
    why:
      'On, an address is trusted without the code being entered — anyone could sign in as any\n' +
      '    email they can spell.',
  },
];

console.log(`Supabase project config — ${env} (${target.ref})\n`);

let failed = 0;
let warned = 0;
for (const check of checks) {
  const pass = check.ok();
  const productionOnly = check.productionOnly && env !== 'production';
  if (pass) {
    console.log(`  ok    ${check.name}`);
    continue;
  }
  if (productionOnly) {
    warned += 1;
    console.log(`  warn  ${check.name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${check.name}`);
  }
  if (check.actual) console.log(`        ${check.actual()}`);
  console.log(`        ${check.why}`);
}

console.log('');
if (failed > 0) {
  console.error(
    `${failed} setting(s) wrong on ${env}. These are fixed in the Supabase dashboard, not in a\n` +
      'pull request — see docs/environments.md §"Project configuration the repo does not own".',
  );
  process.exit(1);
}
console.log(`All checks pass${warned ? ` (${warned} warning(s) for production only)` : ''}.`);
