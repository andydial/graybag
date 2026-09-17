import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `E21-102`. **Both things that move the balance must ask for it again.**
 *
 * Andy, walking staging: *"'Your meal packs' still read 20 of 20 after an order that used 2. Only
 * force-quitting and relaunching showed 18 of 20."* And the reason it matters, in his words: *"A
 * parent who has just spent two items and still sees 20 will assume the order didn't go through
 * and order again."*
 *
 * `E21-95` gave `MealPackSurfaceContext` a `refresh()` and wired it to the one event known at the
 * time to move the number — a purchase. A **redemption** moves it exactly as much and had no call,
 * so the fix was half a fix: the context was correct and nobody told it anything had happened.
 *
 * ## Why this reads the source
 *
 * The call sits inside `RootNavigator`'s checkout poll, behind a navigation container, a session,
 * a cart, a connectivity context and a two-second interval. Rendering all of that to assert one
 * function call would be a test about mocks. What is worth pinning is **structural** and survives
 * a rewrite of everything around it: the refresh happens where the order is confirmed, and the
 * effect that contains it does not depend on the object that the refresh itself replaces.
 *
 * `delivery-notice-wiring.test.ts` makes the same trade for the same reason.
 */

const source = readFileSync(join(__dirname, '../navigation/RootNavigator.tsx'), 'utf8')
  // Blanked, not deleted, so offsets still line up: the comments below quote the very calls and
  // identifiers being scanned for, and a test that reads prose as code fails whenever somebody
  // explains themselves clearly.
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

describe('the pack balance is re-read whenever it changes', () => {
  it('refreshes after a PURCHASE — E21-95, still wired', () => {
    // The half that already worked. Asserted so that fixing one call site can never silently
    // remove the other, which is exactly the shape of the bug being fixed here.
    expect(source).toMatch(/packSurface\.refresh\(\)/);
  });

  it('refreshes after a REDEMPTION — the half that was missing', () => {
    expect(source).toMatch(/refreshPackSurface\(\)/);
  });

  it('does it where the order is CONFIRMED, beside clearing the cart', () => {
    /*
     * Not on tapping Place order, and not when the sheet reports success — both are moments when
     * nothing has been spent yet. The server confirms settlement in the poll; that is when the
     * items have actually left the pack, and it is the same instant the cart is emptied.
     */
    const clearAt = source.indexOf('clearCart();');
    const refreshAt = source.indexOf('refreshPackSurface();');
    // No message argument: this is jest, where `expect` takes exactly one. vitest's two-argument
    // form is what the shared package uses, and it does not carry over.
    expect(clearAt).toBeGreaterThan(-1); // the cart clear
    expect(refreshAt).toBeGreaterThan(-1); // the balance refresh
    // Same block: no `}` between them.
    const between = source.slice(clearAt, refreshAt);
    expect(between).not.toContain('}');
  });

  it('is UNCONDITIONAL — not gated on what the client thought the pack would cover', () => {
    /*
     * The tempting saving is `if (packCoverageForCart.itemsCovered > 0)`. It is wrong: that memo
     * is the CLIENT's view of what the pack would cover, and the server decides what was actually
     * spent. Gating on it would skip the refresh in precisely the case where the client was wrong
     * — which is the failure this whole sequence of fixes has been about.
     */
    const refreshAt = source.indexOf('refreshPackSurface();');
    const lineStart = source.lastIndexOf('\n', refreshAt);
    const statement = source.slice(lineStart, refreshAt);
    expect(statement.trim()).toBe('');
    // And the coverage memo is not consulted anywhere near it.
    expect(source.slice(refreshAt - 400, refreshAt)).not.toContain('itemsCovered');
  });

  it('depends on the stable CALLBACK, never on the surface object', () => {
    /*
     * The poll effect's own comment says `checkout` must never appear in its dependency array
     * because it is a new object each render — *"that is what produced the infinite loop"*.
     * `packSurface` is the same hazard and worse: it is rebuilt when the balance changes, which
     * this very call causes, so depending on it would tear down and restart the poll each time,
     * taking an in-flight confirmation with it. `refresh` is a `useCallback(…, [])`.
     */
    const deps = /\}, \[pollGroupId[^\]]*\]\);/.exec(source)?.[0];
    expect(deps).toBeTruthy(); // the poll effect's dependency array
    expect(deps).toContain('refreshPackSurface');
    expect(deps).not.toContain('packSurface,');
    expect(deps).not.toMatch(/\bpackSurface\]/);
  });

  it('takes the callback out of the surface once, rather than reaching through it', () => {
    // `const refreshPackSurface = packSurface.refresh;` — the binding that makes the dependency
    // above stable. Reaching through `packSurface.refresh` inside the effect would compile and
    // would put the object back in the closure.
    expect(source).toMatch(/const refreshPackSurface = packSurface\.refresh;/);
  });
});
