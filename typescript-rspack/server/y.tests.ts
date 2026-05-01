console.log("[diag] y.tests.ts top-level @ " + Date.now());
import { expect } from "chai";
import { wrapped } from "/imports/sym/wrapper";

describe("smoke y (non-full-app)", () => {
  it("also uses wrapped (transitive TLA via wrapper)", () => {
    expect(wrapped).to.equal("wrapped(tla-shared)");
  });
});
