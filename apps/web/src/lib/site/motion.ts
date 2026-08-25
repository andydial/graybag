/**
 * Motion on the marketing site — `E12-36`.
 *
 * ## Why this is a module and not an inline script
 *
 * The site sends `Content-Security-Policy: … script-src 'self'`. An inline `<script>` is refused
 * by the browser, and the first version of this was `is:inline` — so the page shipped with no
 * motion whatsoever and nothing that looked like a failure, because the CSS degrades silently to
 * "everything visible". It worked locally, because a plain file server sends no CSP. Bundled, it
 * is served from the origin and runs.
 *
 * ## The rules everything here follows
 *
 * **Transform and opacity only.** Both are composited; animating anything else on a long page on a
 * mid-range Android is how a marketing site starts dropping frames on the device it is meant to
 * impress.
 *
 * **The page must be complete without this file.** Nothing is hidden by the stylesheet unless
 * `html.js` is present, and this module is what adds it. Blocked, broken, or an old browser — the
 * page reads exactly as it would have.
 *
 * **Off, not gentler, under `prefers-reduced-motion`.** Checked once here and again in CSS.
 */

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Count a number up when it arrives.
 *
 * Only for the ledger's `2` and `7`, which are the one place on the page where a number *is* the
 * argument. A counter on a decorative figure is the kind of motion that decorates rather than
 * supports, which is the line Andy drew.
 */
function countUp(el: HTMLElement, to: number): void {
  const DURATION = 650;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    // Ease-out cubic: fast to nearly-there, then settles. A linear count reads like a stopwatch.
    const eased = 1 - (1 - t) ** 3;
    el.textContent = String(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  requestAnimationFrame(step);
}

export function startMotion(): void {
  const root = document.documentElement;
  const sections = document.querySelectorAll<HTMLElement>('[data-reveal]');

  // The hero is above the fold and is not observed — it plays on load, once, so the page is never
  // blank while something decides whether to show it.
  const hero = document.querySelector<HTMLElement>('.hero');

  if (reduced()) {
    // Nothing is ever hidden, so there is nothing to reveal. Numbers go straight to their value.
    for (const n of document.querySelectorAll<HTMLElement>('[data-count]')) {
      n.textContent = n.dataset.count ?? n.textContent;
    }
    return;
  }

  root.classList.add('js');
  hero?.classList.add('is-in');

  /**
   * Give each staggered child its index, so the delay lives in CSS rather than in a timer per
   * element. One custom property, no `setTimeout` chains, and it survives a re-render.
   *
   * The step itself is `calc(var(--i) * 70ms)` in `site.css` — long enough to read as a sequence,
   * short enough that the last card is not still arriving after you have started reading the first.
   * It is deliberately not duplicated here: two copies of a timing constant drift.
   */
  for (const section of sections) {
    const items = section.querySelectorAll<HTMLElement>('[data-stagger] > *');
    items.forEach((item, i) => item.style.setProperty('--i', String(i)));
  }
  document.querySelectorAll<HTMLElement>('.hero [data-stagger] > *')
    .forEach((item, i) => item.style.setProperty('--i', String(i)));

  if (!('IntersectionObserver' in window)) {
    for (const section of sections) section.classList.add('is-in');
    return;
  }

  const reveal = (section: HTMLElement) => {
    if (section.classList.contains('is-in')) return;
    section.classList.add('is-in');
    for (const n of section.querySelectorAll<HTMLElement>('[data-count]')) {
      const to = Number(n.dataset.count);
      if (Number.isFinite(to)) countUp(n, to);
    }
  };

  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal(entry.target as HTMLElement);
      // Once. A section that fades out again on the way back up fights you every time you re-read it.
      seen.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

  for (const section of sections) {
    // Anything already on screen is revealed on the next frame rather than waiting to be observed,
    // so a short viewport never shows a gap.
    if (section.getBoundingClientRect().top < innerHeight * 0.9) requestAnimationFrame(() => reveal(section));
    else seen.observe(section);
  }

  /*
   * The failsafe, deliberately long.
   *
   * The first version used three seconds and **defeated the feature**: on any normal visit the
   * timer fired before the reader had scrolled, so every section was already revealed and nothing
   * ever animated. Ten seconds is long past the point where a real visitor has scrolled, and it
   * still guarantees that a broken observer cannot leave copy invisible.
   */
  setTimeout(() => { for (const section of sections) reveal(section); }, 10_000);

  /*
   * The hero device drifts as you scroll — a few pixels, tied to scroll position rather than to a
   * clock, so it reads as depth rather than as an animation playing at you.
   *
   * `requestAnimationFrame`-gated and a passive listener: the handler does one write to one
   * custom property and never reads layout, so it cannot cause a synchronous reflow.
   */
  const device = document.querySelector<HTMLElement>('.hero__device');
  if (device) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = Math.min(scrollY, 900);
        device.style.setProperty('--drift', `${(y * 0.04).toFixed(1)}px`);
        ticking = false;
      });
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}
