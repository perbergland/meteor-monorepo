console.log("[diag] x.tests.ts top-level @ " + Date.now());
import { expect } from "chai";
import { wrapped } from "/imports/sym/wrapper";

describe("smoke x (non-full-app)", () => {
  it("uses wrapped (transitive TLA via wrapper)", () => {
    expect(wrapped).to.equal("wrapped(tla-shared)");
  });
});
