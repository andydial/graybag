/**
 * Everything the public site says, as data.
 *
 * The copy lives here rather than inline in the templates for three reasons: it can be read as
 * a document and argued with, it can be asserted by a test (`site.test.ts` checks the claims
 * that must not drift), and a template that is only structure stays readable.
 *
 * **Every factual claim on this page is traceable.** Where a number or a statement comes from a
 * decision or a repository artefact, the source is cited beside it. A marketing page is exactly
 * where an unsourced number gets invented and then has to be defended later, so the rule here is
 * the same one `docs/ux-spec.md` sets for itself: cite it so a reviewer can check it rather than
 * trust it.
 */

export const SITE = {
  name: 'GrayBag',
  url: 'https://graybag.com',
  tagline: 'School lunch, ordered in advance and delivered to the child',
  description:
    'GrayBag runs school lunch for schools in Mohali. Parents order and pay in advance from ' +
    'their phone, our kitchen cooks that morning, and the food reaches the right child at the ' +
    'right break. No cash at school, no queue at a counter.',
  /** `U4` — parents reply to transactional mail, so it must reach a human. Same here. */
  email: 'hello@graybag.com',
  city: 'Mohali, Punjab',
} as const;

export const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#schools', label: 'For your school' },
  { href: '#food', label: 'The food' },
  { href: '#questions', label: 'Questions' },
] as const;

export const HERO = {
  eyebrow: 'For schools in Mohali',
  /** Lowercase is the brand's headline device and is confined to this line (design-tokens §3.3). */
  headline: 'lunch that arrives at the child, not at a counter',
  lead:
    'Parents order and pay in advance from their phone. Our kitchen cooks that morning and ' +
    'delivers to the right child, in the right class, at the right break. No cash changes ' +
    'hands at school.',
  primaryCta: 'Talk to us about your school',
  secondaryCta: 'See how it works',
  note: 'No cost to the school to run. A revenue share on every order.',
} as const;

/**
 * The proof strip.
 *
 * Three claims, each checkable from something in this repository or from how the operation
 * actually runs, because a number a principal cannot verify is worth less than no number.
 *
 * **"85 dishes" was here and has been removed.** It was a count of the catalogue, and a count
 * of the catalogue is the wrong argument twice over: it will change, and no principal has ever
 * chosen a food supplier on how long its list is. What replaced it is the thing the food
 * section now leads with — that the menu is built per school and rotates — which is a
 * difference from a canteen contract rather than a bigger version of the same thing.
 */
export const FACTS = [
  {
    value: 'A menu per school',
    label: 'agreed with you, and it rotates through the term',
    // The proposition, not a measurement. SC1: one city, so this is per school and not per region.
  },
  {
    value: 'Cooked that morning',
    label: 'to the day\'s order list — nothing held over',
    // How the kitchen works: orders close the night before, so the count is known before cooking.
  },
  {
    value: 'Zero cash',
    label: 'handled at school — paid before the food is cooked',
    // M1: GrayBag is seller of record; payment is captured at checkout (order-lifecycle.md).
  },
] as const;

export const STEPS = [
  {
    title: 'Parents order the night before',
    body:
      'They pick from your school’s menu in the GrayBag app and pay by UPI or card. Ordering ' +
      'closes at a cut-off you and we agree, so the kitchen always knows the real number.',
  },
  {
    title: 'The kitchen cooks that morning',
    body:
      'One kitchen in Mohali, cooking to the actual order list rather than to a guess. ' +
      'Nothing is prepared speculatively and nothing sits on a counter waiting to be sold.',
  },
  {
    title: 'We deliver to the class, at the break',
    body:
      'Food arrives packed per class and per break, each portion already assigned to a named ' +
      'child. Your staff hand it over; there is nothing to sell, ring up or count.',
  },
  {
    title: 'You get a report each month',
    body:
      'What your school ordered, by class and by break, emailed to you. No portal to remember ' +
      'to log into and no dashboard to learn.',
  },
] as const;

/**
 * The school-side benefits.
 *
 * Ordered by what a principal actually worries about — money handling first, because that is
 * the thing a canteen makes someone responsible for, and it is the thing this removes entirely.
 */
