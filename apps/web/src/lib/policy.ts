import { readFileSync } from 'node:fs';

import { legal } from '@graybag/shared';
import { marked } from 'marked';

/**
 * Render one of the three policy documents from `docs/` into HTML, at build time.
 *
 * ## The markdown stays the source
 *
 * `PP1` says the three policies cross-reference rather than duplicate, on the reasoning that one
 * source per fact is what stops a change to the cancellation window editing one document and
 * missing two. A copy of a legal document inside `apps/web` would be the same mistake one level
 * up — and the worst possible document to have two of.
 *
 * So these pages are a *view* of `docs/privacy-policy.md`, `docs/terms.md` and
 * `docs/refund-policy.md`. The lawyer edits the markdown; the site follows.
 *
 * ## The unresolved-placeholder gate
 *
 * All three documents are drafts. Every value a lawyer still has to supply is written as
 * `«SOMETHING-PENDING-E20-01»`, and `E20-22` requires that a production build containing one
 * **fails**, exactly as `G3` does for the GST values. That gate is implemented here, in
 * `assertPublishable`, because this is the last place the tokens exist before they would become
 * a published legal claim.
 *
 * A privacy notice that says the grievance officer is `«GRIEVANCE-OFFICER-NAME-PENDING-E20-21»`
 * is worse than no privacy notice: it is a published statement that we have not appointed one.
 */

/** The three documents, and where each is served. */
export const POLICIES = {
  privacy: {
    source: 'docs/privacy-policy.md',
    path: '/privacy',
    title: 'Privacy policy',
    description:
      'How GrayBag handles personal data, including children’s data, under India’s Digital ' +
      'Personal Data Protection Act, 2023.',
  },
  terms: {
    source: 'docs/terms.md',
    path: '/terms',
    title: 'Terms of service',
    description: 'The terms on which GrayBag sells and delivers school meals.',
  },
  refunds: {
    source: 'docs/refund-policy.md',
    path: '/refunds',
    title: 'Refund policy',
    description: 'When a GrayBag order can be cancelled, and how refunds are made.',
  },
} as const;

export type PolicyKey = keyof typeof POLICIES;

/**
 * The placeholder pattern.
 *
 * Guillemets, because they cannot occur by accident in English prose and because that is the
 * convention `docs/dpdp-compliance.md` and `G3` already established. Matching the delimiters
 * rather than the word "PENDING" catches a token somebody wrote without it.
 */
const PLACEHOLDER = /«[^»]+»/g;

export interface RenderedPolicy {
  readonly html: string;
  readonly title: string;
  readonly description: string;
  readonly path: string;
  /** Every distinct unresolved placeholder found, sorted. Empty means the document is final. */
  readonly placeholders: readonly string[];
}

/**
 * The three documents cross-reference each other, and on disk they do it by filename.
 *
 * `PP1` requires the cross-references — refund detail lives only in the refund policy, and Terms
 * §6 summarises and links to it — so the links are load-bearing rather than decorative. But
 * `[the Refund Policy](./refund-policy.md)` is correct inside `docs/` and a 404 on the web, and
 * that 404 lands on the one link a regulator or an app-store reviewer is most likely to follow.
 *
 * The build's link check caught all three. This map is the fix, and `renderPolicy` throws on any
 * `.md` link that is not in it — so a fourth cross-reference added later fails the build instead
 * of shipping broken.
 */
const CROSS_REFERENCES: Record<string, string> = {
  './privacy-policy.md': '/privacy',
  './terms.md': '/terms',
  './refund-policy.md': '/refunds',
  'privacy-policy.md': '/privacy',
  'terms.md': '/terms',
  'refund-policy.md': '/refunds',
};

function rewriteCrossReferences(markdown: string, source: string): string {
  const rewritten = markdown.replace(/\]\(([^)]*\.md)\)/g, (whole, target: string) => {
    const web = CROSS_REFERENCES[target];
    if (!web) {
      throw new Error(
        `${source} links to "${target}", which has no published web equivalent.\n` +
          `Add it to CROSS_REFERENCES in src/lib/policy.ts, or make it plain text. A markdown ` +
          `path that reaches the website is a 404 on a legal document.`,
      );
    }
    return `](${web})`;
  });
  return rewritten;
}

/** Strip the YAML frontmatter, which is internal metadata and not part of the document. */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown;
  return markdown.slice(markdown.indexOf('\n', end + 1) + 1);
}

