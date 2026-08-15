#!/usr/bin/env node
/**
 * Attach the processed build to an App Store version and submit it for review. `E17-53`.
 *
 *     ASC_KEY_ID=… ASC_ISSUER_ID=… EXPO_ASC_API_KEY_PATH=… \
 *       node scripts/asc-submit-for-review.mjs 4.0.0 [--wait]
 *
 * ## Why this exists
 *
 * **`eas submit` uploads; it does not submit for review.** It hands the binary to App Store
 * Connect, which is what feeds TestFlight, and stops there. Everything after that — creating the
 * version record, writing release notes, attaching the build, and actually asking Apple to review
 * it — is separate, and on 16 August it was the last mile nobody had automated.
 *
 * Doing it by hand in the web UI is four screens and easy to half-finish; a build that sits in
 * `PREPARE_FOR_SUBMISSION` looks submitted to anyone glancing at TestFlight and is not.
 *
 * ## What it will not do
 *
 * It refuses rather than guessing:
 *
 * - **No build in `VALID` state** → it says so and exits. Apple can take an hour or more, and a
 *   build that never appears usually means processing rejected it and emailed the account — the
 *   API shows nothing at all in that case, which is why the message says to check the mail.
 * - **Empty release notes** → refuses. Apple rejects an update with no "What's New", and finding
 *   that out from a review rejection costs a day.
 * - **Already submitted** → reports the state and exits cleanly, so re-running is safe.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const APP_ID = '6749555467';
const API = 'https://api.appstoreconnect.apple.com';

const version = process.argv[2];
const wait = process.argv.includes('--wait');
if (!version) {
  console.error('usage: asc-submit-for-review.mjs <versionString> [--wait]');
  process.exit(2);
}

/** ES256 JWT, using node's crypto — the ASC API wants raw r||s, node emits DER. */
function token() {
  const key = readFileSync(process.env.EXPO_ASC_API_KEY_PATH, 'utf8');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({
    iss: process.env.ASC_ISSUER_ID,
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  });
  const s = createSign('SHA256');
  s.update(`${head}.${body}`);
  const der = s.sign(key);
  let i = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const parts = [];
  for (let n = 0; n < 2; n += 1) {
    const len = der[i + 1];
    let v = der.subarray(i + 2, i + 2 + len);
    while (v.length > 32) v = v.subarray(1);
    parts.push(Buffer.concat([Buffer.alloc(32 - v.length), v]));
    i += 2 + len;
  }
  return `${head}.${body}.${Buffer.concat(parts).toString('base64url')}`;
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (json.errors) {
    throw new Error(json.errors.map((e) => `${e.status} ${e.title}: ${e.detail}`).join('\n'));
  }
  return json;
}

const findBuild = async () => {
  const r = await api(
    `/v1/builds?filter[app]=${APP_ID}&filter[preReleaseVersion.version]=${version}&limit=10&sort=-uploadedDate`,
  );
  return (r.data ?? []).find((b) => b.attributes.processingState === 'VALID') ?? null;
};

let build = await findBuild();
if (!build && wait) {
  process.stdout.write('waiting for Apple to finish processing');
  for (let i = 0; i < 80 && !build; i += 1) {
    await new Promise((r) => setTimeout(r, 45_000));
    process.stdout.write('.');
    build = await findBuild();
  }
  process.stdout.write('\n');
}

if (!build) {
  console.error(
    `No VALID build for ${version}.\n\n` +
      'If the upload succeeded and nothing has appeared after an hour, Apple most likely\n' +
      'REJECTED the binary during processing — export compliance, entitlements, a missing icon.\n' +
      'That produces no API record at all; it is emailed to the account. Check that inbox.',
  );
  process.exit(1);
}
console.log(`build ${build.attributes.version} is VALID (${build.id})`);

const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=20`);
const v = (versions.data ?? []).find((x) => x.attributes.versionString === version);
if (!v) {
  console.error(`No App Store version ${version}. Create it first.`);
  process.exit(1);
}
console.log(`version ${version} is ${v.attributes.appStoreState} (${v.id})`);

if (v.attributes.appStoreState !== 'PREPARE_FOR_SUBMISSION') {
  console.log('Nothing to do — this version is past PREPARE_FOR_SUBMISSION.');
  process.exit(0);
}

// Release notes, checked before submitting rather than discovered in a rejection.
const locs = await api(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
const missing = (locs.data ?? []).filter((l) => !(l.attributes.whatsNew ?? '').trim());
if (missing.length > 0) {
  console.error(
    `Release notes ("What's New") are empty for: ${missing
      .map((l) => l.attributes.locale)
      .join(', ')}.\nApple rejects an update without them.`,
  );
  process.exit(1);
}

await api(`/v1/appStoreVersions/${v.id}/relationships/build`, {
  method: 'PATCH',
  body: JSON.stringify({ data: { type: 'builds', id: build.id } }),
});
console.log('build attached to the version');

const sub = await api('/v1/appStoreVersionSubmissions', {
  method: 'POST',
  body: JSON.stringify({
    data: {
      type: 'appStoreVersionSubmissions',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } },
    },
  }),
});
console.log(`submitted for review (${sub.data?.id})`);

const after = await api(`/v1/appStoreVersions/${v.id}`);
console.log(`state is now: ${after.data.attributes.appStoreState}`);