export const BENEFITS = [
  {
    icon: 'cash',
    title: 'No cash at school',
    body:
      'Every order is paid in the app before the food is cooked. Nothing to collect, no float ' +
      'to hold, no till to reconcile, and no child carrying money in.',
  },
  {
    icon: 'queue',
    title: 'No queue at the break',
    body:
      'Portions arrive already assigned to a child and grouped by class. The break stops being ' +
      'twenty minutes of crowd management.',
  },
  {
    icon: 'shield',
    title: 'Allergen-aware ordering',
    body:
      'Parents record their child’s allergies once, and the app warns them before they order a ' +
      'dish that contains one. The warning goes to the parent, who decides — we never quietly ' +
      'substitute or block.',
  },
  {
    icon: 'report',
    title: 'A report written for you',
    body:
      'A monthly summary of your school’s ordering, by class and by break, in your inbox. It ' +
      'contains no child’s name, no allergy detail and nothing else you would rather not hold.',
  },
  {
    icon: 'kitchen',
    title: 'A kitchen that is already running',
    body:
      'We are cooking for schools in Mohali now. Your school is not the pilot and you are not ' +
      'waiting on us to find a supplier.',
  },
  {
    icon: 'staff',
    title: 'Nothing new for your staff to run',
    body:
      'No terminal, no card reader, no roster for you to maintain. Parents tell us which class ' +
      'their child is in, and keep it current themselves.',
  },
] as const;

/**
 * The food section.
 *
 * **This used to be a 28-tile grid of the catalogue and that was the wrong argument.** A fixed
 * grid of every dish says "here is our list", which is misleading — menus rotate and each school
 * gets its own — and it is a maintenance liability that goes stale the first time a menu
 * changes. The proposition a principal should take away is *bespoke and moving*, not *long*.
 *
 * ## Every line here is a description, not a claim
 *
 * The positioning is healthy school food. It is made **by describing what is on the menu**, and
 * never by asserting it. "Healthy", "nutritious", "wholesome" and "balanced" are close enough to
 * nutrition and health claims under the FSSAI Labelling and Display regulations that they need
 * substantiation we do not hold, so none of them appears anywhere on this site.
 *
 * What is said instead is checkable against `tools/mirror-dish-images/manifest.json`:
 *
 * - **Every dish carries a veg, egg or non-veg mark, and the school agrees its own menu.** This
 *   replaced "there is no meat on the menu at all", which was true of today's catalogue and was
 *   still the wrong thing to say: non-vegetarian food is planned, so it was a promise we intend
 *   to break, and a school that partly chose us for it would be right to be angry when it
 *   changed. What is here now stays true whatever we serve, and it argues the school's control
 *   — which is what the rest of the page argues — rather than a dietary position we cannot hold.
 * - **Wraps on atta bases, sandwiches on brown bread.** 17 records name atta, brown or wheat.
 *   Deliberately *not* "as standard": four items are explicitly `(Maida)` or `(Maida Base)`, so
 *   "as standard" would have been an overstatement. The menu labelling its own maida is worth
 *   saying — it is the sort of thing that goes unlabelled elsewhere.
 * - **Quinoa, sprouts and salads on the same list as the bakery.** True, and it is the honest
 *   version of the point: this is a school menu with a bakery on it, not a health-food menu.
 *
 * One line that was drafted and **cut**: "nothing deep-fried". The catalogue contains vada pao
 * and four puffs, so it would have been false.
 */
export const FOOD = {
  eyebrow: 'The food',
  heading: 'Your school gets its own menu',
  lead:
    'We build the menu with you before the term starts, and it moves through the term — so it ' +
    'fits your children, your break times and what they actually eat. It is not a fixed list ' +
    'we hand every school.',
  /**
   * Five categories, one dish photographed for each: a breakfast, a main, a wrap, a salad, a
   * bake. Enough to show the range, few enough that nobody reads it as an inventory.
   *
   * The dish names in each line are real catalogue names, because a name we invented for a
   * marketing page is a name the kitchen does not recognise.
   */
  categories: [
    {
      id: 'breakfast',
      title: 'Breakfast',
      body: 'Idli and sambar, poha, stuffed paratha, pancakes — for schools whose first break is early enough to matter.',
    },
    {
      id: 'mains',
      title: 'Mains',
      body: 'Rajma, chana or dal makhni with rice; fried rice; quinoa khichdi. The food a child will actually finish.',
    },
    {
      id: 'wraps',
      title: 'Wraps and sandwiches',
      body: 'Wraps on atta bases and sandwiches on brown bread — paneer, vegetables, egg. Where an item is maida, the menu says so.',
    },
    {
      id: 'salads',
      title: 'Salads and fruit',
      body: 'Sprouts, quinoa, three-bean, corn and pepper, and cut fruit — on the same menu as everything else, not a separate virtuous list.',
    },
    {
      id: 'bakery',
      title: 'Bakery',
      body: 'Croissants, muffins, wheat jaggery cake. A school menu with no treat on it is a menu children opt out of.',
    },
  ],
  /**
   * Control, not diet.
   *
   * This tile used to read "Vegetarian, with eggs — there is no meat on the menu at all". True
   * of the catalogue as it stands, and **cut** (Andy, 2026-08-11) because non-vegetarian food is
   * planned. A dietary position we intend to change is not a thing to sell a school on: the
   * school that chose us partly for it would be entitled to be angry, and "we said that when it
   * was true" is not a defence anyone accepts.
   *
   * What replaced it holds whatever the kitchen serves, and it is the better argument anyway —
   * the school decides, which is what every other section of this page is about.
   */
  note: {
    title: 'You choose what is on the menu',
    body:
      'Every dish carries a veg, egg or non-veg mark, and your school\'s menu contains only what ' +
      'you have agreed to. If there is something you would rather we did not serve, it does not ' +
      'go on.',
  },
  footnote:
    'Photographs are of dishes we cook. Your school\'s menu is agreed with you before the term ' +
    'and changes through it; nothing here is a list you would be committing to.',
} as const;

