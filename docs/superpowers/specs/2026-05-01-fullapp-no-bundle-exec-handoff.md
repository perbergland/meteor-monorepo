# Handoff — `meteor test` 0-passing under TLA + rspack

Companion to:
- `2026-04-30-fullapp-no-bundle-exec-design.md` (the original spec)
- `2026-04-30-fullapp-no-bundle-exec-findings.md` (interim findings during dead-ends)

This file is the intended starting point for a new session or contributor picking up the work.

## Status as of 2026-05-01

- **Diagnosed end-to-end.** The bundle-not-executed bug under `meteor test` is reliably
  reproducible on a clean public fork. Both the trigger and the fix are tracked in code references.
- **Verified two-line fix.** With both upstream changes applied (Fix A + Fix B below), the slow-TLA
  repro flips from `0 passing` to `2 passing` under both `meteor test` and `meteor test --full-app`.
- **Public branch:** `perbergland/meteor-monorepo@chore/fullapp-repro`, tip
  [`eaf2fe2`](https://github.com/perbergland/meteor-monorepo/commit/eaf2fe2). Each variant is a
  separate commit; checkpoints inspectable via `git checkout <sha>`.
- **Upstream issues:**
  - [meteor#14371](https://github.com/meteor/meteor/issues/14371) — eager-loader patch
    (`forEach(ctx)` → `await Promise.all(... .map(ctx))`). Still open. **This is Fix A.**
  - [meteor#14392](https://github.com/meteor/meteor/issues/14392) — closed (framing was wrong;
    boot.js's synchronous evaluation is not the gate).
  - [meteor#14395](https://github.com/meteor/meteor/issues/14395) — bridge file doesn't await the
    bundle's Promise. **This is Fix B**, the new issue replacing #14392.
- **No upstream PR yet.** Fix B's two-line change lives in the meteor `rspack` package source, not
  in the `@meteorjs/rspack` npm package, so it can't be applied via project-level patch-package.
  Open question for the next session: open a PR against `meteor/meteor`'s `packages/rspack/...`
  source.

## Reproduction (broken state on the branch)

```sh
git clone git@github.com:perbergland/meteor-monorepo.git
cd meteor-monorepo
git checkout chore/fullapp-repro
cd typescript-rspack
npm install

meteor test --full-app --once --driver-package meteortesting:mocha --port 3015
# 0 passing (0ms)

meteor test --once --driver-package meteortesting:mocha --port 3015
# 0 passing (0ms)
```

Branch ships Fix A (the meteor#14371 patch via patch-package) so the failure shown is specifically
the residual one — the bridge file gap that Fix B addresses.

## The bug, in one paragraph

The auto-generated bridge file `_build/<env>/server-meteor.js` does
`import './server-rspack.js'`. The rspack bundle's `module.exports` is a Promise (because the bundle
has TLA somewhere in its transitive graph). Reify's `moduleLink`
(`@meteorjs/reify/lib/runtime/index.js:91-138`) gates "is this dep async?" on
`childEntry.asyncEvaluation`, which is set only by `wrapAsync()`, which runs only when reify's babel
transform identifies the *source* as TLA. The rspack bundle's source is a synchronous
`(() => {...})()` IIFE — no source-level TLA — so reify never wraps it, the flag stays false,
`addAsyncDep` is not called, and `__reifyWaitForDeps__()` returns null. The bridge prints `TOP`,
prints `AFTER-IMPORT` in the same millisecond, returns. core-runtime moves on to mocha while the
bundle's Promise is still pending.

## The fix

Both are needed for full coverage. Either alone leaves residual breakage in one mode.

### Fix A — eager-loader patch (issue #14371)

In `@meteorjs/rspack`'s `lib/test.js` `generateEagerTestFile`:

```diff
-  ctx.keys().filter(...).forEach(ctx);
+  await Promise.all(ctx.keys().filter(...).map(ctx));
```

Load-bearing for non-`--full-app` (where the eager loader is inlined in the bundle's outer sync
IIFE). Without it, the inline `forEach(ctx)` discards the test files' Promises and the bundle's
`module.exports` ends up `undefined`, so Fix B has nothing to await.

The branch ships this patch via `typescript-rspack/patches/@meteorjs+rspack+2.0.1.patch` +
`patch-package` postinstall.

### Fix B — bridge file awaits the bundle (issue #14395)

In the meteor `rspack` package codegen at
`~/.meteor/packages/rspack/.<ver>/plugin.rspack.os/packages/rspack_plugin.js:909`:

```diff
-import './${outputFile}';
+import * as __rspackBundleNs from './${outputFile}';
+await Promise.resolve(__rspackBundleNs && __rspackBundleNs.default);
 console.log('[meteor-diag] ' + side + '-meteor.js AFTER-IMPORT @ ' + Date.now());
```

Why this shape:
- `import * as` registers the dep statically with reify AND captures a real binding (which
  `const X = require('./literal')` does NOT — reify's transform optimises that pattern into
  `module.link` without preserving the binding).
- `__rspackBundleNs.default` is the bundle's `module.exports`. For TLA bundles, that's a Promise.
- `await Promise.resolve(...)` flattens; await waits.
- The top-level `await` makes the bridge file itself a TLA module — reify wraps it with
  `wrapAsync`, sets `entry.asyncEvaluation = true` on the bridge's entry, and core-runtime starts
  treating the bridge as async. The bundle Promise propagates up the eager-load loop properly.
- For non-TLA bundles, `__rspackBundleNs.default` is whatever the bundle's `module.exports` was;
  `Promise.resolve(<non-thenable>)` resolves on the next microtask — effectively a no-op. So
  projects without TLA aren't penalised.

Cannot be patch-packaged in a project — the file lives in the meteor `rspack` package source, not
the `@meteorjs/rspack` npm package.

## What I'd do next

1. **Open a PR** against `meteor/meteor`'s `packages/rspack/...` source with Fix B. Reference
   issue #14395 in the PR description. The change is the `import * as` / `await Promise.resolve`
   two-line replacement at the codegen template.
2. **Watch for review feedback.** Likely concerns from maintainers:
   - Does the `Promise.resolve(...)` wrap correctly handle non-TLA bundles? (Answer: yes — the
     namespace's `default` is whatever `module.exports` was, which for non-TLA CJS-output is
     typically the exports object; `Promise.resolve(<obj>)` then `await <obj>` is a no-op.)
   - Does this affect the client-side bridge similarly? (`isMeteorBlazeProject() && config.isClient`
     branch in the same template — the client's eager loader is structurally similar but I haven't
     verified Fix B's behaviour there. Worth probing in a follow-up.)
   - What about `mainModule` (non-test) entry points? The same codegen template feeds main-dev
     bridges too. The await of an empty bundle (`Promise.resolve(undefined)`) is safe but worth
     confirming there's no production-mode regression.
3. **Test additional scenarios** that might still fail:
   - Multiple-bundle setups (e.g. cordova + browser + server).
   - Real-world TLA via async I/O (`await mongoClient.connect()`, `await fetchConfig()`) rather
     than synthetic `setTimeout`.
   - Production builds (`meteor --production`) — the codegen has `role === FILE_ROLE.run` /
     `isProduction` branches we haven't exercised.
4. **Decide on the path forward for the symlink-canonicalize bug** that surfaced separately on
   this branch (commit `305c3ef`, fixed by `2d0730a`). It's unrelated to the TLA race but is a
   real `@meteorjs/rspack` bug that may not have its own upstream issue yet. Either file
   separately or include as a section in #14395 — your call.

## Helpful files in the workspace

- `docs/superpowers/specs/2026-04-30-fullapp-no-bundle-exec-design.md` — original spec.
- `docs/superpowers/specs/2026-04-30-fullapp-no-bundle-exec-findings.md` — interim findings
  (includes dead ends; the comprehensive matrix). Worth scanning for the "Behavioral observations"
  section.
- `.context/drafts/14371-followup-comment.md` — earlier comment posted to #14371
  (#14371 issuecomment-4353029040 / 4355796239). Some of its diagnosis was wrong and was patched
  later; treat as historical.
- `.context/drafts/14371-repro-found-comment.md` — the corrected #14371 follow-up.
- `.context/drafts/new-issue-rspack-tla-race.md` — the body of #14395.
- `.context/drafts/new-issue-title.txt` — its title.
- `.context/attachments/pasted_text_2026-04-30_15-01-53.txt` — the original handoff that started
  this work.

## Things I got wrong (so you don't repeat them)

1. **Spent multiple iterations claiming the gate was somewhere it wasn't.**
   - Claimed `core-runtime/load-js-image.js`'s `checkAsyncModule()` was the gate. **Wrong** — that
     check is downstream of `entry.asyncEvaluation`, which is the actual flag. Naively widening
     `checkAsyncModule` to recognise generic thenables broke load order because reify's
     `_requireAsSync` couldn't handle non-reify async modules.
   - Claimed boot.js's `vm.Script` was the gate (via #14392). **Wrong** — boot.js calls
     `require('vm').runInThisContext(wrapped, ...)` (not `vm.Script`), evaluates the program file
     `app/app.js` synchronously, but the Promise this issue is about isn't created at the boot.js
     layer. It's created downstream when core-runtime walks `eagerModulePaths`.
2. **Assumed `const X = require('./Y')` would preserve the binding.** It doesn't — reify's
   transform converts that pattern into `module.link('./Y')` without a setter, dropping the
   binding. `import * as` is the working alternative because it has explicit setter semantics.
3. **Used `await Promise.resolve()` for TLA when reproducing.** Single microtask drains before
   meteor proceeds to mocha; race is masked. Use `await new Promise(r => setTimeout(r, 500))` (or
   any real macrotask) to expose the race.
4. **Assumed dead-pattern matching from upstream issue OPs.** I parroted #14392's "vm.Script"
   wording into the new issue body without checking what the code actually calls. Per caught it,
   I patched it. Lesson: when in doubt, `grep` the source rather than the comment thread.

## Plumbing I left intact (verify on arrival)

- `~/.meteor/packages/core-runtime/.../os/load-js-image.js` — restored to original (verified
  byte-identical to a fresh meteor extraction).
- `~/.meteor/packages/rspack/.<ver>/plugin.rspack.os/packages/rspack_plugin.js` — restored to
  original (verified byte-identical).
- Both `.bak` files I created during experiments were removed.
- The branch ships Fix A only. Fix B requires either upstream landing or local plugin-source
  patching, neither of which is in this repo.
