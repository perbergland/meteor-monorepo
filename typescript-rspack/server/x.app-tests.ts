console.log("[diag] x.app-tests.ts top-level @ " + Date.now());
await Promise.resolve();
import { expect } from "chai";

describe("smoke x", () => {
  it("runs", () => {
    expect(1).to.equal(1);
  });
});