/**
 * Credibility, without naming anyone.
 *
 * **The three school names have been pulled** (Andy, 2026-08-11) and stay out until each school
 * agrees **in writing** to be named — `E12-11`, `[WEB-02]`. Naming a customer as a reference is
 * the school's call and not ours, and a name published without permission is the sort of thing
 * that ends a relationship rather than starting one.
 *
 * What is left is the claim we can make on our own authority — that the operation is running
 * today — plus the strongest available substitute for a reference, which is an invitation to
 * come and watch a delivery go out. For a principal weighing a food partner, seeing the kitchen
 * is worth more than a logo strip anyway.
 */
export const SCHOOLS = {
  eyebrow: 'Already running',
  heading: 'Already serving schools across Mohali',
  lead:
    'We are cooking and delivering to schools in Mohali every school day. Your school would not ' +
    'be the pilot, and you would not be waiting on us to find a kitchen.',
  invitation:
    'We would rather show you the operation than describe it. Come and see a morning\'s ' +
    'delivery go out, and talk to the schools we already serve.',
  cta: 'Arrange a visit',
} as const;

export const REPORT = {
  eyebrow: 'Reporting',
  heading: 'One email a month, not another login',
  lead:
    'School reporting is a PDF that lands in your inbox. It answers the questions a principal ' +
    'actually asks — how many children are eating, which classes, which breaks — and it ' +
    'deliberately contains nothing about any individual child.',
  /** Illustrative figures. `site.test.ts` asserts this is labelled as an example on the page. */
  sample: {
    title: 'Monthly summary',
    subtitle: 'Example — March, a school of about 900',
    rows: [
      { label: 'Orders delivered', value: '4,182' },
      { label: 'Classes ordering', value: '26 of 30' },
      { label: 'Busiest break', value: 'Second, 11:20' },
      { label: 'Most ordered', value: 'Rajma rice' },
    ],
  },
} as const;

/**
 * The administrator FAQ.
 *
 * Written to answer the questions honestly, including where the honest answer is "we will tell
 * you in the conversation". A page that dodges the cost question is a page a principal stops
 * reading.
 */
export const FAQ = [
  {
    q: 'What does this cost the school?',
    a: [
      'Nothing to run. Parents pay for the food, and GrayBag is the seller — we invoice the ' +
        'parent, we carry the payment processing, and we run the kitchen and the delivery.',
      'There is a revenue share to the school on every order. The rate is part of the ' +
        'conversation we would have with you rather than a number on a web page, because it ' +
        'sits alongside break times, delivery points and menu.',
    ],
  },
  {
    q: 'What do you need from us?',
    a: [
      'Somewhere to hand food over at each break, agreement on the break times, and a decision ' +
        'on the menu. That is close to all of it.',
      'We deliberately do not ask you to maintain a roster. Parents tell us which class and ' +
        'section their child is in, and they keep it current — schools told us plainly that ' +
        'maintaining a list for a supplier was not something they would take on.',
    ],
  },
  {
    q: 'How are allergies handled?',
    a: [
      'A parent records their child’s allergies in the app, separately and explicitly, because ' +
        'health information about a child is a regulated category under India’s DPDP Act and is ' +
        'not something we collect by default.',
      'Where a dish contains a declared allergen, the parent sees a named warning before they ' +
        'order and has to confirm deliberately. Where we cannot check — no allergies recorded, ' +
        'or the kitchen has not declared for that dish — we say so plainly rather than showing ' +
        'nothing, because silence reads as “safe”.',
      'It is a warning system for parents, not a medical guarantee, and we describe it that way ' +
        'everywhere it appears.',
    ],
  },
  {
    q: 'What happens if a child has no order that day?',
    a: [
      'Nothing arrives for them, and nothing is sold to them at school — there is no counter to ' +
        'buy from. Ordering closes the night before, so a parent who forgets has missed that ' +
        'day rather than found a queue.',
      'That is a deliberate trade. It is what makes the cash disappear and the kitchen able to ' +
        'cook the right number of meals.',
    ],
  },
  {
    q: 'What about holidays and half days?',
    a: [
      'Tell us and we stop delivering. Where an order has already been paid for a day that ' +
        'turns out to be a holiday, the parent is refunded — to their GrayBag balance ' +
        'immediately, or back to their card if they prefer to wait for the bank.',
    ],
  },
  {
    q: 'How do we know the food is safe?',
    a: [
      'The structural answer is that everything is cooked to the morning’s order list and ' +
        'delivered the same day. Nothing is held over, nothing is stored at your school, and ' +
        'nothing sits in a display case hoping to be sold.',
      'The rest of it — licences, kitchen inspection, and coming to see the place — is part of ' +
        'the first conversation, and we would rather you came and looked.',
    ],
  },
] as const;

