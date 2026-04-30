# Reproduce `meteor test --full-app` 0-passing on a clean public repo

## Goal

Reproduce, on this public fork (`perbergland/meteor-monorepo`, `chore/fullapp-repro` branch), the bug where `meteor test --full-app` reports `0 passing (0ms)` because the server bundle is never executed under rspack — observed in Per's private repo and previously misattributed to the eager-loader async race in [meteor#14371](https://github.com/meteor/meteor/issues/14371).

If the bug reproduces here, this branch becomes the minimal repro to attach to a new upstream issue. If it does not, the bug is private-repo-specific and the next bisect step is to drop in the private repo's `rspack.config.js` overrides.

## Source of truth

The full handoff is `.context/attachments/pasted_text_2026-04-30_15-01-53.txt`. This spec captures only what differs from that doc plus the decisions made in this session.

## Scope

This session ends after the first `meteor test --full-app --once` run on the configured repro. No upstream issue is filed yet; we report the run output to Per first.

Out of scope for this session: dropping in the private repo's custom `rspack.config.js`; adding `dd-trace`; filing the upstream issue; investigating the test-module config caching.

## Starting state

- Workspace: `/Users/per.bergland/conductor/workspaces/meteor-monorepo/victoria-v1`
- Origin: `git@github.com:perbergland/meteor-monorepo.git`
- Branch: `chore/fullapp-repro` (off `main`, has 2 setup commits already)
- App lives under `typescript-rspack/` (single Meteor app at that subdirectory)
- Currently: `METEOR@3.4-rc.1`, `@meteorjs/rspack@^0.2.54`, npm (`package-lock.json`)

## Target state for the repro run

1. `typescript-rspack/.meteor/release` → `METEOR@3.4.1`
2. `typescript-rspack/package.json` devDeps:
   - `@meteorjs/rspack`: `2.0.1` (pinned, not caret)
   - `@rspack/core`, `@rspack/cli`, `@swc/core`, `@swc/helpers` aligned to what `@meteorjs/rspack@2.0.1` peer-depends on
3. `@meteorjs/rspack@2.0.1`'s `lib/test.js` patched per the diff in the handoff doc, applied via `patch-package` (npm-native; no yarn conversion).
4. `server/main.ts` opens with `console.log("[diag] main.ts top-level @ " + Date.now());`
5. `server/x.app-tests.ts` exists with a top-level `console.log` and a single `it()` smoke test (chai-based).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Commit shape | One commit per step (Meteor bump → rspack bump → patch → diag/app-tests) | Per asked for bisectable history; lets the upstream issue link to specific commits. |
| Patch tooling | `patch-package` with `postinstall` hook | App is on npm (`package-lock.json`); converting to yarn just to get yarn's `patch:` protocol is unnecessary churn. `patch-package` is the standard npm equivalent. |
| Stop point | After the first `meteor test --full-app` run | Per wants to look at the output before deciding next steps (file upstream vs. drop in private rspack.config.js). |

## Reproduction commands

From `typescript-rspack/`:

```sh
meteor update --release 3.4.1                                   # step 1
npm install --save-dev @meteorjs/rspack@2.0.1 \
  @rspack/core@<peer> @rspack/cli@<peer> \
  @swc/core@<peer> @swc/helpers@<peer>                          # step 2 (peer versions tbd from npm view)
# step 3: edit node_modules/@meteorjs/rspack/lib/test.js by hand
npx patch-package @meteorjs/rspack                              # step 3 cont
# step 4: edit server/main.ts; create server/x.app-tests.ts
meteor test --full-app --once --driver-package meteortesting:mocha --port 3015   # step 5 — the repro
```

## Expected outcomes

- **Bug reproduces:** `0 passing (0ms)`, neither `[diag]` line appears. → Report to Per; next session files the upstream issue.
- **Bug does not reproduce:** Tests run, both `[diag]` lines fire. → Report to Per; next session drops in the private repo's `rspack.config.js` to bisect.
- **Something else happens** (build error, port conflict, etc.): Report to Per with the full output; do not "fix" it without confirmation, since the failure mode is itself diagnostic.

## Risks / open questions

- The exact peer versions for `@meteorjs/rspack@2.0.1` need to be looked up via `npm view @meteorjs/rspack@2.0.1 peerDependencies` before step 2. The handoff says "see private repo's `backgroundcheck/package.json` for a pinned set" but we don't have access to that here, so we'll resolve via `npm view`.
- `patch-package` against a transitive dep of `@meteorjs/meteor` (auto-installed by the rspack build plugin) may be re-clobbered by the auto-installer the way the handoff warns about for yarn. If that happens, we may need to also pin `@meteorjs/rspack` in a `resolutions`-equivalent (npm `overrides`) block. Will address if observed.
- The handoff describes a `.meteor/local/build/` cache invalidation issue. If the run produces unexpected output, verifying that `.meteor/local/build/programs/server/app/app.js` actually contains the test code is part of triage.
