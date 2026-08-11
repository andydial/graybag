import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BENEFITS,
  FACTS,
  FAQ,
  FOOD,
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
  const allCopy = JSON.stringify({ HERO, FACTS, STEPS, BENEFITS, FAQ, FOOD, SCHOOLS, REPORT, FOOTER, NAV, SITE });

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

  it('makes no nutrition or health claim, anywhere', () => {
    // Andy, 2026-08-11: we position as healthy school food **by description, not assertion**.
    // "Healthy", "nutritious" and their family are close enough to nutrition and health claims
    // under the FSSAI Labelling and Display regulations to need substantiation we do not hold.
    // The positioning is carried by what is on the menu — no meat, atta bases, brown bread,
    // quinoa and sprouts — every word of which is checkable against the catalogue.
    const banned = [
      'healthy', 'healthier', 'health benefit', 'nutritious', 'nutrition', 'nutritional',
      'wholesome', 'balanced diet', 'well-balanced', 'natural', 'wellness', 'superfood',
      'immunity', 'low fat', 'low-fat', 'fat free', 'sugar free', 'sugar-free', 'high protein',
      'high-protein', 'fortified', 'enriched', 'guilt-free', 'clean eating', 'goodness',
      'preservative-free', 'no preservatives', 'organic',
    ];
    const lower = allCopy.toLowerCase();
    for (const word of banned) {
      expect(lower, `"${word}" needs substantiating and must be flagged, not shipped`).not.toContain(word);
    }
  });

  it('does not claim nothing is deep-fried, because the catalogue says otherwise', () => {
    // Drafted and cut: vada pao and four puffs are on the list, so the line would have been
    // false. Recorded here because it is the sort of claim that reads as obviously true.
    expect(allCopy.toLowerCase()).not.toContain('deep-fried');
    expect(allCopy.toLowerCase()).not.toContain('deep fried');
  });

  it('says atta and brown bread specifically, never "as standard"', () => {
    // Four catalogue items are explicitly (Maida), so "atta as standard" would overstate it.
    const wraps = FOOD.categories.find((c) => c.id === 'wraps');
    expect(wraps?.body).toMatch(/atta/i);
    expect(wraps?.body).toMatch(/maida/i);
    expect(JSON.stringify(FOOD)).not.toMatch(/as standard/i);
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
  it('makes no claim about the size of the catalogue', () => {
    // "85 dishes" was a hero stat and is gone. A count of the catalogue will change, and no
    // principal chooses a food supplier on how long its list is — so it is not a number worth
    // maintaining, and a stale one on a sales page is worse than none.
    const stats = JSON.stringify(FACTS);
    expect(stats).not.toMatch(/\b\d+\s*(dishes|items|meals)\b/i);
  });

  it('leads on the menu being per-school rather than on catalogue size', () => {
    expect(FACTS[0]?.value.toLowerCase()).toContain('menu per school');
  });

  it('names only dishes that exist in the real catalogue', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../../tools/mirror-dish-images/manifest.json', import.meta.url), 'utf8'),
    ) as { images: { dish: string }[] };
    const catalogue = manifest.images.map((i) => i.dish.toLowerCase()).join(' | ');
    // A dish named on a sales page that the kitchen does not recognise is a promise nobody made.
    for (const dish of ['idli', 'poha', 'rajma', 'quinoa khichdi', 'sprouts', 'wheat jaggery cake']) {
      expect(catalogue, dish).toContain(dish);
    }
  });

  it('claims one city, because v1 is Mohali only', () => {
    // SC1, confirmed 2026-08-07. A second city on this page would be a commitment nobody made.
    expect(SITE.city).toMatch(/Mohali/);
    expect(SCHOOLS.heading).toMatch(/Mohali/);
  });

  it('labels the sample report as an example rather than as a real school', () => {
    expect(REPORT.sample.subtitle.toLowerCase()).toContain('example');
  });

  it('names no school at all until each agrees in writing', () => {
    // Andy, 2026-08-11: pull the names (E12-11, [WEB-02]). Naming a customer as a reference is
    // the school's call, and a name published without permission ends a relationship rather
    // than starting one. This test is what stops them drifting back in.
    const everything = JSON.stringify({ SCHOOLS, HERO, FACTS, BENEFITS, FAQ, REPORT, FOOTER, NAV, STEPS });
    for (const name of ['Amity', 'Gem Public', 'Paragon']) {
      expect(everything, name).not.toContain(name);
    }
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
