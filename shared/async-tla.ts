console.log("[diag] async-tla.ts top-level @ " + Date.now());
// Slow TLA to expose the meteor#14392 race: boot.js evaluates the bundle
// with vm.Script and does not await the resulting `module.exports` promise.
// `Promise.resolve()` is a single microtask and may be drained before
// meteor proceeds; a setTimeout is a real macrotask that meteor's bootloader
// will return *before* completing.
await new Promise<void>((resolve) => setTimeout(resolve, 500));
console.log("[diag] async-tla.ts settled @ " + Date.now());
export const TLA_VAL = "tla-shared";
