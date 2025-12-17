import { defineConfig } from "@meteorjs/rspack";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

/**
 * Rspack configuration for Meteor projects.
 *
 * Provides typed flags on the `Meteor` object, such as:
 * - `Meteor.isClient` / `Meteor.isServer`
 * - `Meteor.isDevelopment` / `Meteor.isProduction`
 * - …and other flags available
 *
 * Use these flags to adjust your build settings based on environment.
 */
export default defineConfig((Meteor) => {
  return {
    resolve: {
      symlinks: false,
    },
    plugins: [new TsCheckerRspackPlugin()],
    // Workaround: Set jsc.baseUrl to empty string to prevent SWC from
    // canonicalizing symlinks (which breaks resolve.symlinks: false)
    // See: https://github.com/swc-project/swc/blob/main/crates/swc_ecma_transforms_module/src/path.rs
    ...Meteor.extendSwcConfig({
      jsc: {
        baseUrl: "",
      },
    }),
  };
});
