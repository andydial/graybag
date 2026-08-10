/**
 * The `api/` module — non-negotiable #1 and `A4`.
 *
 * Every backend call from the app enters here. Reads may use the Supabase client; writes
 * always go through Edge Functions. Nothing outside this directory may import
 * `@supabase/supabase-js`, and ESLint fails the build if it tries.
 *
 * Currently menu reads only. As `E03`, `E05` and `E06` land, their calls join this surface
 * rather than growing a second one — a screen that talks to the backend some other way is
 * the thing this module exists to prevent.
 */
export {
  ApiError,
  ApiNotConfiguredError,
  configureApi,
  invokeFunction,
  setApiTransport,
  type ApiTransport,
  type FunctionsRef,
  type SelectBuilder,
  type TableRef,
} from './client.js';

export {
  MenuPayloadError,
  fetchMenu,
  fetchMenuVersion,
  type ApiDish,
  type ApiDishAllergen,
  type ApiMenuPayload,
} from './menu.js';

export {
  SCHOOL_COLUMNS,
  SchoolPayloadError,
  fetchSchools,
  type ApiSchool,
} from './schools.js';

// Sign-in (E03, U1). Email OTP today; Google and Apple join this surface rather than
// growing a second one. No passwords, and no path that could carry one.
export {
  AuthError,
  currentUser,
  linkingPolicy,
  looksLikeEmail,
  normaliseEmail,
  sendEmailOtp,
  signOut,
  verifyEmailOtp,
  type AuthTransport,
  type AuthUser,
} from './auth.js';

// Session persistence (E03-20). The store is injected because packages/shared is imported
// by apps/web too, and expo-secure-store is a native module that does not exist there.
export {
  CHUNK_SIZE,
  chunkedStore,
  memoryStore,
  type SessionStore,
} from './session-storage.js';

// The first write (E05-09). Writes always go through an Edge Function (A4).
export { createCheckout, type CheckoutLine, type CheckoutResult } from './checkout.js';

// Adding a child and moving one (E05-01, E05-02, E20-02). Consent is a field on the create
// call rather than a call of its own — the server writes the child, the guardian link and
// the consent record in one transaction, so there is no shape here that could separate them.
export {
  changeRecipientSchool,
  createRecipient,
  type CreatedRecipient,
  type NewRecipient,
  type SchoolChange,
  type SchoolChangeResult,
} from './recipients.js';

