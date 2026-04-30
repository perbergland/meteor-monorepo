const { defineConfig } = require("@meteorjs/rspack");

/**
 * Backgroundcheck rspack overrides.
 *
 * The repo symlinks individual files from ../shared/ into backgroundcheck/.
 * Two pieces of the build chain canonicalize symlink paths before resolving
 * relative imports, which causes `./peer` imports inside shared/ files to be
 * looked up from ../shared/ rather than from the symlinked location:
 *
 *   - swc's NodeImportResolver, reached via swc-loader when jsc.baseUrl or
 *     jsc.paths is set. @meteorjs/rspack injects both by default.
 *   - rspack's resolver, when resolve.symlinks is left at its default (true).
 *
 * The first three sections below address that. The last two work around
 * unrelated server-bundle issues that only surfaced once the build got past
 * the symlink failure.
 */
module.exports = defineConfig((Meteor) => {
  // (1) Skip swc's NodeImportResolver. It short-circuits when both baseUrl
  // and paths are empty (skip_resolver = base_url.is_empty() && paths.is_empty()),
  // which avoids the canonicalize step entirely. We don't need swc-level path
  // resolution because rspack handles module resolution for us.
  const baseSwc = Meteor.swcConfigOptions || {};
  const { baseUrl: _baseUrl, paths: _paths, ...jsc } = baseSwc.jsc || {};
  const swcOptions = { ...baseSwc, jsc };

  // Server-only externals function. Externals run before NormalModuleFactory
  // hooks and so are reachable for requests that externalsPresets: { node: true }
  // would otherwise short-circuit — that's why this is a function rather than
  // a NormalModuleReplacementPlugin.
  const externalizedPackages = new Set([
    // Native binary loaded via require by mongodb's optional CSFLE path.
    "mongodb-client-encryption",
    // Optional dd-trace integration whose @openfeature/server-sdk peer is not
    // installed. dd-trace handles the missing module at runtime via try/catch;
    // externalizing keeps rspack from following the import graph statically.
    "@datadog/openfeature-node-server",
    "@openfeature/server-sdk",
  ]);

  const serverExternals = Meteor.isServer
    ? [
        ({ request }, callback) => {
          if (!request) {
            return callback();
          }
          // (3) Strip the node: prefix. dd-trace's require-in-the-middle hook
          // crashes (`Cannot read properties of undefined (reading 'original')`)
          // when intercepting `require('node:crypto')` routed through Meteor's
          // modules-runtime. The bare form goes through cleanly.
          if (request.startsWith("node:")) {
            return callback(null, `commonjs ${request.slice("node:".length)}`);
          }
          // (4) Underscore-prefixed Node internals (e.g. _http_common used by
          // @mswjs/interceptors). Loadable at runtime, but not matched by
          // externalsPresets: { node: true }, so rspack tries to bundle them.
          if (
            request.startsWith("_http_") ||
            request.startsWith("_stream_") ||
            request.startsWith("_tls_")
          ) {
            return callback(null, `commonjs ${request}`);
          }
          // (5) .node native binaries can't be parsed as JS. Let Node load them
          // via runtime require instead.
          if (request.endsWith(".node")) {
            return callback(null, `commonjs ${request}`);
          }
          // (6) playwright-core (used by ui tests under --full-app). Bundling it
          // walks into chromium-bidi/electron sub-imports that aren't installed
          // and into binary assets (.png/.css/.ttf/.html/.svg) rspack can't parse.
          // Externalising the package and any sub-path import skips the walk.
          if (
            request === "playwright-core" ||
            request.startsWith("playwright-core/")
          ) {
            return callback(null, `commonjs ${request}`);
          }
          // (7) See externalizedPackages above.
          if (externalizedPackages.has(request)) {
            return callback(null, `commonjs ${request}`);
          }
          return callback();
        },
      ]
    : [];

  return {
    ...Meteor.replaceSwcConfig(swcOptions),
    // (2) Keep rspack at the symlink location. Without this, the resolver
    // canonicalizes paths and relative imports inside shared/ files resolve
    // against ../shared/ rather than the symlinked importer.
    resolve: { symlinks: false },
    externals: serverExternals,
  };
});
