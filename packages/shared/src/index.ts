// @graybag/shared — types, validation, and the `api/` client module.
//
// Non-negotiable #1: every backend call from the mobile app goes through the `api/`
// module in this package. Reads may use the Supabase client; writes always go through
// Edge Functions. That module lands in Block 5 (E14-08); this file is its entry point.

export const PACKAGE_NAME = '@graybag/shared';
