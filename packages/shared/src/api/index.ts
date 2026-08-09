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
  setApiTransport,
  type ApiTransport,
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

