# `meteor test --full-app` repro on a clean public fork — findings

Companion to `2026-04-30-fullapp-no-bundle-exec-design.md`. The handoff in
`.context/attachments/pasted_text_2026-04-30_15-01-53.txt` was worked through
on a clean public fork (`perbergland/meteor-monorepo`, `chore/fullapp-repro`).

## TL;DR

- **The bundle-not-executed bug under `meteor test --full-app` did not
  reproduce** on a clean public repo, despite assembling every structural
  ingredient enumerated in the handoff.
- **The meteor#14371 eager-loader patch is not load-bearing** in the public
  setup — vanilla `forEach(ctx)` works fine with TLA and two app-tests files
  under `@meteorjs/rspack@2.0.1`. Patch is on this branch but disabled in the
  current tip; the disable commit is the relevant evidence.
- **A separate, reliably-reproducible symlink + canonicalize bug was
  surfaced.** It's the bug Per's private `rspack.config.js` (`resolve.symlinks:
  false` + clearing swc's `jsc.baseUrl`/`jsc.paths`) was already working
  around. Worth its own upstream issue if not already filed.

## Branch layout

`chore/fullapp-repro` — 16 commits on top of `main`. Each repro step is its
own commit, so the state of any variant is `git checkout <sha>`.

| Commit | Step |
|---|---|
| `28b7d2e` | docs: spec |
| `203816b` | docs: spec — pin peer versions, drop testModule |
| `1810834` | bump meteor to 3.4.1 |
| `4b9d9a8` | bump @meteorjs/rspack to 2.0.1 + peers + npm overrides |
| `b65fa14` | apply #14371 patch via patch-package + postinstall |
| `0646504` | add diag logs + smoke app-tests + drop meteor.testModule |
| `c61df7e` | record auto-installer mutations from first run |
| `24e71b5` | TLA in all server modules |
| `200c18e` | drop in private repo's rspack.config.js verbatim |
| `b29e37f` | disable #14371 patch (bisect) |
| `9f5f50a` | revert rspack.config.js to no-op stub |
| `305c3ef` | add symlinked shared/sym-util.ts (broken) |
| `2d0730a` | restore rspack.config.js (fixes symlink resolution) |
| `2dbec9b` | add dd-trace + tracer.init() |
| `2aee22b` | remove dd-trace |
| `fc5a0ce` | 5-deep transitively-async chain through shared/ |
| `7edc9ea` | shared TLA between main.ts (direct) + app-tests (transitive) |

## Configuration matrix

| Variant | `meteor test --full-app` outcome |
|---|---|
| METEOR@3.4.1 + @meteorjs/rspack@2.0.1 + #14371 patch | 1 passing |
| + TLA in main.ts and both app-tests files | 2 passing |
| + Private rspack.config.js; patch *disabled* | 2 passing |
| + Symlinked shared/sym-util.ts; rspack.config stubbed | **Build fails** (symlink canonicalize) |
| + Same; private rspack.config.js restored | 2 passing |
| + dd-trace import + `tracer.init()` | 2 passing |
| + 5-deep transitively-async chain through shared/ (no own TLA in test files) | 2 passing |
| Final tip: shared TLA module, main.ts imports directly, app-tests via wrapper transitively | 2 passing |

## What did reproduce

### Symlink + canonicalize bug (commit `305c3ef`)

With rspack defaults (`resolve.symlinks: true`) AND swc's `NodeImportResolver`
enabled (which `@meteorjs/rspack` does by default by setting
`jsc.baseUrl`/`jsc.paths`), a symlinked file's relative imports get looked up
at the *canonical* path rather than the symlink location.

Repro:

- `shared/sym-util.ts` (real) — `import { SYM_NAME } from "./sym-name"`
- `typescript-rspack/imports/sym/sym-name.ts` (real, only at this path)
- `typescript-rspack/imports/sym/sym-util.ts` → symlink to `../../../shared/sym-util.ts`
- `server/main.ts` imports `/imports/sym/sym-util`

Build fails:

```
ERROR in ../shared/sym-util.ts 1:1-38
  × Module not found: Can't resolve './sym-name' in '/.../victoria-v1/shared'
```

Fix (commit `2d0730a`): clear swc's `jsc.baseUrl` / `jsc.paths` AND set
`resolve.symlinks: false`. Both layers canonicalize, both fixes are needed.
Per's private `rspack.config.js` already has detailed comments about this; if
it isn't an upstream issue yet, this branch is the minimal repro.

## What did not reproduce

### The bundle-not-executed bug under `--full-app` (the actual goal)

Did not reproduce with any combination of:

- TLA in entry modules and/or test files
- Multiple `*.app-tests.ts` files (2 tried; not stress-tested with 10+)
- Symlinked `shared/` source tree (single TLA module, 5-deep TLA chain, and
  the shared-TLA-direct-vs-transitive split Per described from the private
  repo)
- `dd-trace` integration (`import` + `tracer.init()`)
- The exact `rspack.config.js` from the private repo verbatim (commit
  `200c18e`)
- Shared TLA module across direct (main.ts) and transitive (app-tests via
  wrapper) import paths

### The meteor#14371 eager-loader async race

Patch is applied at commit `b65fa14`, then disabled at `b29e37f`. With
vanilla `forEach(ctx)` + TLA in test files + 2 app-tests, the test still
reports the expected pass count. The patch is not load-bearing here.

This may mean:
- rspack's async-module handling improved between the patch's filing and
  `@meteorjs/rspack@2.0.1`, or
- the bug requires conditions narrower than "any async test file" (e.g., a
  larger test count where promise scheduling actually matters), or
- the bug is conditional on something specific to the private repo.

## Behavioral observations worth keeping

### Diag-log ordering depends on whether main.ts itself has TLA

Under `meteor test --full-app` with rspack (METEOR@3.4.1, @meteorjs/rspack@2.0.1):

- **`main.ts` has top-level await:** `[diag] main.ts top-level` prints
  *after* the `--- RUNNING APP SERVER TESTS ---` banner. main.ts evaluates
  during the test phase, in the same async wave as the eager-loaded test
  files.
- **`main.ts` is async only via a transitive import:** `[diag] main.ts top-level`
  prints *before* the banner. main.ts evaluates during normal server bundle
  startup; the test bundle attaches and the test files evaluate during the
  test phase.

This is a real behavioral difference in Meteor's program-loader sequencing.
If the bundle-not-executed bug is conditional on which of these two timings
applies, this is a useful lever to know about.

### Auto-installer mutates `package.json` mid-build

The rspack build plugin's auto-installer (driven by
`DEFAULT_METEOR_RSPACK_VERSION` in `@meteorjs/rspack`) bumps sibling rspack
packages (`@rsdoctor/rspack-plugin` was bumped from `^1.2.3` to `^1.5.7`) on
the first `meteor test --full-app` run. The npm `overrides` block we set only
locks `@meteorjs/rspack` itself; siblings are still mutable. Per's
`verify-meteor-rspack-patch.mjs` script handles the
`@meteorjs/rspack`-itself-being-clobbered case but not the sibling case.
Documented in commit `c61df7e`.

