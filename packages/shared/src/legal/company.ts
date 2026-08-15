import data from '../../../../docs/legal/company.json' with { type: 'json' };

/**
 * The company's published identity — one source, read by every document that states it.
 *
 * ## Why this exists (`E12-25`)
 *
 * The legal name, the registered address and the GSTIN each appeared as a **separate placeholder
 * in two different documents**: `docs/terms.md` and `docs/gst-invoicing.md`, with different task
 * ids on them. Filling them meant answering the same question twice and hoping the copies matched.
 *
 * Andy, 2026-08-14: *"An invoice whose GSTIN disagrees with the terms is worse than either being
 * blank, and answering twice is how that happens."*
 *
 * So the documents keep their `«…»` tokens — they stay readable as documents — and the tokens are
 * substituted from here at render time. One answer, two documents, no copy to drift.
 *
 * ## `null` means genuinely unknown, and stays unknown
 *
 * A value that is `null` is **not** substituted. Its token survives into the rendered output,
 * where `assertPublishable` refuses to build it for production. That is the point: this file can
 * never quietly turn an unanswered question into a published claim by defaulting it to an empty
 * string.
 */

export interface CompanyIdentity {
  /** Registered company name, exactly as on the incorporation certificate. */
  legalName: string | null;
  /** Registered office address, as filed. */
  registeredAddress: string | null;
  /** The 15-character GSTIN. */
  gstin: string | null;
  /** SAC code for the service. The accountant's answer — it decides the rate. */
  sacCode: string | null;
  /** Whether invoices carry a digital signature, or state that none is required. */
  signatureTreatment: string | null;
  /** Support address. `U4` forbids a `no-reply@` anywhere. */
  supportEmail: string | null;
  /** The city whose courts hear disputes. */
  jurisdictionCity: string | null;
}

/**
 * The grievance officer, required by name under the DPDP Act.
 *
 * **Already published** in the privacy policy §7A since notice version 2. It is repeated here so
 * `docs/dpdp-compliance.md` and `docs/terms.md` read the same person from the same place rather
 * than each naming them again — an internal compliance record that disagrees with the published
 * notice is the document we would be judged against.
 */
export interface GrievanceOfficer {
  name: string | null;
  title: string | null;
  email: string | null;
  /** A postal address for data complaints. */
  address: string | null;
}


/**
 * The values, from `docs/legal/company.json`.
 *
 * JSON rather than a TypeScript literal so a plain `.mjs` script can read the same file: the
 * website renderer, `scripts/build-policy-docs.mjs` and `scripts/check-placeholders.mjs` all
 * substitute from it. A value that lived in only one of them is exactly the drift this exists to
 * prevent.
 *
 * **`Graybag Pty Ltd` is worth a second look before it reaches a tax document.** `Pty Ltd` is an
 * Australian suffix and everything around it is Indian — a GSTIN, SAS Nagar jurisdiction, DPDP,
 * 5% GST as CGST + SGST. An Australian entity can hold an Indian GST registration through a
 * branch, so it is not necessarily wrong; it is the combination most likely to be a slip, and an
 * invoice is the worst place to discover one. Flagged, not changed.
 */
export const COMPANY: CompanyIdentity = {
  legalName: data.legalName,
  registeredAddress: data.registeredAddress,
  gstin: data.gstin,
  sacCode: data.sacCode,
  signatureTreatment: data.signatureTreatment,
  supportEmail: data.supportEmail,
  jurisdictionCity: data.jurisdictionCity,
};

export const GRIEVANCE_OFFICER: GrievanceOfficer = data.grievanceOfficer;

/**
 * Token → value. A token absent from here, or mapped to `null`, is left in place.
 *
 * Keyed by the whole token including its delimiters so the mapping is greppable from either
 * side: searching a document's token finds this entry, and reading this entry names the document.
 */
export const RESOLVED: Readonly<Record<string, string | null>> = {
  // docs/terms.md
  '«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»': COMPANY.legalName,
  '«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»': COMPANY.registeredAddress,
  '«GRAYBAG-GSTIN-PENDING-E00-10»': COMPANY.gstin,
  '«GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01»': COMPANY.supportEmail,
  '«JURISDICTION-CITY-PENDING-E20-01»': COMPANY.jurisdictionCity,
  '«GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»': GRIEVANCE_OFFICER.email,

  // docs/gst-invoicing.md — the same three facts, resolved from the same fields.
  '«LEGAL-NAME-PENDING-E00-10»': COMPANY.legalName,
  '«ADDRESS-PENDING-E00-10»': COMPANY.registeredAddress,
  '«GSTIN-PENDING-E00-10»': COMPANY.gstin,
  '«SAC-PENDING-E00-10»': COMPANY.sacCode,
  '«SIGNATURE-TREATMENT-PENDING-E00-10»': COMPANY.signatureTreatment,

  // docs/dpdp-compliance.md — the officer the privacy policy already names.
  '«GRIEVANCE-OFFICER-NAME-PENDING-E20-21»': GRIEVANCE_OFFICER.name,
  '«GRIEVANCE-OFFICER-TITLE-PENDING-E20-21»': GRIEVANCE_OFFICER.title,
  '«GRIEVANCE-OFFICER-ADDRESS-PENDING-E20-21»': GRIEVANCE_OFFICER.address,

  // Fixed, never computed — an effective date that moves with each build is not one.
  '«TERMS-EFFECTIVE-DATE-PENDING-E20-12»': data.termsEffectiveDate,
};

/**
 * Substitute every resolved token. Unresolved ones are left exactly as they are.
 *
 * Deliberately not a regex over `«[^»]*»` with a lookup: an unknown token must pass through
 * untouched rather than be replaced with `undefined`, and a literal replace per known key makes
 * that impossible to get wrong.
 */
export function resolveTokens(markdown: string): string {
  let out = markdown;
  for (const [token, value] of Object.entries(RESOLVED)) {
    if (value === null) continue;
    out = out.split(token).join(value);
  }
  return out;
}

/** The tokens this file still cannot answer, for the placeholder register. */
export function unresolvedTokens(): string[] {
  return Object.entries(RESOLVED)
    .filter(([, value]) => value === null)
    .map(([token]) => token)
    .sort();
}
