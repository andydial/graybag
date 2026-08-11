import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BENEFITS,
  FACTS,
  FAQ,
  FOOTER,
  FORBIDDEN_LINK_PATTERNS,
  HERO,
  NAV,
  REPORT,
  SCHOOLS,
  SITE,
  STEPS,
} from './site.js';

/**
 * These assert the *claims*, not the layout.
 *
 * A marketing page is where an unsourced number gets invented and then has to be defended, and
 * where a rule everyone agreed to ("no store links") quietly stops holding six months later.
 * Each test below corresponds to a promise made either to Andy or in a decision record.
 */

describe('the things this page must never say', () => {
  const allCopy = JSON.stringify({ HERO, FACTS, STEPS, BENEFITS, FAQ, SCHOOLS, REPORT, FOOTER, NAV, SITE });

  it.each(FORBIDDEN_LINK_PATTERNS)('never links to %s', (host) => {
    // E12-05 stays open until both apps are published. A dead download button is worse than
    // no button, and this is the sort of thing added in a hurry by someone who forgot why.
    expect(allCopy).not.toContain(host);
  });

  it('never tells a visitor to download the app', () => {
    expect(allCopy.toLowerCase()).not.toMatch(/download the (graybag )?app|get it on|app store/);
  });

  it('never publishes the school revenue-share percentage', () => {
    // M4: 10% by default but editable per school. A commercial term on a public page becomes
    // the floor of every negotiation.
    const share = FAQ.flatMap((item) => item.a).join(' ');
    expect(share).not.toMatch(/\b10\s?%|\bten per ?cent/i);
    expect(share).toMatch(/revenue share/i);
  });

  it('does not claim an allergen guarantee', () => {
    const allergen = BENEFITS.find((b) => b.title.includes('Allergen'));
    expect(allergen).toBeDefined();
    // Non-negotiable #4's neighbour: the app warns, the parent decides. Anything stronger is a
    // safety claim about a child that the product does not make.
    expect(allergen?.body).not.toMatch(/guarantee|safe|allergy-free|allergen-free/i);
    expect(allergen?.body).toMatch(/warns/i);
  });

  it('says plainly that allergen handling is a warning and not a medical guarantee', () => {
    const answer = FAQ.find((item) => item.q.toLowerCase().includes('allerg'));
    expect(answer?.a.join(' ')).toMatch(/not a medical guarantee/i);
  });

  it('does not claim a food-safety licence we have not evidenced', () => {
    // Raised as an owner:andy task. Until the FSSAI number is confirmed, the honest answer is
    // structural — everything is cooked to the day's order list — not a licence claim.
    expect(allCopy).not.toMatch(/FSSAI|ISO 22000|HACCP/i);
  });

  it('does not name a child anywhere in the copy', () => {
    // R6 / non-negotiable #4. The hero illustration uses a fixture name inside the template and
    // is labelled as an illustration; no real child's name may enter the content module.
    expect(allCopy).not.toMatch(/\bAarav\b/);
  });
});

describe('the claims that must stay checkable', () => {
  it('states the dish count that the mirror manifest actually records', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../../tools/mirror-dish-images/manifest.json', import.meta.url), 'utf8'),
    ) as { counts: { total: number } };
    const claim = FACTS.find((f) => f.value.includes('dishes'));
    expect(claim?.value).toContain(String(manifest.counts.total));
  });

  it('claims one city, because v1 is Mohali only', () => {
    // SC1, confirmed 2026-08-07. A second city on this page would be a commitment nobody made.
    expect(SITE.city).toMatch(/Mohali/);
    expect(SCHOOLS.heading).toMatch(/Mohali/);
  });

  it('labels the sample report as an example rather than as a real school', () => {
    expect(REPORT.sample.subtitle.toLowerCase()).toContain('example');
  });

  it('names the three schools under a softer claim, not as a client list', () => {
    // Andy's ruling: named smaller, under "already serving schools across Mohali", pending
    // each school's permission before the DNS cutover (E12-10).
    expect(SCHOOLS.names).toHaveLength(3);
    expect(SCHOOLS.heading).not.toMatch(/客|clients?|customers?/i);
    expect(SCHOOLS.heading.toLowerCase()).toContain('already serving schools');
  });
});

describe('the footer carries what the law and the stores require', () => {
  it('links all three policy documents', () => {
    // E12-04 and E20-13: they were published in docs/ and linked from nowhere at all, which
    // for a privacy notice is functionally the same as not having one.
    expect(FOOTER.legal.map((l) => l.href).sort()).toEqual(['/privacy', '/refunds', '/terms']);
  });

  it('publishes a grievance-officer contact', () => {
    // E20-07. DPDP requires it to be findable by a person who wants to complain.
    expect(FOOTER.grievance.email).toMatch(/@graybag\.com$/);
    expect(FOOTER.grievance.body).toMatch(/Digital Personal Data Protection Act/);
  });

  it('uses no no-reply address anywhere', () => {
    // U4: parents and principals reply, so it must reach a human.
    expect(JSON.stringify(FOOTER) + SITE.email).not.toMatch(/no-?reply/i);
  });
});

describe('page structure', () => {
  it('points every nav item at a section the page defines', () => {
    const page = readFileSync(new URL('../pages/index.astro', import.meta.url), 'utf8');
    for (const item of NAV) {
      expect(page).toContain(`id="${item.href.slice(1)}"`);
    }
  });

  it('offers exactly one action, so the page has one job', () => {
    expect(HERO.primaryCta).toMatch(/talk to us/i);
    expect(HERO.secondaryCta).not.toMatch(/sign ?up|download|buy|order/i);
  });

  it('has four steps, matching the "four steps" heading on the page', () => {
    expect(STEPS).toHaveLength(4);
  });
});
