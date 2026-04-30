console.log("[diag] y.app-tests.ts top-level @ " + Date.now());
import { expect } from "chai";
import { wrapped } from "/imports/sym/wrapper";

describe("smoke y", () => {
  it("also uses wrapped (transitive TLA via wrapper)", () => {
    expect(wrapped).to.equal("wrapped(tla-shared)");
  });
});