/**
 * Strip the leading blockquote, which is a note to ourselves and not part of the document.
 *
 * All three policies open with one — provenance for the two the lawyer already approved, and for
 * `terms.md` a drafting warning. **Every word of it was being published.** A parent opening
 * `/terms` read "⚠ DRAFT FOR LEGAL REVIEW — DO NOT PUBLISH AS-IS", "Nothing here has been checked
 * by a lawyer", two internal task ids and an instruction about CI — on a live URL.
 *
 * That is worse than an unresolved token. A token looks like a mistake; this reads as a statement
 * about the document's standing, and it is the first thing on the page.
 *
 * Only the *leading* blockquote goes. A blockquote further down is authored content — the policies
 * use them for emphasis — and the note is always first because it is written for whoever opens the
 * file.
 */
function stripLeadingNote(markdown: string): string {
  const lines = markdown.split('\n');

  // Only the preamble — everything before the first `##` section. The policies use blockquotes
  // inside their sections for emphasis, and those are authored content that must survive.
  const firstSection = lines.findIndex((l) => l.startsWith('## '));
  const limit = firstSection === -1 ? lines.length : firstSection;

  const start = lines.findIndex((l, i) => i < limit && l.startsWith('>'));
  if (start === -1) return markdown;

  let end = start;
  while (end < lines.length && lines[end]!.startsWith('>')) end += 1;

  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  // Collapse the blank line the note left behind, so the page does not open with a gap.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimStart();
}

export function findPlaceholders(markdown: string): string[] {
  return [...new Set(markdown.match(PLACEHOLDER) ?? [])].sort();
}

/**
 * Fail the build if a document that is about to be published still has a placeholder in it.
 *
 * Only in production. In development and on a preview deploy the page renders with a visible
 * pre-launch notice instead, because the whole point of building these pages now is that the
 * plumbing, the links and the typography can be reviewed before `E20-01` returns from the
 * lawyer. Refusing to render at all would mean nobody could look at them until the last moment.
 */
export function assertPublishable(policy: RenderedPolicy, isProduction: boolean): void {
  if (!isProduction || policy.placeholders.length === 0) return;
  throw new Error(
    [
      `Refusing to build ${policy.path} for production: ${policy.placeholders.length} unresolved placeholder(s).`,
      '',
      ...policy.placeholders.map((p) => `  ${p}`),
      '',
      'These are values a lawyer has to supply (E20-01, E20-21, E20-12). Publishing a policy',
      'with a placeholder in it is publishing a false statement about our own practice.',
      'This gate is E20-22. Resolve the tokens in docs/, or build without PUBLIC_SITE_STAGE=production.',
    ].join('\n'),
  );
}

/**
 * Make every table its own horizontally scrollable, keyboard-reachable region.
 *
 * The privacy notice has a retention table wider than a phone. Wrapping the whole document in
 * `overflow-x: auto` made the entire page a scroll container that a keyboard user could not
 * reach — axe's `scrollable-region-focusable`, and a real barrier rather than a technicality:
 * without a focusable ancestor there is no key that scrolls it.
 *
 * `tabindex="0"` plus `role="region"` and a name is the accepted pattern, and scoping it to the
 * table means exactly one tab stop appears, and only on the pages that have a table.
 */
function wrapTables(html: string): string {
  return html.replace(
    /<table>([\s\S]*?)<\/table>/g,
    (whole) => `<div class="doc__table" tabindex="0" role="region" aria-label="Table, scrollable">${whole}</div>`,
  );
}

export function renderPolicy(key: PolicyKey, repoRoot: URL): RenderedPolicy {
  const meta = POLICIES[key];
  // Tokens are substituted from `legal.COMPANY` before anything else looks at the text, so the
  // published document and the placeholder guard both see the resolved version. A value that is
  // still unknown is left as its token and `assertPublishable` refuses it (`E12-25`).
  const markdown = legal.resolveTokens(
    rewriteCrossReferences(
      stripLeadingNote(stripFrontmatter(readFileSync(new URL(meta.source, repoRoot), 'utf8'))),
      meta.source,
    ),
  );

  return {
    html: wrapTables(marked.parse(markdown, { async: false, gfm: true })),
    title: meta.title,
    description: meta.description,
    path: meta.path,
    placeholders: findPlaceholders(markdown),
  };
}
