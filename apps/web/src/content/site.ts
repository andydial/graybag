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
 * Three claims, each one checkable from something in this repository, because a number a
 * principal cannot verify is worth less than no number.
 */
export const FACTS = [
  {
    value: '85 dishes',
    label: 'on the rotating menu — Indian, continental, breakfast through afternoon snack',
    // tools/mirror-dish-images/manifest.json: 85 dish records in the legacy catalogue.
  },
  {
    value: 'One kitchen',
    label: 'in Mohali, already cooking for schools every school day',
    // SC1: Mohali only, confirmed 2026-08-07.
  },
  {
    value: 'Zero cash',
    label: 'handled at school — every order is paid before the food is cooked',
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

export const FOOD = {
  eyebrow: 'The food',
  heading: 'Real dishes, on a menu that moves',
  lead:
    'The menu runs from idli sambar and rajma rice through wraps, salads and sandwiches to a ' +
    'small bakery. Brown wheat and atta bases as standard, paneer rather than processed meat, ' +
    'and quinoa and sprouts on the same list as the muffins.',
  footnote:
    'Photographs are of the dishes we actually cook. The menu published to your school is ' +
    'agreed with you and changes through the year.',
} as const;

export const SCHOOLS = {
  eyebrow: 'Already running',
  heading: 'Already serving schools across Mohali',
  lead:
    'We would rather show you the operation than describe it. If you are within reach of the ' +
    'kitchen, come and see a delivery go out.',
  /**
   * Named smaller, under a softer claim, on Andy's instruction — the strongest version of this
   * section names them as clients outright, and that is a claim each school should get to
   * approve first. Raised as an `owner:andy` task before the DNS cutover (`E12-10`).
   */
  names: ['Amity International', 'Gem Public', 'Paragon Senior Secondary'] as const,
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
   * The name and direct line are `owner:andy` — appointing the officer is his to do — so what
   * is published is the route that is certain to work today. A published contact that reaches
   * nobody would be worse than the generic one.
   */
  grievance: {
    heading: 'Grievance officer',
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
