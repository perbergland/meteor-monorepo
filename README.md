# Rspack Symlink Bug: `jsc.baseUrl` breaks `resolve.symlinks: false`

This repo demonstrates a bug where SWC's `jsc.baseUrl` option in `builtin:swc-loader` causes symlinked files to be resolved to their real path, ignoring rspack's `resolve.symlinks: false` setting.

## Root Cause

**The bug is in the interaction between SWC's `jsc.baseUrl` and rspack's `resolve.symlinks`.**

When `builtin:swc-loader` is configured with `jsc.baseUrl`, SWC resolves file paths to their real locations before rspack's resolver processes them. This causes symlinked files to lose their symlink context.

## The Setup

- `shared/shared-file.ts` imports `./peer` (peer.ts does NOT exist in shared/)
- `server/shared-file.ts` is a **symlink** to `../../shared/shared-file.ts`
- `server/peer.ts` exists and exports `MY_STRING`
- `resolve.symlinks: false` is set

With `symlinks: false`, imports should resolve from the **symlink location** (`server/`), not the real file location (`shared/`).

## Reproduction

### Works: Without `jsc.baseUrl`

```bash
cd rspack-repro
npm install
npm run build
# ✅ Compiles successfully
```

### Fails: With `jsc.baseUrl`

```bash
cd rspack-repro
npx rspack build --config rspack-with-baseurl.config.js
# ❌ Module not found: Can't resolve './peer' in '.../shared'
```

### Fails: Meteor (uses `jsc.baseUrl` internally)

```bash
cd typescript-rspack
npm install
npm run start
# ❌ Module not found: Can't resolve './peer' in '.../shared'
```

## The Difference

| Config | `jsc.baseUrl` | Result |
|--------|---------------|--------|
| `rspack.config.js` | not set | ✅ Works |
| `rspack-with-baseurl.config.js` | set to `__dirname` | ❌ Fails |
| Meteor's config | set to project dir | ❌ Fails |

## Root Cause Analysis (SWC Source Code)

The bug is in SWC's module transform code:

**File**: [`swc_ecma_transforms_module/src/path.rs`](https://github.com/swc-project/swc/blob/main/crates/swc_ecma_transforms_module/src/path.rs) (lines 270-277)

```rust
// Bazel uses symlink
// https://github.com/swc-project/swc/issues/8265
if let FileName::Real(resolved) = &target.filename {
    if let Ok(orig) = canonicalize(resolved) {
        target.filename = FileName::Real(orig);
    }
}
```

### What happens:

1. **Rspack resolves correctly**: With `resolve.symlinks: false`, rspack's resolver returns the symlink path without calling `realpath()`.

2. **SWC creates a resolver when `baseUrl` is set**: In [`swc/src/config/mod.rs`](https://github.com/swc-project/swc/blob/main/crates/swc/src/config/mod.rs), `get_resolver()` only creates a `NodeImportResolver` when `baseUrl` or `paths` are configured.

3. **SWC unconditionally calls `canonicalize()`**: When SWC's resolver processes an import, it calls `canonicalize()` which resolves symlinks to their real paths - defeating rspack's `symlinks: false` setting.

### Why it only happens with `baseUrl`:

Without `baseUrl`, SWC doesn't create its internal resolver, so no `canonicalize()` is called. The symlink path passes through unchanged.

### Historical context:

- [Issue #4057](https://github.com/swc-project/swc/issues/4057) - "Import statements improperly transformed when using symlinks"
- [PR #6716](https://github.com/swc-project/swc/pull/6716) - Attempted fix, reverted because it broke Bazel
- [Issue #8265](https://github.com/swc-project/swc/issues/8265) - Bazel issue that added `canonicalize()` back

## Workaround (Meteor)

Override `jsc.baseUrl` to an empty string in your `rspack.config.ts`:

```typescript
import { defineConfig } from "@meteorjs/rspack";

export default defineConfig((Meteor) => {
  return {
    resolve: {
      symlinks: false,
    },
    // Workaround: Set jsc.baseUrl to empty string to prevent SWC from
    // canonicalizing symlinks (which breaks resolve.symlinks: false)
    ...Meteor.extendSwcConfig({
      jsc: {
        baseUrl: "",
      },
    }),
  };
});
```

This works because when `baseUrl` is empty, SWC skips creating its `NodeImportResolver` entirely, so no `canonicalize()` is called.

**Caveat**: This disables SWC's path alias resolution (`paths` from tsconfig.json). If you need path aliases, this workaround won't work.

## Proper Fix

The fix needs to be in SWC or `@meteorjs/rspack`:

1. **SWC**: Add a `preserveSymlinks` option to `NodeImportResolver` that skips `canonicalize()` when true
2. **@meteorjs/rspack**: Don't set `jsc.baseUrl` by default if not needed for path aliases
3. **@meteorjs/rspack**: File a bug with SWC about the interaction between `baseUrl` and symlinks

## File Structure

```
meteor-monorepo/
├── shared/
│   └── shared-file.ts              # imports ./peer (no peer.ts here!)
├── typescript-rspack/              # Meteor project - FAILS
│   ├── server/
│   │   ├── peer.ts
│   │   └── shared-file.ts -> ../../shared/shared-file.ts
│   └── rspack.config.ts
├── rspack-repro/
│   ├── server/
│   │   ├── peer.ts
│   │   └── shared-file.ts -> ../../shared/shared-file.ts
│   ├── rspack.config.js            # Works (no baseUrl)
│   └── rspack-with-baseurl.config.js  # Fails (has baseUrl)
└── README.md
```

---

*Root cause analysis performed by [Claude Code](https://claude.ai/claude-code) (Claude Opus 4.5) by reading and tracing through the rspack and SWC source code on GitHub.*
