console.log("[diag] x.app-tests.ts top-level @ " + Date.now());
import { expect } from "chai";
import { wrapped } from "/imports/sym/wrapper";

describe("smoke x", () => {
  it("uses wrapped (transitive TLA via wrapper)", () => {
    expect(wrapped).to.equal("wrapped(tla-shared)");
  });
});
