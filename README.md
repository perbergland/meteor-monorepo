# Rspack Symlink Bug Reproduction

This repo demonstrates a bug where `resolve.symlinks: false` works correctly in pure rspack but fails when rspack is invoked through Meteor 3.4RC1.

## The Setup

Both projects use the same pattern:
- `shared/shared-file.ts` imports `./peer` (peer.ts does NOT exist in shared/)
- Each project has `server/shared-file.ts` as a **symlink** to `../../shared/shared-file.ts`
- Each project has `server/peer.ts` which exports `MY_STRING`
- Both configs set `resolve.symlinks: false`

With `symlinks: false`, imports in the symlinked file should resolve from the **symlink location** (`server/`), not the real file location (`shared/`).

## Pure Rspack (WORKS)

```bash
cd rspack-repro
npm install
npm run build
# ✅ Compiles successfully - ./peer resolves to server/peer.ts
```

## Meteor + Rspack (FAILS)

```bash
cd typescript-rspack
npm install
npm run test-app
# ❌ Module not found: Can't resolve './peer' in '.../shared'
```

## The Bug

Despite both projects having identical:
- Directory structure
- Symlink setup
- `resolve.symlinks: false` configuration

The Meteor project fails because rspack resolves the symlink to its real path before applying the `symlinks: false` resolver option.

## File Structure

```
meteor-monorepo/
├── shared/
│   └── shared-file.ts              # imports ./peer (no peer.ts here!)
├── typescript-rspack/              # Meteor project - FAILS
│   ├── server/
│   │   ├── peer.ts                 # exports MY_STRING
│   │   └── shared-file.ts -> ../../shared/shared-file.ts
│   ├── rspack.config.ts            # has resolve.symlinks: false
│   └── package.json
├── rspack-repro/                   # Pure rspack - WORKS
│   ├── server/
│   │   ├── peer.ts                 # exports MY_STRING
│   │   └── shared-file.ts -> ../../shared/shared-file.ts
│   ├── rspack.config.js            # has resolve.symlinks: false
│   └── package.json
└── README.md
```
