import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { design, POLICY_DOCUMENTS, type PolicyKey } from '@graybag/shared';

import { Card } from '../components/Surfaces';

const { bg, text, space, scale, layout } = design;

/**
 * A policy document, in the app — `E20-38`.
 *
 * ## What was wrong
 *
 * `AccountScreen.onPolicy` had no caller. Three rows — Privacy policy, Terms of use, Refund
 * policy — rendered and did nothing, so the documents were, in the task's words, published and
 * unlinked. They were in fact **neither**: nothing in the app opened them, and all three still
 * carry `«…-PENDING-…»` placeholders awaiting `E20-01`.
 *
 * ## The text comes from `docs/`, not from a copy
 *
 * `POLICY_DOCUMENTS` is generated from the same markdown files that go to the lawyer and get
 * published, by `scripts/build-policy-docs.mjs`, checked for staleness in the smoke test. Two
 * copies of a legal document is one copy that is wrong, and the wrong one would be the one on
 * the parent's phone.
 *
 * ## A draft says it is a draft
 *
 * While a document still holds placeholders it is shown with a banner saying so. The
 * alternative — rendering `«GRIEVANCE-OFFICER-NAME-PENDING-E20-21»` inside a paragraph and
 * hoping nobody reads that far — is how a placeholder ends up in a store submission.
 * `E20-27` is the build guard that stops such a document shipping to production at all; this
 * banner is what makes it honest on the way there.
 *
 * ## Rendering
 *
 * Deliberately plain: headings, list items and paragraphs. A markdown library for three
 * documents that are read once would be a dependency, an app-size cost on a network-constrained
 * audience, and a new way for a legal document to render wrong.
 */
export function PolicyDocumentScreen({
  which,
  testID = 'screen-policy-document',
}: {
  which: PolicyKey;
  testID?: string;
}) {
  const doc = POLICY_DOCUMENTS[which];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID={testID}
    >
      <Text style={styles.title} accessibilityRole="header">
        {doc.title}
      </Text>

      {doc.hasPendingTokens ? (
        <Card testID={`${testID}-draft`}>
          <Text style={styles.draftHead}>This is a draft</Text>
          <Text style={styles.draftBody}>
            We&rsquo;re still finalising this document with our lawyers. Some details are marked
            as pending and will be filled in before launch.
          </Text>
        </Card>
      ) : null}

      <View style={styles.body}>
        {blocks(doc.markdown).map((block, i) => (
          <Text key={i} style={styleFor(block)} testID={`${testID}-block-${i}`}>
            {block.text}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'li' | 'p';
  text: string;
}

/**
 * Markdown, reduced to the four things these documents actually use.
 *
 * Exported so `PolicyDocumentScreen.test.tsx` can assert the reduction directly rather than
 * through a rendered tree — a legal document rendering as one unbroken paragraph is a defect
 * that is easy to miss visually and trivial to assert here.
 */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line === '' || /^([-*_])\1{2,}$/.test(line)) continue;

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      out.push({ kind: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text: plain(heading[2] ?? '') });
      continue;
    }
    const item = line.match(/^[-*]\s+(.*)$/);
    if (item) {
      out.push({ kind: 'li', text: `•  ${plain(item[1] ?? '')}` });
      continue;
    }
    // Consecutive prose lines are one paragraph — the source is hard-wrapped at 90 columns,
    // and rendering each wrapped line as its own block would break every sentence in the
    // document at an arbitrary point.
    const last = out[out.length - 1];
    if (last?.kind === 'p') last.text += ` ${plain(line)}`;
    else out.push({ kind: 'p', text: plain(line) });
  }
  return out;
}

/** Emphasis and code marks out; the words are the point. Links keep their text, drop the URL. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function styleFor(block: Block) {
  return block.kind === 'h1'
    ? styles.h1
    : block.kind === 'h2'
      ? styles.h2
      : block.kind === 'h3'
        ? styles.h3
        : block.kind === 'li'
          ? styles.li
          : styles.p;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { padding: layout.gutter, gap: space[3], paddingBottom: space[6] },
  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
  },
  body: { gap: space[2] },
  h1: { color: text.primary, fontSize: scale.h2.size, lineHeight: scale.h2.lineHeight, fontWeight: scale.h2.weight, marginTop: space[3] },
  h2: { color: text.primary, fontSize: scale.h3.size, lineHeight: scale.h3.lineHeight, fontWeight: scale.h3.weight, marginTop: space[3] },
  h3: { color: text.primary, fontSize: scale.label.size, fontWeight: scale.label.weight, marginTop: space[2] },
  li: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight, paddingLeft: space[2] },
  p: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  draftHead: { color: text.primary, fontSize: scale.label.size, fontWeight: scale.label.weight },
  draftBody: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
});