### Shared async modules are correctly de-duplicated

In the final variant (commit `7edc9ea`): one TLA module (`async-tla.ts`) is
imported directly by `main.ts` AND transitively by both app-tests files (via
a non-async `wrapper.ts`). The module's top-level `console.log` fires
**exactly once**, and both bundles see the same value. So Meteor's
module-runtime correctly de-dups async modules across server-bundle and
test-bundle entries — at least at this scale.

## Hypotheses ruled out

Each as a clean checkpoint commit on this branch:

- "Async-module wrapper alone triggers it" → ruled out (TLA everywhere, still passes)
- "Private rspack.config workarounds + symlinks" → ruled out
- "dd-trace's require-in-the-middle" → ruled out
- "Deep transitively-async chain" → ruled out
- "Shared TLA across direct + transitive importers" → ruled out

## Open hypotheses (not tried)

In rough order of likelihood:

1. **`.meteor/local/build/` cache pathology.** Per's note in the handoff:
   stale `app.js` from `METEOR@3.4-rc.0` survived `meteor update --release
   3.4.1` until manual deletion. Plausibly the actual bug — cache
   invalidation in the rspack plugin not running on release bumps. Easy to
   test on the private repo: after a failing run, dump the first 200 bytes
   of `.meteor/local/build/programs/server/app/app.js`; if the file doesn't
   contain the test code, cache invalidation is the culprit.
2. **Real-scale `shared/` source tree** with many files, real imports,
   actual transitive load — not synthetic.
3. **Many app-tests files** (10+) all importing the same wrapper. Pressure
   test the de-dup.
4. **Circular import between two TLA modules.** Most fragile spot in
   rspack's async-module wrapping.
5. **Wrapper does `await import()`** (dynamic) of the TLA module rather than
   a static import — different code path through rspack's lazy/eager module
   handling.
6. **Actual `mongodb-client-encryption` import** with the externals function
   intercepting it.

## Suggested next moves

### On the private repo

1. After a failing `meteor test --full-app` run, dump the first ~200 bytes
   of `.meteor/local/build/programs/server/app/app.js` and confirm whether
   the file contains the test code at all. That distinguishes "bundle not
   executed" from "bundle written but main module not entered" from "bundle
   is stale from a previous build".
2. Try `rm -rf .meteor/local/build .meteor/local/bundler-cache && yarn
   test:app` and see if the bug clears. If it does, file the cache
   invalidation issue separately.
3. If the bug only fires after a release bump or after switching between
   `--full-app` and non-`--full-app` modes, that's a strong signal pointing
   at cache invalidation in the rspack plugin rather than anything
   async-related.

### On this public branch

If/when the cache hypothesis is ruled out and the search returns to
structural triggers, the open hypotheses above are listed roughly by the
cost of trying them.
