console.log("[diag] y.app-tests.ts top-level @ " + Date.now());
await Promise.resolve();
import { expect } from "chai";

describe("smoke y", () => {
  it("runs too", () => {
    expect(2).to.equal(2);
  });
});
