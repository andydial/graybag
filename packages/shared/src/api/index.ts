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
  storagePublicUrl,
  DISH_IMAGE_BUCKET,
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

// The kitchen dashboard's reads and its one write (`E09-04`, `E09-05`, `E09-17`).
//
// NOTE FOR THE PAYMENTS THREAD: `kitchen.ts` and
// `supabase/functions/kitchen-order-status/` were written by the WEB thread on 2026-08-12,
// on Andy's instruction while this thread was on `E06`. These six lines are the only edit
// made to any file outside those two — without the export, nothing there is reachable from
// `apps/web`, because this package exposes only `.`.
export {
  KITCHEN_ORDER_COLUMNS,
  KitchenPayloadError,
  fetchKitchenOrders,
  fetchKitchenSchools,
  fetchMyGrants,
  updateKitchenOrderStatus,
  type ApiKitchenOrder,
  type ApiKitchenOrderLine,
  type KitchenSchool,
  type KitchenOrderStatus,
  type KitchenStatusAction,
  type KitchenStatusResult,
} from './kitchen.js';

// The allergens a parent ticks when adding a child (E05-01). Ids, not names, because
// `recipient_allergen` and `dish_allergen` share this vocabulary — that shared row id is the
// whole mechanism behind an allergen warning, and a free-text note cannot do it.
export {
  ALLERGEN_COLUMNS,
  AllergenPayloadError,
  fetchAllergens,
  type ApiAllergen,
} from './allergens.js';

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
export { fetchOrders, type ApiOrderSummary, type ApiOrderStatus } from './orders.js';
export {
  createPaymentOrder,
  fetchCheckoutStatus,
  type PaymentOrder,
  type CheckoutStatus,
  type CheckoutStatusResult,
  type SettledOrderSummary,
} from './payments.js';

// Adding a child and moving one (E05-01, E05-02, E20-02). Consent is a field on the create
// call rather than a call of its own — the server writes the child, the guardian link and
// the consent record in one transaction, so there is no shape here that could separate them.
//
// `fetchRecipients` is the read half, and it goes through `guardian_link` — `D10`, the only
// path from a user to a child. `recipient.created_by_user_id` decides nothing, here or in
// any policy.
export {
  RECIPIENT_COLUMNS,
  RecipientPayloadError,
  changeRecipientSchool,
  updateRecipientDetails,
  removeRecipient,
  createRecipient,
  fetchRecipients,
  fetchRecipientAllergens,
  type ApiRecipient,
  type CreatedRecipient,
  type NewRecipient,
  type RecipientEdit,
  type SchoolChange,
  type SchoolChangeResult,
} from './recipients.js';


// The policy-version acceptance gate (`E20-36`, `E20-03`). The read is a PostgREST query
// under RLS; the acceptance is a write and so goes through the `policy` Edge Function, which
// owns `source` and the evidence columns — evidence a client can author is not evidence.
export {
  POLICY_VERSION_COLUMNS,
  PolicyPayloadError,
  acceptPolicyVersion,
  compareVersions,
  fetchPendingPolicies,
  type PendingPolicy,
} from './policy.js';

// The break windows a parent picks from (`E05-30`, `P19`). An empty list is the answer "this
// school cannot take orders yet", not an empty state — `0027` makes it readable signed out so a
// visitor learns that before building a cart rather than after signing in.
export {
  BREAK_TIME_COLUMNS,
  BreakTimePayloadError,
  fetchBreakTimes,
  formatBreakWindow,
  type BreakTime,
} from './breakTimes.js';

// The account holder's own name (`P18`, `E05-39`). Asked once, after payment, and never a
// precondition for anything: order one has no name and that has to be fine everywhere.
export {
  PROFILE_COLUMNS,
  ProfilePayloadError,
  clearUserName,
  fetchProfile,
  setUserName,
  shouldAskForName,
  skipNamePrompt,
  type Profile,
} from './profile.js';
