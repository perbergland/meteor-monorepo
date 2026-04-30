console.log("[diag] x.app-tests.ts top-level @ " + Date.now());
import { expect } from "chai";

describe("smoke", () => {
  it("runs", () => {
    expect(1).to.equal(1);
  });
});
