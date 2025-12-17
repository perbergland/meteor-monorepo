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

## Fix

The fix needs to be in `@meteorjs/rspack` - either:
1. Don't set `jsc.baseUrl` in the SWC loader config
2. Or file a bug with rspack about the interaction between `jsc.baseUrl` and `resolve.symlinks`

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
