# `chore/fullapp-repro` — public minimal repro for the rspack ↔ reify TLA race

This branch is a self-contained reproduction of the bug filed as
[meteor#14395](https://github.com/meteor/meteor/issues/14395) and the partial fix attempt at
[meteor#14396](https://github.com/meteor/meteor/pull/14396), shipped on top of an early
[meteor#14371](https://github.com/meteor/meteor/issues/14371) eager-loader patch that's
required for the non-`--full-app` path.

It exists so anyone reading the issues can clone, run a single command, and observe the
`0 passing (0ms)` symptom on a clean app — and inspect the verified upstream fix in diff form
against a working repro.

## TL;DR — reproduce the bug

```sh
git clone -b chore/fullapp-repro git@github.com:perbergland/meteor-monorepo.git
cd meteor-monorepo/typescript-rspack
npm install
meteor test --once --driver-package meteortesting:mocha
```

Expect:

```
[meteor-diag] test-meteor.js TOP @ <ts>
[meteor-diag] test-meteor.js AFTER-IMPORT @ <ts>     ← same ms
--- RUNNING SERVER TESTS ---
 0 passing (0ms)
```

`AFTER-IMPORT - TOP ≈ 0ms` and the test bundle never gets to evaluate any test files. Same shape
under `meteor test --full-app`.

The single line that flips this from "passes" to "0 passing" is in
[`shared/async-tla.ts`](./shared/async-tla.ts):

```ts
await new Promise<void>((resolve) => setTimeout(resolve, 500));
```

Replace it with `await Promise.resolve()` (a single microtask, drains before meteor proceeds)
and the suite passes 2/2 — the bug is masked. The 500 ms macrotask is a stand-in for any real
async TLA in a real app (`await mongoClient.connect()`, CSFLE handshake, dd-trace init, …).

## What lives where

| Path | Purpose |
|---|---|
| [`typescript-rspack/`](./typescript-rspack/) | The Meteor 3.4.1 + `@meteorjs/rspack@2.0.1` app. This is the test surface. |
| [`shared/`](./shared/) | Shared modules symlinked into `typescript-rspack/imports/sym/`. Includes `async-tla.ts` (the macrotask trigger), `wrapper.ts` (the non-async re-export the app-tests files import transitively), and `sym-util.ts` (a separate symlink-canonicalize repro the design doc describes). |
| [`typescript-rspack/server/main.ts`](./typescript-rspack/server/main.ts) | Server entry. Imports the TLA module + the symlinked util. |
| [`typescript-rspack/server/x.app-tests.ts`, `y.app-tests.ts`](./typescript-rspack/server/) | `--full-app` mode test files. Both transitively reach `async-tla.ts` via `wrapper.ts`. |
| [`typescript-rspack/server/x.tests.ts`, `y.tests.ts`](./typescript-rspack/server/) | Same shape, eager-mode test files. Confirms the bug is not specific to `--full-app`. |
| [`typescript-rspack/patches/@meteorjs+rspack+2.0.1.patch`](./typescript-rspack/patches/) | The meteor#14371 eager-loader patch (`forEach(ctx)` → `await Promise.all(... .map(ctx))`), applied via patch-package + a `postinstall` hook so `npm install` reapplies it. Required for non-`--full-app` mode. |
| [`typescript-rspack/packages/rspack/`](./typescript-rspack/packages/rspack/) | A `degit` of `ref-app/meteor#fix/14395-rspack-bridge-awaits-bundle-promise/packages/rspack` (PR meteor#14396, head `588e3c92`). Verbatim, no local edits — the two follow-up fixes documented during this work are already integrated upstream. With this local copy in place plus the meteor#14371 patch via patch-package, the reproduction passes 2/2 under both modes. |
| [`typescript-rspack/rspack.config.js`](./typescript-rspack/rspack.config.js) | Verbatim from the private repo (`ref-app/refapp@chore/bgc-rspack@e4ead81fca`). Provides `resolve.symlinks: false`, swc `jsc.baseUrl`/`jsc.paths` clearing, and the server-only externals function for `node:` prefix stripping etc. The first two are required for the symlinked `shared/` setup to build at all (see commit [`305c3ef`](../../commit/305c3ef) → [`2d0730a`](../../commit/2d0730a) for the failure-then-fix demo). The externals are inert here because none of the externalised packages are installed; they're kept verbatim so the file matches the private repo. |
| [`docs/superpowers/specs/`](./docs/superpowers/specs/) | The full design / findings / handoff documents — see "Documentation" below. |
| [`.context/drafts/`](./.context/drafts/) | Working drafts of the GitHub issue + PR comment bodies; gitignored. Includes the active handoff at [`14396-pr-fixes-handoff.md`](./.context/drafts/14396-pr-fixes-handoff.md) for taking the two PR fixes back to a meteor source checkout. |

## What works after which fixes

The branch's commits are designed to be bisectable so anyone reading along can `git checkout
<sha>` and verify each step. Three states matter:

1. **`b29e37f`** (`chore: disable meteor#14371 patch (bisect)`) — meteor#14371 patch off,
   bridge-file fix not yet present, eager-loader inlined synchronously.
   `meteor test` (non-`--full-app`): **0 passing**, the inlined `forEach(ctx)` discards the
   test-file Promises and `module.exports` ends up `undefined`.
2. **`eaf2fe2`** (`chore: re-enable meteor#14371 patch (load-bearing for non-full-app)`) —
   meteor#14371 patch on, no bridge-file fix yet.
   `meteor test`: **0 passing** still. The bundle's `module.exports` is now a Promise (good),
   but the bridge file (`_build/test/server-meteor.js`) doesn't await it (the bug this branch
   primarily reproduces).
3. **`4f05e9c`** (`chore: re-degit PR #14396 verbatim — both fixes now in PR head`) —
   meteor#14371 patch on, verbatim PR meteor#14396 source.
   `meteor test`: **2 passing** under both `meteor test` and `meteor test --full-app`.
   `[diag] async-tla.ts settled` actually fires; `AFTER-IMPORT - TOP ≈ 500ms`.

The current tip ([`4f05e9c`](../../commit/4f05e9c)) is the "fixed" state, with the PR's source
verbatim. Roll back to either of the earlier two to see the bug.

## How to make the bug reproduce or stop reproducing

The bug requires:

- A **TLA-shaped module reachable from the test bundle's transitive graph** — `await Promise.resolve()` is too fast to expose the race; the slow `setTimeout(500)` in [`shared/async-tla.ts`](./shared/async-tla.ts) is what makes the timing observable.
- **The bug's diagnostic instrumentation already ships with `@meteorjs/rspack@2.0.1`** — `[meteor-diag] <side>-meteor.js TOP @ <ts>` and `... AFTER-IMPORT @ <ts>` are emitted by `rspack_plugin.js:909`. When `AFTER-IMPORT - TOP ≈ 0ms`, the bridge's `import './<output>.js';` returned without awaiting the bundle's Promise. That's the smoking-gun signature.

To stop it reproducing: apply both halves of the fix (the meteor#14371 eager-loader patch AND
the bridge-file fix from #14396 with the two follow-ups documented in the handoff). With both
in place, the bundle's Promise propagates to a top-level-await on the bridge, the bridge
becomes a TLA module from reify's perspective, `entry.asyncEvaluation` is set, and core-runtime's
eager-load loop awaits the bridge before mocha runs.

## Documentation

Detailed write-ups in `docs/superpowers/specs/`:

- **[`2026-04-30-fullapp-no-bundle-exec-design.md`](./docs/superpowers/specs/2026-04-30-fullapp-no-bundle-exec-design.md)** — the original brainstorm + design for the repro setup. Captures the version pins, the symlink+canonicalize side-bug, why `meteor.testModule` was originally removed.
- **[`2026-04-30-fullapp-no-bundle-exec-findings.md`](./docs/superpowers/specs/2026-04-30-fullapp-no-bundle-exec-findings.md)** — interim findings from the long bisect. Includes the configuration matrix, the dead-ends I went down on the diagnosis (some claims here were later corrected — see the handoff for the canonical reading), and "things I got wrong" so a future reader doesn't repeat them.
- **[`2026-05-01-fullapp-no-bundle-exec-handoff.md`](./docs/superpowers/specs/2026-05-01-fullapp-no-bundle-exec-handoff.md)** — the canonical handoff. Status as of 2026-05-06, the verified upstream fix in PR #14396, the testModule.server experiment that ruled out a per-project workaround, and the two follow-up review fixes that landed on the PR before it was ready for merge.

For taking the fixes back to a meteor source checkout (i.e. updating PR #14396), see
[`.context/drafts/14396-pr-fixes-handoff.md`](./.context/drafts/14396-pr-fixes-handoff.md) —
a self-contained spec with the exact diffs ready to apply.

## Upstream issue/PR map

| Reference | What it is | Status |
|---|---|---|
| [meteor#14371](https://github.com/meteor/meteor/issues/14371) | Eager-loader: `forEach(ctx)` → `await Promise.all(... .map(ctx))` in `@meteorjs/rspack/lib/test.js`. | Open. The branch ships this as a `patch-package` patch. Required for non-`--full-app`. |
| [meteor#14392](https://github.com/meteor/meteor/issues/14392) | Original "boot.js's `vm.Script`" framing of the bug — the actual bug is at the rspack ↔ reify bridge, not the boot.js layer. | **Closed** as misframed; superseded by #14395. |
| [meteor#14395](https://github.com/meteor/meteor/issues/14395) | Bridge file doesn't await the bundle's Promise. The corrected diagnosis. | Open. Fix is in PR #14396 (below). |
| [meteor#14396](https://github.com/meteor/meteor/pull/14396) | Per's enhancement of the bridge-file fix — detect-async-bundle gate so non-TLA bundles aren't penalised. | Open. PR head `588e3c92` includes both follow-up fixes (correct rspack signal in `detectAsyncBundle`, `looksLikeRspackBundle` guard in the loop). Verbatim PR source verified to produce 2 passing on this branch's slow-TLA repro under both modes — see commit [`4f05e9c`](../../commit/4f05e9c). |

## Branch hygiene notes

- The branch is currently 27 commits ahead of `main`. Each commit is intentionally small/atomic
  so any earlier state can be checked out and run.
- `~/.meteor` was modified during the investigation but restored to original; verified
  byte-identical to a fresh meteor extraction.
- The `typescript-rspack/packages/rspack/.npm/devPackage/node_modules/` directory is gitignored
  to keep the diff focused on the package source.
