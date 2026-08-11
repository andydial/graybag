/**
 * A local stand-in for the `enquiry-submit` Edge Function, for `astro dev` only.
 *
 * ## Why this exists
 *
 * The real endpoint lives in `supabase/`, which another thread owns, and it is specified in
 * `docs/enquiry-submission-contract.md` rather than built here. Without something to post to,
 * the form could not be filled in, the no-JavaScript path could not be walked, and the whole
 * enquiry flow would be unreviewable until the other side landed. That is the wrong order: the
 * form's behaviour is what we want looked at now.
 *
 * So this implements **the contract, not the feature** — the same request shapes, the same
 * status codes, the same error bodies, the same redirect behaviour. It writes each submission to
 * `.dev-enquiries.jsonl` and prints it, so a local run can be inspected.
 *
 * ## It is a development integration and cannot reach production
 *
 * Astro integrations receive `command`, and this one returns without registering anything unless
 * the command is `dev`. It is never part of `astro build`, so there is no route in `dist/` and
 * nothing to deploy. Belt and braces: the file writes to a gitignored path and says loudly in
 * its response body that it is a mock.
 */
import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, '..', '.dev-enquiries.jsonl');

/** The path the form posts to in development. Production posts to the Edge Function's URL. */
export const ENQUIRY_ENDPOINT_PATH = '/api/dev/enquiry';

/** Mirrors `docs/enquiry-submission-contract.md` §4. Kept in the same order as the document. */
const REQUIRED = ['name', 'role', 'school', 'city', 'email', 'phone'];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (c) => chunks.push(c));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

export function devEnquiryEndpoint() {
  return {
    name: 'graybag:dev-enquiry-endpoint',
    hooks: {
      'astro:config:setup': ({ command, logger }) => {
        if (command !== 'dev') return;
        logger.info(`mock enquiry endpoint at ${ENQUIRY_ENDPOINT_PATH} (writes .dev-enquiries.jsonl)`);
      },
      'astro:server:setup': ({ server, logger }) => {
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          if (url.pathname !== ENQUIRY_ENDPOINT_PATH) return next();

          if (request.method === 'OPTIONS') {
            response.writeHead(204, {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': 'content-type',
              'access-control-allow-methods': 'POST, OPTIONS',
            });
            return response.end();
          }

          if (request.method !== 'POST') {
            return json(response, 405, { error: 'method_not_allowed' });
          }

          const raw = await readBody(request);
          const contentType = request.headers['content-type'] ?? '';
          const isForm = contentType.includes('application/x-www-form-urlencoded');

          let fields;
          try {
            fields = isForm
              ? Object.fromEntries(new URLSearchParams(raw))
              : JSON.parse(raw || '{}');
          } catch {
            return json(response, 400, { error: 'malformed_body' });
          }

          // The honeypot and the timing floor, exactly as the contract specifies: accepted with
          // a 202 and silently dropped, never rejected. A bot told it failed tries again.
          const honeypot = String(fields.website ?? '');
          const elapsed = Number(fields.elapsed_ms ?? 0);
          if (honeypot.trim() !== '' || (Number.isFinite(elapsed) && elapsed > 0 && elapsed < 3000)) {
            logger.warn(`enquiry looked automated (honeypot=${JSON.stringify(honeypot)}, elapsed=${elapsed}ms) — dropped`);
            if (isForm) {
              response.writeHead(303, { location: '/thanks' });
              return response.end();
            }
            return json(response, 202, { status: 'accepted' });
          }

          const missing = REQUIRED.filter((f) => !String(fields[f] ?? '').trim());
          if (missing.length) {
            if (isForm) {
              response.writeHead(303, { location: `/#enquiry-error` });
              return response.end();
            }
            return json(response, 422, {
              error: 'validation_failed',
              fields: Object.fromEntries(missing.map((f) => [f, 'required'])),
            });
          }

          const record = {
            received_at: new Date().toISOString(),
            mock: true,
            transport: isForm ? 'form' : 'json',
            fields,
          };
          appendFileSync(LOG, `${JSON.stringify(record)}\n`, 'utf8');
          logger.info(`enquiry from ${fields.name} (${fields.school}) — written to .dev-enquiries.jsonl`);

          if (isForm) {
            response.writeHead(303, { location: '/thanks' });
            return response.end();
          }
          return json(response, 201, {
            status: 'created',
            id: '00000000-0000-4000-8000-000000000000',
            mock: true,
            note: 'Local development mock. The real endpoint is the enquiry-submit Edge Function.',
          });
        });
      },
    },
  };
}
