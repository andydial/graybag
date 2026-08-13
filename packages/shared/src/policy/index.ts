/**
 * The three published policy documents — `E20-38`.
 *
 * Generated from `docs/{privacy-policy,terms,refund-policy}.md` by
 * `scripts/build-policy-docs.mjs`, so the text a parent reads on their phone and the text that
 * went to the lawyer are the same string. `npm run check:policy-docs` fails if they drift.
 */
export {
  POLICY_DOCUMENTS,
  type PolicyDocument,
  type PolicyKey,
} from './documents.generated.js';
