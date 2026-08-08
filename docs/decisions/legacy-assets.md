# Decisions — Legacy assets outside git

`RH1`–`RH4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

The 46 MB design package lives at `../Legacy-Application-backup/`, a sibling of this
repository, and `Legacy-Application/` is in `.gitignore` — copy it into the working tree when a
task needs it (`planning/OVERNIGHT.md` step 3). The `git filter-repo` rewrite that removed it
from all 66 commits is described in the archive.

| # | Decision | Why |
|---|---|---|
| RH1 | **The 46 MB design package is kept outside git rather than in it** | Git stores a new full copy of every binary on every change and can diff none of it. The package is a 21.8 MB brand-guidelines PDF, `.ai` and `.pptx` sources, patterns and nine UI mocks — none of which git adds any value to holding. It inflated the packed repository from under 1 MB to 36 MB, which is a permanent tax on every clone and every CI checkout, forever, for files that change perhaps twice a year and are read by humans, not by the build |
| RH2 | **The licensed fonts are the harder half of the reason** | Ten `VAG-Rounded-Next-*.ttf` files were committed. A git repository is a redistribution channel, and the licence has never been checked (`E13-14`, `owner:andy`, still open). Keeping the binaries in history meant the answer to "may we redistribute this typeface?" was already "we have been". Outside git, the licence question stays a question about *use*, which is the answer-able one, and the repo can go public without that being a decision nobody made |
| RH3 | **`filter-repo` over `git rm`** | `git rm` in a new commit leaves every byte in history, so clone cost and the redistribution point both stand. Only rewriting removes them. The root commit `b5805b7` never contained the package, so its SHA survived the rewrite and the branch remained a clean fast-forward onto the unborn `origin/main` |
| RH4 | **A verified byte-for-byte copy and a full `--all` bundle were taken first** | `filter-repo` deletes the stripped paths from the working tree as well as from history — without the copy the assets would have been gone from disk the moment it ran. `../graybag-pre-rewrite.bundle` (36 MB, `git bundle verify` clean) holds the entire pre-rewrite history including the five merged agent worktree branches, so the rewrite is reversible in full |

**One caution.** `../Legacy-Application-backup/` contains `Legacy-DB/gray-bag-23660.bubble`,
the Bubble export with live secrets. It was never committed — `*.bubble` has always been
gitignored — and it must not be moved into this or any other repository. Non-negotiable #5.