export const ENQUIRY = {
  eyebrow: 'Get in touch',
  heading: 'Bring GrayBag to your school',
  lead:
    'Tell us about your school and we will come back to you with what a term would look like — ' +
    'break times, menu, delivery points and the commercial terms.',
  reassurance:
    'One person reads these. You will get a reply from a human, not a sequence of marketing ' +
    'emails, and we will not pass your details to anyone.',
  submit: 'Send enquiry',
  sending: 'Sending…',
} as const;

export const FOOTER = {
  /**
   * `E12-04` and `E20-13`. The three policy documents have been written and published in
   * `docs/` and are currently linked from nowhere at all — which for a privacy notice is the
   * same as not having one. Both app stores require a reachable privacy URL, and the DPDP Act
   * requires the grievance officer to be findable.
   */
  legal: [
    { href: '/privacy', label: 'Privacy policy' },
    { href: '/terms', label: 'Terms of service' },
    { href: '/refunds', label: 'Refund policy' },
  ],
  company: [
    { href: '#how', label: 'How it works' },
    { href: '#food', label: 'The food' },
    { href: '#questions', label: 'Questions' },
    { href: '#enquiry', label: 'Contact us' },
  ],
  /**
   * The DPDP grievance officer contact (`E20-07`), required by law to be published.
   *
   * ## The name is here, and here only
   *
   * Andy, 2026-08-15: **Vivek's name stays in the website footer only. Everywhere else — the
   * app-adjacent pages, the order and support copy — routes to `support@graybag.com`.**
   *
   * The split is not inconsistency, it is the two requirements pulling in opposite directions.
   * The DPDP Act requires a Data Fiduciary to *publish* the contact details of a named person
   * who answers data complaints, and this footer is the published surface — `E20-52` records
   * that notice version 2 added the name **specifically because** a general `info@` alias does
   * not satisfy a named-officer requirement.
   *
   * `E20-51` pulled the same name out of the app, for reasons that are just as real: a personal
   * mailbox behind a support route is unanswerable when that person is away, unchangeable
   * without every shipped build pointing at the wrong place, and it makes one individual the
   * public face of every complaint in an app-store listing.
   *
   * One published page carries the statutory name; nothing a parent taps inside the app does.
   *
   * ## The address is a role, not an individual's mailbox
   *
   * `grievance@graybag.com`, not `vivek@graybag.com`, even though the person is named beside it.
   * Naming the officer is what the Act asks for; routing every data complaint into one person's
   * inbox is what `E20-51` found to be the actual failure, and the two are separable. It also
   * stays a **separate address from `support@`** on purpose: `E20-51` kept the grievance route
   * distinct so a DPDP matter can be filtered out of the order-query pile, and those are on a
   * statutory clock.
   *
   * **`docs/privacy-policy.md` §7A still names `vivek@graybag.com` and was not touched.** That
   * is `E20-52` — `owner:andy`, risk:high, blocked on a lawyer's answer — and the task says in
   * as many words: do not edit the published wording. A `policy_version` row is immutable once
   * published, so changing it is a new notice version that re-triggers the acceptance gate for
   * every existing parent.
   */
  grievance: {
    heading: 'Grievance officer',
    name: 'Vivek',
    role: 'Grievance Officer, GrayBag',
    body:
      'For questions about personal data, or to exercise a right under the Digital Personal ' +
      'Data Protection Act, 2023.',
    email: 'grievance@graybag.com',
  },
} as const;

/**
 * The one claim on this site that would be a lie: a link to an app store.
 *
 * Neither app is published. `E12-05` stays open until they are, and `site.test.ts` asserts that
 * no built page contains a store URL — a dead download button on a sales page is worse than no
 * button, and this is the sort of thing that gets added by someone in a hurry six months from
 * now.
 */
export const FORBIDDEN_LINK_PATTERNS = [
  'apps.apple.com',
  'itunes.apple.com',
  'play.google.com',
  'testflight.apple.com',
] as const;
