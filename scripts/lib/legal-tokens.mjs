import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Substitute the company's published identity from `docs/legal/company.json` — the same file the
 * website renderer reads (`E12-25`). A `null` value is left as its token, so an unanswered
 * question can never become a published claim.
 */
function loadResolved() {
  const d = JSON.parse(readFileSync(join(ROOT, 'docs/legal/company.json'), 'utf8'));
  const g = d.grievanceOfficer ?? {};
  return {
    '\u00abGRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01\u00bb': d.legalName,
    '\u00abGRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01\u00bb': d.registeredAddress,
    '\u00abGRAYBAG-GSTIN-PENDING-E00-10\u00bb': d.gstin,
    '\u00abGRAYBAG-SUPPORT-EMAIL-PENDING-E20-01\u00bb': d.supportEmail,
    '\u00abJURISDICTION-CITY-PENDING-E20-01\u00bb': d.jurisdictionCity,
    '\u00abGRIEVANCE-OFFICER-EMAIL-PENDING-E20-21\u00bb': g.email,
    '\u00abLEGAL-NAME-PENDING-E00-10\u00bb': d.legalName,
    '\u00abADDRESS-PENDING-E00-10\u00bb': d.registeredAddress,
    '\u00abGSTIN-PENDING-E00-10\u00bb': d.gstin,
    '\u00abSAC-PENDING-E00-10\u00bb': d.sacCode,
    '\u00abSIGNATURE-TREATMENT-PENDING-E00-10\u00bb': d.signatureTreatment,
    '\u00abGRIEVANCE-OFFICER-NAME-PENDING-E20-21\u00bb': g.name,
    '\u00abGRIEVANCE-OFFICER-TITLE-PENDING-E20-21\u00bb': g.title,
    '\u00abGRIEVANCE-OFFICER-ADDRESS-PENDING-E20-21\u00bb': g.address,
    '\u00abTERMS-EFFECTIVE-DATE-PENDING-E20-12\u00bb': d.termsEffectiveDate,
  };
}

export function resolveTokens(text) {
  let out = text;
  for (const [token, value] of Object.entries(loadResolved())) {
    if (value === null || value === undefined) continue;
    out = out.split(token).join(value);
  }
  return out;
}
