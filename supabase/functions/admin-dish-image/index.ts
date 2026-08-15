// `admin-dish-image` — putting a photo on a dish. `E10-24`.
//
//   POST /functions/v1/admin-dish-image
//     { dishId, filename, contentType, dataBase64, width?, height? }
//     { dishId, remove: true }
//
//     200 { assetId, bucket, path, bytes } | { removed: true }
//     401 not_authenticated
//     403 not_permitted        needs dish.edit
//     404 unknown_dish
//     413 too_large
//     422 validation_failed
//     405 method_not_allowed
//
// ## Why the bytes come through here rather than straight to storage
//
// `storage.objects` has **no policies at all**, so an authenticated browser cannot write to the
// bucket — default-deny, and correctly so. Uploading from the client would mean opening that up
// with a policy broad enough to be hard to reason about, on a **public** bucket.
//
// Routing through a function keeps three things in one place that otherwise end up in three:
// the `dish.edit` check, the `asset` row, and `dish.image_asset_id`. A direct-to-storage upload
// leaves an object with no `asset` row on any failure after the PUT — a file nothing references,
// which nothing will ever clean up because nothing knows it is there.
//
// ## The old image is not deleted
//
// Replacing a photo soft-deletes the previous `asset` row and leaves the object in the bucket.
// Deleting it would break any cached menu payload still pointing at it, and a stale photo is a
// far smaller problem than a broken one on a menu a parent is reading. `deleted_at` makes the
// orphan findable later.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'dish-images';

/**
 * 3 MB after the browser has already downscaled. A dish photo that arrives larger than this is a
 * client that did not resize, and letting it through would put a 12 MB original on a menu read
 * over a patchy connection — the exact thing the performance priorities put images in the list for.
 */
const MAX_BYTES = 3 * 1024 * 1024;

const ALLOWED = new Map([
  ['image/webp', 'webp'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
]);

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

Deno.serve(async (request: Request): Promise<Response> => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = request.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await anon.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json(401, { error: 'not_authenticated' });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  const { data: grants, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code')
    .is('revoked_at', null);
  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }
  if (!(grants ?? []).some((g: { permission_code: string }) => g.permission_code === 'dish.edit')) {
    return json(403, { error: 'not_permitted', requires: 'dish.edit' });
  }

  const dishId = str(body.dishId);
  if (!dishId || !UUID.test(dishId)) {
    return json(422, { error: 'validation_failed', fields: { dishId: 'required, and a uuid' } });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: dish } = await admin
    .from('dish')
    .select('id,image_asset_id')
    .eq('id', dishId)
    .maybeSingle();
  if (!dish) return json(404, { error: 'unknown_dish', dishId });

  /** Soft-delete the row the dish currently points at. The object itself is left in the bucket. */
  const retireCurrent = async () => {
    if (!dish.image_asset_id) return;
    await admin
      .from('asset')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', dish.image_asset_id);
  };

  // ------------------------------------------------------------------------------ remove
  if (body.remove === true) {
    await retireCurrent();
    const { error } = await admin.from('dish').update({ image_asset_id: null }).eq('id', dishId);
    if (error) {
      console.error('image unlink failed', error.code);
      return json(500, { error: 'internal' });
    }
    return json(200, { removed: true });
  }

  // ------------------------------------------------------------------------------ upload
  const contentType = (str(body.contentType) ?? '').toLowerCase();
  const extension = ALLOWED.get(contentType);
  if (!extension) {
    return json(422, {
      error: 'validation_failed',
      fields: { contentType: `must be one of: ${[...ALLOWED.keys()].join(', ')}` },
    });
  }

  const dataBase64 = str(body.dataBase64);
  if (!dataBase64) {
    return json(422, { error: 'validation_failed', fields: { dataBase64: 'required' } });
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(dataBase64);
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return json(422, { error: 'validation_failed', fields: { dataBase64: 'not valid base64' } });
  }
  if (bytes.byteLength === 0) {
    return json(422, { error: 'validation_failed', fields: { dataBase64: 'the file is empty' } });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return json(413, {
      error: 'too_large',
      detail: `${Math.round(bytes.byteLength / 1024)} kB. The limit is ${MAX_BYTES / 1024 / 1024} MB after resizing.`,
    });
  }

  // The path carries the dish id and a timestamp: same dish, new file, new object, so a replaced
  // photo cannot be served from a CDN cache of the old one.
  const path = `${dishId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (uploadError) {
    console.error('image upload failed', uploadError.message);
    return json(500, { error: 'internal', detail: 'the file could not be stored' });
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const width = Number.isInteger(body.width) ? (body.width as number) : null;
  const height = Number.isInteger(body.height) ? (body.height as number) : null;

  const { data: asset, error: assetError } = await admin
    .from('asset')
    .insert({
      kind: 'dish_image',
      bucket: BUCKET,
      path,
      mime_type: contentType,
      byte_size: bytes.byteLength,
      width,
      height,
      checksum_sha256: checksum,
      uploaded_by_user_id: user.id,
    })
    .select('id')
    .single();
  if (assetError) {
    // The object is already in the bucket. Removed again rather than left behind: an object with
    // no `asset` row is invisible to everything that could ever tidy it up.
    await admin.storage.from(BUCKET).remove([path]);
    console.error('asset insert failed', assetError.code);
    return json(500, { error: 'internal' });
  }

  await retireCurrent();

  const { error: linkError } = await admin
    .from('dish')
    .update({ image_asset_id: asset.id })
    .eq('id', dishId);
  if (linkError) {
    console.error('image link failed', linkError.code);
    return json(500, { error: 'internal' });
  }

  return json(200, { assetId: asset.id, bucket: BUCKET, path, bytes: bytes.byteLength });
});
