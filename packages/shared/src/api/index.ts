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
  // `E10-29`. The generic read, exported so `/admin/import` can satisfy the CLI importer's
  // `snapshot(db)` — which only ever calls `db.from(t).select(c)` — without any caller outside
  // this directory touching `@supabase/supabase-js` (non-negotiable #1).
  runQuery,
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
// The all-kitchens order dashboard (`E10-08`). Its own module and its own column list rather
// than a flag on `kitchen.ts`: money is a separate grant (`D3`), and a redaction behind a boolean
// is one careless caller away from not being a redaction.
export {
  ADMIN_ORDER_COLUMNS,
  AdminOrderPayloadError,
  fetchAdminOrders,
  totalsFor,
  type AdminOrder,
  type AdminOrderTotals,
} from './admin-orders.js';

// School onboarding and editing (`E10-01`). Its own module and its own column list rather than
// widening `schools.ts`: that one is the parent-facing picker, readable signed out under `0012`,
// and its narrow column list is the only thing keeping a named member of staff and their direct
// line off a public surface. Two lists means the parent path cannot leak a contact by mistake.
export {
  ADMIN_SCHOOL_COLUMNS,
  AdminSchoolError,
  createSchool,
  fetchAdminSchools,
  fetchAllBreakTimes,
  fetchServiceDaysBySchool,
  fetchCities,
  fetchKitchens,
  updateSchool,
  type AdminSchool,
  type City,
  type CreatedSchool,
  type Kitchen,
  type NewSchool,
  type SchoolBreakWindow,
  type SchoolConfigInput,
  type SchoolEdit,
  type SchoolUpdateResult,
} from './admin-schools.js';

// The dish and menu catalogue, for editing one thing at a time (`E10-20`). `tools/bulk-import`
// is the other half and does the bulk case; this is the afternoon one price is wrong, where
// preparing a CSV is six minutes of ceremony for a four-character change — and the ceremony is
// what makes somebody edit the database by hand instead.
export {
  ADMIN_ASSIGNMENT_COLUMNS,
  ADMIN_DISH_COLUMNS,
  ADMIN_MENU_COLUMNS,
  AdminDishError,
  fetchAdminDishes,
  fetchAdminMenus,
  fetchDishImageAssets,
  fetchMenuAssignments,
  isAssignmentLive,
  removeDishImage,
  runImport,
  setDishAllergens,
  uploadDishImage,
  setFoodTypes,
  updateCatalogue,
  type AdminDish,
  type AdminMenu,
  type AdminMenuAssignment,
  type AdminMenuItem,
  type CatalogueUpdateResult,
  type DishAllergenAssignment,
  type DishEdit,
  type FoodTypeAssignment,
  type DishImageResult,
  type DishImageUpload,
  type ImportRequest,
  type ImportResult,
  type MenuItemEdit,
} from './admin-dishes.js';

// Orders and revenue by school by month (`E10-10`). Its column list reads NO recipient, class or
// section — non-negotiable #4, and a report is aggregate by definition. `admin-orders.ts` reads
// all three because that screen is a record of individual orders; keeping the two lists apart is
// what stops a child's name reaching a school's inbox through an export.
export {
  MAX_REPORT_MONTHS,
  REPORT_ORDER_COLUMNS,
  ReportError,
  fetchMonthlyRevenue,
  groupRows,
  monthOf,
  summarise,
  totalOf,
  totalsByMonth,
  type Bucket,
  type GroupBy,
  type MonthTotals,
  type ReportRow,
} from './admin-reports.js';

// Order alert recipients (`E08-12`). Reads under the caller's session and scoped by
// `kitchen.config_edit`; writes through the Edge Function, because the table has no write policy.
export {
  ALERT_RECIPIENT_COLUMNS,
  AlertRecipientError,
  addAlertRecipient,
  fetchAlertRecipients,
  removeAlertRecipient,
  setAlertRecipientEnabled,
  type AlertRecipient,
} from './admin-alerts.js';

// Growth (`E11-08`). The column lists are the privacy control: a platform admin may read every
// column on every child, and this selects three that identify nobody. Same reasoning as
// `REPORT_ORDER_COLUMNS` above.
export {
  GROWTH_CHILD_COLUMNS,
  GROWTH_LINK_COLUMNS,
  GROWTH_USER_COLUMNS,
  fetchGrowth,
  type GrowthData,
} from './admin-growth.js';

// Per-school configuration with visible inheritance (`E10-06`). Deliberately does NOT call
// `resolve_effective_config`: that returns one scalar per setting, and a scalar cannot tell an
// operator whether somebody chose this school's cutoff or whether it is the default every school
// gets. Those two facts lead to opposite actions, so the losing values are kept.
export {
  AdminConfigError,
  KITCHEN_CONFIG_COLUMNS,
  PLATFORM_CONFIG_COLUMNS,
  SCHOOL_CONFIG_COLUMNS,
  SETTINGS,
  fetchSchoolConfig,
  formatSettingValue,
  resolveAll,
  resolveSetting,
  sourceLabel,
  type ConfigRows,
  type ConfigScope,
  type SchoolConfigView,
  type SettingResolution,
  type SettingSpec,
} from './admin-config.js';

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

// `E17-46`. The force-update gate: a read, and the one that never throws — see its header.
export { fetchVersionSupport, type VersionSupport } from './app-version.js';

// The first write (E05-09). Writes always go through an Edge Function (A4).
export { createCheckout, type CheckoutLine, type CheckoutResult } from './checkout.js';
export {
  fetchOrders,
  fetchOrderDetail,
  // A write, so it goes through an Edge Function (`A4`) — see `cancelOrder`'s header.
  cancelOrder,
  type ApiOrderSummary,
  type ApiOrderDetail,
  type ApiOrderStatus,
  type ApiCancelResult,
} from './orders.js';
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

// Who holds what back-office access (`E10-27`). Registration is identical for everyone and reach
// is a `permission_grant` row and nothing else (`D3`) — which is right, and left no screen able to
// answer "who can do what?". Writes go through `admin-grants`, because `permission_grant` has no
// write policy at all and must not have one.
export {
  ACCESS_GRANT_COLUMNS,
  ACCESS_USER_COLUMNS,
  AdminAccessError,
  PERMISSION_COLUMNS,
  ACCOUNT_SEARCH_LIMIT,
  fetchAccess,
  searchAccounts,
  fetchPermissions,
  grantPermission,
  revokePermission,
  type AccessAccount,
  type GrantRequest,
  type HeldGrant,
  type PermissionInfo,
} from './admin-grants.js';
