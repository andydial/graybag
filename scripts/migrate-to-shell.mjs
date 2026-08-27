#!/usr/bin/env node
/**
 * Move a back-office page onto the shell — `E10-55`.
 *
 *     node scripts/migrate-to-shell.mjs reports.astro "Revenue" "…subtitle…" /reports
 *
 * Ten screens share one frame and one set of old class names. Converting them by hand ten times is
 * ten chances to convert them slightly differently, which is the failure this whole exercise is
 * about — so the mechanical part is mechanical. What it cannot decide (the subtitle, and anything
 * the prototype does differently on that screen) stays a human edit afterwards.
 *
 * It is deliberately **not** idempotent-by-cleverness: it asserts the old frame is present and
 * refuses if it is not, rather than half-converting a file that has already been done.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [file, title, subtitle, current] = process.argv.slice(2);
if (!file || !title || !subtitle || !current) {
  console.error('usage: migrate-to-shell.mjs <page.astro> <title> <subtitle> <current-href>');
  process.exit(1);
}

const path = resolve('apps/web/src/pages', file);
let s = readFileSync(path, 'utf8');

const before = s;

// 1. Imports: the shell component and its stylesheet, in place of the nav and the old two.
s = s.replace(
  /import BackofficeNav from '(\.\.\/)+components\/BackofficeNav\.astro';/,
  (m) => m.replace('BackofficeNav', 'BackofficeShell').replace('BackofficeNav.astro', 'BackofficeShell.astro'),
);
s = s.replace(/^import '(\.\.\/)+styles\/kitchen\.css';\n/m, '');
s = s.replace(/^import '((\.\.\/)+)styles\/admin\.css';$/m, "import '$1styles/backoffice.css';");

// 2. The frame. Everything from `<div class="kitchen">` to the end of the header becomes the
//    component's opening tag; the actions in that header become its `actions` slot.
const headerRe =
  /<div class="kitchen">\s*<header class="kitchen__bar">\s*<div class="kitchen__bar-inner kitchen__bar-inner--admin">\s*<h1 class="kitchen__title">[^<]*<\/h1>\s*([\s\S]*?)<BackofficeNav current="[^"]*" \/>\s*<\/div>\s*<\/header>\s*<main class="kitchen__wrap admin__wrap">/;
const match = headerRe.exec(s);
if (!match) {
  console.error(`${file}: the old frame is not here — already migrated, or shaped differently.`);
  process.exit(1);
}

const actions = match[1]
  .trim()
  .replace(/class="kitchen__btn kitchen__refresh"/g, 'class="btn btn--ghost" slot="actions"')
  .replace(/class="kitchen__btn kitchen__btn--primary"/g, 'class="btn" slot="actions"')
  .replace(/class="kitchen__btn"/g, 'class="btn btn--ghost" slot="actions"');

s = s.replace(
  headerRe,
  `<BackofficeShell\n      current="${current}"\n      title="${title}"\n      subtitle="${subtitle}"\n    >\n      ${actions}\n`,
);
s = s.replace(/<\/main>\s*<\/div>/, '</BackofficeShell>');

// 3. The vocabulary. Old name on the left, the prototype's on the right.
const RENAMES = [
  // Headline stat cards became `.grid` of `.card`, with `.k` for the number and `.m` for the note.
  [/class="gstats"/g, 'class="grid"'],
  [/class="gstat gstat--warn"/g, 'class="card card--warn"'],
  [/class="gstat"/g, 'class="card"'],
  [/class="gstat__n"/g, 'class="k"'],
  [/class="gstat__l"/g, 'class="m"'],
  [/class="gstat__note"/g, 'class="m"'],
  // Sections: a labelled rule rather than a heading with its own margins.
  [/class="admin__section-note"/g, 'class="m"'],
  [/class="admin__hint admin__hint--warn"/g, 'class="notice notice--warn"'],
  [/class="admin__hint"/g, 'class="m"'],
  [/class="admin__intro"/g, 'class="m"'],
  // States.
  [/class="kitchen__skeleton"/g, 'class="sk"'],
  [/class="kitchen__state"/g, 'class="empty"'],
  [/class="kitchen__oneway kitchen__oneway--block"/g, 'class="notice notice--info"'],
  [/class="kitchen__oneway"/g, 'class="notice notice--info"'],
  // Controls.
  [/class="kitchen__btn kitchen__btn--primary"/g, 'class="btn"'],
  [/class="kitchen__btn kitchen__btn--small"/g, 'class="chip"'],
  [/class="kitchen__btn"/g, 'class="btn btn--ghost"'],
  [/class="admin__select"/g, 'class=""'],
  [/class="admin__input"/g, 'class=""'],
  [/class="admin__label"/g, 'class=""'],
  // Tables: the wide ones must scroll in their own box rather than push the page.
  [/class="otable__num"/g, 'class="num"'],
  [/class="otable"/g, 'class=""'],
];
for (const [from, to] of RENAMES) s = s.replace(from, to);
s = s.replace(/ class=""/g, '');

// 4. The mount call.
s = s.replace(/import \{ mountNav \} from '((\.\.\/)+)lib\/backoffice\/nav-mount\.js';/,
  "import { mountShell } from '$1lib/backoffice/shell.js';");
s = s.replace(/mountNav\(\)/g, 'mountShell()');

if (s === before) {
  console.error(`${file}: nothing changed.`);
  process.exit(1);
}

writeFileSync(path, s);
console.log(`${file} -> shell (${title})`);
